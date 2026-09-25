/**
 * Jev 判断题集 + state 构造。从 jev-chat-windows/core/questions.py 逐字移植。
 *
 * 口径说明（和 Python 原版完全一致，校准过的措辞不要改）：
 * instructions / criteria 用英文（Jev 主训练语言是英文），聊天正文保持中文。
 * state 的 from 字段用 "me"/"her"，题目里通篇用 "the other person" 指代 her。
 */
export interface JevChoiceQuestion {
  type: 'choice'
  instructions: string
  criteria: Record<string, string>
}

export interface JevNoulQuestion {
  type: 'noul'
  instructions: string
  criteria: { true: string; false: string }
}

export interface JevScoreQuestion {
  type: 'score'
  instructions: string
  criteria: string[]
}

export type JevQuestion = JevChoiceQuestion | JevNoulQuestion | JevScoreQuestion
export type JevQuestions = Record<string, JevQuestion>

/**
 * 每道题都追加这一句：让 D 阶段的 background（关系、联系人备注、知识库命中）读起来
 * 是「给定的上下文」，而不是该被扣分的跑题。
 */
const BACKGROUND_NOTE = ' Facts given in background are provided context, not off-topic.'

export const JUDGE_QUESTIONS: JevQuestions = {
  literal_question: {
    type: 'noul',
    instructions:
      'Is the other person\'s latest message meant purely literally, with no subtext? ' +
      'Judge from the whole thread, not one sentence in isolation.' + BACKGROUND_NOTE,
    criteria: {
      true:
        'The latest message is a straightforward statement, question, or plan ' +
        'with no implied accusation, test, sarcasm, hint, or unsaid request.',
      false:
        'There is subtext: a test of whether you remember or care, sarcasm, ' +
        'an implied complaint, a hint they will not say outright, a trap question, ' +
        'an accusation dressed as a question, or a cold/short line that really means blame.'
    }
  },
  true_intent: {
    type: 'choice',
    instructions:
      'What is the other person\'s true intent in the latest message, given the full conversation? ' +
      'Prefer tone and context over surface wording. ' +
      'If they are checking whether you remember something or still care, choose confirm_you_care ' +
      'even if the words look like a request to \'say it\' or to do something. ' +
      'If they already accepted and closed the matter peacefully, choose close_topic. ' +
      'Ending the relationship, deleting you, or \'don\'t talk to me\' is vent_anger, never close_topic.' +
      BACKGROUND_NOTE,
    criteria: {
      confirm_you_care:
        'They are testing whether you remember, pay attention, or still care. ' +
        'Signals: \'did you forget again\', \'then say it\', \'you better\', sarcastic \'busy person\', ' +
        'asking you to prove you know a past conversation. ' +
        'If they mainly want a new deliverable or a yes on a time, do not use this.',
      vent_anger:
        'They are angry or hurt and mainly want the feeling acknowledged. ' +
        'They are blaming or raising the temperature; a specific plan is not the main point yet.',
      request_action:
        'They want a concrete action, time, deliverable, or commitment from you now, ' +
        'and this is a real ask, not a loyalty test.',
      seek_explanation:
        'They want a factual explanation of why something happened. ' +
        'They asked why or what is going on, not mainly for an apology or a new plan.',
      casual_chat:
        'Light talk, banter, sharing, teasing with a laugh, or friendly logistics ' +
        'with no emotional test and no conflict. A friend suggesting a meal time can be this ' +
        'if the thread is warm.',
      close_topic:
        'Peaceful wrap-up only: they accepted an apology, confirmed a happy plan, said thanks, ' +
        'or clearly signaled they need nothing more. ' +
        'Not a breakup, not \'don\'t contact me\', not sarcastic \'I\'m used to it\'.'
    }
  },
  danger_level: {
    type: 'score',
    instructions:
      'How close is this conversation to a fight or to hurting the relationship? ' +
      'Match the current scene. ' +
      'If they genuinely accepted an apology or confirmed a happy plan, score the cooled-down present, ' +
      'not an earlier complaint. ' +
      'If an ultimatum (break up, report to the boss, stop covering for you) is still in force ' +
      'and has not been withdrawn, stay in that high bin even if the latest line names a specific task.' +
      BACKGROUND_NOTE,
    criteria: [
      'Light chat or joking; no complaint, no test, no deadline.',
      'Mild tease or a small reminder that is easy to laugh off; a clumsy reply would only feel slightly awkward.',
      'A mild complaint or \'please remember next time\' said without heat; they still send warm or practical follow-ups.',
      'Noticeable unhappiness; they mention being forgotten, ignored, or kept waiting, but still give you a chance to make it right.',
      'Sarcasm, cold short replies, or \'you better\'; they are testing you, and a sloppy or fake-confident reply will escalate.',
      'Openly upset; they accuse you of not listening or not caring; they expect a real response, not a joke.',
      'Clearly angry and blaming you; a wrong reply will turn this into a fight.',
      'Last-chance warning. They will not cover for you, do not want to keep talking unless this changes, ' +
        'or tell you to finish a named checklist yourself because trust is almost gone.',
      'An ultimatum is already on the table even if they also give a practical next step: ' +
        'break up if you forget again, report you tonight, or stop working together if you miss this.',
      'Active rupture: they said it is over, told you not to reply, deleted you, or are exploding.'
    ]
  },
  should_reply_now: {
    type: 'noul',
    instructions:
      'Should your next message contain substantive content? ' +
      'Substantive means: admitting a specific known fault, giving a concrete time/plan/deliverable, ' +
      'explaining facts you actually know, or reciting the recalled content they asked you to say. ' +
      'This is NOT \'should you send any message\'. Timing is irrelevant. ' +
      'Answer FALSE if the thing they want you to recite or prove is not present in this snippet ' +
      '(you would be guessing). \'Then say it\' / \'you better\' while you are stalling is FALSE. ' +
      'Answer FALSE if they already accepted and closed the topic. ' +
      'Answer true only if the needed fact, plan, or named fault is already in this snippet.' +
      BACKGROUND_NOTE,
    criteria: {
      true:
        'The needed fact, named fault, or named time/place is already in this snippet, ' +
        'and they are waiting for that substance now.',
      false:
        'Do not put substance in the next message: the recalled content is not in this snippet, ' +
        'they are testing whether you remember, a holding line is enough, ' +
        'saying less is safer, or they already closed the topic.'
    }
  },
  best_action: {
    type: 'choice',
    instructions:
      'What type of next action is best? Do not decide whether to send a message immediately. ' +
      'Ignore timing. Choose only the action type. ' +
      'If they asked you to recall a specific past message or event and you have not shown that you actually remember it, ' +
      'choose check_history — do not apologize or invent a plan instead.' + BACKGROUND_NOTE,
    criteria: {
      check_history:
        'Look up prior chat or facts before taking a position. ' +
        'Use when they ask you to repeat, recall, or prove you remember something specific.',
      apologize:
        'Lead with a sincere apology for a real mistake or hurt already identified. ' +
        'Not for an unnamed forgotten thing when you should first find out what it was.',
      give_commitment:
        'Give a concrete promise, deadline, or arrangement they asked for ' +
        'in a conflict or work-pressure setting.',
      explain: 'Explain what happened or why, without leading with apology or a new plan.',
      acknowledge:
        'Show you heard them and care, without new facts, an apology, or a plan. ' +
        'Use for light chat or when they mainly need to feel seen.',
      say_less:
        'Keep it short or add nothing. Extra words would over-explain, reopen a closed topic, ' +
        'or pour fuel on an ultimatum that told you not to talk.',
      make_plan:
        'Propose or confirm logistics (time, place, task) for a non-conflict request ' +
        'such as a meal or a meeting.'
    }
  },
  she_needs: {
    type: 'choice',
    instructions:
      'What does the other person need from you right now? Judge the LATEST message first. ' +
      'If they genuinely accepted (thanks / got it / 没事了 / 那就这样 / 收到了 / 过去了), ' +
      'you MUST choose nothing, even if earlier they wanted action or an apology. ' +
      'Sarcastic \'I\'m used to it\', \'whatever\', \'I don\'t want to hear it\', \'don\'t bother coming\' ' +
      'is NOT genuine satisfaction — do not choose nothing. ' +
      'If they asked you to recap a named time/place/date, choose action. ' +
      'If they are testing whether you remember or still care, and the content is unnamed, choose care.' +
      BACKGROUND_NOTE,
    criteria: {
      apology: 'They need a sincere apology for hurt or a mistake, and they have not accepted one yet.',
      action:
        'They need a concrete action, time, commitment, recap of a named fact, or follow-through, ' +
        'and they have not yet accepted one.',
      explanation: 'They need a clear explanation of what happened or why, and have not received it.',
      care:
        'They need proof you remember, listen, or care — a loyalty or attention test — ' +
        'not yet a plan or an apology. Sarcastic \'I am used to it\' belongs here, not nothing.',
      nothing:
        'They need nothing further. Genuine acceptance, a peaceful closed topic, ' +
        'warm casual chat with no ask, or a rupture where they told you not to reply. ' +
        'Not sarcasm pretending to be fine.'
    }
  },
  tension_resolved: {
    type: 'noul',
    instructions:
      'Has interpersonal tension already been resolved? ' +
      'Answer true only if there was never tension, or the other person has clearly accepted, ' +
      'cooled down, joked again, or said it is fine. ' +
      'A sarcastic \'you better\', an unanswered test, leftover blame, or an open ultimatum means false.' +
      BACKGROUND_NOTE,
    criteria: {
      true:
        'No remaining tension: they accepted, joked again, said it\'s fine, ' +
        'confirmed a happy plan, or the chat was never tense.',
      false:
        'Tension is still present: they are waiting, testing, angry, sarcastic, ' +
        'issuing an ultimatum, or the issue is open.'
    }
  }
}

