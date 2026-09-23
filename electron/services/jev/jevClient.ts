/**
 * Jev decisions API 客户端。从 jev-chat-windows/core/jev_client.py 移植。
 *
 * 判断/排序走 decisions 端点（和 chat/completions 不是同一个端点，insightService 的
 * callApi 复用不了，这里另写一个）。起草才走 chat/completions，见 draft.ts。
 *
 * 两套官方入口，请求体都是 {model, state, questions}：
 * - openrouter：https://openrouter.ai/api/alpha/decisions，模型 typesafe/jev-1.13
 * - typesafe 官方：https://api.typesafe.ai/v1/systemone，模型 jev-latest
 * 用户在设置页选 provider，或填完整 URL 走 custom。
 *
 * 密钥处理口径和 insightService 一致：key 只从 ConfigService 读，绝不进日志。
 * 请求失败时把 key 从错误文本里替掉再抛。
 */
import * as https from 'https'
import * as http from 'http'

export const JUDGE_PROVIDER_DEFAULTS = {
  openrouter: { endpoint: 'https://openrouter.ai/api/alpha/decisions', model: 'typesafe/jev-1.13' },
  typesafe: { endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' }
} as const
export type JudgeProvider = keyof typeof JUDGE_PROVIDER_DEFAULTS

export const DEFAULT_DECISIONS_URL = JUDGE_PROVIDER_DEFAULTS.openrouter.endpoint
export const DEFAULT_JUDGE_MODEL = JUDGE_PROVIDER_DEFAULTS.openrouter.model
const MAX_RETRIES = 3

export class JevApiError extends Error {
  status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'JevApiError'
    this.status = status
  }
}

interface AskOptions {
  /** 判断接口的完整 URL。优先级低于 provider。 */
  endpoint?: string
  apiKey: string
  model?: string
  timeoutMs?: number
}

/**
 * 按 provider 解析端点和模型：provider 优先，用户显式填的 endpoint/model 覆盖默认值，
 * 都没给就退 openrouter。和 jev-chat-jarvis v1.3-plan 的契约一致。
 */
export function resolveJudgeEndpoint(options: {
  provider?: JudgeProvider
  endpoint?: string
  model?: string
}): { endpoint: string; model: string } {
  const provider: JudgeProvider =
    options.provider === 'typesafe' ? 'typesafe'
      : options.provider === 'openrouter' ? 'openrouter'
        : (() => {
            // 没指定 provider，按用户填的 URL 猜一个
            const ep = String(options.endpoint || '').trim()
            if (ep.includes('api.typesafe.ai')) return 'typesafe'
            return 'openrouter'
          })()
  const def = JUDGE_PROVIDER_DEFAULTS[provider]
  const endpoint = String(options.endpoint || '').trim() || def.endpoint
  const model = String(options.model || '').trim() || def.model
  return { endpoint, model }
}

/**
 * POST {model, state, questions} 到 decisions，返回解析后的 JSON。
 * 429 / 529 / 超时按指数退避重试，最多 3 次。key 绝不进异常文本。
 */
export function ask(state: unknown, questions: unknown, options: AskOptions): Promise<Record<string, any>> {
  const endpoint = (options.endpoint || DEFAULT_DECISIONS_URL).trim()
  const model = (options.model || DEFAULT_JUDGE_MODEL).trim()
  const timeoutMs = options.timeoutMs ?? 20_000
  if (!options.apiKey) {
    return Promise.reject(new JevApiError('未配置判断接口密钥（Jev API Key）'))
  }

  const payload = JSON.stringify({ model, state, questions })
  return askOnce(endpoint, options.apiKey, payload, timeoutMs).then(
    (raw) => JSON.parse(raw),
    (err) => {
      const status = err instanceof JevApiError ? err.status : undefined
      // 429/529/超时才重试；其它 HTTP 错误直接抛（重试也是一样的错）
      if (!shouldRetry(status, err) ) throw err
      return retry(endpoint, options.apiKey, payload, timeoutMs, err)
    }
  )
}

function shouldRetry(status: number | undefined, err: unknown): boolean {
  if (status === 429 || status === 529) return true
  // 超时错误：request destroy 后抛的是普通 Error，按消息特征认一下
  const message = err instanceof Error ? err.message : String(err)
  return !status && message.includes('超时')
}

function retry(
  endpoint: string, apiKey: string, payload: string, timeoutMs: number, firstError: unknown
): Promise<Record<string, any>> {
  let attempt = 0
  const step = (): Promise<Record<string, any>> =>
    new Promise((resolve) => setTimeout(resolve, Math.pow(2, attempt) * 1000))
      .then(() => { attempt += 1; return askOnce(endpoint, apiKey, payload, timeoutMs) })
      .then((raw) => JSON.parse(raw))
      .catch((err) => {
        const status = err instanceof JevApiError ? err.status : undefined
        if (attempt < MAX_RETRIES && shouldRetry(status, err)) return step()
        throw describeError(err, firstError, apiKey)
      })
  return step()
}

function askOnce(endpoint: string, apiKey: string, payload: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let urlObj: URL
    try {
      urlObj = new URL(endpoint)
    } catch {
      reject(new JevApiError(`无效的判断接口 URL: ${endpoint}`))
      return
    }
    const requestOptions: http.RequestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(payload).toString()
      }
    }
    const requestFn = urlObj.protocol === 'https:' ? https.request : http.request
    const req = requestFn(requestOptions, (res) => {
      let data = ''
      res.setEncoding('utf-8')
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        const status = res.statusCode
        if (status && status >= 400) {
          reject(new JevApiError(`判断接口请求失败 (${status}): ${truncate(data, 400, apiKey)}`, status))
          return
        }
        resolve(data)
      })
    })
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new JevApiError(`判断接口请求超时 (${Math.round(timeoutMs / 1000)}s)`))
    })
    req.on('error', (e) => {
      reject(new JevApiError(`判断接口请求失败: ${redactKey(e.message, apiKey)}`))
    })
    req.write(payload)
    req.end()
  })
}

/**
 * 把任何要进日志/异常的文本里的 key 抹掉。和 Python 版 redact_secrets 同一个口径。
 * keys 之外再加一层格式兜底：有些网关/反代会在 4xx 响应体里回显 Authorization 头，
 * 这时错误文本里出现的 key 并不在调用方传进来的 keys 里（甚至根本不是我们这把），
 * 靠 sk-/apikey_ 前缀正则兜住，确保任何明文 key 都不进日志、不进 IPC、不进弹窗。
 */
export function redactKey(text: string, ...keys: string[]): string {
  let out = String(text || '')
  for (const k of keys) {
    if (k && out.includes(k)) out = out.split(k).join('[REDACTED]')
  }
  return out.replace(/(?:sk-[a-zA-Z0-9_\-]{8,}|apikey_[a-zA-Z0-9_\-]{8,})/gi, '[REDACTED]')
}

function truncate(text: string, limit: number, apiKey?: string): string {
  return redactKey(String(text || '').slice(0, limit), apiKey || '')
}

function describeError(err: unknown, firstError: unknown, apiKey?: string): Error {
  const status = err instanceof JevApiError ? err.status : undefined
  const firstStatus = firstError instanceof JevApiError ? firstError.status : undefined
  const statusText = status || firstStatus
  const detail = err instanceof Error ? err.message : String(err)
  return new JevApiError(`判断接口重试 ${MAX_RETRIES} 次后仍失败 (HTTP ${statusText ?? 'n/a'}): ${redactKey(detail, apiKey || '')}`, statusText)
}
