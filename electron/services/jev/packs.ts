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
import { JUDGE_QUESTIONS, buildRankQuestion, buildStanceQuestions } from './questions'
import { TODO_QUESTIONS } from './todoQuestions'
import { DIARY_QUESTIONS } from './diaryQuestions'
import { AGENT_QUESTIONS } from './agentQuestions'

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
      // 排序题 + 每条候选的策略标注（后者给前端展示「为什么是这条」）
      Object.assign(questions, buildRankQuestion(candidates), buildStanceQuestions(candidates))
    }
    return questions
  }
}

export const QUESTION_PACKS: Record<string, QuestionPack> = {
  reply: replyPack,
  /**
   * 「该回吗」题集：只问两道，不起草、不排序。
   * 右键消息时给一个二结论徽标——「该现在回 / 先别急着回」+ 对方到底在要什么。
   * 故意不收 danger_level：那道题贵，而且徽标场景不需要它。真要看全量判断走 reply。
   */
  shouldReply: {
    id: 'shouldReply',
    description: '右键「该回吗」：只跑两道判断，不起草，给二结论徽标',
    buildQuestions() {
      return {
        should_reply_now: JUDGE_QUESTIONS.should_reply_now,
        she_needs: JUDGE_QUESTIONS.she_needs
      }
    }
  },
  /**
   * 消息标注题集：给一批对方消息逐条标「有没有潜台词 / 真实意图 / 对方需要什么」。
   * 三道都是轻题，不收 danger_level（贵，且徽标场景用不上）。徽标直接挂在气泡上，
   * 一眼看出哪条话里有话。按需扫描，结果进 decisionCacheService 二次不花钱。
   */
  annotate: {
    id: 'annotate',
    description: '消息标注：潜台词 / 真实意图 / 对方需要，三道轻题逐条标',
    buildQuestions() {
      return {
        literal_question: JUDGE_QUESTIONS.literal_question,
        true_intent: JUDGE_QUESTIONS.true_intent,
        she_needs: JUDGE_QUESTIONS.she_needs
      }
    }
  },
  /**
   * 待办题集：从对话里捞出「需要我去做的事」。Jev 没有生成题，所以待办文本是消息本身，
   * 这三道只负责判断「有没有 / 什么类型 / 有没有截止」。todo_present 是闸门题，<0.5 整条跳过。
   */
  todo: {
    id: 'todo',
    description: '待办提取：这条消息有没有要我做的事、什么类型、有没有截止',
    buildQuestions() {
      return { ...TODO_QUESTIONS }
    }
  },
  /**
   * 日记题集：对一整天的总结。结论拼装（情绪走向 + 值得记住的瞬间 + 没收尾的事），
   * 不是生成散文。喂一整天的气泡，不吃 5 小时时间窗。
   */
  diary: {
    id: 'diary',
    description: '每日总结：整体情绪 + 值得记住的瞬间 + 有没有没收尾的事',
    buildQuestions() {
      return { ...DIARY_QUESTIONS }
    }
  },
  /**
   * Agent 题集：给一条命令，选该跑哪个工具。工具表见 agentQuestions.ts，
   * criteria 就是工具表里的 description，工具能力变了只改一处。决策接口只会选工具，
   * 不会自己执行——执行在 jevService.runAgent 的有界循环里，带确认门。
   */
  agent: {
    id: 'agent',
    description: 'Agent：这条命令该跑哪个工具（标注 / 待办 / 日记 / 该回吗 / 起草）',
    buildQuestions() {
      return { ...AGENT_QUESTIONS }
    }
  }
}

/** 取题集；不存在抛错，IPC 层好把错误透给用户。 */
export function getPack(id: string): QuestionPack {
  const pack = QUESTION_PACKS[id]
  if (!pack) throw new Error(`未知的 Jev 题集: ${id}`)
  return pack
}
