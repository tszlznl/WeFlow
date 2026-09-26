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
/**
 * 决策上下文的时间窗：与最新消息间隔超过 5 小时的消息不喂给判断。
 * 隔了几个小时甚至几天的旧消息混进来会带偏意图判断（上一轮吵架、上个月的话题），
 * 上下文既有条数上限（cfg.context）又有时长上限，两个条件一起收。
 * createTime 是 Unix 秒，这里也是秒。
 */
const DECISION_WINDOW_SECONDS = 5 * 60 * 60

export class JevService {
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

    // 与最新消息间隔超过 5 小时的旧消息不喂给判断
    const bubbles = messagesToBubbles(this.filterRecentWindow(messages), params.sessionId)
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
   * 时间窗过滤：丢掉与「最新消息」间隔超过 5 小时的消息。
   * 参考点是列表里最后一条（判断的就是最新这一轮），被判断的那条本身永远保留。
   */
  private filterRecentWindow(messages: Message[]): Message[] {
    if (messages.length === 0) return messages
    const latest = messages[messages.length - 1]
    const cutoff = (latest.createTime || 0) - DECISION_WINDOW_SECONDS
    return messages.filter((m) => (m.createTime || 0) >= cutoff)
  }

  /**
   * 取会话消息：前端已经传了就直接用（省一次读库），否则从数据库取最近 context 条。
   * 三个扫描类入口（annotate / todo）共用。
   */
  private async loadMessages(sessionId: string, messages: Message[] | undefined, forceRefresh: boolean, context: number): Promise<Message[] | { error: string }> {
    if (messages && !forceRefresh) return messages
    const result = await chatService.getMessages(sessionId, 0, Math.max(context, 20), 0, 0, false)
    if (!result.success || !result.messages) return { error: result.error || '读取会话消息失败' }
    return result.messages
  }

  /**
   * 定位每条目标在消息流里的下标：createTime + 文本前 40 字双匹配，只靠时间会撞车。
   * 前端传来的是它自己的 messageKey，后端只负责找到对应消息，不猜键。
   */
  private locateTargets(
    messages: Message[],
    targets: Array<{ key: string; createTime: number; text: string }>
  ): Array<{ idx: number; key: string }> {
    const located: Array<{ idx: number; key: string }> = []
    for (const t of targets) {
      const idx = messages.findIndex((m) =>
        m.createTime === t.createTime &&
        pickReadableText(m).slice(0, 40) === String(t.text || '').slice(0, 40))
      if (idx >= 0) located.push({ idx, key: t.key })
    }
    return located
  }

