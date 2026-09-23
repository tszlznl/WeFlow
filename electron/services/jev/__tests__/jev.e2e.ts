/**
 * Jev 内核端到端冒烟测试：真实跑一遍「起草 3 条 → 判断 → 排序」。
 *
 * 跑法（在 WeFlow 仓库根目录）：
 *   npm run test:jev:e2e
 *
 * 必填环境变量：
 *   JEV_JUDGE_KEY    判断接口的 key（TypeSafe 官方或 OpenRouter）
 *   JEV_DRAFT_KEY    起草接口（OpenAI 兼容）的 key
 *   JEV_DRAFT_BASE   起草接口 base url，到 /v1 为止，如 https://openrouter.ai/api/v1
 *
 * 可选：
 *   JEV_JUDGE_PROVIDER  typesafe（官方 api.typesafe.ai）| openrouter（默认 openrouter）
 *   JEV_JUDGE_ENDPOINT  自定义判断端点，覆盖 provider 默认值
 *   JEV_JUDGE_MODEL     自定义判断模型（typesafe 默认 jev-latest）
 *   JEV_DRAFT_MODEL     自定义起草模型（默认按 provider 选）
 *   JEV_DRAFT_PROVIDER  openrouter | deepseek（默认 openrouter）
 *   JEV_THINKING        1 = 起草开思考模式
 *
 * 不会发任何消息，结果只打印到终端。Key 只从环境变量读，不落盘不进日志。
 */
import { analyze } from '../engine'
import { ask, resolveJudgeEndpoint } from '../jevClient'
import type { JevMessage } from '../draft'

let passed = 0
let failed = 0

