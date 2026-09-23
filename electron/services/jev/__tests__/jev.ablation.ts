/**
 * Jev 内核消融实验：在标注集上跑各种「砍掉一个部件」的变体，看每道题的命中率变化。
 *
 * 跑法（WeFlow 仓库根目录）：
 *   npm run test:jev:ablation
 *
 * 必填环境变量：
 *   JEV_JUDGE_KEY    判断接口的 key
 *
 * 可选：
 *   JEV_JUDGE_PROVIDER  typesafe | openrouter（默认 typesafe）
 *   JEV_JUDGE_ENDPOINT  自定义判断端点
 *   JEV_JUDGE_MODEL     自定义判断模型
 *   JEV_LIMIT           只跑前 N 条用例（默认全跑）
 *   JEV_ONLY            只跑指定变体（逗号分隔），默认全跑
 *   JEV_OUT             结果输出目录（默认 .ablation）
 *
 * 判分口径和 Python 版 calibrate.py 对齐：
 *   noul  → 预测值 >=0.5 视作 true，和期望的布尔比
 *   choice→ choice 字符串和期望值相等
 *   score → |预测 - 期望| < 1.0 算命中（danger_level 是 0~9 的分箱）
 *
 * Key 只从环境变量读，不落盘不进日志；报告里也不会出现 key。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join, resolve } from 'path'

import { ask, resolveJudgeEndpoint } from '../jevClient'
import { JUDGE_QUESTIONS, buildState, type JevQuestions } from '../questions'

// ─── 标注集：直接读 jev-chat-jarvis 的 fixtures，不复制一份保持单一数据源 ───
// 不用 import.meta.url（esbuild 打 cjs 时没有）；从仓库根目录往下找
function findFixture(): string {
  const rel = ['jev-chat-jarvis/tools/jev/fixtures/labeled_set.json', '../jev-chat-jarvis/tools/jev/fixtures/labeled_set.json']
  for (const r of rel) {
    const p = resolve(process.cwd(), r)
    try {
      readFileSync(p, 'utf-8')
      return p
    } catch { /* 继续找 */ }
  }
  throw new Error(`找不到标注集，请在 wechat-dev 仓库根目录下运行（找过 ${rel.join(' / ')}）`)
}
const FIXTURE = findFixture()

interface LabeledCase {
  id: string
  relationship: string
  messages: Array<[string, string]>
  expect: Record<string, unknown>
}

const NOUL_KEYS = ['literal_question', 'should_reply_now', 'tension_resolved']
const CHOICE_KEYS = ['true_intent', 'best_action', 'she_needs']
const SCORE_KEYS = ['danger_level']

function env(name: string, fallback = ''): string {
  return String(process.env[name] || fallback).trim()
}

// ─── 变体定义：每个变体把题集和 state 砍掉一部分 ───────────────────────────

type StateTransform = (caseData: LabeledCase) => unknown

function baseState(c: LabeledCase): unknown {
  return buildState(c.messages, c.relationship, 10, null)
}

function stripField(c: LabeledCase, field: string): unknown {
  const s = baseState(c) as { chat: Record<string, unknown> }
  const chat = { ...s.chat }
  delete chat[field]
  return { chat }
}

function onlyLastMessage(c: LabeledCase): unknown {
  const s = baseState(c) as { chat: { messages: unknown[]; [k: string]: unknown } }
  return { chat: { ...s.chat, messages: s.chat.messages.slice(-1) } }
}

function dropRelationship(c: LabeledCase): unknown {
  return stripField(c, 'relationship')
}

interface Variant {
  id: string
  label: string
  /** 题集变换；返回 null 表示这道题在该变体里被移除，不参与计分 */
  questions: (base: JevQuestions) => JevQuestions
  /** state 变换 */
  state?: StateTransform
  /** 这道题在这个变体下还要不要计分（默认看题在不在题集里） */
  scored?: (key: string) => boolean
}

const ALL_KEYS = Object.keys(JUDGE_QUESTIONS)

