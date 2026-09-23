import { createPortal } from 'react-dom'
import {
  Loader2,
  Copy,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Settings
} from 'lucide-react'
import type { JevAnalysisResult } from '../types/electron'
import './JevResultModal.scss'

const JEV_AVATAR_URL = './assets/jev/jev-avatar.png'

interface JevAnswerDetail {
  noul?: number
  choice?: string
  score?: number
  legend?: string
  probabilities?: Record<string, number>
  confidence?: number
}

// 七道判断题的中文标签和短解释，key 对齐 questions.ts
const QUESTION_META: Record<string, { label: string; kind: 'noul' | 'choice' | 'score' }> = {
  literal_question: { label: '是否有潜台词', kind: 'noul' },
  true_intent: { label: '真实意图', kind: 'choice' },
  danger_level: { label: '危险等级', kind: 'score' },
  should_reply_now: { label: '是否该现在回', kind: 'noul' },
  best_action: { label: '建议做法', kind: 'choice' },
  she_needs: { label: '对方需要', kind: 'choice' },
  tension_resolved: { label: '紧张是否已化解', kind: 'noul' }
}

const TRUE_INTENT_LABELS: Record<string, string> = {
  confirm_you_care: '确认你还在乎',
  vent_anger: '发泄情绪',
  request_action: '要求行动',
  seek_explanation: '要个解释',
  casual_chat: '随口闲聊',
  close_topic: '了结话题'
}

const BEST_ACTION_LABELS: Record<string, string> = {
  check_history: '先翻记录',
  apologize: '道歉',
  give_commitment: '给承诺',
  explain: '解释',
  acknowledge: '认可对方',
  say_less: '少说为妙',
  make_plan: '定个计划'
}

const SHE_NEEDS_LABELS: Record<string, string> = {
  apology: '道歉',
  action: '行动',
  explanation: '解释',
  care: '关心',
  nothing: '什么都不用做'
}

/**
 * 把 noul 原始概率翻成「选中结论自己的把握」。
 * noul 是「命题为真」的概率：v<0.5 时选中否定态，否定态自己的把握是 1-v。
 * 直接显示 v 会让「否」看起来只有 v 成把握，和模型意图完全相反。
 */
function noulText(v: number | undefined, positive: string, negative: string): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '—'
  const pct = Math.round((v >= 0.5 ? v : 1 - v) * 100)
  return v >= 0.5 ? `${positive}（${pct}%）` : `${negative}（${pct}%）`
}

/** score 0~9 的中文档位名，给危险等级条做注解。API 返回的 legend 是 index→描述的对象，不能直接插值。 */
function dangerTierOf(score: number): string {
  if (!Number.isFinite(score)) return ''
  const i = Math.max(0, Math.min(9, Math.round(score)))
  return ['闲聊', '轻微打趣', '小埋怨', '明显不快', '阴阳/试探', '公开生气', '愤怒指责', '最后通牒', '已下通牒', '关系破裂'][i]
}

function choiceLabel(questionKey: string, raw: string | undefined): string {
  if (!raw) return '—'
  if (questionKey === 'true_intent') return TRUE_INTENT_LABELS[raw] || raw
  if (questionKey === 'best_action') return BEST_ACTION_LABELS[raw] || raw
  if (questionKey === 'she_needs') return SHE_NEEDS_LABELS[raw] || raw
  if (questionKey === 'best_reply') return raw
  return raw
}

interface JevResultModalProps {
  open: boolean
  analyzing: boolean
  result: JevAnalysisResult | null
  error: string | null
  onCopy: (text: string, key: string) => void
  onClose: () => void
  onOpenSettings: () => void
  copiedKey: string | null
}