/** 喂给 Jev 的单条消息（和 Python 版的 dict 形状一致）。name 是群里的发言人。 */
export interface JevStateMessage {
  from: 'me' | 'her'
  text: string
  name?: string
}

export interface JevState {
  chat: {
    relationship: string
    messages: JevStateMessage[]
    latest_from: 'me' | 'her'
    is_group: boolean
    /** 显式可为 null：没有指定回复对象时给模型一个稳定结构，而不是省略字段。 */
    reply_to?: string | null
  }
}

/**
 * 从 (from, text[, name]) 元组构造 state。只取最近 keep 条。
 * 有 name 就当群聊（is_group），reply_to 是群里指定的回复对象。
 * from 不是 me/her 直接抛——上游适配层必须先分好边。
 */
export function buildState(
  messages: Array<[string, string] | [string, string, string?] | JevStateMessage>,
  relationship: string,
  keep: number = 10,
  replyTo?: string | null
): JevState {
  const cleaned: JevStateMessage[] = []
  for (const item of messages) {
    let who: string, text: string, name: string | undefined
    if (Array.isArray(item)) {
      who = item[0]
      text = item[1]
      name = item[2]
    } else {
      who = item.from
      text = item.text
      name = item.name
    }
    if (who !== 'me' && who !== 'her') {
      throw new Error(`message from must be 'her' or 'me', got ${JSON.stringify(who)}`)
    }
    const message: JevStateMessage = { from: who, text: String(text) }
    if (name) message.name = String(name)
    cleaned.push(message)
  }
  const kept = cleaned.slice(-keep)
  const latestFrom = kept.length > 0 ? kept[kept.length - 1].from : 'her'
  const chat: JevState['chat'] = {
    relationship,
    messages: kept,
    latest_from: latestFrom,
    is_group: kept.some((m) => m.name !== undefined),
    // 显式给 null：模型拿到的是稳定结构，有/无回复目标都看得见
    reply_to: replyTo ? String(replyTo) : null
  }
  return { chat }
}

