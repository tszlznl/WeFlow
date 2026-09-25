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
import { app } from 'electron'
import { ConfigService } from './config'
import { analyze, type AnalysisResult } from './jev/engine'
import { DecisionCacheStore } from './decisionCacheService'
import type { JevMessage } from './jev/draft'
import { DRAFT_PROVIDERS } from './jev/draft'
import type { DraftProvider } from './jev/draft'
import { messagesToBubbles } from './jev/adapter'
import { pickReadableText } from './jev/pickText'

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

/**
 * 把 shouldReply 题集的 answers 整成前端要的二结论。
 * should_reply_now 的 noul>=0.5 = 该现在回；把握按选中结论算（否定态是 1-v）。
 */
export function shapeQuickVerdict(answers: Record<string, any>): {
  verdict: 'reply' | 'wait'
  confidence: number
  sheNeeds: string
} {
  const v = typeof answers.should_reply_now?.noul === 'number' ? answers.should_reply_now.noul : 0.5
  const verdict: 'reply' | 'wait' = v >= 0.5 ? 'reply' : 'wait'
  const confidence = Math.round((verdict === 'reply' ? v : 1 - v) * 100)
  const sheNeeds = String(answers.she_needs?.choice || '')
  return { verdict, confidence, sheNeeds }
}

export interface JevAnnotation {
  /** 有没有潜台词（literal_question 的命题是「纯字面」，<0.5 才是有潜台词） */
  subtext: boolean
  /** 选中结论自己的把握 */
  subtextPct: number
  /** 真实意图（英文 choice key，前端查表翻中文） */
  intent?: string
  /** 对方需要什么（英文 choice key，前端查表翻中文） */
  needs?: string
}

/**
 * 把 annotate 题集的 answers 整成徽标要的形状。
 * literal_question 的 noul 是「这句话纯字面」的概率：<0.5 才是有潜台词，
 * 否定态的把握是 1-v（和 shapeQuickVerdict 一个口径）。
 */
export function shapeAnnotation(answers: Record<string, any>): JevAnnotation {
  const lit = typeof answers.literal_question?.noul === 'number' ? answers.literal_question.noul : 0.5
  const subtext = lit < 0.5
  return {
    subtext,
    subtextPct: Math.round((subtext ? 1 - lit : lit) * 100),
    intent: answers.true_intent?.choice || undefined,
    needs: answers.she_needs?.choice || undefined
  }
}

/** 一次标注最多扫多少条：再多就太贵，而且通常只看最近一屏 */
const MAX_ANNOTATE_TARGETS = 15
/** 标注并发数：顺序跑 10 条要 ~20 秒，3 路并发 ~7 秒，又不至于撞 rate limit */
const ANNOTATE_CONCURRENCY = 3

class JevService {
  private config: ConfigService
  private decisionCache: DecisionCacheStore

