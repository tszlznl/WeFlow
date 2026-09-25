/**
 * 探针：decisions 端点是否真的读 state.background？
 *
 * background（联系人备注 + 知识库命中）在两个 Python 版里都**只是设计意图**
 * （jarvis 里只有这个探针脚本，build_state 从没接过它）。在往 questions.ts
 * 接数据之前必须先确认线上端点的行为：
 *
 *   - 两次 200 且概率完全相同 → ACCEPTED BUT IGNORED：字段没到模型，
 *     不能用 state.background，得把背景折进 chat.relationship 之类的已有字段。
 *   - 两次 200 且概率不同   → ACCEPTED AND READ：可以按计划接。
 *   - 加字段返回 400/422     → REJECTED：不能加顶层 background，要嵌进 chat。
 *
 * 跑法（key 只进环境，绝不落盘/打印）：
 *   $env:JEV_JUDGE_KEY = "<key>"      # PowerShell
 *   npm run test:jev:bg-probe
 *
 * 输出只有 HTTP 状态、答案和概率，不含 key。
 */
import https from 'node:https'

const URLS = {
  typesafe: 'https://api.typesafe.ai/v1/systemone',
  openrouter: 'https://openrouter.ai/api/alpha/decisions'
} as const

const MODELS = {
  typesafe: 'jev-latest',
  openrouter: 'typesafe/jev-1.13'
} as const

const BACKGROUND_NOTE = ' Facts given in background are provided context, not off-topic.'

const CHAT = {
  relationship: '对方是我的伴侣；from=me 的是我发的，from=her 的是对方发的',
  messages: [
    { from: 'her', text: '你还记得我下周要去干嘛吗' },
    { from: 'me', text: '记得啊' },
    { from: 'her', text: '那你说说' }
  ],
  latest_from: 'her',
  is_group: false,
  reply_to: null
}

const BACKGROUND = (
  '关系：伴侣，在一起 3 年。'
  + '联系人备注：她下周三要去上海面试一家设计公司，很紧张。'
  + '知识库命中：她对迟到零容忍；她不喝咖啡。'
)

const QUESTION = {
  true_intent: {
    type: 'choice',
    instructions:
      'What is the other person\'s true intent in the latest message, '
      + 'given the full conversation?' + BACKGROUND_NOTE,
    criteria: {
      confirm_you_care: 'They are testing whether you remember or still care.',
      request_action: 'They want a concrete action, time, or commitment now.',
      vent_anger: 'They are angry or hurt and want the feeling acknowledged.'
    }
  }
}

interface PostResult {
  status: number
  body: string
  ms: number
}

function post(provider: 'typesafe' | 'openrouter', key: string, state: unknown): Promise<PostResult> {
  const url = URLS[provider]
  const body = JSON.stringify({ model: MODELS[provider], state, questions: QUESTION })
  return new Promise((resolve) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let data = ''
        res.setEncoding('utf-8')
        res.on('data', (c) => { data += c })
        res.on('end', () => resolve({ status: res.statusCode || 0, body: data, ms: Date.now() - t0 }))
      }
    )
    const t0 = Date.now()
    req.on('error', (e) => resolve({ status: -1, body: `${e.name}: ${e.message}`, ms: Date.now() - t0 }))
    req.end(body)
  })
}

interface AnswerSummary {
  choice?: string
  probabilities?: Record<string, number>
}

function summarize(tag: string, r: PostResult): AnswerSummary | null {
  console.log(`\n=== ${tag} ===`)
  console.log(`HTTP ${r.status}   ${r.ms} ms`)
  if (r.status !== 200) {
    console.log(r.body.slice(0, 400))
    return null
  }
  let data: any
  try {
    data = JSON.parse(r.body)
  } catch {
    console.log('响应不是 JSON:', r.body.slice(0, 200))
    return null
  }
  const ans = (data.answers || {}).true_intent || {}
  console.log('choice     :', ans.choice)
  console.log('confidence :', ans.confidence)
  console.log('probs      :', JSON.stringify(ans.probabilities || {}))
  return { choice: ans.choice, probabilities: ans.probabilities || {} }
}

async function main(): Promise<void> {
  const key = (process.env.JEV_JUDGE_KEY || '').trim()
  if (!key) {
    console.error('JEV_JUDGE_KEY 未设置。key 只从环境读，不落盘不打印。')
    process.exit(2)
  }
  const provider = (process.env.JEV_JUDGE_PROVIDER || 'typesafe') as 'typesafe' | 'openrouter'
  console.log(`provider: ${provider}   endpoint: ${URLS[provider]}`)

  const baseState = { chat: CHAT }
  const withBg = { chat: CHAT, background: BACKGROUND }

  const a = summarize('A. 不含 background（当前结构）', await post(provider, key, baseState))
  const b = summarize('B. 含未知字段 background（目标结构）', await post(provider, key, withBg))

  console.log('\n=== VERDICT ===')
  if (!a || !b) {
    console.log('INCONCLUSIVE: 至少一次请求非 200，检查网络 / key / 额度后重跑。')
    return
  }
  const probsEqual = JSON.stringify(a.probabilities) === JSON.stringify(b.probabilities)
  if (probsEqual) {
    console.log('ACCEPTED BUT IGNORED: 两次都 200 且概率完全相同 →')
    console.log('  background 没到模型。不能加 state.background，')
    console.log('  要把背景信息折进 chat.relationship 之类的已有字段。')
  } else {
    console.log('ACCEPTED AND READ: 两次都 200 且概率不同 →')
    console.log('  state.background 到了模型。可以按计划接 contactCacheService /')
    console.log('  insightProfileService 的联系人摘要。')
  }
}

void main()