// 砍掉某一道题
function dropQuestion(key: string): (base: JevQuestions) => JevQuestions {
  return (base: JevQuestions) => {
    const out: JevQuestions = { ...base }
    delete out[key]
    return out
  }
}

// 去掉所有题尾的 BACKGROUND_NOTE
function withoutBackgroundNote(base: JevQuestions): JevQuestions {
  const note = ' Facts given in background are provided context, not off-topic.'
  const out: JevQuestions = {}
  for (const [k, q] of Object.entries(base)) {
    const instructions = q.instructions.replace(note, '')
    out[k] = { ...q, instructions }
  }
  return out
}

// 去掉 criteria 的解释，只留标签名（测 criteria 的解释文本值多少）
function criteriaKeysOnly(base: JevQuestions): JevQuestions {
  const out: JevQuestions = {}
  for (const [k, q] of Object.entries(base)) {
    if (q.type === 'choice') {
      const criteria: Record<string, string> = {}
      for (const ck of Object.keys(q.criteria)) criteria[ck] = ck
      out[k] = { ...q, criteria }
    } else if (q.type === 'noul') {
      out[k] = { ...q, criteria: { true: 'true', false: 'false' } }
    } else {
      out[k] = { ...q, criteria: q.criteria.map((_, i) => String(i)) }
    }
  }
  return out
}

// 只保留排序相关的三道（意图 / 危险 / 需求），砍掉元判断题
function coreQuestionsOnly(base: JevQuestions): JevQuestions {
  const keep = ['true_intent', 'danger_level', 'she_needs']
  const out: JevQuestions = {}
  for (const k of keep) if (base[k]) out[k] = base[k]
  return out
}

const VARIANTS: Variant[] = [
  { id: 'full', label: '完整题集（基线）', questions: (b) => b, state: baseState },
  // 逐题消融：砍掉一道，看其它题的命中率是否变化（题与题之间有没有互相提供上下文）
  ...ALL_KEYS.map((key) => ({
    id: `drop_${key}`,
    label: `砍掉 ${key}`,
    questions: dropQuestion(key),
    state: baseState,
    scored: (k: string) => k !== key
  })),
  { id: 'no_bg_note', label: '去掉 BACKGROUND_NOTE', questions: withoutBackgroundNote, state: baseState },
  { id: 'criteria_keys', label: 'criteria 只留标签', questions: criteriaKeysOnly, state: baseState },
  { id: 'core_only', label: '只留 3 道核心题', questions: coreQuestionsOnly, state: baseState,
    scored: (k: string) => ['true_intent', 'danger_level', 'she_needs'].includes(k) },
  // state 侧消融
  { id: 'state_last_msg', label: 'state 只留最后一条', questions: (b) => b, state: onlyLastMessage },
  { id: 'state_no_rel', label: 'state 去掉 relationship', questions: (b) => b, state: dropRelationship }
]

// ─── 判分（对齐 calibrate.py）─────────────────────────────────────────────

function noulValue(ans: Record<string, any>): number {
  if (typeof ans.noul !== 'number') throw new Error('noul missing')
  return ans.noul
}
function choiceValue(ans: Record<string, any>): string {
  if (typeof ans.choice !== 'string') throw new Error('choice missing')
  return ans.choice
}
function scoreValue(ans: Record<string, any>): number {
  if (typeof ans.score !== 'number') throw new Error('score missing')
  const probs = ans.probabilities
  if (probs && typeof probs === 'object') {
    try {
      let sum = 0
      for (const [k, p] of Object.entries(probs)) {
        sum += Number(k) * Number(p)
      }
      if (Number.isFinite(sum)) return sum
    } catch { /* 概率权重算不出来就退 score */ }
  }
  return ans.score
}

function predictedFor(key: string, ans: Record<string, any>): number | string {
  if (NOUL_KEYS.includes(key)) return noulValue(ans)
  if (CHOICE_KEYS.includes(key)) return choiceValue(ans)
  if (SCORE_KEYS.includes(key)) return scoreValue(ans)
  throw new Error(key)
}

