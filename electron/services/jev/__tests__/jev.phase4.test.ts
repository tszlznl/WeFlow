/**
 * Phase 4 的桩测试：日记题集 + shapeDiary 边界 + summarizeDay 的入库 /
 * 同天去重 / 缓存命中 / 无 key 拒绝。judge 端点指向本地 mock 服务器，
 * 全程不联网、不花钱。
 *
 * 跑法：npm run test:jev:phase4
 */
import { getPack, QUESTION_PACKS } from '../packs'
import { DIARY_QUESTIONS } from '../diaryQuestions'
import { JevService, shapeDiary, type JevDiary } from '../../jevService'
import { insightRecordService } from '../../insightRecordService'
import { ConfigService } from '../../config'
import { createServer, type Server } from 'http'
import { tmpdir } from 'os'
import { mkdtempSync } from 'fs'
import { join } from 'path'
import type { AddressInfo } from 'net'

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
  // ─── diary 题集结构 ───────────────────────────────────────────────────────

  check('diary 已注册', !!QUESTION_PACKS.diary)
  eq('diary 三道题', Object.keys(getPack('diary').buildQuestions()).sort(), [
    'diary_highlight',
    'diary_mood',
    'diary_unresolved'
  ])
  const diaryQ = getPack('diary').buildQuestions() as Record<string, any>
  eq('buildQuestions 返回的是原题', diaryQ, { ...DIARY_QUESTIONS })
  check('diary_mood 是 choice 题', diaryQ.diary_mood.type === 'choice')
  eq('diary_mood 的 criteria 有五种氛围', Object.keys(diaryQ.diary_mood.criteria).sort(), [
    'conflict',
    'distant',
    'friction',
    'relaxed',
    'routine'
  ])
  check('两道 noul 题', diaryQ.diary_highlight.type === 'noul' &&
    diaryQ.diary_unresolved.type === 'noul')

  // ─── shapeDiary：答案 → 只读结论的拼装边界 ───────────────────────────────

  const full = shapeDiary(
    {
      diary_mood: { choice: 'friction' },
      diary_highlight: { noul: 0.82 },
      diary_unresolved: { noul: 0.61 }
    },
    42
  )
  eq('mood 透传', full.mood, 'friction')
  eq('有亮点', full.hasHighlight, true)
  eq('有未处理完的事', full.unresolved, true)
  eq('消息条数', full.messageCount, 42)
  check('文本里带了条数', full.text.includes('聊了 42 条'))
  check('文本里说了有瞬间', full.text.includes('有值得记住的瞬间'))
  check('文本里说了没收尾', full.text.includes('没处理完的事'))
  check('moodPct 在 0-100 之间', full.moodPct >= 0 && full.moodPct <= 100, String(full.moodPct))

  // 全平淡的一天：highlight 低、unresolved 低
  const calm = shapeDiary(
    {
      diary_mood: { choice: 'relaxed' },
      diary_highlight: { noul: 0.2 },
      diary_unresolved: { noul: 0.3 }
    },
    5
  )
  eq('无亮点', calm.hasHighlight, false)
  eq('收尾了', calm.unresolved, false)
  check('文本说事情都收尾了', calm.text.includes('事情都收尾了'))
  check('文本说没有特别的瞬间', calm.text.includes('没有特别的瞬间'))

  // 答案残缺不能炸
  const partial = shapeDiary({}, 3)
  eq('残缺时 mood 落空', partial.mood, undefined)
  eq('残缺时 highlight 默认无', partial.hasHighlight, false)
  check('残缺时也给出一句话', partial.text.length > 0, partial.text)
  check('noul 出界按边界算', shapeDiary({ diary_highlight: { noul: 12 } }, 1).hasHighlight === true)

  // ─── mock 判断服务器 ──────────────────────────────────────────────────────

  const captured: string[] = []
  const server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      captured.push(body)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        answers: {
          diary_mood: { choice: 'friction' },
          diary_highlight: { noul: 0.9 },
          diary_unresolved: { noul: 0.7 }
        },
        usage: {}
      }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as AddressInfo
  const MOCK_ENDPOINT = `http://127.0.0.1:${addr.port}/v1/systemone`

  // 独立 userData 目录 + 自己一个 JevService 实例，不污染别的测试
  const dataDir = mkdtempSync(join(tmpdir(), 'jev-diary-'))
  process.env.WEFLOW_USER_DATA_PATH = dataDir
  const svc = new JevService(ConfigService.getInstance())

  const config = ConfigService.getInstance()
  config.set('jevJudgeApiKey' as any, 'test-key' as any)
  config.set('jevJudgeEndpoint' as any, MOCK_ENDPOINT as any)

  const NOW = Math.floor(Date.now() / 1000)
  const H = 3600
  const mkMsg = (createTime: number, parsedContent: string) => ({
    isSend: 0,
    createTime,
    localType: 1,
    localId: createTime,
    parsedContent,
    rawContent: parsedContent
  } as any)

  const TEST_SESSION = 'jev-diary-test-session'
  // 从早到晚一整天：日记不吃 5 小时窗口，早上的消息也得在 state 里
  const messages = [
    mkMsg(NOW - 10 * H, '早，今天加班吗'),
    mkMsg(NOW - 6 * H, '中午吃啥'),
    mkMsg(NOW - 20, '晚上再说吧，我先忙')
  ]
  const DAY_END = messages[messages.length - 1].createTime
  insightRecordService.clearRecords({ sourceType: 'jev_diary', sessionId: TEST_SESSION })

  const first = await svc.summarizeDay({
    sessionId: TEST_SESSION,
    messages,
    dayEndTime: DAY_END,
    displayName: '测试联系人'
  })
  check('总结成功', first.success, JSON.stringify(first))
  check('返回了日记', !!first.diary)
  eq('mood 是 mock 给的 friction', first.diary!.mood, 'friction')
  eq('消息条数是气泡数', first.diary!.messageCount, 3)

  // 入库
  const list1 = insightRecordService.listRecords({ sourceType: 'jev_diary', sessionId: TEST_SESSION })
  eq('收件箱里有一条 jev_diary', list1.records.length, 1)
  const rec = list1.records[0]
  eq('来源标记', rec.sourceType, 'jev_diary')
  eq('insight 是拼装文本', rec.insight, first.diary!.text)
  eq('反链锚点是当天最后一条', rec.messageInsight?.targetCreateTime, DAY_END)
  eq('氛围存进 analysis.intent', rec.messageInsight?.analysis.intent, 'friction')
  eq('未收尾标记', rec.messageInsight?.analysis.topic, '有未处理完的事')
  eq('displayName 透传', rec.displayName, '测试联系人')

  // 不吃 5 小时窗口：state 里得有早上那条
  const req0 = captured[0]
  const texts: string[] = req0 ? (JSON.parse(req0).state?.chat?.messages || []).map((m: any) => m.text) : []
  check('抓到了请求', captured.length >= 1)
  check('日记 state 包含早上的消息（不吃时间窗）', texts.includes('早，今天加班吗'), JSON.stringify(texts))
  check('日记 state 包含最后一条', texts.includes('晚上再说吧，我先忙'))

  // 命中缓存：再总结同一天，不再请求接口
  const beforeRequests = captured.length
  const second = await svc.summarizeDay({
    sessionId: TEST_SESSION,
    messages,
    dayEndTime: DAY_END,
    displayName: '测试联系人'
  })
  check('二次总结走缓存也成功', second.success, JSON.stringify(second))
  eq('命中缓存不再请求接口', captured.length, beforeRequests)
  check('缓存结论和上次一致', JSON.stringify(second.diary) === JSON.stringify(first.diary))

  // 同天去重：forceRefresh 重跑，仍是同一天，不该变成两条
  const refreshed = await svc.summarizeDay({
    sessionId: TEST_SESSION,
    messages,
    dayEndTime: DAY_END,
    displayName: '测试联系人',
    forceRefresh: true
  })
  check('forceRefresh 也成功', refreshed.success, JSON.stringify(refreshed))
  const list2 = insightRecordService.listRecords({ sourceType: 'jev_diary', sessionId: TEST_SESSION })
  eq('forceRefresh 后仍只有一条（同天去重）', list2.records.length, 1)
  check('换了新结论', list2.records[0].insight === refreshed.diary?.text)

  // 另一天：不去重，应该是两条并存
  const OTHER_DAY = messages.map((m) => ({ ...m, createTime: m.createTime - 48 * H }))
  const otherEnd = OTHER_DAY[OTHER_DAY.length - 1].createTime
  const third = await svc.summarizeDay({
    sessionId: TEST_SESSION,
    messages: OTHER_DAY as any,
    dayEndTime: otherEnd,
    displayName: '测试联系人'
  })
  check('另一天的总结也成功', third.success, JSON.stringify(third))
  const list3 = insightRecordService.listRecords({ sourceType: 'jev_diary', sessionId: TEST_SESSION })
  eq('不同天的日记并存', list3.records.length, 2)

  // 无 key 拒绝
  config.set('jevJudgeApiKey' as any, '' as any)
  const noKey = await svc.summarizeDay({
    sessionId: TEST_SESSION,
    messages,
    dayEndTime: DAY_END
  })
  check('无 judge key → 拒绝', !noKey.success && noKey.error!.includes('API Key'), JSON.stringify(noKey))

  // 空会话拒绝
  config.set('jevJudgeApiKey' as any, 'test-key' as any)
  const empty = await svc.summarizeDay({
    sessionId: TEST_SESSION,
    messages: [],
    dayEndTime: 0
  })
  check('空会话 → 拒绝', !empty.success, JSON.stringify(empty))

  // 死端点：接口失败时不写半成品记录
  config.set('jevJudgeEndpoint' as any, 'http://127.0.0.1:1/v1/systemone' as any)
  const dead = await svc.summarizeDay({
    sessionId: TEST_SESSION,
    messages,
    dayEndTime: DAY_END,
    forceRefresh: true
  })
  check('死端点 → 失败', !dead.success, JSON.stringify(dead))
  const list4 = insightRecordService.listRecords({ sourceType: 'jev_diary', sessionId: TEST_SESSION })
  eq('死端点不新增记录', list4.records.length, 2)

  // 清理
  insightRecordService.clearRecords({ sourceType: 'jev_diary', sessionId: TEST_SESSION })
  config.set('jevJudgeApiKey' as any, '' as any)
  config.set('jevJudgeEndpoint' as any, '' as any)
  delete process.env.WEFLOW_USER_DATA_PATH
  server.close()

  // ─── 汇总 ───────────────────────────────────────────────────────────────

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.error('PHASE 4 TESTS FAILED')
    process.exit(1)
  }
}

void main().catch((e) => {
  console.error('PHASE 4 测试运行异常:', e)
  process.exit(1)
})