export function JevResultModal({
  open,
  analyzing,
  result,
  error,
  onCopy,
  onClose,
  onOpenSettings,
  copiedKey
}: JevResultModalProps) {
  if (!open) return null

  const answers: Record<string, JevAnswerDetail> = (result?.answers || {}) as Record<string, JevAnswerDetail>
  const dangerRaw = typeof answers.danger_level?.score === 'number' ? answers.danger_level.score : null
  // score 是 0~9 的分箱索引（criteria 一共 10 档，最高「关系破裂」= 9），不是 0~10。
  const dangerPct = dangerRaw !== null ? Math.min(100, Math.max(0, (dangerRaw / 9) * 100)) : null
  const dangerTone = dangerPct === null ? 'unknown' : dangerPct >= 70 ? 'high' : dangerPct >= 40 ? 'mid' : 'low'
  const dangerText = dangerRaw !== null
    ? `${dangerRaw.toFixed(1)} / 9${dangerTierOf(dangerRaw) ? ` · ${dangerTierOf(dangerRaw)}` : ''}`
    : '—'

  const shouldReply = answers.should_reply_now?.noul
  const shouldReplyYes = typeof shouldReply === 'number' && shouldReply >= 0.5
  // 摘要条显示的是「选中结论」的把握，不是 shouldReply 原值：否的时候把握是 1-shouldReply。
  const shouldReplyPct = typeof shouldReply === 'number'
    ? Math.round((shouldReplyYes ? shouldReply : 1 - shouldReply) * 100)
    : null

  return createPortal(
    <div className="jev-modal-overlay" onClick={() => !analyzing && onClose()}>
      <div className="jev-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="jev-modal-header">
          <img
            src={JEV_AVATAR_URL}
            alt=""
            className="jev-avatar jev-modal-avatar"
            width={22}
            height={22}
          />
          <h3>Jev 回复候选</h3>
          {!analyzing && (
            <button className="jev-modal-close" onClick={onClose} aria-label="关闭">
              <XCircle size={16} />
            </button>
          )}
        </div>

        <div className="jev-modal-body">
          {analyzing && (
            <div className="jev-state jev-state-loading">
              <Loader2 size={18} className="spin" />
              <span>正在分析：起草候选 → 判断意图 → 排序…</span>
            </div>
          )}

          {!analyzing && error && (
            <div className="jev-state jev-state-error">
              <AlertTriangle size={16} />
              <span>{error}</span>
              <button className="btn btn-secondary jev-settings-btn" onClick={onOpenSettings}>
                <Settings size={13} /> 打开 Jev 设置
              </button>
            </div>
          )}

          {!analyzing && !error && result && (
            <>
              {/* 判断摘要条 */}
              <div className={`jev-verdict jev-verdict-${shouldReplyYes ? 'yes' : 'no'}`}>
                <span className="jev-verdict-icon">
                  {shouldReplyYes ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                </span>
                <span className="jev-verdict-text">
                  {typeof shouldReply === 'number'
                    ? shouldReplyYes
                      ? '建议现在就回'
                      : '先别急着回'
                    : '判断结果不完整'}
                </span>
                {shouldReplyPct !== null && (
                  <span className="jev-verdict-pct">{shouldReplyPct}%</span>
                )}
              </div>

              {/* 危险等级 */}
              <div className="jev-danger">
                <div className="jev-danger-row">
                  <span className="jev-danger-label">危险等级</span>
                  <span className={`jev-danger-value jev-danger-${dangerTone}`}>{dangerText}</span>
                </div>
                {dangerPct !== null && (
                  <div className="jev-danger-bar">
                    <div
                      className={`jev-danger-fill jev-danger-fill-${dangerTone}`}
                      style={{ width: `${dangerPct}%` }}
                    />
                  </div>
                )}
              </div>

              {/* 候选回复 */}
              {result.candidates.length > 0 ? (
                <div className="jev-candidates">
                  {result.candidates.map((cand, i) => {
                    const isBest = i === result.bestIndex
                    const score = result.scores[i]
                    const key = `jev-cand-${i}`
                    const copied = copiedKey === key
                    return (
                      <div key={key} className={`jev-cand${isBest ? ' jev-cand-best' : ''}`}>
                        <div className="jev-cand-head">
                          {isBest ? (
                            <span className="jev-cand-badge">推荐</span>
                          ) : (
                            <span className="jev-cand-idx">候选 {String.fromCharCode(65 + i)}</span>
                          )}
                          {typeof score === 'number' && score > 0 && (
                            <span className="jev-cand-score">排序分 {(score * 100).toFixed(0)}</span>
                          )}
                          <button
                            className="btn btn-secondary jev-cand-copy"
                            onClick={() => onCopy(cand, key)}
                          >
                            {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                            {copied ? '已复制' : '复制'}
                          </button>
                        </div>
                        <div className="jev-cand-text">{cand}</div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="jev-empty">没有拿到候选回复。</p>
              )}

              {/* 判断明细 */}
              <details className="jev-detail">
                <summary>判断明细</summary>
                <div className="jev-detail-list">
                  {Object.keys(QUESTION_META).map((qkey) => {
                    const meta = QUESTION_META[qkey]
                    const a = answers[qkey]
                    if (!a) return null
                    let value = '—'
                    if (meta.kind === 'noul') {
                      // literal_question 的命题是「纯字面、无潜台词」：noul>=0.5 是字面意思，<0.5 才是有潜台词。
                      // 其余 noul 题（该现在回 / 紧张已化解）命题本身就是问句，>=0.5 是「是」。
                      value = noulText(
                        a.noul,
                        qkey === 'literal_question' ? '字面意思' : '是',
                        qkey === 'literal_question' ? '有潜台词' : '否'
                      )
                    } else if (meta.kind === 'choice') {
                      value = choiceLabel(qkey, a.choice)
                    } else if (meta.kind === 'score') {
                      value = typeof a.score === 'number' ? `${a.score.toFixed(1)} / 9` : '—'
                    }
                    const conf = typeof a.confidence === 'number' ? a.confidence : null
                    return (
                      <div key={qkey} className="jev-detail-row">
                        <span className="jev-detail-key">{meta.label}</span>
                        <span className="jev-detail-value">{value}</span>
                        {conf !== null && (
                          <span className="jev-detail-conf" title="模型对这个判断的把握">
                            把握 {(conf * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </details>

              <p className="jev-footnote">
                候选仅供参考，需自行复制粘贴。本功能不会自动发送任何消息。
              </p>
            </>
          )}
        </div>

        <div className="jev-modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={analyzing}>
            关闭
          </button>
          {!analyzing && !error && result && result.bestReply && (
            <button
              className="btn-primary jev-copy-best"
              onClick={() => onCopy(result.bestReply, 'jev-best')}
            >
              {copiedKey === 'jev-best' ? <CheckCircle2 size={16} /> : <Copy size={16} />}
              {copiedKey === 'jev-best' ? '已复制推荐回复' : '复制推荐回复'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