function hitFor(key: string, predicted: number | string, expect: unknown): boolean | null {
  if (expect === null || expect === undefined) return null
  if (NOUL_KEYS.includes(key)) return (Number(predicted) >= 0.5) === Boolean(expect)
  if (CHOICE_KEYS.includes(key)) return String(predicted) === String(expect)
  if (SCORE_KEYS.includes(key)) return Math.abs(Number(predicted) - Number(expect)) < 1.0
  return null
}

// ─── 跑一个变体 ────────────────────────────────────────────────────────────

interface CaseRow {
  id: string
  ok: boolean
  error?: string
  latencyMs?: number
  inputTokens?: number
  outputTokens?: number
  predicted: Record<string, number | string | null>
  hit: Record<string, boolean | null>
  expect: Record<string, unknown>
}

async function runVariant(
  variant: Variant,
  cases: LabeledCase[],
  judge: { endpoint: string; model: string },
  apiKey: string
): Promise<CaseRow[]> {
  const rows: CaseRow[] = []
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]
    const row: CaseRow = { id: c.id, ok: false, predicted: {}, hit: {}, expect: c.expect }
    const questions = variant.questions(JUDGE_QUESTIONS)
    const state = variant.state ? variant.state(c) : baseState(c)
    const t0 = Date.now()
    try {
      const result = await ask(state, questions, { endpoint: judge.endpoint, apiKey, model: judge.model, timeoutMs: 45_000 })
      row.latencyMs = Date.now() - t0
      const usage = (result.usage || {}) as Record<string, unknown>
      row.inputTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined
      row.outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined
      const answers = (result.answers || {}) as Record<string, any>
      for (const key of Object.keys(questions)) {
        const ans = answers[key]
        if (!ans || typeof ans !== 'object') {
          row.predicted[key] = null
          row.hit[key] = false
          continue
        }
        try {
          const pred = predictedFor(key, ans)
          row.predicted[key] = pred
          row.hit[key] = variant.scored ? (variant.scored(key) ? hitFor(key, pred, c.expect[key]) : null)
            : hitFor(key, pred, c.expect[key])
        } catch {
          row.predicted[key] = null
          row.hit[key] = false
        }
      }
      row.ok = true
    } catch (e) {
      row.latencyMs = Date.now() - t0
      row.error = e instanceof Error ? e.message : String(e)
      for (const key of Object.keys(questions)) row.hit[key] = false
    }
    rows.push(row)
    const hitCount = Object.values(row.hit).filter((h) => h === true).length
    const qCount = Object.keys(questions).length
    const tag = row.ok ? `${hitCount}/${qCount}` : 'ERR'
    console.log(`  [${i + 1}/${cases.length}] ${c.id} ${tag}${row.ok ? '' : ` ${row.error}`}`)
  }
  return rows
}

// ─── 汇总 ──────────────────────────────────────────────────────────────────

interface VariantSummary {
  id: string
  label: string
  n: number
  ok: number
  perQuestion: Record<string, { hit: number; total: number; rate: number | null }>
  overall: { hit: number; total: number; rate: number | null }
  avgLatencyMs: number | null
  inputTokens: number
  outputTokens: number
  dangerMae: number | null
}

