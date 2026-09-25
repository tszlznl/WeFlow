/**
 * 题集注册表。每个功能有自己的题集，IPC 按名字调用，共用 decide() 这一艘船。
 *
 * 为什么要有注册表：判断能力从「回复建议专用」变成共享原语后，功能变多，
 * 但每家的题集不同（待办问的是截止时间，日记问的是情绪走向）。注册表让
 * 「这个功能问哪些题」成为一份可枚举、可单独测试的清单，而不是散在各 service 里。
 *
 * 加新题集的步骤：
 * 1. 在 JUDGE_QUESTIONS 之外定义你的题（或新建 questions-xxx.ts）。
 * 2. 在 QUESTION_PACKS 里注册，buildQuestions 里组装。
 * 3. 在 packs.test 里加「题集结构合法」的用例。
 * 4. 功能开关 + SettingsPage UI。
 */
import { JUDGE_QUESTIONS, buildRankQuestion } from './questions'

export interface QuestionContext {
  /** 排序题要排的候选回复（replyPack 专用）。 */
  candidates?: string[]
}

export interface QuestionPack {
  /** 注册表 key，IPC 按它调用。小写连字符。 */
  id: string
  /** 这个题集给哪个功能用，写给人看。 */
  description: string
  /**
   * 组装题集。不需要运行时数据的题集忽略 context；
   * 需要的（如 replyPack 的排序题要候选列表）从 context 取。
   */
  buildQuestions(context?: QuestionContext): Record<string, unknown>
}

/**
 * 回复建议题集：7 道判断题 + 1 道排序题（候选 >=2 才加排序）。
 * 这就是原先焊在 engine.analyze() 里的那套，行为不变。
 */
const replyPack: QuestionPack = {
  id: 'reply',
  description: '回复建议：该不该回、对方意图、危险等级，并给候选回复排序',
  buildQuestions(context) {
    const questions: Record<string, unknown> = { ...JUDGE_QUESTIONS }
    const candidates = context?.candidates || []
    if (candidates.length >= 2) {
      Object.assign(questions, buildRankQuestion(candidates))
    }
    return questions
  }
}

export const QUESTION_PACKS: Record<string, QuestionPack> = {
  reply: replyPack
}

/** 取题集；不存在抛错，IPC 层好把错误透给用户。 */
export function getPack(id: string): QuestionPack {
  const pack = QUESTION_PACKS[id]
  if (!pack) throw new Error(`未知的 Jev 题集: ${id}`)
  return pack
}
