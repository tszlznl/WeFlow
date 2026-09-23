/**
 * Jev 判断内核在 WeFlow 里的服务层。把 jev-chat-windows 的 core/ 移植进来后，
 * 这一层负责两件内核不管的事：
 *
 * 1. 适配：WeFlow 的 Message（isSend/parsedContent/senderDisplayName）→ 内核要的
 *    {from: 'me'|'her', text, name}。群聊带上发言人名，单聊不带（内核靠有没有 name 区分群聊）。
 * 2. 取数 + 配置：从 chatService 拉会话消息，从 ConfigService 读接口配置。
 *
 * 内核（questions/jevClient/draft/engine）对 WeFlow 一无所知，可以单独测、单独复用。
 */
import { chatService, type Message } from './chatService'
import { ConfigService } from './config'
import { analyze, type AnalysisResult } from './jev/engine'
import type { JevMessage } from './jev/draft'
import { DRAFT_PROVIDERS } from './jev/draft'
import type { DraftProvider } from './jev/draft'
import { messagesToBubbles } from './jev/adapter'

export type { JevChatBubble } from './jev/adapter'

export interface AnalyzeSessionParams {
  sessionId: string
  /** 群聊里指定回复给谁；不传 = 正常回复。 */
  replyTo?: string | null
  /** 直接传消息进来（已经取好的场景）；不传就从数据库取最近 context 条。 */
  messages?: Message[]
  /** 是否强制刷新（跳过传入的 messages）。 */
  forceRefresh?: boolean
}

export interface JevConfig {
  enabled: boolean
  relationship: string
  context: number
  style: string
  draftProvider: DraftProvider
  thinking: boolean
  judgeProvider: 'typesafe' | 'openrouter' | ''
  judgeEndpoint: string
  judgeApiKey: string
  judgeModel: string
  draftApiBaseUrl: string
  draftApiKey: string
  draftModel: string
}

class JevService {
  private config: ConfigService

  constructor(config: ConfigService) {
    this.config = config
  }

  /** 当前配置（每次读，改设置不用重启进程）。密钥读出来只在这一次调用里用，不缓存。 */
  getConfig(): JevConfig {
    // 起草接口默认复用 WeFlow 已有的共享模型配置（aiModel*），没单独配就跟着它走，
    // 这样已经填过一次 key 的用户不用再填一遍
    const sharedBaseUrl = String(this.config.get('aiModelApiBaseUrl') || '').trim()
    const sharedApiKey = String(this.config.get('aiModelApiKey') || '').trim()
    const sharedModel = String(this.config.get('aiModelApiModel') || '').trim()

    const provider = String(this.config.get('jevDraftProvider') || 'openrouter')
    const draftProvider = provider === 'deepseek' ? 'deepseek' : 'openrouter'
    const draftDefault = DRAFT_PROVIDERS[draftProvider]

    const draftBaseUrl = String(this.config.get('jevDraftApiBaseUrl') || '').trim() || sharedBaseUrl || draftDefault.baseUrl
    const draftApiKey = String(this.config.get('jevDraftApiKey') || '').trim() || sharedApiKey
    const draftModel = String(this.config.get('jevDraftApiModel') || '').trim() || sharedModel || draftDefault.model

    const relationship = String(this.config.get('jevRelationship') || '朋友').trim() || '朋友'
    const style = String(this.config.get('jevStyle') || '').trim()

    return {
      enabled: this.config.get('jevEnabled') === true,
      relationship,
      context: clampContext(this.config.get('jevContext')),
      style,
      draftProvider,
      thinking: this.config.get('jevThinking') === true,
      judgeProvider: (() => {
        const p = String(this.config.get('jevJudgeProvider') || '').trim()
        return p === 'typesafe' || p === 'openrouter' ? p : ''
      })(),
      judgeEndpoint: String(this.config.get('jevJudgeEndpoint') || '').trim(),
      judgeApiKey: String(this.config.get('jevJudgeApiKey') || '').trim(),
      judgeModel: String(this.config.get('jevJudgeModel') || '').trim(),
      draftApiBaseUrl: draftBaseUrl,
      draftApiKey,
      draftModel
    }
  }