  constructor(config: ConfigService) {
    this.config = config
    const workerUserDataPath = String(process.env.WEFLOW_USER_DATA_PATH || process.env.WEFLOW_CONFIG_CWD || '').trim()
    this.decisionCache = new DecisionCacheStore(
      workerUserDataPath || app?.getPath?.('userData') || process.cwd()
    )
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

  /**
   * 「该回吗」：只跑两道判断（shouldReply 题集），不起草、不排序。
   * 右键消息时的轻量入口——比 analyzeSession 便宜得多（一道判断 vs 起草+判断）。
   * 结果进 decisionCacheService，同一条消息二次展开不花钱。
   */
  async quickDecide(params: AnalyzeSessionParams): Promise<{
    success: boolean
    verdict?: 'reply' | 'wait'
    confidence?: number
    sheNeeds?: string
    error?: string
  }> {
    const cfg = this.getConfig()
    if (!cfg.judgeApiKey) {
      return { success: false, error: '未填写判断接口 API Key' }
    }

    let messages = params.messages
    if (!messages || params.forceRefresh) {
      const result = await chatService.getMessages(params.sessionId, 0, Math.max(cfg.context, 20), 0, 0, false)
      if (!result.success || !result.messages) {
        return { success: false, error: result.error || '读取会话消息失败' }
      }
      messages = result.messages
    }

    const bubbles = messagesToBubbles(messages, params.sessionId)
    if (bubbles.length === 0) {
      return { success: false, error: '这个会话没有可分析的文本消息' }
    }

    // 消息指纹：对方最后一条消息的文本。变了就重算，没变就走缓存。
    const lastHer = [...bubbles].reverse().find((m) => m.from === 'her')
    const messageKey = lastHer ? String(lastHer.text).slice(0, 60) : '__none__'
    const cached = this.decisionCache.get('shouldReply', params.sessionId, messageKey)
    if (cached) {
      return { success: true, ...shapeQuickVerdict(cached) }
    }

    try {
      const { decide } = await import('./jev/decide')
      const { getPack } = await import('./jev/packs')
      const { buildState } = await import('./jev/questions')
      const state = buildState(bubbles, cfg.relationship, cfg.context, params.replyTo || null)
      const questions = getPack('shouldReply').buildQuestions()
      const { answers } = await decide(state, questions, {
        judgeProvider: cfg.judgeProvider || undefined,
        judgeEndpoint: cfg.judgeEndpoint || undefined,
        judgeApiKey: cfg.judgeApiKey,
        judgeModel: cfg.judgeModel || undefined
      })
      this.decisionCache.set('shouldReply', params.sessionId, messageKey, answers)
      return { success: true, ...shapeQuickVerdict(answers) }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * 消息标注：给一批对方消息逐条跑 annotate 题集（潜台词 / 真实意图 / 对方需要），
   * 徽标挂气泡上。targets 由前端指定（用它自己的 messageKey），后端只负责在消息流里
   * 定位、跑判断、返答案。结果进 decisionCacheService，二次扫描不花钱。
   */
  async annotateSession(params: {
    sessionId: string
    messages?: Message[]
    targets: Array<{ key: string; createTime: number; text: string }>
    forceRefresh?: boolean
  }): Promise<{
    success: boolean
    annotations: Record<string, JevAnnotation>
    scanned: number
    cached: number
    error?: string
  }> {
    const cfg = this.getConfig()
    if (!cfg.judgeApiKey) {
      return { success: false, annotations: {}, scanned: 0, cached: 0, error: '未填写判断接口 API Key' }
    }

    let messages = params.messages
    if (!messages || params.forceRefresh) {
      const result = await chatService.getMessages(params.sessionId, 0, Math.max(cfg.context, 20), 0, 0, false)
      if (!result.success || !result.messages) {
        return { success: false, annotations: {}, scanned: 0, cached: 0, error: result.error || '读取会话消息失败' }
      }
      messages = result.messages
    }

    const targets = params.targets.slice(-MAX_ANNOTATE_TARGETS)
    if (targets.length === 0) {
      return { success: true, annotations: {}, scanned: 0, cached: 0 }
    }

    // 定位每条目标在消息流里的下标：createTime + 文本前缀双匹配，只靠时间会撞车
    const located: Array<{ idx: number; key: string }> = []
    for (const t of targets) {
      const idx = messages.findIndex((m) =>
        m.createTime === t.createTime &&
        pickReadableText(m).slice(0, 40) === String(t.text || '').slice(0, 40))
      if (idx >= 0) located.push({ idx, key: t.key })
    }
    if (located.length === 0) {
      return {
        success: false,
        annotations: {},
        scanned: 0,
        cached: 0,
        error: '没在消息流里定位到要标注的消息（可能已滚出当前窗口，试试加载更多）'
      }
    }

    const { decide } = await import('./jev/decide')
    const { getPack } = await import('./jev/packs')
    const { buildState } = await import('./jev/questions')
    const questions = getPack('annotate').buildQuestions()

    const annotations: Record<string, JevAnnotation> = {}
    let scanned = 0
    let cached = 0
    const errors: string[] = []

    // 分批并发（每批 ANNOTATE_CONCURRENCY 条）：顺序跑 10 条要 ~20 秒，
    // 3 路并发 ~7 秒，又不至于撞 rate limit。失败的条目下次扫描会重试（命中的已进缓存）。
    for (let i = 0; i < located.length; i += ANNOTATE_CONCURRENCY) {
      const batch = located.slice(i, i + ANNOTATE_CONCURRENCY)
      const settled = await Promise.allSettled(batch.map(async (t) => {
        const target = messages[t.idx]
        const cacheKey = `${String(target.createTime)}|${pickReadableText(target).slice(0, 40)}`
        if (!params.forceRefresh) {
          const hit = this.decisionCache.get('annotate', params.sessionId, cacheKey)
          if (hit) return { key: t.key, ann: shapeAnnotation(hit), fromCache: true }
        }
        // 用目标之前的消息当上下文，目标本身是最后一条——标注的是「这句话」
        const state = buildState(
          messagesToBubbles(messages.slice(0, t.idx + 1), params.sessionId),
          cfg.relationship,
          cfg.context,
          null
        )
        const { answers } = await decide(state, questions, {
          judgeProvider: cfg.judgeProvider || undefined,
          judgeEndpoint: cfg.judgeEndpoint || undefined,
          judgeApiKey: cfg.judgeApiKey,
          judgeModel: cfg.judgeModel || undefined
        })
        this.decisionCache.set('annotate', params.sessionId, cacheKey, answers)
        return { key: t.key, ann: shapeAnnotation(answers), fromCache: false }
      }))
      for (const r of settled) {
        if (r.status === 'fulfilled') {
          annotations[r.value.key] = r.value.ann
          if (r.value.fromCache) cached++
          else scanned++
        } else {
          errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
        }
      }
    }

    if (scanned + cached === 0) {
      return {
        success: false,
        annotations: {},
        scanned: 0,
        cached: 0,
        error: errors[0] || '标注全部失败，请检查接口配置'
      }
    }
    return { success: true, annotations, scanned, cached }
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