function summarize(variant: Variant, rows: CaseRow[]): VariantSummary {
  const questions = variant.questions(JUDGE_QUESTIONS)
  const qKeys = Object.keys(questions)
  const perQuestion: Record<string, { hit: number; total: number; rate: number | null }> = {}
  let totalHit = 0
  let totalN = 0
  let dangerErrs: number[] = []
  let latencies: number[] = []
  let inTok = 0
  let outTok = 0

  for (const key of qKeys) {
    let hit = 0
    let n = 0
    for (const row of rows) {
      if (!row.ok) continue
      const h = row.hit[key]
      if (h === null || h === undefined) continue
      n++
      if (h) hit++
      // danger_level 的绝对误差（不管命中没命中都收）
      if (key === 'danger_level' && row.predicted[key] !== null && row.expect[key] !== undefined) {
        const err = Math.abs(Number(row.predicted[key]) - Number(row.expect[key]))
        if (Number.isFinite(err)) dangerErrs.push(err)
      }
    }
    perQuestion[key] = { hit, total: n, rate: n > 0 ? hit / n : null }
    totalHit += hit
    totalN += n
  }

  for (const row of rows) {
    if (row.latencyMs !== undefined) latencies.push(row.latencyMs)
    if (row.inputTokens !== undefined) inTok += row.inputTokens
    if (row.outputTokens !== undefined) outTok += row.outputTokens
  }

  return {
    id: variant.id,
    label: variant.label,
    n: rows.length,
    ok: rows.filter((r) => r.ok).length,
    perQuestion,
    overall: { hit: totalHit, total: totalN, rate: totalN > 0 ? totalHit / totalN : null },
    avgLatencyMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    inputTokens: inTok,
    outputTokens: outTok,
    dangerMae: dangerErrs.length ? dangerErrs.reduce((a, b) => a + b, 0) / dangerErrs.length : null
  }
}

function pct(v: number | null): string {
  if (v === null) return '   -  '
  return `${(v * 100).toFixed(1)}%`.padStart(6)
}

function renderTable(summaries: VariantSummary[], baseline: VariantSummary | null): string {
  const keys = Object.keys(JUDGE_QUESTIONS)
  const widths = { variant: 22, cell: 12, all: 10, mae: 7, lat: 7, tok: 8 }
  const header = [
    'variant'.padEnd(widths.variant),
    'ALL'.padStart(widths.all),
    ...keys.map((k) => k.slice(0, widths.cell - 1).padStart(widths.cell)),
    'MAE'.padStart(widths.mae),
    'lat'.padStart(widths.lat),
    'in_tok'.padStart(widths.tok)
  ]
  const lines = [header.join(''), '-'.repeat(header.join('').length)]

  for (const s of summaries) {
    const cells: string[] = [s.label.padEnd(widths.variant).slice(0, widths.variant)]
    // ALL 列：基线不挂 delta，其它变体挂上差值，整体截到固定宽度
    let allCell = pct(s.overall.rate)
    if (baseline && s.id !== 'full' && s.overall.rate !== null && baseline.overall.rate !== null) {
      allCell += delta(s.overall.rate - baseline.overall.rate)
    }
    cells.push(allCell.padStart(widths.all).slice(0, widths.all))
    for (const k of keys) {
      const v = s.perQuestion[k]
      const bv = baseline ? baseline.perQuestion[k] : null
      if (!v) { cells.push('-'.padStart(widths.cell)); continue }
      let cell = pct(v.rate)
      if (bv && bv.rate !== null && v.rate !== null && s.id !== 'full') cell += delta(v.rate - bv.rate)
      cells.push(cell.padStart(widths.cell).slice(0, widths.cell))
    }
    cells.push((s.dangerMae === null ? '-' : s.dangerMae.toFixed(2)).padStart(widths.mae))
    cells.push((s.avgLatencyMs === null ? '-' : `${(s.avgLatencyMs / 1000).toFixed(1)}s`).padStart(widths.lat))
    cells.push(String(s.inputTokens).padStart(widths.tok))
    lines.push(cells.join(''))
  }
  return lines.join('\n')
}

function delta(d: number): string {
  if (Math.abs(d) < 0.0005) return ''
  const p = `${(d * 100).toFixed(1)}`
  return d > 0 ? `+${p}` : p
}

