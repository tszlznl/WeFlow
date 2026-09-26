/**
 * Agent 题集 + 工具表。
 *
 * 口径说明（重要）：Jev 是**决策接口**，不是生成式 LLM——只有 Noul / Choice / Score，
 * 写不出「我先去查一下数据库然后帮你写封邮件」这种自由文本计划。所以这里的 Agent
 * 不是会自主规划的通用 agent，而是一个**有界的工具路由器**：
 *
 *   命令 → 决策接口选工具 →（副作用工具先问一句）→ 执行 → 把结果喂回决策接口选下一步
 *         → 决策接口说 none 就停，或者撞上 MAX_AGENT_STEPS 强制停
 *
 * 「先做命令式入口」：`/annotate` `/todo` 这类显式命令直接跳过决策调用，不花钱、
 * 不需要 key 也能预测行为；自然语言（「帮我把这个会话整理一下」）才走决策接口选工具。
 *
 * 确认门是**确定性**的，不是一道判断题：工具表里标了 hasSideEffects 的（写收件箱）
 * 必须先问用户，没必要花一次调用去问「该不该问」。
 */

/** 单个工具的规格：决策接口的 criteria、命令别名、要不要确认门。 */
export interface AgentToolSpec {
  id: string
  /** 命令式入口别名，小写。命中别名直接执行，跳过决策调用。 */
  aliases: string[]
  /** 给人看的名字，确认门的文案用它。 */
  label: string
  /** 决策接口选工具时读的描述（英文，和题集语言一致）。 */
  description: string
  /** 有副作用（写收件箱）→ 执行前必须先确认。 */
  hasSideEffects: boolean
}

/**
 * 工具表。决策接口的 criteria 就是这里的 description——工具能力变化时改这一处，
 * 题集和前端跟着走，不会出现「决策接口能选但后端没有」的幽灵工具。
 */
export const AGENT_TOOLS: AgentToolSpec[] = [
  {
    id: 'annotate',
    aliases: ['annotate', '标注', 'biaozhu'],
    label: '标注本页消息',
    description:
      'Annotate the visible messages in this chat for subtext, true intent, and what the other person needs. ' +
      'Read-only: results are shown as badges on bubbles and cached, nothing is saved to the inbox.',
    hasSideEffects: false
  },
  {
    id: 'todos',
    aliases: ['todo', 'todos', '待办', 'daiban'],
    label: '提取待办',
    description:
      'Scan this chat for things the user was asked or promised to do, and save them to the insight inbox ' +
      'with a link back to the source message. Writes records — needs confirmation first.',
    hasSideEffects: true
  },
  {
    id: 'diary',
    aliases: ['diary', '日记', '总结', 'rijǐ', 'zongjie'],
    label: '生成今日小结',
    description:
      'Write a read-only daily summary of this chat: overall mood, whether anything is worth remembering, ' +
      'and whether open loops remain. Writes one record to the inbox — needs confirmation first.',
    hasSideEffects: true
  },
  {
    id: 'verdict',
    aliases: ['verdict', '该回吗', 'gaihuima'],
    label: '该回吗',
    description:
      'Answer one question only: should the user reply now or wait, and what does the other person actually ' +
      'need right now. Read-only, cheapest tool, good default for an unread chat.',
    hasSideEffects: false
  },
  {
    id: 'draft',
    aliases: ['draft', '回复', '起草', 'huifu'],
    label: '起草回复建议',
    description:
      'Draft and rank candidate replies to the latest message. Costs the most because it drafts text, ' +
      'not just decisions. Read-only: candidates are shown, never sent.',
    hasSideEffects: false
  }
]

export const AGENT_TOOL_IDS = AGENT_TOOLS.map((t) => t.id)

/** 找工具：按 id 或命令别名。找不到给 null，调用方好报「不认识的命令」。 */
export function findAgentTool(input: string): AgentToolSpec | null {
  const norm = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/^[/！!]/, '')
    .replace(/[？?]/g, '')
    .trim()
  if (!norm) return null
  for (const tool of AGENT_TOOLS) {
    if (tool.id === norm || tool.aliases.includes(norm)) return tool
  }
  return null
}

export const AGENT_QUESTIONS = {
  /**
   * 唯一一道题：这条命令该跑哪个工具。命令是单数意图（「做一件事」），
   * 不让决策接口一次选多个——多步编排由有界循环的下一轮问出来，每轮只见一步，
   * 行为可预测、可中断、可计费。
   */
  agent_tool: {
    type: 'choice',
    instructions:
      'A command was given about this chat. Pick the ONE tool that matches what was asked for. ' +
      'Tools already run in this session are listed in agent.steps — do not pick one that already ran ' +
      'unless the command clearly asks to redo it; when the work is done, choose none.' +
      ' Facts given in background are provided context, not off-topic.',
    criteria: Object.fromEntries(
      AGENT_TOOLS.map((tool) => [tool.id, tool.description])
    ) as Record<string, string>
  }
} as const