function ok(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed++
    console.log(`ok   ${name}`)
  } else {
    failed++
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

function env(name: string, fallback = ''): string {
  return String(process.env[name] || fallback).trim()
}

async function main(): Promise<void> {
  const judgeKey = env('JEV_JUDGE_KEY')
  const draftKey = env('JEV_DRAFT_KEY')
  const draftBase = env('JEV_DRAFT_BASE')

  console.log('=== Jev 内核端到端冒烟测试 ===\n')

  if (!judgeKey || !draftKey || !draftBase) {
    console.log('缺环境变量：')
    if (!judgeKey) console.log('  JEV_JUDGE_KEY   判断接口 key（必填）')
    if (!draftKey) console.log('  JEV_DRAFT_KEY   起草接口 key（必填）')
    if (!draftBase) console.log('  JEV_DRAFT_BASE  起草接口 base url（必填）')
    console.log('\n示例（Git Bash）：')
    console.log('  JEV_JUDGE_KEY=sk-or-v1-xxx JEV_DRAFT_KEY=sk-or-v1-xxx \\\n  JEV_DRAFT_BASE=https://openrouter.ai/api/v1 npm run test:jev:e2e')
    process.exit(2)
  }

  const judge = resolveJudgeEndpoint({
    provider: (env('JEV_JUDGE_PROVIDER', 'openrouter') === 'typesafe' ? 'typesafe' : 'openrouter'),
    endpoint: env('JEV_JUDGE_ENDPOINT'),
    model: env('JEV_JUDGE_MODEL')
  })
  const judgeEndpoint = judge.endpoint
  const judgeModel = judge.model
  const draftModel = env('JEV_DRAFT_MODEL')
  const draftProvider = env('JEV_DRAFT_PROVIDER', 'openrouter') === 'deepseek' ? 'deepseek' : 'openrouter'
  const thinking = env('JEV_THINKING') === '1'

  console.log(`判断接口：${judgeEndpoint}`)
  console.log(`判断模型：${judgeModel}`)
  console.log(`起草接口：${draftBase}（${draftProvider}${thinking ? '，开思考' : ''}）`)
  console.log(`起草模型：${draftModel || '（默认）'}\n`)

  // ─── 1. 判断接口连通性：发一个最小 state，一道 noul 题 ──────────────────

  console.log('--- 1. 判断接口连通性 ---')
  try {
    const probe = await ask(
      { chat: { relationship: '朋友', messages: [{ from: 'her', text: '在吗' }], latest_from: 'her', is_group: false, reply_to: null } },
      { probe: { type: 'noul', instructions: 'Is this a greeting?', criteria: { true: 'yes', false: 'no' } } },
      { endpoint: judgeEndpoint, apiKey: judgeKey, model: judgeModel }
    )
    ok('判断接口有响应', !!probe && typeof probe === 'object')
    ok('probe 题有答案', typeof (probe as Record<string, any>)?.probe === 'object',
       JSON.stringify((probe as Record<string, any>)?.probe))
  } catch (e) {
    ok('判断接口有响应', false, (e as Error).message)
  }

  // ─── 2. 完整链路：起草 + 7 道判断题 + 排序 ──────────────────────────────

  console.log('\n--- 2. 完整链路（要几十秒）---')
  const sample: JevMessage[] = [
    { from: 'her', text: '你到了吗' },
    { from: 'me', text: '快了 快了 堵车' },
    { from: 'her', text: '我都到二十分钟了' },
    { from: 'her', text: '每次都这样' }
  ]

  const startedAt = Date.now()
  try {
    const r = await analyze(sample, '朋友', {
      context: 10,
      judgeEndpoint,
      judgeApiKey: judgeKey,
      judgeModel,
      draftProvider,
      draftApiBaseUrl: draftBase,
      draftApiKey: draftKey,
      draftModel: draftModel || undefined,
      thinking
    })
    const secs = ((Date.now() - startedAt) / 1000).toFixed(1)

    ok('分析跑完没抛', true)
    ok(`有候选回复（${secs}s）`, Array.isArray(r.candidates) && r.candidates.length > 0,
       `拿到 ${r.candidates.length} 条`)
    ok('候选不是空串', r.candidates.every((c) => String(c || '').trim().length > 0),
       JSON.stringify(r.candidates))
    ok('bestIndex 在范围内',
      Number.isInteger(r.bestIndex) && r.bestIndex >= 0 && r.bestIndex < r.candidates.length,
      String(r.bestIndex))
    ok('bestReply 非空', !!(r.bestReply || '').trim())
    ok('scores 和候选数对齐',
      Array.isArray(r.scores) && r.scores.length === r.candidates.length,
      JSON.stringify(r.scores))
    ok('判断答案齐', !!r.answers && Object.keys(r.answers).length >= 7,
      r.answers ? Object.keys(r.answers).join(', ') : '')

    console.log('\n--- 判断摘要 ---')
    const a = r.answers || {}
    const sr = a.should_reply_now as { noul?: number } | undefined
    if (sr && typeof sr.noul === 'number') console.log(`该现在回吗：${(sr.noul * 100).toFixed(0)}%`)
    const dl = a.danger_level as { score?: number } | undefined
    if (dl && typeof dl.score === 'number') console.log(`危险等级：${dl.score} / 10`)
    const ti = a.true_intent as { choice?: string } | undefined
    if (ti && ti.choice) console.log(`真实意图：${ti.choice}`)

    console.log('\n--- 候选 ---')
    r.candidates.forEach((c, i) => {
      const mark = i === r.bestIndex ? '★' : ' '
      const sc = typeof r.scores[i] === 'number' ? `（${(r.scores[i] * 100).toFixed(0)}）` : ''
      console.log(`${mark} ${c}${sc}`)
    })
  } catch (e) {
    ok('分析跑完没抛', false, `${(e as Error).message}（${((Date.now() - startedAt) / 1000).toFixed(1)}s）`)
  }

  console.log()
  if (failed > 0) {
    console.log(`${failed} 项失败，${passed} 项通过`)
    process.exit(1)
  }
  console.log(`全部 ${passed} 项通过`)
}

main().catch((e) => {
  console.error('冒烟测试崩了：', e)
  process.exit(2)
})