/** 2~3 条候选的排序题。criteria 的值保持中文原样（就是候选本身）。 */
export function buildRankQuestion(candidates: string[]): Record<string, JevChoiceQuestion> {
  if (candidates.length < 2 || candidates.length > 3) {
    throw new Error('buildRankQuestion expects 2 or 3 candidate replies')
  }
  const keys = ['reply_a', 'reply_b', 'reply_c'].slice(0, candidates.length)
  const criteria: Record<string, string> = {}
  keys.forEach((key, i) => {
    criteria[key] = candidates[i]
  })
  return {
    best_reply: {
      type: 'choice',
      instructions:
        'Which candidate reply is the most appropriate next message, ' +
        'given the conversation and the other person\'s true need? ' +
        'Prefer a reply that matches the best action type. ' +
        'Penalize dismissive, over-promising, or off-topic replies. ' +
        'If the facts are not yet confirmed, prefer the candidate that looks them up ' +
        'instead of faking memory or a vague apology.' + BACKGROUND_NOTE,
      criteria
    }
  }
}

/**
 * 给每条候选标「它属于哪种策略」。排序题只告诉我们哪条最好，不告诉我们每条是什么——
 * 前端要展示「为什么是这条」，就得知道每条候选各自匹配什么行动类型。
 * 和排序题同一次 decisions 调用里问，不额外花钱。
 * criteria 复用 best_action 的七个类型，保证标注口径和排序题的「match the best action type」一致。
 */
export function buildStanceQuestions(candidates: string[]): Record<string, JevChoiceQuestion> {
  if (candidates.length < 2 || candidates.length > 3) {
    throw new Error('buildStanceQuestions expects 2 or 3 candidate replies')
  }
  const labels = ['a', 'b', 'c'] as const
  const out: Record<string, JevChoiceQuestion> = {}
  labels.slice(0, candidates.length).forEach((label, i) => {
    out[`reply_${label}_stance`] = {
      type: 'choice',
      instructions:
        `What type of action does candidate ${label} serve? ` +
        'Judge the candidate itself, not whether it is the best one. ' +
        'If it mixes two, pick the one it leads with.' + BACKGROUND_NOTE,
      criteria: { ...(JUDGE_QUESTIONS.best_action.criteria as Record<string, string>) }
    }
  })
  return out
}
