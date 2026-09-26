/**
 * 日记题集的题面。和待办一样放独立文件：JUDGE_QUESTIONS 是回复建议的移植题。
 *
 * 日记是「对一整天的总结」，不是对单条消息的判断，所以：
 * - state 丢一整天的气泡进去（最后一条就是当天最后一条）；
 * - 不吃 5 小时时间窗——日记要覆盖从早到晚，吃了窗口早上的消息就没了。
 *
 * Jev 只有 Noul / Choice，写不出散文，所以日记是「结论拼装」而非生成：
 * 情绪走向（choice）+ 有没有值得记住的瞬间（noul）+ 有没有没收尾的事（noul），
 * 加上前端自己能算的消息条数，拼一段只读总结。
 */

export const DIARY_QUESTIONS = {
  /** 整体情绪走向：日记的第一句话。 */
  diary_mood: {
    type: 'choice',
    instructions:
      'What was the overall emotional arc of this day\'s conversation? ' +
      'Judge the dominant tone across the whole day, not the last message alone. ' +
      'If the day had both warmth and a fight, pick whichever set the weather more.' +
      '',
    criteria: {
      relaxed:
        'Light, warm, playful, or fun. Banter, sharing, inside jokes, or easy logistics. ' +
        'No tension underneath.',
      routine:
        'Neutral daily business: practical coordination, short check-ins, or mostly silent. ' +
        'No strong emotion in either direction.',
      friction:
        'Small rubs, mild complaints, passive-aggressive pokes, or an unresolved undertone. ' +
        'Not a fight, but not comfortable either.',
      conflict:
        'A real argument: anger, blame, accusations, or an ultimatum landed today.',
      distant:
        'Cold or avoidant: one side went quiet, gave short answers, or pulled away.'
    }
  },
  /** 有没有值得记住的瞬间/重要决定：日记的第二句。 */
  diary_highlight: {
    type: 'noul',
    instructions:
      'Does this day contain a moment worth remembering or an important decision — ' +
      'a first, a reconciliation, a commitment made, or something the reader would ' +
      'want to look back on later? Routine chat is false.'
  },
  /** 结束时还有没有没处理完的事：呼应待办，日记的第三句。 */
  diary_unresolved: {
    type: 'noul',
    instructions:
      'As the day ends, is there an open loop — something one side asked for, ' +
      'a question left hanging, or a task not yet done? Answer true only if it still ' +
      'needs attention; things already resolved today are false.'
  }
} as const
