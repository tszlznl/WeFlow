/**
 * WeFlow Message → Jev 内核气泡的适配层。纯函数，不依赖任何运行时服务，可以单独测。
 *
 * 内核（questions/draft/engine）只认 {from: 'me'|'her', text, name?}，这一层负责把
 * WeFlow 的结构化消息翻译过去：
 * - 分边：isSend=1 是我说的，0 是对方
 * - 群聊（sessionId 以 @chatroom 结尾）且是对方说的话才带发言人名——内核靠「有没有 name」
 *   判断是不是群聊，单聊带上名字会把按一对一写的判断题口径带偏
 * - 只取文本正文：parsedContent 是解析过的展示文本；空了退到 rawContent，但原始 XML
 *   （卡片/引用）抽不出干净正文，喂了只会给模型加噪音
 */
import type { Message } from '../chatService'
import { pickReadableText } from './pickText'

export interface JevChatBubble {
  from: 'me' | 'her'
  text: string
  name?: string
}

export function messagesToBubbles(messages: Message[], sessionId: string): JevChatBubble[] {
  const isGroup = String(sessionId || '').trim().endsWith('@chatroom')
  const out: JevChatBubble[] = []
  for (const m of messages) {
    const text = pickReadableText(m)
    if (!text) continue
    const from: 'me' | 'her' = m.isSend === 1 ? 'me' : 'her'
    const bubble: JevChatBubble = { from, text }
    if (isGroup && from === 'her') {
      // 群昵称优先（聊天界面显示的就是它），其次备注/昵称；都没有就不带，总比喂 wxid 强
      const name = String(m.senderDisplayName || '').trim()
      if (name) bubble.name = name
    }
    out.push(bubble)
  }
  return out
}
