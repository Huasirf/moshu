import { useCallback, useEffect, useMemo, useState } from 'react'
import { Crosshair, RefreshCw, Check, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/Button'
import { useProjectStore } from '../../stores/project-store'
import { ipc } from '../../services/ipc-client'
import {
  computeRecallMetrics,
  loadRecallEval,
  mergeAnnotations,
  runRecallSampling,
  saveRecallEval,
  RECALL_EVAL_SAMPLE_SIZE,
  type RecallBlueprint,
  type RecallEvalCase,
  type RecallEvalStore,
} from '../../services/recall-eval'

/**
 * 召回评估面板（P2-4）
 *
 * 抽样 20 章 → 逐章用写稿同一检索链路取 top5 → 人工标注相关性 → 计算 precision@5 / recall@5。
 * 标注结果写入 `<项目>/.moshu/recall-eval.json`，重新抽样时按「章节 + 文档名」沿用旧标注。
 */
export default function RecallEvalPanel() {
  const { t } = useTranslation('pages', { keyPrefix: 'recallEval' })
  const currentProject = useProjectStore((s) => s.currentProject)

  const [cases, setCases] = useState<RecallEvalCase[]>([])
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null)
  const [error, setError] = useState('')

  // 切换项目时加载该项目的既有评估结果
  useEffect(() => {
    let mounted = true
    if (!currentProject) {
      setCases([])
      setUpdatedAt(null)
      return
    }
    setLoading(true)
    loadRecallEval(currentProject.path)
      .then((store) => {
        if (!mounted) return
        setCases(store?.cases ?? [])
        setUpdatedAt(store?.updatedAt ?? null)
      })
      .finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [currentProject?.path])

  const metrics = useMemo(() => computeRecallMetrics(cases), [cases])

  const persist = useCallback(async (nextCases: RecallEvalCase[]) => {
    if (!currentProject) return
    const store: RecallEvalStore = {
      version: 1,
      updatedAt: new Date().toISOString(),
      sampleSize: RECALL_EVAL_SAMPLE_SIZE,
      cases: nextCases,
    }
    try {
      await saveRecallEval(currentProject.path, store)
      setUpdatedAt(store.updatedAt)
    } catch (e) {
      setError(`${t('saveFailed')}: ${String(e)}`)
    }
  }, [currentProject?.path, t])

  const handleSample = async () => {
    if (!currentProject || running) return
    setRunning(true)
    setError('')
    setProgress(null)
    try {
      const blueprints = await ipc.invoke('db:blueprint-get-all') as RecallBlueprint[]
      const next = await runRecallSampling(blueprints, RECALL_EVAL_SAMPLE_SIZE, (current, total) => {
        setProgress({ current, total })
      })
      const merged = mergeAnnotations(next, cases)
      setCases(merged)
      await persist(merged)
    } catch (e) {
      setError(`${t('runFailed')}: ${String(e)}`)
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  const handleToggle = (caseIndex: number, hitIndex: number, value: boolean | null) => {
    const next = cases.map((item, ci) => {
      if (ci !== caseIndex) return item
      const relevant = item.relevant.map((old, hi) => (hi === hitIndex ? value : old))
      return { ...item, relevant }
    })
    setCases(next)
    void persist(next)
  }

  const formatTime = (iso: string | null) => iso
    ? new Date(iso).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <div
      className="rounded-xl border border-[var(--color-border)] mb-6 overflow-hidden"
      style={{ backgroundColor: 'var(--color-sidebar)' }}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--color-border)]">
        <Crosshair size={14} className="text-[var(--color-accent)] flex-shrink-0" />
        <span className="text-sm font-semibold text-[var(--color-text)]">{t('title')}</span>
        {updatedAt && (
          <span className="text-[0.7rem] text-[var(--color-text-muted)]">
            {t('lastUpdated', { time: formatTime(updatedAt) })}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {running && progress && (
            <span className="text-[0.7rem] text-[var(--color-text-muted)]">
              {t('sampling', { current: progress.current, total: progress.total })}
            </span>
          )}
          <Button variant="outline" onClick={handleSample} disabled={running || !currentProject}>
            {running ? <RefreshCw size={13} className="animate-spin" /> : <Crosshair size={13} />}
            {cases.length > 0 ? t('resample') : t('sample')}
          </Button>
        </div>
      </div>

      <div className="px-4 py-2.5 border-b border-[var(--color-border)]">
        <p className="text-[0.7rem] leading-relaxed text-[var(--color-text-muted)]">{t('description')}</p>
      </div>

      {/* 指标 */}
      <div className="grid grid-cols-3 gap-3 px-4 py-3 border-b border-[var(--color-border)]">
        <MetricBox
          label={t('precision')}
          value={`${(metrics.precisionAt5 * 100).toFixed(0)}%`}
          hint={t('relevantHits', { count: metrics.relevantHits })}
        />
        <MetricBox
          label={t('recall')}
          value={`${(metrics.recallAt5 * 100).toFixed(0)}%`}
          hint={t('annotated', { annotated: metrics.annotatedCases, total: metrics.totalCases })}
        />
        <MetricBox
          label={t('annotatedHits')}
          value={`${metrics.annotatedHits}`}
          hint={`/ ${metrics.totalCases * 5}`}
        />
      </div>

      {error && (
        <div className="px-4 py-2 text-[0.7rem]" style={{ color: 'var(--color-error)' }}>{error}</div>
      )}

      {loading ? null : cases.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-[var(--color-text-muted)]">{t('empty')}</div>
      ) : (
        <div className="max-h-[520px] overflow-y-auto">
          {cases.map((item, ci) => (
            <div key={item.chapterNumber} className="px-4 py-3 border-t border-[var(--color-border)] first:border-t-0">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-[var(--color-text)]">
                  {t('chapterLabel', { chapter: item.chapterNumber })} · {item.title}
                </span>
                <span
                  className="text-[0.68rem] text-[var(--color-text-muted)] truncate max-w-[45%]"
                  title={`${t('queryLabel')}: ${item.query}`}
                >
                  {item.query}
                </span>
              </div>

              {item.hits.length === 0 ? (
                <div className="text-[0.7rem] text-[var(--color-text-muted)]">{t('noHits')}</div>
              ) : (
                <div className="space-y-1.5">
                  {item.hits.map((hit, hi) => {
                    const marked = item.relevant[hi]
                    return (
                      <div
                        key={`${hit.fileName}-${hi}`}
                        className="rounded-lg border border-[var(--color-border)] px-2.5 py-2"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[0.7rem] text-[var(--color-text-secondary)]">{hit.fileName}</span>
                          <span className="text-[0.65rem] font-mono text-[var(--color-text-muted)]">
                            {(hit.score * 100).toFixed(1)}%
                          </span>
                          <div className="ml-auto flex items-center gap-1">
                            <button
                              onClick={() => handleToggle(ci, hi, marked === true ? null : true)}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.68rem] transition-colors"
                              style={{
                                backgroundColor: marked === true
                                  ? 'color-mix(in srgb, var(--color-success) 15%, transparent)'
                                  : 'var(--color-hover)',
                                color: marked === true ? 'var(--color-success)' : 'var(--color-text-muted)',
                              }}
                            >
                              <Check size={10} /> {t('relevant')}
                            </button>
                            <button
                              onClick={() => handleToggle(ci, hi, marked === false ? null : false)}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[0.68rem] transition-colors"
                              style={{
                                backgroundColor: marked === false
                                  ? 'color-mix(in srgb, var(--color-error) 15%, transparent)'
                                  : 'var(--color-hover)',
                                color: marked === false ? 'var(--color-error)' : 'var(--color-text-muted)',
                              }}
                            >
                              <X size={10} /> {t('irrelevant')}
                            </button>
                          </div>
                        </div>
                        <p className="text-[0.7rem] leading-relaxed text-[var(--color-text-secondary)] whitespace-pre-wrap line-clamp-2">
                          {hit.text}
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="px-4 py-2.5 border-t border-[var(--color-border)]">
        <p className="text-[0.65rem] leading-relaxed text-[var(--color-text-muted)]">{t('explain')}</p>
      </div>
    </div>
  )
}

function MetricBox({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-[var(--color-border)] px-3 py-2" style={{ backgroundColor: 'var(--color-editor-bg)' }}>
      <div className="text-[0.68rem] text-[var(--color-text-muted)] mb-1">{label}</div>
      <div className="text-lg font-bold text-[var(--color-text)] leading-tight">{value}</div>
      <div className="text-[0.65rem] text-[var(--color-text-muted)]">{hint}</div>
    </div>
  )
}
