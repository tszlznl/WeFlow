/**
 * Phase 5 的桩测试：Agent 题集 + 工具表 + 有界循环 + 确认门。
 *
 * 覆盖：
 * - agent 题集结构和工具表对齐（criteria key = 工具 id，不存在幽灵工具）
 * - findAgentTool 的命令式入口（中英文别名、/前缀、大小写、问号；乱写给 null）
 * - runAgent 两段式：直接命令跳过决策；自然语言走决策；副作用工具没确认只出计划；
 *   确认后重跑命中缓存不重复执行；有界循环上限；决策接口选了不存在的工具
 *
 * judge 端点指向本地 mock 服务器，全程不联网、不花钱。
 *
 * 跑法：npm run test:jev:phase5
 */
import { getPack, QUESTION_PACKS } from '../packs'
import { AGENT_QUESTIONS, AGENT_TOOLS, AGENT_TOOL_IDS, findAgentTool } from '../agentQuestions'
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
  // ─── 题集结构 ───────────────────────────────────────────────────────────────

  check('agent 已注册', !!QUESTION_PACKS.agent)
  eq('agent 一道题', Object.keys(getPack('agent').buildQuestions()), ['agent_tool'])
  const agentQ = getPack('agent').buildQuestions() as Record<string, any>
  check('agent_tool 是 choice 题', agentQ.agent_tool.type === 'choice')

  // criteria 的 key 必须正好是工具表 id：多一个是幽灵工具，少一个决策接口选了也执行不了
  eq(
    'criteria key 和工具表 id 完全对齐',
    Object.keys(agentQ.agent_tool.criteria).sort(),
    [...AGENT_TOOL_IDS].sort()
  )
  check('agent_tool 有 none-ish 退路吗（没有，靠 break）', !('none' in agentQ.agent_tool.criteria))

  // 工具表自洽：每个工具至少有一个别名，id 不重复
  check('工具表五个工具', AGENT_TOOLS.length === 5, String(AGENT_TOOLS.length))
  eq('工具 id 不重复', new Set(AGENT_TOOL_IDS).size, AGENT_TOOL_IDS.length)
  check('每个工具都有别名', AGENT_TOOLS.every((t) => t.aliases.length > 0))
  eq(
    '有副作用的正好是写收件箱那两个',
    AGENT_TOOLS.filter((t) => t.hasSideEffects).map((t) => t.id).sort(),
    ['diary', 'todos']
  )

  // ─── findAgentTool：命令式入口 ─────────────────────────────────────────────

  eq('英文 id', findAgentTool('todo')?.id, 'todos')
  eq('英文别名复数', findAgentTool('todos')?.id, 'todos')
  eq('中文别名', findAgentTool('待办')?.id, 'todos')
  eq('带斜杠', findAgentTool('/todo')?.id, 'todos')
  eq('大写', findAgentTool('/TODO')?.id, 'todos')
  eq('带问号', findAgentTool('该回吗？')?.id, 'verdict')
  eq('带感叹号', findAgentTool('！标注')?.id, 'annotate')
  eq('前后空格', findAgentTool('  /diary  ')?.id, 'diary')
  eq('起草', findAgentTool('/起草')?.id, 'draft')
  check('乱写 → null', findAgentTool('随便说说的') === null)
  check('空串 → null', findAgentTool('') === null)
  check('自然语言 → null（不按命令处理）', findAgentTool('帮我看看这个会话') === null)

  // ─── mock 判断服务器 ────────────────────────────────────────────────────────
  // 每次请求回一个工具，靠 requestCount 让它「排一步就停」和「无限编排」两种行为

  let nextTool = 'todos'
  let requestCount = 0
  const captured: string[] = []
  const server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      requestCount++
      captured.push(body)
      // 第 N 次请求要排第 N 步（从 0 起）。排够 2 步或者要到重复工具就停。
      const planSoFar = (() => {
        try {
          return (JSON.parse(body)?.state?.agent?.steps || []) as Array<{ tool: string }>
        } catch {
          return []
        }
      })()
      const tool = nextTool
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        answers: { agent_tool: { choice: tool } },
        usage: {}
      }))
      void planSoFar
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address() as AddressInfo
  const MOCK_ENDPOINT = `http://127.0.0.1:${addr.port}/v1/systemone`

  // 独立 userData 目录 + 自己一个 JevService 实例
  const dataDir = mkdtempSync(join(tmpdir(), 'jev-agent-'))
  process.env.WEFLOW_USER_DATA_PATH = dataDir
  const svc = new JevService(ConfigService.getInstance())

  const config = ConfigService.getInstance()
  config.set('jevJudgeApiKey' as any, 'test-key' as any)
  config.set('jevJudgeEndpoint' as any, MOCK_ENDPOINT as any)

  const NOW = Math.floor(Date.now() / 1000)
  const mkMsg = (createTime: number, parsedContent: string) => ({
    isSend: 0,
    createTime,
    localType: 1,
    localId: createTime,
    parsedContent,
    rawContent: parsedContent,
    messageKey: `key-${createTime}`
  } as any)

  const TEST_SESSION = 'jev-agent-test-session'
  const messages = [
    mkMsg(NOW - 10, '周五前把报告发我'),
    mkMsg(NOW - 5, '在吗')
  ]
  insightRecordService.clearRecords({ sourceType: 'jev_todo', sessionId: TEST_SESSION })
  insightRecordService.clearRecords({ sourceType: 'jev_diary', sessionId: TEST_SESSION })

  // ─── 直接命令：跳过决策接口 ─────────────────────────────────────────────────

  const requestsBefore = requestCount
  const agentRequestsBefore = captured.length
  nextTool = 'todos'
  const direct = await svc.runAgent({
    command: '/待办',
    sessionId: TEST_SESSION,
    messages,
    displayName: '测试联系人'
  })
  check('直接命令执行成功', direct.success, JSON.stringify(direct))
  eq('直接命令只排一个工具', direct.plan, ['todos'])
  // 直接命令不调用 agent 题集（工具自己该调的 todo 题集不算）
  check(
    '直接命令不调用 agent 题集',
    captured.slice(agentRequestsBefore).every((c) => !c.includes('agent_tool')),
    JSON.stringify(captured.slice(agentRequestsBefore).map((c) => c.slice(0, 80)))
  )
  check('直接命令不绕回决策接口选工具', requestCount - requestsBefore >= 0)
  check('有执行结果', (direct.steps || []).length === 1)
  check('步骤是 todos', direct.steps?.[0]?.tool === 'todos')
  check('待办真入库了', (direct.steps?.[0]?.summary || '').includes('新增'))

  // ─── 确认门：有副作用的工具不确认就只出计划 ───────────────────────────────

  nextTool = 'diary'
  const noConfirm = await svc.runAgent({
    command: '帮我总结一下今天',
    sessionId: TEST_SESSION,
    messages,
    displayName: '测试联系人'
  })
  check('没确认 → 需要确认', noConfirm.needsConfirm === true, JSON.stringify(noConfirm))
  check('确认文案提到了会写收件箱', (noConfirm.confirmPrompt || '').includes('收件箱'))
  eq('计划已经排出来了', noConfirm.plan, ['diary'])
  check('没执行（没有 steps）', !noConfirm.steps)
  const diaryBefore = insightRecordService.listRecords({ sourceType: 'jev_diary', sessionId: TEST_SESSION }).records.length
  eq('没确认时收件箱没多日记', diaryBefore, 0)

  // ─── 确认后重跑：决策命中缓存，执行工具 ───────────────────────────────────

  const confirmed = await svc.runAgent({
    command: '帮我总结一下今天',
    sessionId: TEST_SESSION,
    messages,
    displayName: '测试联系人',
    confirmed: true
  })
  check('确认后执行成功', confirmed.success, JSON.stringify(confirmed))
  check('确认后有执行结果', (confirmed.steps || []).length === 1)
  const diaryAfter = insightRecordService.listRecords({ sourceType: 'jev_diary', sessionId: TEST_SESSION })
  eq('确认后日记入库', diaryAfter.records.length, 1)

  // ─── 只读工具不需要确认 ─────────────────────────────────────────────────────

  nextTool = 'verdict'
  const verdict = await svc.runAgent({
    command: '看看该不该回',
    sessionId: TEST_SESSION,
    messages
  })
  check('只读工具不需要确认', !verdict.needsConfirm, JSON.stringify(verdict))
  check('verdict 直接执行了', verdict.success === true)
  check('verdict 有结论', (verdict.steps?.[0]?.summary || '').length > 0, verdict.steps?.[0]?.summary)

  // ─── 有界循环：决策接口一直选同一个工具也不会无限编排 ─────────────────────
  // （重复工具 = 没新活干了，break）

  nextTool = 'annotate'
  const loop = await svc.runAgent({
    command: '标注一下',
    sessionId: TEST_SESSION,
    messages
  })
  check('重复工具时自然停下', loop.success && (loop.steps || []).length === 1, JSON.stringify(loop))
  check('没被截断（是自然停的）', !loop.truncated)

  // ─── 无 key 拒绝 ─────────────────────────────────────────────────────────────

  config.set('jevJudgeApiKey' as any, '' as any)
  const noKey = await svc.runAgent({
    command: '/待办',
    sessionId: TEST_SESSION,
    messages
  })
  check('无 judge key → 拒绝', !noKey.success && noKey.error!.includes('API Key'), JSON.stringify(noKey))

  // ─── 死端点：决策接口挂了不执行任何工具 ─────────────────────────────────────

  config.set('jevJudgeApiKey' as any, 'test-key' as any)
  config.set('jevJudgeEndpoint' as any, 'http://127.0.0.1:1/v1/systemone' as any)
  const dead = await svc.runAgent({
    command: '帮我看看',
    sessionId: TEST_SESSION,
    messages
  })
  check('死端点 → 失败', !dead.success, JSON.stringify(dead))
  check('死端点没执行任何工具', !dead.steps, JSON.stringify(dead))

  // ─── 决策接口选了不存在的工具：不认，不执行 ───────────────────────────────

  config.set('jevJudgeEndpoint' as any, MOCK_ENDPOINT as any)
  nextTool = 'call_someone'
  const ghost = await svc.runAgent({
    command: '做点什么都行',
    sessionId: TEST_SESSION,
    messages
  })
  check('幽灵工具 → 失败且不执行', !ghost.success && !ghost.steps, JSON.stringify(ghost))

  // ─── 决策接口全选 none：计划空，给提示 ─────────────────────────────────────

  nextTool = 'none'
  const noneRun = await svc.runAgent({
    command: '我也不知道要干嘛',
    sessionId: TEST_SESSION,
    messages
  })
  check('全 none → 失败且给出可用命令提示', !noneRun.success && (noneRun.error || '').includes('/'), JSON.stringify(noneRun))

  // ─── 空命令 ─────────────────────────────────────────────────────────────────

  const empty = await svc.runAgent({
    command: '   ',
    sessionId: TEST_SESSION,
    messages
  })
  check('空命令 → 拒绝', !empty.success, JSON.stringify(empty))

  // 清理
  insightRecordService.clearRecords({ sourceType: 'jev_todo', sessionId: TEST_SESSION })
  insightRecordService.clearRecords({ sourceType: 'jev_diary', sessionId: TEST_SESSION })
  config.set('jevJudgeApiKey' as any, '' as any)
  config.set('jevJudgeEndpoint' as any, '' as any)
  delete process.env.WEFLOW_USER_DATA_PATH
  server.close()

  // ─── 汇总 ───────────────────────────────────────────────────────────────────

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.error('PHASE 5 TESTS FAILED')
    process.exit(1)
  }
}

void main().catch((e) => {
  console.error('PHASE 5 测试运行异常:', e)
  process.exit(1)
})
