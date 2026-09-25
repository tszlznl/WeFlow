/**
 * 整条链的入口：对话 → 起草 3 条 → Jev 一次判断+排序 → 结构化结果。
 * 从 jev-chat-windows/core/engine.py 移植。平台无关，IPC handler / UI / 命令行都只调 analyze()。
 */
import { draftCandidates, type JevMessage, type DraftProvider } from './draft'
import { ask, type JudgeProvider } from './jevClient'
import { buildState } from './questions'
import { decide } from './decide'
import { getPack } from './packs'

const REPLY_IDX: Record<string, number> = { reply_a: 0, reply_b: 1, reply_c: 2 }

export interface AnalyzeOptions {
  /** 参考上下文条数：起草和判断各看最近多少条。3~30，默认 10。 */
  context?: number
  /** 起草走哪家（openrouter / deepseek 直连）；判断和排序永远走 OpenRouter。 */
  draftProvider?: DraftProvider
  /** 群聊里指定回复给谁；null = 正常回复。 */
  replyTo?: string | null
  /** 是不是群聊。决定 replyTo 的提示语口径（群聊强调只对 TA 说，私聊不能说「这是群聊」）。 */
  isGroup?: boolean
  /** 用户自己描述的说话风格，只影响起草。 */
  style?: string
  /** 起草时开思考模式，默认关（慢且贵）。 */
  thinking?: boolean

  // ---- 接口配置（都从 ConfigService 来，见 JevService.analyze）----
  /** 判断接口走哪家：typesafe 官方 / openrouter。没填按 endpoint 猜。 */
  judgeProvider?: JudgeProvider
  /** 判断接口完整 URL；留空按 provider 取默认。 */
  judgeEndpoint?: string
  judgeApiKey: string
  judgeModel?: string
  /** 起草接口：OpenAI 兼容的 base url（到 /v1 为止）。 */
  draftApiBaseUrl: string
  draftApiKey: string
  draftModel?: string

  // ---- 测试用：把网络换成桩。不传就走真实实现 ----
  /** 覆盖起草函数，返回固定候选，便于不联网测编排。 */
  draftFn?: typeof draftCandidates
  /** 覆盖判断接口，返回固定 answers，便于不联网测编排。 */
  askFn?: typeof ask
}

export interface AnalysisResult {
  candidates: string[]
  bestIndex: number
  bestReply: string
  /** 每条候选的胜出概率（0~1），取自 best_reply.probabilities，取不到记 0。 */
  scores: number[]
  answers: Record<string, any>
  usage: Record<string, unknown>
  replyTo?: string | null
}

/**
 * messages: [{from, text, name?}]，from ∈ her/me，最新一条在最后；name 是群里的发言人。
 * 只有对方最新说话时才有意义调它——是不是该触发由调用方判断（看 latest_from）。
 *
 * 起草是盲起草：不把判断喂给起草模型；7 道判断题加一道「哪条候选最合适」一次问完，
 * 概率就是各条候选的得分。起草只给 1 条就不排序（没什么可排），判断题照问。
 */
export async function analyze(
  messages: JevMessage[],
  relationship: string,
  options: AnalyzeOptions
): Promise<AnalysisResult> {
  const context = Math.max(3, Math.min(30, options.context ?? 10))
  const draft = options.draftFn ?? draftCandidates
  const candidates = await draft(messages, relationship, {
    provider: options.draftProvider,
    apiBaseUrl: options.draftApiBaseUrl,
    apiKey: options.draftApiKey,
    model: options.draftModel,
    keep: context,
    replyTo: options.replyTo,
    isGroup: options.isGroup,
    style: options.style,
    thinking: options.thinking
  })

  // 判断走共享决策原语：题集从注册表取（replyPack = 7 道判断题 + 候选排序题）。
  // 盲起草的边界在这里体现：candidates 只进判断的排序题，不进上面的起草 prompt。
  const state = buildState(messages, relationship, context, options.replyTo)
  const questions = getPack('reply').buildQuestions({ candidates })

  const { answers, usage } = await decide(state, questions, {
    judgeProvider: options.judgeProvider,
    judgeEndpoint: options.judgeEndpoint,
    judgeApiKey: options.judgeApiKey,
    judgeModel: options.judgeModel,
    askFn: options.askFn
  })
  const bestReply = answers.best_reply || {}
  const bestKey = bestReply.choice
  let bestIndex = REPLY_IDX[String(bestKey)] ?? 0
  if (!Number.isInteger(bestIndex) || bestIndex < 0) bestIndex = 0
  if (bestIndex >= candidates.length) bestIndex = 0 // 解析不出或越界就退第一条

  const probabilities = bestReply.probabilities || {}
  const scores = [0, 0, 0]
  for (const [key, idx] of Object.entries(REPLY_IDX)) {
    const v = probabilities[key]
    scores[idx] = typeof v === 'number' && Number.isFinite(v) ? v : 0.0
  }

  return {
    candidates,
    bestIndex,
    bestReply: candidates[bestIndex] || '',
    scores,
    answers,
    usage,
    replyTo: options.replyTo
  }
}
