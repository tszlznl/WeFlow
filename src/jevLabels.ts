/**
 * Jev 判断题选项的中文标签。
 *
 * 判断接口返回的 choice 是 criteria 里的英文 key，展示层统一在这里查中文。
 * 新增题集时在这里加对应映射，别在组件里另建一份。
 */

export const TRUE_INTENT_LABELS: Record<string, string> = {
  confirm_you_care: '确认你还在乎',
  vent_anger: '发泄情绪',
  request_action: '要求行动',
  seek_explanation: '要个解释',
  casual_chat: '随口闲聊',
  close_topic: '了结话题'
}

export const BEST_ACTION_LABELS: Record<string, string> = {
  check_history: '先翻记录',
  apologize: '道歉',
  give_commitment: '给承诺',
  explain: '解释',
  acknowledge: '认可对方',
  say_less: '少说为妙',
  make_plan: '定个计划'
}

export const SHE_NEEDS_LABELS: Record<string, string> = {
  apology: '道歉',
  action: '行动',
  explanation: '解释',
  care: '关心',
  nothing: '什么都不用做'
}

/** 把英文 choice key 翻成中文，找不到就原样返回。 */
export function choiceLabel(questionKey: string, raw: string | undefined): string {
  if (!raw) return '—'
  if (questionKey === 'true_intent') return TRUE_INTENT_LABELS[raw] || raw
  if (questionKey === 'best_action') return BEST_ACTION_LABELS[raw] || raw
  if (questionKey === 'she_needs') return SHE_NEEDS_LABELS[raw] || raw
  return raw
}
