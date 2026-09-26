/**
 * Phase 3 的桩测试：待办题集 + scanTodos 的闸门 / 入库 / 去重 / forceRefresh /
 * 5 小时时间窗。judge 端点指向本地 mock 服务器，全程不联网、不花钱。
 *
 * 跑法：npm run test:jev:phase3
 */
import { getPack, QUESTION_PACKS } from '../packs'
import { TODO_QUESTIONS } from '../todoQuestions'
import { JevService } from '../../jevService'
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
  // ─── todo 题集结构 ───────────────────────────────────────────────────────

  check('todo 已注册', !!QUESTION_PACKS.todo)
  eq('todo 三道题', Object.keys(getPack('todo').buildQuestions()).sort(), [
    'todo_kind',
    'todo_present',
    'todo_when'
  ])
  eq('buildQuestions 返回的是原题', getPack('todo').buildQuestions(), { ...TODO_QUESTIONS })
  const todoQ = getPack('todo').buildQuestions() as Record<string, any>
  check('todo_present 是闸门 noul 题', todoQ.todo_present.type === 'noul')
  check('todo_kind 的 criteria 有六个类型', Object.keys(todoQ.todo_kind.criteria).length === 6)
  check(
    'criteria key 和前端 TODO_KIND_LABELS 对齐',
    Object.keys(todoQ.todo_kind.criteria).sort().join(',') ===
      ['help', 'meeting', 'other', 'promise', 'reminder', 'work'].join(',')
  )

  // ─── mock 判断服务器：按消息内容回固定答案，并记下每次请求的 state ────────

  const captured: string[] = []
  const server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      captured.push(body)
      // 按请求里最后一条消息判：判的是「这句话」，不是上下文里出现过就算
      let lastText = ''
      try {
        const msgs = JSON.parse(body)?.state?.chat?.messages || []
        lastText = msgs.length > 0 ? String(msgs[msgs.length - 1]?.text || '') : ''
      } catch {
        /* 解析失败按非待办处理 */
      }
      // 「周五前把报告发我」判成待办（present=0.9，有截止，工作交办）；
      // 其余判成非待办（present=0.2），闸门必须拦下
      const isTodo = lastText === '周五前把报告发我'
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        answers: {
          todo_present: { noul: isTodo ? 0.9 : 0.2 },
          todo_when: { noul: isTodo ? 0.8 : 0.1 },
          todo_kind: { choice: isTodo ? 'work' : 'reminder' }
        },
        usage: {}
      }))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as AddressInfo
  const MOCK_ENDPOINT = `http://127.0.0.1:${addr.port}/v1/systemone`

  // 独立 userData 目录 + 自己一个 JevService 实例，不污染别的测试
  const dataDir = mkdtempSync(join(tmpdir(), 'jev-todo-'))
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

  const TEST_SESSION = 'jev-todo-test-session'
  const messages = [
    mkMsg(NOW - 8 * H, '上次说的那件事'),   // 超过 5 小时，该被时间窗排除
    mkMsg(NOW - 10, '周五前把报告发我'),    // 待办
    mkMsg(NOW - 5, '在吗')                  // 非待办
  ]
  insightRecordService.clearRecords({ sourceType: 'jev_todo', sessionId: TEST_SESSION })

  const targets = [
    { key: 'k-todo', createTime: NOW - 10, text: '周五前把报告发我' },
    { key: 'k-chat', createTime: NOW - 5, text: '在吗' }
  ]

  const first = await svc.scanTodos({
    sessionId: TEST_SESSION,
    messages,
    targets,
    displayName: '测试联系人'
  })
  check('扫描成功', first.success, JSON.stringify(first))
  eq('只入库 present 达标的那一条（闸门拦下 0.2 的）', first.added, 1)
  eq('两条都判了（没漏判）', first.scanned, 2)

  // 入库内容：源消息反链 + 类型 + 截止标记 + 把握
  const list1 = insightRecordService.listRecords({ sourceType: 'jev_todo', sessionId: TEST_SESSION })
  eq('收件箱里有一条 jev_todo', list1.records.length, 1)
  const rec = list1.records[0]
  eq('待办文本是源消息本身', rec.insight, '周五前把报告发我')
  eq('反链键就是前端的 messageKey', rec.messageInsight?.targetMessageKey, 'k-todo')
  eq('反链 localId', rec.messageInsight?.targetLocalId, NOW - 10)
  eq('类型 work', rec.messageInsight?.analysis.intent, 'work')
  eq('有截止时间', rec.messageInsight?.analysis.topic, '有截止时间')
  eq('把握 90%', rec.messageInsight?.analysis.emotion, '90')
  eq('displayName 透传', rec.displayName, '测试联系人')

  // 闸门：非待办那条从头到尾没进过收件箱
  check(
    '「在吗」从未成为待办',
    !list1.records.some((r) => r.messageInsight?.targetMessageKey === 'k-chat')
  )

  // 5 小时时间窗：判「周五前」那次请求的 state 里不该有 8 小时前的旧消息
  const todoReq = captured.find((c) => {
    try {
      const p = JSON.parse(c)
      const msgs = p?.state?.chat?.messages || []
      return msgs.length > 0 && msgs[msgs.length - 1]?.text === '周五前把报告发我'
    } catch {
      return false
    }
  })
  check('抓到了判「周五前」的那次请求', !!todoReq)
  if (todoReq) {
    const texts: string[] = (JSON.parse(todoReq).state?.chat?.messages || []).map((m: any) => m.text)
    check('超过 5 小时的旧消息被排除', !texts.includes('上次说的那件事'), JSON.stringify(texts))
    check('目标消息自己还在', texts.includes('周五前把报告发我'))
  }

  // 去重：同会话同消息再扫不重复建（走缓存，不再请求接口）
  const beforeRequests = captured.length
  const second = await svc.scanTodos({
    sessionId: TEST_SESSION,
    messages,
    targets,
    displayName: '测试联系人'
  })
  eq('二次扫描跳过已存在的', second.added, 0)
  eq('skipped 计数', second.skipped, 1)
  eq('命中缓存不再请求接口', captured.length, beforeRequests)

  // forceRefresh：清掉旧的重建（绕过缓存，重新请求接口）
  const refreshed = await svc.scanTodos({
    sessionId: TEST_SESSION,
    messages,
    targets,
    displayName: '测试联系人',
    forceRefresh: true
  })
  eq('forceRefresh 重建待办', refreshed.added, 1)
  const list2 = insightRecordService.listRecords({ sourceType: 'jev_todo', sessionId: TEST_SESSION })
  eq('forceRefresh 后仍只有一条（清了旧的）', list2.records.length, 1)

  // 无 key 拒绝
  config.set('jevJudgeApiKey' as any, '' as any)
  const noKey = await svc.scanTodos({
    sessionId: TEST_SESSION,
    messages,
    targets: [{ key: 'k-todo', createTime: NOW - 10, text: '周五前把报告发我' }]
  })
  check('无 judge key → 拒绝', !noKey.success && noKey.error!.includes('API Key'), JSON.stringify(noKey))

  // 定位失败
  config.set('jevJudgeApiKey' as any, 'test-key' as any)
  const notLocated = await svc.scanTodos({
    sessionId: TEST_SESSION,
    messages,
    targets: [{ key: 'k-x', createTime: 9999, text: '不存在' }]
  })
  check('定位失败 → 报错', !notLocated.success && notLocated.error!.includes('没在消息流里定位到'), JSON.stringify(notLocated))

  // 死端点：接口全失败时不留半成品记录
  config.set('jevJudgeEndpoint' as any, 'http://127.0.0.1:1/v1/systemone' as any)
  const dead = await svc.scanTodos({
    sessionId: TEST_SESSION,
    messages,
    targets: [{ key: 'k-todo', createTime: NOW - 10, text: '周五前把报告发我' }],
    forceRefresh: true
  })
  check('死端点 → 失败且 added=0', !dead.success && dead.added === 0, JSON.stringify(dead))

  // 清理
  insightRecordService.clearRecords({ sourceType: 'jev_todo', sessionId: TEST_SESSION })
  config.set('jevJudgeApiKey' as any, '' as any)
  config.set('jevJudgeEndpoint' as any, '' as any)
  delete process.env.WEFLOW_USER_DATA_PATH
  server.close()

  // ─── 汇总 ───────────────────────────────────────────────────────────────

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.error('PHASE 3 TESTS FAILED')
    process.exit(1)
  }
}

void main().catch((e) => {
  console.error('PHASE 3 测试运行异常:', e)
  process.exit(1)
})
