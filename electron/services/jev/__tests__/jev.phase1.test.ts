/**
 * Phase 1 的桩测试：候选做法标注题（「为什么是这条」）+ 「该回吗」结论整形。
 * 全部不联网。
 *
 * 跑法：npm run test:jev:phase1
 */
import { buildStanceQuestions, JUDGE_QUESTIONS } from '../questions'
import { shapeQuickVerdict } from '../../jevService'

let passed = 0
let failed = 0

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++
    console.log(`ok   ${name}`)
  } else {
    failed++
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function eq<T>(name: string, actual: T, expected: T): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  check(name, same, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
}

// ─── buildStanceQuestions：「为什么是这条」的题结构 ──────────────────────────

// 每条候选一道独立的 choice 题，问它服务哪种做法；和全局 best_action 用同一套 criteria，
// 这样「候选做法 == 建议做法」就是排序依据，前端能直接高亮。
// 起草固定出 3 条候选，这组题只接受 2~3 条；少了没意义，多了键会撞。
eq('2 条候选 → a/b 两道', Object.keys(buildStanceQuestions(['一', '二'])), [
  'reply_a_stance',
  'reply_b_stance'
])
eq('3 条候选 → a/b/c 三道', Object.keys(buildStanceQuestions(['一', '二', '三'])), [
  'reply_a_stance',
  'reply_b_stance',
  'reply_c_stance'
])
check('1 条候选抛错（没东西可排序）', (() => {
  try {
    buildStanceQuestions(['只有一条'])
    return false
  } catch {
    return true
  }
})())
check('5 条候选抛错（超过 a/b/c 键空间）', (() => {
  try {
    buildStanceQuestions(['1', '2', '3', '4', '5'])
    return false
  } catch {
    return true
  }
})())

const three = buildStanceQuestions(['一', '二', '三'])
check('每道都是 choice 题', Object.values(three).every((q) => q.type === 'choice'))
check('instructions 里带候选字母', Object.entries(three).every(([key, q]) => {
  const letter = key.replace('reply_', '').replace('_stance', '')
  return q.instructions.includes(`candidate ${letter}`)
}))
// criteria 必须和 best_action 完全对齐，否则前端标注的中文和明细里「建议做法」对不上号
eq(
  'stance 题的 criteria 就是 best_action 的 criteria',
  Object.values(three)[0].criteria,
  JUDGE_QUESTIONS.best_action.criteria
)
check(
  'criteria 覆盖前端 BEST_ACTION_LABELS 的全部 7 个键',
  Object.keys(Object.values(three)[0].criteria).sort().join(',') ===
    ['acknowledge', 'apologize', 'check_history', 'explain', 'give_commitment', 'make_plan', 'say_less'].join(',')
)

// ─── shapeQuickVerdict：answers → 前端二结论 ───────────────────────────────

// noul 是「命题为真」的概率：>=0.5 判「该回」，<0.5 判「等」。
// 把握按选中结论算，否则「等」会显示成一个低把握的怪数字。
eq('noul=0.9 → reply/90%', shapeQuickVerdict({ should_reply_now: { noul: 0.9 } }), {
  verdict: 'reply',
  confidence: 90,
  sheNeeds: ''
})
eq('noul=0.5 → reply/50%（边界算该回）', shapeQuickVerdict({ should_reply_now: { noul: 0.5 } }), {
  verdict: 'reply',
  confidence: 50,
  sheNeeds: ''
})
eq('noul=0.2 → wait/80%（否定态把握是 1-v）', shapeQuickVerdict({ should_reply_now: { noul: 0.2 } }), {
  verdict: 'wait',
  confidence: 80,
  sheNeeds: ''
})
eq('noul=0 → wait/100%', shapeQuickVerdict({ should_reply_now: { noul: 0 } }), {
  verdict: 'wait',
  confidence: 100,
  sheNeeds: ''
})
eq('缺 should_reply_now → 默认 50/50', shapeQuickVerdict({}), {
  verdict: 'reply',
  confidence: 50,
  sheNeeds: ''
})
// she_needs 的 choice 原样透传给前端查中文标签
eq('she_needs.choice 透传', shapeQuickVerdict({ should_reply_now: { noul: 0.7 }, she_needs: { choice: 'apology' } }), {
  verdict: 'reply',
  confidence: 70,
  sheNeeds: 'apology'
})
eq('she_needs 缺失 → 空串', shapeQuickVerdict({ should_reply_now: { noul: 0.7 } }).sheNeeds, '')

// ─── 汇总 ───────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) {
  console.error('PHASE 1 TESTS FAILED')
  process.exit(1)
}
