/**
 * 纯决策函数：给 state 和题集，跑一次 decisions 调用，返回答案。
 *
 * 从 engine.analyze() 里拆出来的共享原语。它**不起草、不排序、不挑候选**——
 * 只做「问问题、拿答案」。回复建议（engine.analyze）、消息标注、待办、日记、Agent
 * 路由全都是它的调用方，共用同一份判断能力，各自配题集。
 *
 * 设计约束：
 * - 盲起草架构要求判断结果不进起草 prompt。decide() 是判断侧，不要把它的输出
 *   喂回任何 chat/completions 调用。
 * - key 只在调用期间存在，绝不落盘；进异常/日志的文本一律过 redactKey。
 */
import { ask, resolveJudgeEndpoint, type JudgeProvider } from './jevClient'

export interface DecideOptions {
  /** 判断接口走哪家：typesafe 官方 / openrouter 中转。没填按 endpoint 猜。 */
  judgeProvider?: JudgeProvider
  /** 判断接口完整 URL；留空按 provider 取默认。 */
  judgeEndpoint?: string
  judgeApiKey: string
  judgeModel?: string
  /** 请求超时，默认 20s。 */
  timeoutMs?: number
  /** 测试用：覆盖 ask，返回固定 answers，不联网。 */
  askFn?: typeof ask
}

export interface DecideResult {
  /** 每道题的答案，结构由题集决定（noul/choice/score）。 */
  answers: Record<string, any>
  /** 接口返回的用量信息（token 数等），原样透传。 */
  usage: Record<string, unknown>
}

/**
 * 跑一次判断。state 和 questions 都由调用方按题集构造好。
 * 同样的输入会得到同样的输出，本身无状态、无缓存——缓存由上层
 * decisionCacheService 按 (pack, session, messageKey) 做。
 */
export async function decide(
  state: unknown,
  questions: Record<string, unknown>,
  options: DecideOptions
): Promise<DecideResult> {
  const judge = resolveJudgeEndpoint({
    provider: options.judgeProvider || undefined,
    endpoint: options.judgeEndpoint || undefined,
    model: options.judgeModel || undefined
  })
  const result = await (options.askFn ?? ask)(state, questions, {
    endpoint: judge.endpoint,
    apiKey: options.judgeApiKey,
    model: judge.model,
    timeoutMs: options.timeoutMs
  })
  return {
    answers: (result.answers || {}) as Record<string, any>,
    usage: (result.usage || {}) as Record<string, unknown>
  }
}