function renderMd(summaries: VariantSummary[], rowsByVariant: Record<string, CaseRow[]>, baseline: VariantSummary | null): string {
  const lines: string[] = ['# Jev 内核消融实验', '', '## 汇总', '', '```', renderTable(summaries, baseline), '```', '']
  lines.push(`变体数：${summaries.length}　用例数：${summaries[0]?.n ?? 0}`)
  lines.push('')
  // 逐题列出相对基线的变化
  if (baseline) {
    lines.push('## 相对基线的变化（只列有掉点的题）', '')
    for (const s of summaries) {
      if (s.id === 'full') continue
      const worse: string[] = []
      for (const [k, v] of Object.entries(s.perQuestion)) {
        const b = baseline.perQuestion[k]
        if (!b || b.rate === null || v.rate === null) continue
        const d = v.rate - b.rate
        if (d < -0.0005) worse.push(`${k} ${pct(b.rate)}→${pct(v.rate)} (${delta(d)})`)
      }
      const overallD = s.overall.rate !== null && baseline.overall.rate !== null ? s.overall.rate - baseline.overall.rate : null
      lines.push(`- **${s.label}**：总体 ${pct(s.overall.rate)}${overallD !== null ? ` (${delta(overallD)})` : ''}${worse.length ? `；掉点：${worse.join('、')}` : '；无掉点'}`)
    }
    lines.push('')
  }
  // 错误明细
  const errs: string[] = []
  for (const s of summaries) {
    for (const row of rowsByVariant[s.id] || []) {
      if (!row.ok) errs.push(`- ${s.label} / ${row.id}: ${row.error}`)
    }
  }
  if (errs.length) { lines.push('## 失败的调用', '', ...errs, '') }
  return lines.join('\n') + '\n'
}

// ─── 入口 ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apiKey = env('JEV_JUDGE_KEY')
  if (!apiKey) {
    console.log('缺环境变量 JEV_JUDGE_KEY（判断接口 key）')
    process.exit(2)
  }
  const judge = resolveJudgeEndpoint({
    provider: env('JEV_JUDGE_PROVIDER', 'typesafe') === 'typesafe' ? 'typesafe' : 'openrouter',
    endpoint: env('JEV_JUDGE_ENDPOINT'),
    model: env('JEV_JUDGE_MODEL')
  })
  const outDir = env('JEV_OUT') || resolve(process.cwd(), '.ablation')
  const limit = env('JEV_LIMIT') ? Number(env('JEV_LIMIT')) : undefined
  const onlyIds = env('JEV_ONLY') ? env('JEV_ONLY').split(',').map((s) => s.trim()) : null

  const allCases = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as LabeledCase[]
  const cases = limit ? allCases.slice(0, limit) : allCases
  const variants = onlyIds ? VARIANTS.filter((v) => onlyIds.includes(v.id)) : VARIANTS

  console.log('=== Jev 内核消融实验 ===')
  console.log(`判断接口：${judge.endpoint}（${judge.model}）`)
  console.log(`用例数：${cases.length}　变体数：${variants.length}`)
  console.log(`标注集：${FIXTURE}\n`)

  const rowsByVariant: Record<string, CaseRow[]> = {}
  const summaries: VariantSummary[] = []
  for (const v of variants) {
    console.log(`\n--- ${v.label} ---`)
    const rows = await runVariant(v, cases, judge, apiKey)
    rowsByVariant[v.id] = rows
    summaries.push(summarize(v, rows))
    // 每跑完一个变体就落一次盘，中途中断也不丢
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'ablation.json'), JSON.stringify({ summaries, cases: rowsByVariant }, null, 2), 'utf-8')
  }

  const baseline = summaries.find((s) => s.id === 'full') || null
  console.log('\n=== 汇总 ===\n')
  console.log(renderTable(summaries, baseline))

  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'ablation.json'), JSON.stringify({ summaries, cases: rowsByVariant }, null, 2), 'utf-8')
  writeFileSync(join(outDir, 'ablation.md'), renderMd(summaries, rowsByVariant, baseline), 'utf-8')
  console.log(`\n报告写入 ${outDir}`)
}

main().catch((e) => {
  console.error('消融实验崩了：', e)
  process.exit(2)
})
