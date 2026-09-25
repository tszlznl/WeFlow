/**
 * Phase 0 的桩测试：decide() 原语、题集注册表、决策缓存。
 * 全部不联网，用 askFn / 临时目录桩掉网络与持久化。
 *
 * 跑法：npm run test:jev:packs
 */
import { decide } from '../decide'
import { QUESTION_PACKS, getPack, type QuestionContext } from '../packs'
import { JUDGE_QUESTIONS } from '../questions'
import { DecisionCacheStore } from '../../decisionCacheService'
import { tmpdir } from 'os'
import { mkdtempSync } from 'fs'
import { join } from 'path'

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

// ─── decide()：纯决策原语 ──────────────────────────────────────────────────

// 桩 ask：把入参存下来，回固定答案。验证 decide 只做「问问题、拿答案」。
let stubState: unknown = null
let stubQuestions: unknown = null
const stubAsk = async (state: unknown, questions: unknown): Promise<Record<string, any>> => {
  stubState = state
  stubQuestions = questions
  return Promise.resolve({
    answers: { literal_question: { noul: 0.9 }, danger_level: { score: 3 } },
    usage: { input_tokens: 42 }
  })
}

async function runDecide(): Promise<void> {
  const state = { chat: { relationship: '朋友', messages: [], latest_from: 'her', is_group: false, reply_to: null } }
  const questions = { literal_question: JUDGE_QUESTIONS.literal_question }
  const result = await decide(state, questions, {
    judgeApiKey: 'sk-fake',
    askFn: stubAsk
  })

  check('decide 透传 state 给 ask', stubState === state)
  check('decide 透传 questions 给 ask', stubQuestions === questions)
  eq('decide 返回 answers', result.answers, { literal_question: { noul: 0.9 }, danger_level: { score: 3 } })
  eq('decide 透传 usage', result.usage, { input_tokens: 42 })
  check('decide 不返回候选（纯决策，不起草）', !('candidates' in result) && !('bestReply' in result))
}

// ─── decide()：没 key 时抛错而不是发请求 ────────────────────────────────────

async function runDecideNoKey(): Promise<void> {
  let threw = false
  try {
    await decide({ chat: {} }, {}, { judgeApiKey: '' })
  } catch (e) {
    threw = e instanceof Error && /密钥/.test(e.message)
  }
  check('decide 没 key 时拒绝请求', threw)
}

// ─── 题集注册表 ─────────────────────────────────────────────────────────────

function runPacks(): void {
  check('注册表里有 reply', !!QUESTION_PACKS.reply)
  eq('reply 题集含 7 道判断题', Object.keys(QUESTION_PACKS.reply.buildQuestions({})), Object.keys(JUDGE_QUESTIONS))

  // 排序题只有候选 >=2 才加
  const withCandidates = QUESTION_PACKS.reply.buildQuestions({ candidates: ['甲', '乙', '丙'] })
  check('候选 >=2 时 replyPack 加排序题', 'best_reply' in withCandidates)
  check('排序题有 3 个选项', Object.keys((withCandidates.best_reply as Record<string, unknown>).criteria || {}).length === 3)

  const noCandidates = QUESTION_PACKS.reply.buildQuestions({})
  check('无候选时不加排序题', !('best_reply' in noCandidates))

  const oneCandidate = QUESTION_PACKS.reply.buildQuestions({ candidates: ['甲'] })
  check('只有 1 条候选时不加排序题', !('best_reply' in oneCandidate))

  check('getPack 取得到 reply', getPack('reply') === QUESTION_PACKS.reply)
  let threw = false
  try {
    getPack('nonexistent')
  } catch (e) {
    threw = e instanceof Error && /未知的 Jev 题集/.test(e.message)
  }
  check('getPack 未知题集抛错', threw)
}

// ─── DecisionCacheStore：去重与过期 ────────────────────────────────────────

function runCache(): void {
  const dir = mkdtempSync(join(tmpdir(), 'jev-cache-test-'))
  const cache = new DecisionCacheStore(dir)

  check('空缓存 get 返回 undefined', cache.get('reply', 's1', 'm1') === undefined)

  const answers = { literal_question: { noul: 0.9 } }
  cache.set('reply', 's1', 'm1', answers)
  eq('写入后能命中', cache.get('reply', 's1', 'm1'), answers)

  check('不同 messageKey 不串', cache.get('reply', 's1', 'm2') === undefined)
  check('不同 session 不串', cache.get('reply', 's2', 'm1') === undefined)
  check('不同 pack 不串', cache.get('todo', 's1', 'm1') === undefined)

  // 同一会话清空
  cache.set('reply', 's1', 'm2', { x: 1 })
  cache.clearSession('s1')
  check('clearSession 清掉该会话全部', cache.get('reply', 's1', 'm1') === undefined && cache.get('reply', 's1', 'm2') === undefined)
  check('clearSession 不影响别的会话', cache.get('reply', 's2', 'm1') === undefined)

  // 过期：直接把内存里的 cachedAt 改到 TTL 之前（落盘是 500ms 防抖，这里不等）
  const setAge = (k: string, age: number): void => {
    const entry = (cache as unknown as { data: Map<string, { cachedAt: number }> }).data.get(k)
    if (entry) entry.cachedAt = Date.now() - age
  }

  cache.set('reply', 's3', 'm1', { x: 1 })
  setAge('reply::s3::m1', DecisionCacheStore.DEFAULT_TTL_MS + 1000)
  check('过期后 get 返回 undefined', cache.get('reply', 's3', 'm1') === undefined)

  // ttlMs=0 表示不过期
  cache.set('reply', 's4', 'm1', { x: 1 })
  setAge('reply::s4::m1', DecisionCacheStore.DEFAULT_TTL_MS + 1000)
  check('ttlMs=0 时不过期', cache.get('reply', 's4', 'm1', 0) !== undefined)

  cache.clear()
  check('clear 后全空', cache.get('reply', 's4', 'm1', 0) === undefined)
}

// ─── 汇总 ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await runDecide()
  await runDecideNoKey()
  runPacks()
  runCache()
  console.log()
  if (failed > 0) {
    console.log(`${failed} 项失败，${passed} 项通过`)
    process.exit(1)
  }
  console.log(`全部 ${passed} 项通过`)
}

void main()
