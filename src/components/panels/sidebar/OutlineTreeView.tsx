/**
 * OutlineTreeView — 大纲树（P4-3 / P5-2）
 *
 * 三层结构：卷（每 ARC_SIZE 章）→ 章 → 节拍/场景。
 * 数据源：章节蓝图（db:blueprint-get-all） + 流水线阶段（db:pipeline-list）。
 * 蓝图更新 / 定稿 / 审稿事件都会触发重载，避免列表停留在旧状态。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, FileText, RefreshCw, TriangleAlert } from 'lucide-react'
import { useProjectStore } from '../../../stores/project-store'
import { ipc } from '../../../services/ipc-client'
import { ARC_SIZE, arcRangeOf } from '../../../services/narrative-consistency/arc-summary'
import { globalEventBus } from '../../../shared/event-bus'
import { CHAPTER_STAGES, type ChapterStage } from '../../../shared/chapter-stage'
import { ChapterStagePill } from '../../ui/ChapterStagePill'
import { useEditorStore } from '../../../stores/editor-store'
import { openBuiltinEditor } from './SidebarShared'

interface OutlineBlueprint {
  chapterNumber: number
  title?: string
  role?: string
  status?: string
  wordsTarget?: number
  beatTags?: string[]
  scenes?: Array<{ id?: string; title?: string; summary?: string; goal?: string; words?: number }>
}

interface PipelineEntry {
  chapterNumber: number
  stage: ChapterStage
}

interface ArcGroup {
  start: number
  end: number
  chapters: OutlineBlueprint[]
}

function asChapterStage(value: string | undefined): ChapterStage | undefined {
  return value && (CHAPTER_STAGES as readonly string[]).includes(value)
    ? (value as ChapterStage)
    : undefined
}

export default function OutlineTreeView() {
  const { t } = useTranslation('panels')
  const currentProject = useProjectStore((s) => s.currentProject)
  const projectPath = currentProject?.path

  const [blueprints, setBlueprints] = useState<OutlineBlueprint[]>([])
  const [stages, setStages] = useState<Map<number, ChapterStage>>(new Map())
  const [loading, setLoading] = useState(false)
  const [collapsedArcs, setCollapsedArcs] = useState<Set<number>>(new Set())
  const [collapsedChapters, setCollapsedChapters] = useState<Set<number>>(new Set())

  const load = useCallback(async () => {
    if (!projectPath) {
      setBlueprints([])
      setStages(new Map())
      return
    }
    setLoading(true)
    try {
      const [blueprintList, pipelineList] = await Promise.all([
        ipc.invoke('db:blueprint-get-all', projectPath).catch(() => []),
        ipc.invoke('db:pipeline-list').catch(() => []),
      ]) as [OutlineBlueprint[], PipelineEntry[]]

      setBlueprints(Array.isArray(blueprintList) ? blueprintList : [])
      const map = new Map<number, ChapterStage>()
      for (const entry of Array.isArray(pipelineList) ? pipelineList : []) {
        if (asChapterStage(entry.stage)) map.set(entry.chapterNumber, entry.stage)
      }
      setStages(map)
    } catch {
      setBlueprints([])
      setStages(new Map())
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  useEffect(() => { void load() }, [load])

  // 蓝图编辑、故事修订、定稿写回、审稿落库都会改变大纲/阶段展示
  useEffect(() => globalEventBus.on('BLUEPRINTS_UPDATED', (payload) => {
    if (payload.projectPath === projectPath) void load()
  }), [projectPath, load])
  useEffect(() => globalEventBus.on('STORY_REVISED', (payload) => {
    if (payload.projectPath === projectPath) void load()
  }), [projectPath, load])
  useEffect(() => globalEventBus.on('FINALIZE_COMPLETE', () => { void load() }), [load])
  useEffect(() => globalEventBus.on('REVIEW_FINDINGS_UPDATED', () => { void load() }), [load])

  const arcs = useMemo<ArcGroup[]>(() => {
    const byArc = new Map<number, OutlineBlueprint[]>()
    for (const bp of [...blueprints].sort((a, b) => a.chapterNumber - b.chapterNumber)) {
      const [start] = arcRangeOf(bp.chapterNumber)
      const bucket = byArc.get(start) ?? []
      bucket.push(bp)
      byArc.set(start, bucket)
    }
    return [...byArc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([start, chapters]) => ({ start, end: start + ARC_SIZE - 1, chapters }))
  }, [blueprints])

  const toggleArc = (start: number) => {
    setCollapsedArcs((prev) => {
      const next = new Set(prev)
      if (next.has(start)) next.delete(start)
      else next.add(start)
      return next
    })
  }

  const toggleChapter = (chapterNumber: number) => {
    setCollapsedChapters((prev) => {
      const next = new Set(prev)
      if (next.has(chapterNumber)) next.delete(chapterNumber)
      else next.add(chapterNumber)
      return next
    })
  }

  return (
    <div className="px-2 pb-3">
      <div className="flex items-center justify-between py-1">
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {loading ? t('outlineTree.loading') : `${blueprints.length} ${t('outlineTree.chapters')}`}
        </span>
        <button
          className="tool-btn"
          title={t('outlineTree.refresh')}
          onClick={() => { void load() }}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {!loading && blueprints.length === 0 && (
        <p className="text-xs px-1 py-2" style={{ color: 'var(--color-text-muted)' }}>
          {t('outlineTree.empty')}
        </p>
      )}

      {arcs.map((arc) => {
        const arcCollapsed = collapsedArcs.has(arc.start)
        const staleCount = arc.chapters.filter((c) => c.status === 'stale').length
        return (
          <div key={arc.start} className="mb-1">
            <button
              className="w-full flex items-center gap-1 px-1 py-1 rounded text-left"
              onClick={() => toggleArc(arc.start)}
              style={{ color: 'var(--color-text)' }}
            >
              {arcCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              <span className="text-xs font-medium">
                {t('outlineTree.arc', { start: arc.start, end: arc.end })}
              </span>
              <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                {arc.chapters.length}
              </span>
              {staleCount > 0 && (
                <span
                  className="ml-auto flex items-center gap-0.5 text-[10px]"
                  style={{ color: 'var(--color-warning)' }}
                >
                  <TriangleAlert size={10} /> {staleCount}
                </span>
              )}
            </button>

            {!arcCollapsed && arc.chapters.map((chapter) => {
              const chapterCollapsed = collapsedChapters.has(chapter.chapterNumber)
              const hasDetail = (chapter.beatTags?.length ?? 0) > 0 || (chapter.scenes?.length ?? 0) > 0
              const isStale = chapter.status === 'stale'
              const stage = stages.get(chapter.chapterNumber) ?? asChapterStage(chapter.status)
              return (
                <div key={chapter.chapterNumber} className="ml-3">
                  <div
                    className="flex items-center gap-1 px-1 py-0.5 rounded"
                    style={{
                      backgroundColor: isStale ? 'color-mix(in srgb, var(--color-warning) 12%, transparent)' : undefined,
                      borderLeft: isStale ? '2px solid var(--color-warning)' : '2px solid transparent',
                    }}
                  >
                    <button
                      className="shrink-0"
                      onClick={() => hasDetail && toggleChapter(chapter.chapterNumber)}
                      style={{ color: 'var(--color-text-muted)', visibility: hasDetail ? 'visible' : 'hidden' }}
                    >
                      {chapterCollapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
                    </button>
                    <button
                      className="flex-1 min-w-0 flex items-center gap-1 text-left"
                      onClick={() => {
                        useEditorStore.getState().focusChapter(chapter.chapterNumber)
                        openBuiltinEditor('chapter-card-editor', t('outlineTree.openBlueprint'), 'chapter-card')
                      }}
                      title={t('outlineTree.openBlueprint')}
                    >
                      <FileText size={11} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                      <span className="text-xs truncate" style={{ color: 'var(--color-text)' }}>
                        {chapter.chapterNumber}. {chapter.title || t('outlineTree.noTitle')}
                      </span>
                      {isStale && (
                        <span className="text-[10px] shrink-0" style={{ color: 'var(--color-warning)' }}>
                          {t('outlineTree.stale')}
                        </span>
                      )}
                    </button>
                    {stage && <ChapterStagePill stage={stage} compact />}
                  </div>

                  {!chapterCollapsed && hasDetail && (
                    <div className="ml-5 mb-1 space-y-1">
                      {(chapter.beatTags?.length ?? 0) > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {chapter.beatTags!.map((beat) => (
                            <span
                              key={beat}
                              className="text-[10px] px-1.5 py-0.5 rounded"
                              style={{ background: 'var(--color-hover)', color: 'var(--color-text-muted)' }}
                            >
                              {beat}
                            </span>
                          ))}
                        </div>
                      )}
                      {(chapter.scenes?.length ?? 0) > 0 && (
                        <div className="space-y-0.5">
                          {chapter.scenes!.map((scene, idx) => (
                            <div key={scene.id ?? idx} className="text-[11px] truncate" style={{ color: 'var(--color-text-muted)' }}>
                              · {scene.title || t('outlineTree.noTitle')}
                              {scene.goal ? ` — ${scene.goal}` : scene.summary ? ` — ${scene.summary}` : ''}
                              {scene.words ? `（${scene.words}字）` : ''}
                            </div>
                          ))}
                        </div>
                      )}
                      {chapter.wordsTarget ? (
                        <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                          {t('outlineTree.words', { count: chapter.wordsTarget })}
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
