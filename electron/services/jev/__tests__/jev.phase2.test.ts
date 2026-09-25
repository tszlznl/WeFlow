/**
 * Phase 2 的桩测试：消息标注题集 + shapeAnnotation 整形 + annotateSession 定位/缓存/错误聚合。
 * judge 端点指向本地拒绝端口，全程不联网、不花钱。
 *
 * 跑法：npm run test:jev:phase2
 */
import { getPack, QUESTION_PACKS } from '../packs'
import { JUDGE_QUESTIONS } from '../questions'
import { shapeAnnotation, jevService } from '../../jevService'
import { ConfigService } from '../../config'
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

async function main() {
  // ─── annotate 题集结构 ───────────────────────────────────────────────────

  check('annotate 已注册', !!QUESTION_PACKS.annotate)
  check('getPack(annotate) 不抛', (() => {
    try {
      getPack('annotate')
      return true
    } catch {
      return false
    }
  })())
  eq('annotate 只收三道轻题', Object.keys(getPack('annotate').buildQuestions()).sort(), [
    'literal_question',
    'she_needs',
    'true_intent'
  ])
  check(
    'annotate 不含 danger_level（贵，徽标场景用不上）',
    !('danger_level' in getPack('annotate').buildQuestions())
  )
  eq(
    'annotate 的题就是 JUDGE_QUESTIONS 里那三道原题',
    getPack('annotate').buildQuestions(),
    {
      literal_question: JUDGE_QUESTIONS.literal_question,
      true_intent: JUDGE_QUESTIONS.true_intent,
      she_needs: JUDGE_QUESTIONS.she_needs
    }
  )

  // ─── shapeAnnotation：answers → 徽标 ─────────────────────────────────────

  // literal_question 的命题是「这句话纯字面」：noul<0.5 才是有潜台词，
  // 否定态把握是 1-v（和 shapeQuickVerdict 一个口径）。
  eq('noul=0.9 → 字面意思/90%', shapeAnnotation({ literal_question: { noul: 0.9 } }), {
    subtext: false,
    subtextPct: 90
  })
  eq('noul=0.2 → 话里有话/80%', shapeAnnotation({ literal_question: { noul: 0.2 } }), {
    subtext: true,
    subtextPct: 80
  })
  eq('noul=0.5 边界 → 算字面意思/50%', shapeAnnotation({ literal_question: { noul: 0.5 } }), {
    subtext: false,
    subtextPct: 50
  })
  eq('缺 literal_question → 默认 50/50 算字面', shapeAnnotation({}), {
    subtext: false,
    subtextPct: 50
  })
  eq('choice 透传（前端查表翻中文）', shapeAnnotation({
    literal_question: { noul: 0.1 },
    true_intent: { choice: 'vent_anger' },
    she_needs: { choice: 'apology' }
  }), {
    subtext: true,
    subtextPct: 90,
    intent: 'vent_anger',
    needs: 'apology'
  })
  eq('choice 缺失 → undefined 不出现', shapeAnnotation({ literal_question: { noul: 0.1 } }), {
    subtext: true,
    subtextPct: 90
  })

  // ─── 缓存键口径 ───────────────────────────────────────────────────────────

  // 同一条消息（createTime + 文本前 40 字）在 annotate pack 下命中
  const cacheDir = mkdtempSync(join(tmpdir(), 'jev-annotate-'))
  const cache = new DecisionCacheStore(cacheDir)
  cache.set('annotate', 'session-x', '1000|你好', { literal_question: { noul: 0.1 } })
  check('annotate 缓存能命中', !!cache.get('annotate', 'session-x', '1000|你好'))
  check('不同 pack 不串（shouldReply 不该命中 annotate 的键）', !cache.get('shouldReply', 'session-x', '1000|你好'))
  check('不同会话不串', !cache.get('annotate', 'session-y', '1000|你好'))
  check('文本变了不命中', !cache.get('annotate', 'session-x', '1000|你不好'))
  cache.clear()
  check('clear 后全空', !cache.get('annotate', 'session-x', '1000|你好'))

  // ─── annotateSession：定位 / 错误聚合（接真实单例）──────────────────────

  // judge 端点指向 127.0.0.1:1：连接被拒、立刻失败、不触发重试，全程不联网
  const DEAD_ENDPOINT = 'http://127.0.0.1:1/v1/systemone'
  const config = ConfigService.getInstance()
  // 先清掉可能残留的配置，保证「无 key」用例确定成立
  config.set('jevJudgeApiKey' as any, '' as any)
  config.set('jevJudgeEndpoint' as any, '' as any)

  // 前端传进来的消息长这样（只列用到的字段）
  const mkMsg = (createTime: number, parsedContent: string, isSend = 0) => ({
    isSend,
    createTime,
    localType: 1,
    parsedContent,
    rawContent: parsedContent
  } as any)

  const sessionMessages = [
    mkMsg(1000, '在吗'),
    mkMsg(1001, '我最近还好，你呢'),
    mkMsg(1002, '其实我一直想跟你说声对不起')
  ]

  // 无 key：必须在设 key 之前跑
  const noKey = await jevService.annotateSession({
    sessionId: 'test-session',
    messages: sessionMessages,
    targets: [{ key: 'k1', createTime: 1000, text: '在吗' }]
  })
  check('无 judge key → 拒绝', !noKey.success && noKey.error!.includes('API Key'), JSON.stringify(noKey))

  config.set('jevJudgeApiKey' as any, 'test-key' as any)
  config.set('jevJudgeEndpoint' as any, DEAD_ENDPOINT as any)

  // 空目标：直接成功，不花钱
  const empty = await jevService.annotateSession({
    sessionId: 'test-session',
    messages: sessionMessages,
    targets: []
  })
  check('空 targets → success 且不调用接口', empty.success && Object.keys(empty.annotations).length === 0)

  // 定位失败：createTime 对不上
  const notLocated = await jevService.annotateSession({
    sessionId: 'test-session',
    messages: sessionMessages,
    targets: [{ key: 'k1', createTime: 9999, text: '在吗' }]
  })
  check(
    '定位失败 → 报「没在消息流里定位到」',
    !notLocated.success && notLocated.error!.includes('没在消息流里定位到'),
    JSON.stringify(notLocated)
  )

  // 定位失败：createTime 对但文本不同，说明不只靠时间戳
  const textMismatch = await jevService.annotateSession({
    sessionId: 'test-session',
    messages: sessionMessages,
    targets: [{ key: 'k1', createTime: 1000, text: '不在吗' }]
  })
  check('文本对不上也定位失败', !textMismatch.success, JSON.stringify(textMismatch))

  // 定位成功但接口失败：错误聚合后返回失败，不带半成品标注
  const locatedButFailed = await jevService.annotateSession({
    sessionId: 'test-session',
    messages: sessionMessages,
    targets: [
      { key: 'k1', createTime: 1000, text: '在吗' },
      { key: 'k3', createTime: 1002, text: '其实我一直想跟你说声对不起' }
    ]
  })
  check(
    '定位成功但接口失败 → success:false 且无标注',
    !locatedButFailed.success &&
      locatedButFailed.scanned === 0 &&
      locatedButFailed.cached === 0 &&
      Object.keys(locatedButFailed.annotations).length === 0,
    JSON.stringify(locatedButFailed)
  )

  // 还原配置，别影响别的测试
  config.set('jevJudgeApiKey' as any, '' as any)
  config.set('jevJudgeEndpoint' as any, '' as any)

  // ─── 汇总 ───────────────────────────────────────────────────────────────

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.error('PHASE 2 TESTS FAILED')
    process.exit(1)
  }
}

void main().catch((e) => {
  console.error('PHASE 2 测试运行异常:', e)
  process.exit(1)
})
