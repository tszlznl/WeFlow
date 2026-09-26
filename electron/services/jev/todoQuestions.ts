/**
 * 待办题集的题面。和 JUDGE_QUESTIONS 分开放：那套是回复建议专用的移植题，这组是新功能。
 *
 * Jev 只有 Noul / Choice / Score 三种原语，没有生成题——所以待办的「内容」不是模型写的，
 * 是消息本身 + 这三道判断的结论（有没有、什么类型、有没有截止）。文本拿原始消息，判断拿结论，
 * 用户在收件箱里看到后自己确认要不要做。
 *
 * criteria 的 key 要和前端的 TODO_KIND_LABELS 对齐。
 */

export interface JevChoiceQuestion {
  type: 'choice'
  instructions: string
  criteria: Record<string, string>
}

export interface JevNoulQuestion {
  type: 'noul'
  instructions: string
}

export const TODO_QUESTIONS = {
  /** 有没有待办：这是闸门题，<0.5 就整条跳过，不浪费后面的判断。 */
  todo_present: {
    type: 'noul',
    instructions:
      'Does this message contain an explicit request, commitment, or pending task that the reader ' +
      'needs to act on? Answer true only for a concrete, actionable item — a real ask for a deliverable, ' +
      'a meeting time to confirm, a promise the reader made, or a deadline someone is waiting on. ' +
      'Vague complaints, emotional venting, rhetorical questions, and pure information sharing are false. ' +
      'If the request was for someone other than the reader, answer false.'
  },
  /** 有没有明确截止：决定徽标上要不要标「有截止」。 */
  todo_when: {
    type: 'noul',
    instructions:
      'Does this message state a specific deadline, date, or time bound for the action? ' +
      'Answer true only for an explicit time ("by Friday", "tonight", "before the 5th"). ' +
      '"When you have time" or "sometime next week" without a concrete point is false.'
  },
  /** 待办类型：给待办分类，方便扫一眼就知道该花多少精力。 */
  todo_kind: {
    type: 'choice',
    instructions:
      'What kind of actionable item is this? Pick the one that matches what the reader actually has to do. ' +
      'If it mixes two, pick the one it leads with.',
    criteria: {
      meeting:
        'Confirming or scheduling a meeting, hangout, call, or visit. The action is agreeing on a time or place.',
      work:
        'A work or task deliverable the reader must produce or hand over (a document, a fix, a review, a payment of a shared bill).',
      promise:
        'Something the reader already promised or committed to and is being held to. The action is following through.',
      reminder:
        'A gentle nudge or follow-up with no hard deliverable — "don\'t forget to", "let me know when you can".',
      help:
        'The other person is asking for help, advice, or a favor the reader can choose to take on.',
      other:
        'An actionable item that does not fit the above.'
    }
  }
} as const
