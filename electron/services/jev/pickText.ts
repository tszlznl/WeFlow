/**
 * 取一条消息的可读正文。零依赖纯函数，主进程和渲染进程共用，可单独测。
 *
 * parsedContent 是解析过的展示文本，优先取；空了退到 rawContent/content。
 * 原始 XML（<msg / <appmsg 开头的卡片/引用）抽不出干净正文，喂给模型只会加噪音，返回空。
 * 媒体占位（[图片]/[语音]）留着——它们也是对话节奏的一部分，内核需要知道「对方发了个表情」。
 */
export interface ReadableMessageLike {
  parsedContent?: string | null
  rawContent?: string | null
  content?: string | null
}

export function pickReadableText(m: ReadableMessageLike): string {
  const parsed = String(m.parsedContent || '').trim()
  if (parsed) return parsed
  const raw = String(m.rawContent || m.content || '').trim()
  if (!raw) return ''
  if (raw.startsWith('<msg') || raw.startsWith('<appmsg')) return ''
  return raw
}
