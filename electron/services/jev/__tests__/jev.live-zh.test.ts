/**
 * 实测：用真实 key 跑一遍中文场景，验证两件 mock 测不到的事：
 *
 * 1. norm() 的中文修复真的在真实数据上生效（\W 的 u-flag 问题在单元测试里用
 *    硬编码字符串测过，但没在真实模型输出上验过）；
 * 2. decisions 端点对纯中文 state 的处理符合预期（choice 是题面里的 key，
 *    不是模型自由发挥的中文）。
 *
 * 跑法（key 只进环境，绝不落盘/打印）：
 *   JEV_JUDGE_KEY="..." npm run test:jev:live-zh
 */
import { JevService } from '../../jevService'
import { ConfigService } from '../../config'
import { tmpdir } from 'os'
import { mkdtempSync } from 'fs'
import { join } from 'path'

// draft.ts 的 norm 不导出（只内部用）；这里复制同一份实现，**必须和 draft.ts 保持一致**。
// 它是「中文候选全丢」的直接原因，实测里要在真实数据上证明它没把中文抹空。
function norm(t: string): string {
  return String(t || '').replace(/[\s\p{P}\p{S}_]+/gu, '').toLowerCase()
}

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

async function main() {
  const key = (process.env.JEV_JUDGE_KEY || '').trim()
  if (!key) {
    console.error('JEV_JUDGE_KEY 未设置。key 只从环境读，不落盘不打印。')
    process.exit(1)
  }

  // ─── norm() 单元层面：中文不该被抹空 ──────────────────────────────────────
  // 这部分不需要网络，但放这儿一起跑：它是「中文候选全丢」的直接原因
  check('norm 保留中文字符', norm('你好，世界！') === '你好世界', norm('你好，世界！'))
  check('norm 保留中文 + 字母混合', norm('OK 好的！') === 'ok好的', norm('OK 好的！'))
  check('norm 抹掉标点和空白', norm('测试...（确认）') === '测试确认', norm('测试...（确认）'))
  check('norm 纯标点是空串', norm('。。。！？') === '', norm('。。。！？'))
  // 旧的 ASCII \W 行为会把中文全抹掉——这里证明现在不会
  check('旧 bug 已修：中文不被当非词字符抹掉', norm('记得阿').length === 3, norm('记得阿'))

  // ─── 真实端点：中文 state 走 decide ──────────────────────────────────────
  const dataDir = mkdtempSync(join(tmpdir(), 'jev-live-zh-'))
  process.env.WEFLOW_USER_DATA_PATH = dataDir
  const svc = new JevService(ConfigService.getInstance())

  const config = ConfigService.getInstance()
  config.set('jevJudgeApiKey' as any, key as any)
  // 这条 key 是 TypeSafe 官方的，默认 provider 是 openrouter（typesafe/jev-1.13）会 400。
  // 探针已验证官方端点 + jev-latest 可用。
  config.set('jevJudgeProvider' as any, 'typesafe' as any)
  config.set('jevJudgeEndpoint' as any, '' as any)
  config.set('jevJudgeModel' as any, '' as any)

  const NOW = Math.floor(Date.now() / 1000)
  const mkMsg = (createTime: number, isSend: number, parsedContent: string) => ({
    isSend,
    createTime,
    localType: 1,
    localId: createTime,
    parsedContent,
    rawContent: parsedContent,
    messageKey: `live-${createTime}`
  } as any)

  const TEST_SESSION = 'jev-live-zh-session'
  const messages = [
    mkMsg(NOW - 60, 0, '你还记得我下周要去干嘛吗'),
    mkMsg(NOW - 50, 1, '记得啊'),
    mkMsg(NOW - 40, 0, '那你说说')
  ]

  // quickDecide：真实端点 + 中文对话
  const verdict = await svc.quickDecide({ sessionId: TEST_SESSION, messages })
  check('quickDecide 真实端点成功', verdict.success, JSON.stringify(verdict))
  if (verdict.success) {
    check('verdict 是两个合法值之一', verdict.verdict === 'reply' || verdict.verdict === 'wait', String(verdict.verdict))
    check('confidence 在 0-100', verdict.confidence !== undefined && verdict.confidence >= 0 && verdict.confidence <= 100, String(verdict.confidence))
    console.log(`     判决：${verdict.verdict}（把握 ${verdict.confidence}%）${verdict.sheNeeds ? `对方想要：${verdict.sheNeeds}` : ''}`)
  }

  // 命中缓存：同样输入再跑一次不该再请求接口（decisionCache 记的是 answers）
  const verdict2 = await svc.quickDecide({ sessionId: TEST_SESSION, messages })
  check('同样输入二次走缓存也成功', verdict2.success, JSON.stringify(verdict2))
  check('缓存判决一致', verdict.success && verdict2.success && verdict.verdict === verdict2.verdict)

  // annotate：真实端点给中文消息逐条标潜台词
  const targets = [
    { key: 'live-a', createTime: NOW - 60, text: '你还记得我下周要去干嘛吗' },
    { key: 'live-c', createTime: NOW - 40, text: '那你说说' }
  ]
  const ann = await svc.annotateSession({ sessionId: TEST_SESSION, messages, targets })
  check('annotateSession 真实端点成功', ann.success, JSON.stringify(ann))
  if (ann.success) {
    eq('两条都判了', ann.scanned + ann.cached, 2)
    for (const k of ['live-a', 'live-c']) {
      const a = ann.annotations[k]
      check(`标注 ${k} 有结论`, !!a && typeof a.subtext === 'boolean', JSON.stringify(a))
      if (a) {
        console.log(`     ${k}：话里有话=${a.subtext}（${a.subtextPct}%）意图=${a.intent} 需要=${a.needs}`)
        check(`${k} 的 intent 是合法 choice key`, typeof a.intent === 'string' && a.intent.length > 0, String(a.intent))
        check(`${k} 的 needs 是合法 choice key`, typeof a.needs === 'string' && a.needs.length > 0, String(a.needs))
      }
    }
  }

  // 清理
  config.set('jevJudgeApiKey' as any, '' as any)
  config.set('jevJudgeProvider' as any, '' as any)
  config.set('jevJudgeEndpoint' as any, '' as any)
  config.set('jevJudgeModel' as any, '' as any)
  delete process.env.WEFLOW_USER_DATA_PATH

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) {
    console.error('LIVE ZH TESTS FAILED')
    process.exit(1)
  }
}

function eq<T>(name: string, actual: T, expected: T): void {
  const same = JSON.stringify(actual) === JSON.stringify(expected)
  check(name, same, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)
}

void main().catch((e) => {
  console.error('实测运行异常:', e)
  process.exit(1)
})
