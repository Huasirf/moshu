/**
 * ReviewFindingsPanel — 审稿台账抽屉（P5-1）
 *
 * 数据来自 review_findings（规则审稿 + LLM 审稿），只展示属于当前草稿的 open 条目。
 * 定稿闸门与这里共用 finding-scope 的过滤口径，避免旧版本结论拦住新稿。
 */
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, EyeOff, MapPin, X,
} from 'lucide-react'

import { useEditorStore } from '../../stores/editor-store'
import { ipc } from '../../services/ipc-client'
import { requestEditorReveal } from '../../services/editor-reveal'
import { globalEventBus } from '../../shared/event-bus'
import { isFindingForDraft, summarizeFindings, type FindingSummary } from '../../services/review/finding-scope'
import type { ReviewFinding, ReviewFindingStatus, ReviewSeverity } from '../../../electron/repositories/review-finding-repository'
import { Badge } from '../ui/Badge'
import { EmptyState } from '../ui/EmptyState'
import { Skeleton } from '../ui/Skeleton'
import { toast } from '../ui/Toast'

interface Props {
  chapterNumber: number
  draftId: string
  filePath: string
  open: boolean
  onClose: () => void
  onCountChange?: (count: FindingSummary) => void
}

const GROUPS: Array<{ severity: ReviewSeverity; labelKey: string; variant: 'error' | 'warning' | 'outline' }> = [
  { severity: 'error', labelKey: 'reviewPanel.errorGroup', variant: 'error' },
  { severity: 'warning', labelKey: 'reviewPanel.warningGroup', variant: 'warning' },
  { severity: 'info', labelKey: 'reviewPanel.infoGroup', variant: 'outline' },
]

export default function ReviewFindingsPanel({
  chapterNumber, draftId, filePath, open, onClose, onCountChange,
}: Props) {
  const { t } = useTranslation('editors')
  const [items, setItems] = useState<ReviewFinding[]>([])
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<ReviewSeverity>>(new Set())

  const applyItems = useCallback((list: ReviewFinding[]) => {
    setItems(list)
    onCountChange?.(summarizeFindings(list))
  }, [onCountChange])

  const reload = useCallback(async () => {
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) {
      applyItems([])
      return
    }
    setLoading(true)
    try {
      const list = await ipc.invoke('db:review-finding-list', chapterNumber, 'open') as ReviewFinding[]
      applyItems((Array.isArray(list) ? list : []).filter((f) => isFindingForDraft(f, draftId)))
    } catch {
      applyItems([])
    } finally {
      setLoading(false)
    }
  }, [chapterNumber, draftId, applyItems])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => globalEventBus.on('REVIEW_FINDINGS_UPDATED', (payload) => {
    if (payload.chapterNumber === chapterNumber) void reload()
  }), [chapterNumber, reload])

  useEffect(() => globalEventBus.on('FINALIZE_COMPLETE', (payload) => {
    if (payload.chapterNumber === chapterNumber) void reload()
  }), [chapterNumber, reload])

  const toggleGroup = (severity: ReviewSeverity) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(severity)) next.delete(severity)
      else next.add(severity)
      return next
    })
  }

  /** 在当前草稿正文中定位证据 */
  const locate = (evidence: string) => {
    const text = evidence.trim()
    if (!text) {
      toast.info(t('reviewPanel.noEvidence'))
      return
    }
    const tab = useEditorStore.getState().tabs.find((x) => x.filePath === filePath)
    const from = (tab?.content ?? '').indexOf(text)
    if (from < 0) {
      toast.warning(t('reviewPanel.evidenceMissing'))
      return
    }
    requestEditorReveal({ filePath, from, to: from + text.length, text })
  }

  const mark = async (id: number, status: ReviewFindingStatus) => {
    const res = await ipc.invoke('db:review-finding-update-status', id, status)
    if (!res.success) {
      toast.error(t('reviewPanel.updateFailed', { error: res.error ?? '' }))
      return
    }
    applyItems(items.filter((f) => f.id !== id))
  }

  if (!open) return null

  return (
    <aside
      className="flex flex-col shrink-0 h-full"
      role="complementary"
      aria-label={t('reviewPanel.title')}
      style={{
        width: 320,
        borderLeft: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-panel)',
      }}
    >
      <div
        className="flex items-center justify-between px-3 h-9 shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
            {t('reviewPanel.title')}
          </span>
          {items.length > 0 && (
            <Badge variant={items.some((f) => f.severity === 'error') ? 'error' : 'warning'}>
              {items.length}
            </Badge>
          )}
        </div>
        <button className="icon-btn" style={{ width: 22, height: 22 }} onClick={onClose} title={t('reviewPanel.close')}>
          <X size={13} strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {loading && items.length === 0 ? (
          <div className="space-y-1.5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<AlertTriangle size={26} />} message={t('reviewPanel.empty')} />
        ) : (
          GROUPS.map((group) => {
            const list = items
              .filter((f) => f.severity === group.severity)
              // 规则合规/数值闸问题优先展示，便于按规则编号逐条核对
              .sort((a, b) => {
                const rank = (f: ReviewFinding) => (f.stage === 'rule-compliance' ? 0 : 1)
                return rank(a) - rank(b) || b.id - a.id
              })
            if (list.length === 0) return null
            const isCollapsed = collapsed.has(group.severity)
            return (
              <div key={group.severity} className="mb-2">
                <button
                  className="w-full flex items-center gap-1 px-1 py-1 rounded text-left hover:bg-[var(--color-hover)]"
                  onClick={() => toggleGroup(group.severity)}
                >
                  {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                  <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                    {t(group.labelKey)}
                  </span>
                  <Badge variant={group.variant}>{list.length}</Badge>
                </button>

                {!isCollapsed && (
                  <div className="space-y-1 mt-0.5" role="list">
                    {list.map((finding) => (
                      <div
                        key={finding.id}
                        role="listitem"
                        className="rounded px-2 py-1.5"
                        style={{ border: '1px solid var(--color-border)' }}
                      >
                        <div className="text-xs leading-5" style={{ color: 'var(--color-text)' }}>
                          {finding.message}
                        </div>
                        {finding.evidence && (
                          <div
                            className="text-[11px] mt-0.5 line-clamp-2 cursor-pointer hover:underline"
                            style={{ color: 'var(--color-text-muted)' }}
                            onClick={() => locate(finding.evidence)}
                            title={t('reviewPanel.locate')}
                          >
                            “{finding.evidence}”
                          </div>
                        )}
                        <div className="flex items-center gap-1 mt-1">
                          <span className="text-[10px] mr-auto truncate" style={{ color: 'var(--color-text-muted)' }}>
                            {finding.stage} · {finding.category}
                          </span>
                          {finding.evidence && (
                            <button
                              className="icon-btn"
                              style={{ width: 20, height: 20 }}
                              onClick={() => locate(finding.evidence)}
                              title={t('reviewPanel.locate')}
                            >
                              <MapPin size={11} />
                            </button>
                          )}
                          <button
                            className="icon-btn"
                            style={{ width: 20, height: 20 }}
                            onClick={() => void mark(finding.id, 'fixed')}
                            title={t('reviewPanel.markFixed')}
                          >
                            <Check size={11} />
                          </button>
                          <button
                            className="icon-btn"
                            style={{ width: 20, height: 20 }}
                            onClick={() => void mark(finding.id, 'ignored')}
                            title={t('reviewPanel.ignore')}
                          >
                            <EyeOff size={11} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