  /** 判断接口通不通：发一个最小 state 过去，只要 HTTP 不是 4xx/5xx 就算通。 */
  async testConnection(): Promise<{ success: boolean; message: string }> {
    const cfg = this.getConfig()
    if (!cfg.judgeApiKey) {
      return { success: false, message: '未填写判断接口 API Key' }
    }
    try {
      const { ask, resolveJudgeEndpoint } = await import('./jev/jevClient')
      const { JUDGE_QUESTIONS } = await import('./jev/questions')
      const judge = resolveJudgeEndpoint({
        provider: cfg.judgeProvider || undefined,
        endpoint: cfg.judgeEndpoint || undefined,
        model: cfg.judgeModel || undefined
      })
      // 用真实题集里最轻的一道（literal_question 是非题），免得白白消耗一道判断的额度
      await ask(
        { chat: { relationship: 'test', messages: [{ from: 'her', text: '测试' }], latest_from: 'her', is_group: false, reply_to: null } },
        { literal_question: JUDGE_QUESTIONS.literal_question },
        {
          endpoint: judge.endpoint,
          apiKey: cfg.judgeApiKey,
          model: judge.model,
          timeoutMs: 15_000
        }
      )
      return { success: true, message: `判断接口连接正常（${judge.model} @ ${judge.endpoint}）` }
    } catch (e) {
      return { success: false, message: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * 分析一个会话：从数据库取最近 context 条消息，转成内核格式，跑 analyze。
   * 只在最新一条是对方发的时候才值得跑——调用方不传 messages 时这里会先取消息再判断。
   */
  async analyzeSession(params: AnalyzeSessionParams): Promise<AnalysisResult & { success: boolean; error?: string }> {
    const cfg = this.getConfig()
    if (!cfg.judgeApiKey) {
      return { success: false, error: '未填写判断接口 API Key', candidates: [], bestIndex: 0, bestReply: '', scores: [0, 0, 0], answers: {}, usage: {} }
    }
    if (!cfg.draftApiKey || !cfg.draftApiBaseUrl) {
      return { success: false, error: '未填写起草接口地址或 Key', candidates: [], bestIndex: 0, bestReply: '', scores: [0, 0, 0], answers: {}, usage: {} }
    }

    let messages = params.messages
    if (!messages || params.forceRefresh) {
      const result = await chatService.getMessages(params.sessionId, 0, Math.max(cfg.context, 20), 0, 0, false)
      if (!result.success || !result.messages) {
        return { success: false, error: result.error || '读取会话消息失败', candidates: [], bestIndex: 0, bestReply: '', scores: [0, 0, 0], answers: {}, usage: {} }
      }
      messages = result.messages
    }

    const bubbles = messagesToBubbles(messages, params.sessionId)
    if (bubbles.length === 0) {
      return { success: false, error: '这个会话没有可分析的文本消息', candidates: [], bestIndex: 0, bestReply: '', scores: [0, 0, 0], answers: {}, usage: {} }
    }
    // 群聊 sessionId 带 @chatroom 后缀。replyTo 在私聊里也有效（右键指定回哪句），
    // 但只有群聊才该给起草模型注入「这是群聊、只对 TA 说」的提示。
    const isGroup = String(params.sessionId || '').includes('@chatroom')

    try {
      const result = await analyze(bubbles, cfg.relationship, {
        context: cfg.context,
        draftProvider: cfg.draftProvider,
        replyTo: params.replyTo || null,
        isGroup,
        style: cfg.style,
        thinking: cfg.thinking,
        judgeProvider: cfg.judgeProvider || undefined,
        judgeEndpoint: cfg.judgeEndpoint || undefined,
        judgeApiKey: cfg.judgeApiKey,
        judgeModel: cfg.judgeModel || undefined,
        draftApiBaseUrl: cfg.draftApiBaseUrl,
        draftApiKey: cfg.draftApiKey,
        draftModel: cfg.draftModel || undefined
      })
      return { ...result, success: true }
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e),
        candidates: [], bestIndex: 0, bestReply: '', scores: [0, 0, 0], answers: {}, usage: {}
      }
    }
  }
}

function clampContext(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return 10
  return Math.max(3, Math.min(30, Math.round(n)))
}

export const jevService = new JevService(ConfigService.getInstance())
