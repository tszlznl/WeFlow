/**
 * 决策缓存：按 (pack, session, messageKey) 缓存 decide() 的答案。
 *
 * decisions 按调用收费。同一条消息、同一个题集，第二次还要答案时直接走缓存，
 * 不再花钱。消息标注（徽标常驻界面、反复渲染）、待办扫描这类高频读场景
 * 全靠它。回复建议的排序题依赖候选，不进这个缓存（候选每次都变）。
 *
 * 存储范式照抄 cacheMapStore：内存 Map 服务读写 + 防抖异步落盘 + 退出时
 * 同步 flush，读写不碰磁盘、不阻塞主线程。答案本身不含密钥，明文存本地无妨。
 */
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { writeFile } from 'fs/promises'

let app: any = null
try {
  app = require('electron').app
} catch {
  // Worker 环境
}

interface CachedDecision {
  /** 题集 id。 */
  pack: string
  /** 答案，结构由题集决定。 */
  answers: Record<string, any>
  /** 缓存写入时间（ms），用于过期与展示。 */
  cachedAt: number
}

export class DecisionCacheStore {
  private readonly filePath: string
  private data = new Map<string, CachedDecision>()
  private persistTimer: NodeJS.Timeout | null = null
  private persistInFlight = false
  private persistDirty = false
  /** 默认 7 天过期。判断的是「最近这条消息值不值得回」，太久之前的没意义。 */
  static readonly DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

  constructor(userDataPath: string) {
    this.filePath = join(userDataPath, 'WeFlow-jev-decisions.json')
    this.load()
    app?.once?.('will-quit', () => this.flushSync())
  }

  /**
   * 缓存键：题集 + 会话 + 消息指纹。
   * messageKey 由调用方用「对方最近一条消息的文本 + 时间戳」算，保证同一条消息
   * 两次扫描命中同一格；消息一变，键自然变，不会拿到陈旧答案。
   */
  static key(pack: string, sessionId: string, messageKey: string): string {
    return `${pack}::${sessionId}::${messageKey}`
  }

  /**
   * 取未过期的缓存答案；过期或不存在返回 undefined。
   * ttlMs 传 0 表示不过期（日记这类跨天总结可以自己管有效期）。
   */
  get(pack: string, sessionId: string, messageKey: string, ttlMs: number = DecisionCacheStore.DEFAULT_TTL_MS): Record<string, any> | undefined {
    const hit = this.data.get(DecisionCacheStore.key(pack, sessionId, messageKey))
    if (!hit) return undefined
    if (ttlMs > 0 && Date.now() - hit.cachedAt > ttlMs) {
      this.data.delete(DecisionCacheStore.key(pack, sessionId, messageKey))
      return undefined
    }
    return hit.answers
  }

  set(pack: string, sessionId: string, messageKey: string, answers: Record<string, any>): void {
    this.data.set(DecisionCacheStore.key(pack, sessionId, messageKey), { pack, answers, cachedAt: Date.now() })
    this.persist()
  }

  /** 清掉某个会话的所有缓存（会话被删、或用户要求重算时）。 */
  clearSession(sessionId: string): void {
    const prefix = `::${sessionId}::`
    for (const k of this.data.keys()) {
      if (k.includes(prefix)) this.data.delete(k)
    }
    this.persist()
  }

  clear(): void {
    this.data.clear()
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    try {
      rmSync(this.filePath, { force: true })
    } catch (error) {
      console.error('DecisionCacheStore: 清理决策缓存失败', error)
    }
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as unknown
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (value && typeof value === 'object' && 'answers' in (value as Record<string, unknown>)) {
            this.data.set(key, value as CachedDecision)
          }
        }
      }
    } catch (error) {
      console.error('DecisionCacheStore: 载入决策缓存失败', error)
    }
  }

  private persist(): void {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      void this.persistNow()
    }, 500)
    this.persistTimer.unref?.()
  }

  private async persistNow(): Promise<void> {
    if (this.persistInFlight) {
      this.persistDirty = true
      return
    }
    this.persistInFlight = true
    try {
      await writeFile(this.filePath, JSON.stringify(Object.fromEntries(this.data)), 'utf8')
    } catch (error) {
      console.error('DecisionCacheStore: 保存决策缓存失败', error)
    } finally {
      this.persistInFlight = false
      if (this.persistDirty) {
        this.persistDirty = false
        void this.persistNow()
      }
    }
  }

  flushSync(): void {
    if (!this.persistTimer) return
    clearTimeout(this.persistTimer)
    this.persistTimer = null
    try {
      writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.data)), 'utf8')
    } catch (error) {
      console.error('DecisionCacheStore: 同步保存决策缓存失败', error)
    }
  }
}