  /** 跑一批 decide 调用，3 路分批并发；命中缓存的直接返回，失败的抛出由调用方聚合。 */
  private async runDecideBatch<T>(
    packId: string,
    sessionId: string,
    messages: Message[],
    located: Array<{ idx: number; key: string }>,
    cfg: JevConfig,
    forceRefresh: boolean,
    shape: (answers: Record<string, any>) => T
  ): Promise<{ results: Array<{ key: string; value: T; fromCache: boolean }>; errors: string[] }> {
    const { decide } = await import('./jev/decide')
    const { getPack } = await import('./jev/packs')
    const { buildState } = await import('./jev/questions')
    const questions = getPack(packId).buildQuestions()

    const results: Array<{ key: string; value: T; fromCache: boolean }> = []
    const errors: string[] = []

    for (let i = 0; i < located.length; i += ANNOTATE_CONCURRENCY) {
      const batch = located.slice(i, i + ANNOTATE_CONCURRENCY)
      const settled = await Promise.allSettled(batch.map(async (t) => {
        const target = messages[t.idx]
        const cacheKey = `${String(target.createTime)}|${pickReadableText(target).slice(0, 40)}`
        if (!forceRefresh) {
          const hit = this.decisionCache.get(packId, sessionId, cacheKey)
          if (hit) return { key: t.key, value: shape(hit), fromCache: true }
        }
        // 用目标之前的消息当上下文，目标本身是最后一条——判断的是「这句话」。
        // 超过 5 小时的旧消息不喂进去（上一轮吵架、上次的话题会带偏意图）。
        const cutoff = (target.createTime || 0) - DECISION_WINDOW_SECONDS
        const ctx = messages.slice(0, t.idx + 1).filter((m) => (m.createTime || 0) >= cutoff)
        const state = buildState(
          messagesToBubbles(ctx, sessionId),
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
        this.decisionCache.set(packId, sessionId, cacheKey, answers)
        return { key: t.key, value: shape(answers), fromCache: false }
      }))
      for (const r of settled) {
        if (r.status === 'fulfilled') results.push(r.value)
        else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
      }
    }
    return { results, errors }
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

    const loaded = await this.loadMessages(params.sessionId, params.messages, Boolean(params.forceRefresh), cfg.context)
    if (!Array.isArray(loaded)) {
      return { success: false, annotations: {}, scanned: 0, cached: 0, error: loaded.error }
    }
    const messages = loaded

    const targets = params.targets.slice(-MAX_ANNOTATE_TARGETS)
    if (targets.length === 0) {
      return { success: true, annotations: {}, scanned: 0, cached: 0 }
    }

    const located = this.locateTargets(messages, targets)
    if (located.length === 0) {
      return {
        success: false,
        annotations: {},
        scanned: 0,
        cached: 0,
        error: '没在消息流里定位到要标注的消息（可能已滚出当前窗口，试试加载更多）'
      }
    }

    const { results, errors } = await this.runDecideBatch<JevAnnotation>(
      'annotate', params.sessionId, messages, located, cfg, Boolean(params.forceRefresh), shapeAnnotation
    )

    const annotations: Record<string, JevAnnotation> = {}
    let scanned = 0
    let cached = 0
    for (const r of results) {
      annotations[r.key] = r.value
      if (r.fromCache) cached++
      else scanned++
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

  /**
   * 待办提取：扫一批对方消息，把「需要我去做的事」捞出来塞进 InsightInbox。
   *
   * Jev 没有生成题，所以待办文本就是源消息本身（消息反链），三道判断只决定
   * 「这条算不算待办 / 什么类型 / 有没有截止」。todo_present < 0.5 的不入库。
   * 已入库的（同会话同 messageKey）不重复建，除非 forceRefresh。
   */
  async scanTodos(params: {
    sessionId: string
    messages?: Message[]
    targets: Array<{ key: string; createTime: number; text: string }>
    displayName?: string
    avatarUrl?: string
    forceRefresh?: boolean
  }): Promise<{
    success: boolean
    added: number
    skipped: number
    scanned: number
    error?: string
  }> {
    const cfg = this.getConfig()
    if (!cfg.judgeApiKey) {
      return { success: false, added: 0, skipped: 0, scanned: 0, error: '未填写判断接口 API Key' }
    }

    // targets 是前端按当前窗口挑的，消息流也以它为准；forceRefresh 只管「绕过判断缓存」，
    // 不必重读数据库（重读反而可能因为没配 wxid 失败，且窗口消息前端已经有了）
    const loaded = await this.loadMessages(params.sessionId, params.messages, false, cfg.context)
    if (!Array.isArray(loaded)) {
      return { success: false, added: 0, skipped: 0, scanned: 0, error: loaded.error }
    }
    const messages = loaded

    const targets = params.targets.slice(-MAX_ANNOTATE_TARGETS)
    if (targets.length === 0) {
      return { success: true, added: 0, skipped: 0, scanned: 0 }
    }

    const located = this.locateTargets(messages, targets)
    if (located.length === 0) {
      return {
        success: false,
        added: 0,
        skipped: 0,
        scanned: 0,
        error: '没在消息流里定位到要扫的消息（可能已滚出当前窗口，试试加载更多）'
      }
    }

    const { insightRecordService } = await import('./insightRecordService')

    // 已入库的待办不重复建（同会话 + 同目标消息键）；forceRefresh 时先清掉本会话旧待办
    const existingKeys = new Set<string>()
    if (params.forceRefresh) {
      insightRecordService.clearRecords({ sourceType: 'jev_todo', sessionId: params.sessionId })
    } else {
      const listed = insightRecordService.listRecords({ sourceType: 'jev_todo', sessionId: params.sessionId, limit: 500 })
      for (const r of listed.records) {
        if (r.messageInsight?.targetMessageKey) existingKeys.add(r.messageInsight.targetMessageKey)
      }
    }

    const t0 = Date.now()
    const { results, errors } = await this.runDecideBatch<{
      present: number
      hasDeadline: boolean
      kind?: string
    }>(
      'todo', params.sessionId, messages, located, cfg, Boolean(params.forceRefresh),
      (answers) => ({
        present: typeof answers.todo_present?.noul === 'number' ? answers.todo_present.noul : 0.5,
        hasDeadline: (typeof answers.todo_when?.noul === 'number' ? answers.todo_when.noul : 0) >= 0.5,
        kind: answers.todo_kind?.choice || undefined
      })
    )

    let added = 0
    let skipped = 0
    for (const r of results) {
      const locatedItem = located.find((l) => l.key === r.key)
      if (!locatedItem) continue
      // 闸门题：不是待办的跳过
      if (r.value.present < 0.5) continue
      // 已入库的跳过
      if (!params.forceRefresh && existingKeys.has(r.key)) {
        skipped++
        continue
      }

      const target = messages[locatedItem.idx]
      const text = pickReadableText(target)
      const judge = {
        endpoint: cfg.judgeEndpoint || '',
        model: cfg.judgeModel || ''
      }
      insightRecordService.addRecord({
        sessionId: params.sessionId,
        displayName: params.displayName || params.sessionId,
        avatarUrl: params.avatarUrl,
        sourceType: 'jev_todo',
        triggerReason: 'manual',
        insight: text.slice(0, 120),
        messageInsight: {
          targetLocalId: Number(target.localId || 0),
          targetCreateTime: target.createTime,
          targetMessageKey: r.key,
          targetSenderName: String(target.senderDisplayName || params.displayName || ''),
          targetTextPreview: text.slice(0, 80),
          analysis: {
            explicitText: text,
            emotion: `${Math.round(r.value.present * 100)}`,
            intent: r.value.kind || 'other',
            topic: r.value.hasDeadline ? '有截止时间' : '无截止时间'
          }
        },
        log: {
          endpoint: judge.endpoint,
          model: judge.model,
          maxTokens: 0,
          temperature: 0,
          triggerReason: 'manual',
          allowContext: true,
          contextCount: cfg.context,
          systemPrompt: 'jev decisions: todo pack (todo_present / todo_when / todo_kind)',
          userPrompt: '',
          rawOutput: JSON.stringify({ present: r.value.present, kind: r.value.kind, hasDeadline: r.value.hasDeadline }),
          finalInsight: text.slice(0, 120),
          durationMs: Date.now() - t0,
          createdAt: Date.now()
        }
      })
      added++
    }

    // 一条没入库（接口全挂或全被闸门拦下）且还有错误 → 当失败报，别让前端显示「部分成功」
    if (added + skipped === 0 && errors.length > 0) {
      return {
        success: false,
        added: 0,
        skipped: 0,
        scanned: results.length,
        error: errors[0]
      }
    }

    return {
      success: true,
      added,
      skipped,
      scanned: results.length,
      error: errors[0] && added > 0 ? `部分失败：${errors[0]}` : undefined
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

    // 与最新消息间隔超过 5 小时的旧消息不喂给判断
    const bubbles = messagesToBubbles(this.filterRecentWindow(messages), params.sessionId)
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
