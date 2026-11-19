import { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, Search, BadgeCheck, Save, FileStack, FileText, Wrench, RefreshCw, Wand2, Image as ImageIcon, Pilcrow, ClipboardCheck, RotateCcw, History, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useProjectStore } from '../../stores/project-store'
import { useEditorStore } from '../../stores/editor-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import CodeMirrorEditor from './CodeMirrorEditor'
import ThreeWayMerge from './ThreeWayMerge'
import ChapterImagesPanel from './ChapterImagesPanel'
import { Button } from '../ui/Button'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import {
  parseDraftMeta,
  type DraftMeta,
  type DraftStatus,
} from '../../services/workflows/chapter-workflow'
import { getPendingRevisions, getReviewsForVersion, type RevisionEntry } from '../../services/draft-index'
import { readDraftBody } from '../../stores/draft-store'
import { globalEventBus } from '../../shared/event-bus'
import { persistEditorContent } from '../../services/editor-persistence'
import { registerEditorFlusher } from '../../services/editor-autosave'

import { DRAFT_STATUS_LABEL, DRAFT_STATUS_COLOR } from '../../shared/draft-status'
import { PostProcessStatusPanel } from '../ui/PostProcessStatusPanel'
import { getChapterFinalizeScope } from '../../services/workflows/workflow-utils'
import { guardRepairPostProcess } from '../../services/workflow-guards'
import { normalizeChinesePunctuation, describeNormalizeResult, type NormalizeResult } from '../../lib/punctuation'
import { isFindingForDraft, type FindingSummary } from '../../services/review/finding-scope'
import type { ReviewFinding } from '../../../electron/repositories/review-finding-repository'
import ReviewFindingsPanel from './ReviewFindingsPanel'
import { ChapterStagePill } from '../ui/ChapterStagePill'
import { CHAPTER_STAGES, type ChapterStage } from '../../shared/chapter-stage'
import { markDownstreamBlueprintsStale } from '../../services/workflows/blueprint-staleness'

interface Props {
  filePath: string
  content: string
}

/**
 * 草稿编辑器
 * — 顶部工具栏：草稿状态 + 待合并修稿 + AI 修稿(含自定义提示词) / AI 审稿 / 定稿
 * — 正文：CodeMirrorEditor（prose 模式）
 */
export default function DraftEditor({ filePath, content }: Props) {
  const { t } = useTranslation('editors')
  const { t: tPanels } = useTranslation('panels')
  // 从系统读取草稿元数据与章节标题
  const [meta, setMeta] = useState<(DraftMeta & { chapterTitle?: string; filePath?: string }) | null>(null)
  const [pendingRevisions, setPendingRevisions] = useState<RevisionEntry[]>([])
  const [reviewCount, setReviewCount] = useState(0)
  // 审稿台账抽屉：面板常驻挂载以维持计数，关闭时仅隐藏
  const [findingsOpen, setFindingsOpen] = useState(false)
  const [findingCounts, setFindingCounts] = useState<FindingSummary>({ total: 0, errors: 0, warnings: 0 })
  // 流水线阶段（只读展示，不在此处推进）
  const [stage, setStage] = useState<ChapterStage | null>(null)
  const [storyRefresh, setStoryRefresh] = useState(0)
  // 取消定稿：仅当前最新定稿章可操作，需要知道全书最大定稿章号
  const [maxFinalized, setMaxFinalized] = useState(0)
  const [unfinalizeOpen, setUnfinalizeOpen] = useState(false)
  const [unfinalizeAck, setUnfinalizeAck] = useState(false)
  const [unfinalizing, setUnfinalizing] = useState(false)
  useEffect(() => globalEventBus.on('STORY_REVISED', ({ projectPath, revision }) => {
    if (projectPath === useProjectStore.getState().currentProject?.path && revision.changes.some(c => c.kind === 'draft' && filePath === `moshu://draft/${c.id}`)) setStoryRefresh(n => n + 1)
  }), [filePath])

  // 【BUG1&2 修复】合并视图弹窗数据（不再占用 Tab）
  const [mergeData, setMergeData] = useState<{
    originalContent: string
    modifiedContent: string
    revisionPath: string
  } | null>(null)

  // 后处理失败状态（用于控制是否展示修复按钮）
  const [hasProcessFailure, setHasProcessFailure] = useState(false)

  // 标点规范化的待确认结果（弹出 diff 供逐处核对，确认后才写入正文）
  const [punctPreview, setPunctPreview] = useState<{ original: string; result: NormalizeResult } | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const m = await parseDraftMeta(filePath)
      if (cancelled || !m) return
      const { ipc } = await import('../../services/ipc-client')
      const bps = await ipc.invoke('db:blueprint-get-all')
      const bp = Array.isArray(bps) ? bps.find((b: unknown) => (b as { chapterNumber?: number }).chapterNumber === m.chapterNumber) : null
      setMeta({ ...m, chapterTitle: bp ? (bp as { title?: string }).title : t('chapterCard.unnamed'), filePath, fileName: `v${m.version}`, createdAt: m.updatedAt ?? m.createdAt })
      // 使用 DB 化的虚拟 chapterDir（用于 draft-index 兼容层解析章节号）
      const chapterDir = `moshu://draft/ch${m.chapterNumber}`
      // 检查待合并修稿
      const pending = await getPendingRevisions(chapterDir, m.version)
      if (!cancelled) setPendingRevisions(pending)
      // 检查审稿报告
      const reviews = await getReviewsForVersion(chapterDir, m.version)
      if (!cancelled) setReviewCount(reviews.length)
      // 流水线阶段（章节维度的唯一事实来源）
      const pipeline = await ipc.invoke('db:pipeline-get', m.chapterNumber).catch(() => null)
      if (!cancelled) setStage((pipeline as { stage?: ChapterStage } | null)?.stage ?? null)
    }
    load()

    // 数据刷新由 ProjectService 统一处理（FINALIZE_COMPLETE 事件驱动 Store 更新后组件自动重渲染）

    return () => {
      cancelled = true
    }
  }, [filePath, storyRefresh, t])

  // 审稿 / 定稿会推进流水线阶段，事件到达时只刷新阶段徽标
  useEffect(() => {
    const chapter = meta?.chapterNumber
    if (!chapter) return
    let cancelled = false
    const refreshStage = async () => {
      const { ipc } = await import('../../services/ipc-client')
      const state = await ipc.invoke('db:pipeline-get', chapter).catch(() => null)
      if (!cancelled) setStage((state as { stage?: ChapterStage } | null)?.stage ?? null)
    }
    const offs = [
      globalEventBus.on('REVIEW_FINDINGS_UPDATED', (p) => { if (p.chapterNumber === chapter) void refreshStage() }),
      globalEventBus.on('FINALIZE_COMPLETE', (p) => { if (p.chapterNumber === chapter) void refreshStage() }),
    ]
    return () => {
      cancelled = true
      offs.forEach((off) => off())
    }
  }, [meta?.chapterNumber])

  const status: DraftStatus = meta?.status ?? 'draft'
  const isReadonly = status === 'finalized' || status === 'archived'
  // 取消定稿需要知道全书最新定稿章号，用于禁用非最新章
  useEffect(() => {
    if (status !== 'finalized') return
    let cancelled = false
    const load = async () => {
      const { ipc } = await import('../../services/ipc-client')
      const max = await ipc.invoke('db:draft-get-max-finalized-chapter').catch(() => 0)
      if (!cancelled) setMaxFinalized(Number(max) || 0)
    }
    void load()
    const off = globalEventBus.on('FINALIZE_COMPLETE', () => { void load() })
    return () => {
      cancelled = true
      off()
    }
  }, [status])
  // 临时解锁：定稿章节默认只读，但允许作者临时解锁做少量文本修正（如角色名统一）。
  // 仅影响本组件的 UI 门控（可编辑性/保存按钮），不修改草稿的 status 字段，
  // 锁回去后行为与从未解锁完全一致。
  const [tempUnlocked, setTempUnlocked] = useState(false)
  const effectiveReadonly = isReadonly && !tempUnlocked

  // 检查是否有相关章节工作流正在运行。
  // ✅ 折叠为布尔 selector：流式期间 activeRuns 引用约每 120ms 换一次，
  //    订阅整表会让编辑器壳跟着每个流式批次空转重渲染
  const chapterNumber = meta?.chapterNumber
  //    按工作流定义携带的结构化章节号判断，不匹配标题文案（标题随界面语言变化，en/ru 下匹配不上）
  const isChapterBusy = useWorkflowStore(s =>
    chapterNumber != null && s.activeRuns.some(r =>
      r.type === 'chapter_creation' && r.chapterNumber === chapterNumber
    )
  )

  const [saving, setSaving] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'refine' | 'review' | 'deaify' | null>(null)
  const [userRefinePrompt, setUserRefinePrompt] = useState('')
  // 审稿维度多选
  const REVIEW_DIMS = [
    { key: 'continuity', label: t('draftEditor.reviewDims.continuity'), desc: t('draftEditor.reviewDims.continuityDesc') },
    { key: 'logic', label: t('draftEditor.reviewDims.logic'), desc: t('draftEditor.reviewDims.logicDesc') },
    { key: 'character', label: t('draftEditor.reviewDims.character'), desc: t('draftEditor.reviewDims.characterDesc') },
    { key: 'foreshadow', label: t('draftEditor.reviewDims.foreshadow'), desc: t('draftEditor.reviewDims.foreshadowDesc') },
  ]
  const [reviewDims, setReviewDims] = useState<Record<string, boolean>>(
    Object.fromEntries(REVIEW_DIMS.map(d => [d.key, true]))
  )
  // 去AI味强度（单选）
  const DEAIFY_LEVELS: Array<{ key: '轻' | '中' | '重'; desc: string }> = [
    { key: '轻', desc: '只清最明显的套路句，改动克制' },
    { key: '中', desc: '系统性清理所有 AI 腔（默认）' },
    { key: '重', desc: '更大胆地重组句式与节奏' },
  ]
  const [deaifyIntensity, setDeaifyIntensity] = useState<'轻' | '中' | '重'>('中')
  const [charCount, setCharCount] = useState(0)
  const [showImages, setShowImages] = useState(false)
  const isDirty = useEditorStore(s => s.tabs.find(t => t.filePath === filePath)?.dirty ?? false)
  const currentBodyRef = useRef(content)
  useEffect(() => { currentBodyRef.current = content }, [content])

  // 键入热路径不再逐键把全文写入 store（那会让 EditorArea 整树按键级重渲染），
  // 内容由 currentBodyRef 自持；卸载（如切换 Tab）时刷回 store，
  // 保证切走再切回来仍能看到未保存的编辑
  useEffect(() => {
    return () => {
      const tab = useEditorStore.getState().tabs.find(t => t.filePath === filePath)
      if (tab && tab.dirty && currentBodyRef.current !== tab.content) {
        useEditorStore.getState().syncTabContent(tab.id, currentBodyRef.current)
      }
    }
  }, [filePath])

  const currentProject = useProjectStore(s => s.currentProject)

  /**
   * 保存（moshu://draft/ 走 DB，其他走 FS，见 persistEditorContent）。
   * silent=true（自动保存 / 关窗刷盘）时不弹提示，失败直接抛出，由调用方统一处理。
   */
  const doSave = async (text: string, silent = false): Promise<void> => {
    setSaving(true)
    try {
      const res = await persistEditorContent(filePath, text)
      if (!res.success) {
        if (silent) throw new Error(res.error)
        toast.error(t('saveFailed', { ns: 'common', error: res.error ?? '' }))
        return
      }
      const targetTab = useEditorStore.getState().tabs.find(t => t.filePath === filePath)
      // 保存期间用户还在输入：只落盘，不清未保存标记、也不回写 store。
      // 回写的旧内容会经 content prop 把编辑器重置回保存时的版本，吞掉新输入
      if (targetTab && currentBodyRef.current === text) {
        useEditorStore.getState().markTabSaved(targetTab.id)
        useEditorStore.getState().syncTabContent(targetTab.id, text)
      }
    } finally {
      setSaving(false)
    }
  }

  // 自动保存 / 关窗刷盘入口：doSave 每次渲染都会重建，经 ref 取最新的
  const doSaveRef = useRef(doSave)
  useEffect(() => { doSaveRef.current = doSave })
  useEffect(() => registerEditorFlusher(filePath, async () => {
    const tab = useEditorStore.getState().tabs.find(t => t.filePath === filePath)
    if (!tab?.dirty) return
    await doSaveRef.current(currentBodyRef.current, true)
  }), [filePath])

  /** 执行 AI 修稿（含用户自定义提示词） */
  const doRefine = async () => {
    if (!currentProject || !meta) return
    try {
      const { useWorkflowStore } = await import('../../stores/workflow-store')
      const { createRefineOnlyWorkflow } = await import('../../services/workflows/chapter-workflow')

      const body = await readDraftBody(filePath)

      useWorkflowStore.getState().startWorkflow(createRefineOnlyWorkflow({
        chapterNumber: meta.chapterNumber,
        chapterTitle: meta.chapterTitle ?? t('draftEditor.unknownTitle'),
        draftPath: filePath,
        draftContent: body,
        userRefinePrompt: userRefinePrompt.trim() || undefined,
      }), false)
    } catch (e) {
      toast.error(t('draftEditor.refineStartFailed', { error: e }))
    }
  }

  /** 执行 AI 审稿 */
  const doReview = async () => {
    if (!currentProject || !meta) return
    try {
      const { useWorkflowStore } = await import('../../stores/workflow-store')
      const { createReviewOnlyWorkflow } = await import('../../services/workflows/chapter-workflow')

      const body = await readDraftBody(filePath)

      useWorkflowStore.getState().startWorkflow(createReviewOnlyWorkflow({
        chapterNumber: meta.chapterNumber,
        chapterTitle: meta.chapterTitle ?? t('draftEditor.unknownTitle'),
        draftPath: filePath,
        draftContent: body,
        reviewFocus: REVIEW_DIMS.filter(d => reviewDims[d.key]).map(d => d.label).join('、') || undefined,
      }), false)
    } catch (e) {
      toast.error(t('draftEditor.reviewStartFailed', { error: e }))
    }
  }

  /** 自动审校闭环（审稿→修复→复审，最多 N 轮） */
  const doAutoReview = async () => {
    if (!currentProject || !meta || isChapterBusy) return
    const ok = await confirm(
      `将对第 ${meta.chapterNumber} 章自动执行「审稿 → 修复 → 复审」闭环：\n\n· 最多 3 轮，仅在存在严重矛盾（error）时触发重写\n· 每轮修复会生成新的草稿版本（历史保留，可回溯）\n· 不会自动定稿，跑完后请在草稿列表查看最新版本`,
      { title: '自动审校闭环', confirmText: '开始' }
    )
    if (!ok) return
    try {
      const { useWorkflowStore } = await import('../../stores/workflow-store')
      const { createAutoReviewLoopWorkflow } = await import('../../services/workflows/chapter-workflow')

      const body = await readDraftBody(filePath)

      useWorkflowStore.getState().startWorkflow(createAutoReviewLoopWorkflow({
        chapterNumber: meta.chapterNumber,
        chapterTitle: meta.chapterTitle ?? '未知标题',
        draftPath: filePath,
        draftContent: body,
        maxRounds: 3,
        gate: 'error',
        reviewFocus: REVIEW_DIMS.filter(d => reviewDims[d.key]).map(d => d.label).join('、') || undefined,
      }), false)
    } catch (e) {
      toast.error(`自动审校启动失败：${e}`)
    }
  }

  /** 去 AI 味润色（强度由确认弹窗中的 deaifyIntensity 决定） */
  const doDeaify = async () => {
    if (!currentProject || !meta || isChapterBusy) return
    try {
      const { useWorkflowStore } = await import('../../stores/workflow-store')
      const { createDeaifyWorkflow } = await import('../../services/workflows/chapter-workflow')

      const body = await readDraftBody(filePath)

      useWorkflowStore.getState().startWorkflow(createDeaifyWorkflow({
        chapterNumber: meta.chapterNumber,
        chapterTitle: meta.chapterTitle ?? '未知标题',
        draftPath: filePath,
        draftContent: body,
        intensity: deaifyIntensity,
      }), false)
    } catch (e) {
      toast.error(`去AI味启动失败：${e}`)
    }
  }

  /**
   * 标点规范化 — 纯本地文本处理，不调用模型
   *
   * 把中文语境下混入的半角标点（, ; : ! ? 、成对小括号与成对双引号）转成全角，
   * 并清理全角标点后多余的空格。西文/数字用法、代码块与 URL 一律跳过。
   * 编辑器查找会做 NFKD 归一化（半角与全角逗号等价）导致无法手工替换，
   * 半角双引号更是无法用替换处理（中文引号需交替产出左右形态），故提供一键处理。
   *
   * 全文机械替换不适合直接落盘，这里先算出结果并弹出 diff 供作者逐处核对，
   * 确认后才写入编辑器。检测到但刻意未处理的项（半角句点、无法配对的引号）一并告知，
   * 避免出现"报告无事发生、正文里却仍有半角标点"的误导。
   */
  const doNormalizePunctuation = () => {
    if (effectiveReadonly || isChapterBusy) return
    const source = currentBodyRef.current
    const result = normalizeChinesePunctuation(source)

    if (result.count === 0) {
      const notes: string[] = []
      if (result.skipped.unpairedQuotes > 0) {
        notes.push(`${result.skipped.unpairedQuotes} 处半角引号因所在行引号数为奇数无法配对`)
      }
      if (result.skipped.periods > 0) {
        notes.push(`${result.skipped.periods} 处中文语境下的半角句点未处理（避免误伤小数点与省略号）`)
      }
      if (notes.length > 0) {
        toast.warning(`没有可自动规范化的标点，但检测到：${notes.join('；')}。需要手工处理`)
      } else {
        toast.info('未发现需要规范化的半角标点')
      }
      return
    }

    setPunctPreview({ original: source, result })
  }

  /** 采纳标点规范化结果（在 diff 弹窗中确认后） */
  const applyPunctuation = (text: string) => {
    currentBodyRef.current = text
    const tab = useEditorStore.getState().tabs.find(t => t.filePath === filePath)
    // 外部推送必须写入 content：编辑器靠 content prop 变化感知并刷新正文
    if (tab) useEditorStore.getState().updateTabContent(tab.id, text)
    setPunctPreview(null)
    toast.success('标点已规范化，确认后请保存')
  }

  /** 定稿 */
  const doFinalize = async () => {
    if (!meta || isChapterBusy) return

    // [P3-5] 定稿前先看审稿台账：error 直接拦截，warning 需在确认弹窗中显式豁免
    const { ipc } = await import('../../services/ipc-client')
    const findings = await ipc.invoke('db:review-finding-list', meta.chapterNumber, 'open').catch(() => []) as ReviewFinding[]
    const mine = findings.filter(f => isFindingForDraft(f, meta.id))
    const errors = mine.filter(f => f.severity === 'error')
    if (errors.length > 0) {
      toast.error(t('draftEditor.finalizeBlockedByFindings', {
        count: errors.length,
        first: errors[0].message,
      }))
      return
    }
    const warnings = mine.filter(f => f.severity === 'warning')

    const ok = await confirm(
      warnings.length > 0
        ? t('draftEditor.finalizeConfirmWithWarnings', { chapter: meta.chapterNumber, count: warnings.length })
        : t('draftEditor.finalizeConfirmText', { chapter: meta.chapterNumber }),
      {
        title: t('draftEditor.finalizeConfirmTitle'),
        confirmText: t('draftEditor.finalizeConfirm'),
      }
    )
    if (!ok) return
    try {
      const { useWorkflowStore } = await import('../../stores/workflow-store')
      const { createFinalizeWorkflow } = await import('../../services/workflows/chapter-workflow')

      const body = await readDraftBody(filePath)

      useWorkflowStore.getState().startWorkflow(createFinalizeWorkflow({
        chapterNumber: meta.chapterNumber,
        chapterTitle: meta.chapterTitle ?? t('draftEditor.unknownTitle'),
        draftPath: filePath,
        draftContent: body,
        acceptWarnings: warnings.length > 0,
      }), false)
    } catch (e) {
      toast.error(t('draftEditor.finalizeStartFailed', { error: e }))
    }
  }

  /**
   * 取消定稿：把本章完整回滚到 deaiified 并清理定稿派生数据。
   *
   * 只允许操作当前最新定稿章；服务端会再次校验，避免多窗口/刷新期间越界。
   * 成功后保留草稿正文与版本历史，作者可重新生成、审校、定稿。
   */
  const doUnfinalize = async () => {
    if (!meta || isChapterBusy || unfinalizing) return
    if (maxFinalized > 0 && meta.chapterNumber !== maxFinalized) {
      toast.error(t('draftEditor.unfinalizeNotLatest', { chapter: maxFinalized }))
      return
    }
    setUnfinalizeOpen(false)
    setUnfinalizing(true)
    try {
      const { ipc } = await import('../../services/ipc-client')
      const res = await ipc.invoke('db:chapter-unfinalize', meta.chapterNumber)
        .catch((e) => ({ success: false as const, error: String(e) }))
      if (!res.success) {
        const latest = res.error?.match(/latest=(\d+)/)?.[1]
        toast.error(latest
          ? t('draftEditor.unfinalizeNotLatest', { chapter: latest })
          : res.error?.includes('CHAPTER_NOT_FINALIZED')
            ? t('draftEditor.unfinalizeNotFinalized')
            : t('draftEditor.unfinalizeFailed', { error: res.error ?? '' }))
        return
      }
      const warnings = res.result?.warnings ?? []
      toast.success(t('draftEditor.unfinalizeDone', { chapter: meta.chapterNumber }))
      if (warnings.length > 0) toast.warning(warnings.join('；'))
      setStage('deaiified')
      setTempUnlocked(false)
      setMaxFinalized(Math.max(0, meta.chapterNumber - 1))
      globalEventBus.emit('FINALIZE_COMPLETE', { chapterNumber: meta.chapterNumber })
    } catch (e) {
      toast.error(t('draftEditor.unfinalizeFailed', { error: String(e) }))
    } finally {
      setUnfinalizing(false)
    }
  }

  /**
   * 回退一个流水线阶段（DR-03）
   *
   * 二次确认后只退一步：正文、审稿台账都保留，不删除任何历史。
   * 下游 N+1..N+5 的蓝图会被标记 stale，提醒作者重新核对大纲。
   */
  const doRewindStage = async () => {
    if (!meta || !stage || isChapterBusy) return
    const index = CHAPTER_STAGES.indexOf(stage)
    if (index <= 0) return
    const prev = CHAPTER_STAGES[index - 1]
    const stageLabel = (s: ChapterStage) => tPanels(`outlineTree.stage.${s}`)
    const ok = await confirm(
      t('draftEditor.rewindConfirmText', {
        chapter: meta.chapterNumber,
        from: stageLabel(stage),
        to: stageLabel(prev),
        start: meta.chapterNumber + 1,
        end: meta.chapterNumber + 5,
      }),
      {
        title: t('draftEditor.rewindConfirmTitle'),
        confirmText: t('draftEditor.rewindStage'),
        danger: true,
      }
    )
    if (!ok) return

    const { ipc } = await import('../../services/ipc-client')
    const res = await ipc.invoke('db:pipeline-rewind', meta.chapterNumber, stage)
      .catch((e) => ({ success: false as const, error: String(e) }))
    if (!res.success) {
      toast.error(t('draftEditor.rewindFailed', { error: res.error ?? '' }))
      // 阶段已被别处推进：刷新徽标，避免界面停留在旧值
      const latest = await ipc.invoke('db:pipeline-get', meta.chapterNumber).catch(() => null)
      setStage((latest as { stage?: ChapterStage } | null)?.stage ?? null)
      return
    }
    setStage(res.state?.stage ?? prev)
    const marked = await markDownstreamBlueprintsStale(meta.chapterNumber).catch(() => [] as number[])
    toast.success(
      marked.length > 0
        ? t('draftEditor.rewindDoneWithStale', { stage: stageLabel(prev), chapters: marked.join(', ') })
        : t('draftEditor.rewindDone', { stage: stageLabel(prev) })
    )
  }

  /** 修复定稿后处理 — 只重跑失败的步骤 */
  const doRepairFinalize = useCallback(async () => {
    if (!meta || isChapterBusy) return
    try {
      const guard = await guardRepairPostProcess(meta.chapterNumber)
      if (!guard.ok) {
        toast.error(guard.message || t('draftEditor.cannotRepair'))
        return
      }
      const { useWorkflowStore } = await import('../../stores/workflow-store')
      const { createRepairFinalizeWorkflow } = await import('../../services/workflows/chapter-workflow')
      useWorkflowStore.getState().startWorkflow(createRepairFinalizeWorkflow(meta.chapterNumber), false)
    } catch (e) {
      toast.error(t('draftEditor.repairStartFailed', { error: e }))
    }
  }, [meta, isChapterBusy, t])

  /** 打开待合并修稿 —— 弹出式合并视图，不占用原草稿 Tab */
  const openPendingRevision = async (rev: RevisionEntry) => {
    if (!meta) return
    // 使用 moshu://revision/{id} 协议路径读取修稿内容
    const revPath = `moshu://revision/${rev.id}`

    // 读取原稿和修稿
    const [origContent, revContent] = await Promise.all([
      readDraftBody(filePath),
      readDraftBody(revPath),
    ])
    if (!origContent && !revContent) return

    // 设置弹窗数据，不再打开新 Tab
    setMergeData({
      originalContent: origContent,
      modifiedContent: revContent,
      revisionPath: revPath,
    })
  }

  /** 合并完成回调 —— 就地覆写原草稿（不新建版本，仅蓝图写稿时才产生新版本） */
  const handleMergeComplete = async (mergedText: string) => {
    if (!meta || !mergeData) return
    const chapterDir = `moshu://draft/ch${meta.chapterNumber}`

    try {
      const { useDraftStore } = await import('../../stores/draft-store')
      const result = await useDraftStore.getState().applyMergedRevision(
        chapterDir,
        meta.chapterNumber,
        filePath,
        mergeData.revisionPath,
        mergedText
      )

      if (result.success) {
        // 关闭弹窗 + 刷新待合并列表 + 更新本地元数据
        setMergeData(null)
        setMeta(prev => prev ? { ...prev, status: 'revised' } : prev)
        toast.success(t('draftEditor.mergeComplete'))
        const { getPendingRevisions } = await import('../../services/draft-index')
        const pending = await getPendingRevisions(chapterDir, meta.version)
        setPendingRevisions(pending)
      } else {
        toast.error(t('draftEditor.mergeFailed', { error: result.error }))
      }
    } catch (e) {
      toast.error(t('draftEditor.mergeError', { error: e }))
    }
  }

  /** 打开本章版本历史（P2-1：可选任意版本与当前稿左右对比） */
  const openVersionHistory = () => {
    if (!meta) return
    useEditorStore.getState().openFile({
      id: `version-history-ch${meta.chapterNumber}`,
      name: t('draftEditor.versionHistoryName', { chapter: meta.chapterNumber }),
      type: 'version-history',
      filePath: `moshu://version-history/${meta.chapterNumber}`,
      chapterNumber: meta.chapterNumber,
    })
  }

  /** 打开最新的审稿报告 */
  const openLatestReview = async () => {
    if (!meta) return
    const chapterDir = `moshu://draft/ch${meta.chapterNumber}`
    const { getLatestReview } = await import('../../services/draft-index')
    const latest = await getLatestReview(chapterDir, meta.version)
    if (!latest) return

    // 使用 review 的数据库 ID 读取审稿报告内容
    const reportContent = await readDraftBody(`moshu://review/${latest.id}`)
    if (!reportContent) return

    useEditorStore.getState().openFile({
      id: `review-report-${meta.chapterNumber}-${latest.id}`,
      name: t('draftEditor.reviewReportName', { version: meta.version }),
      type: 'review-report',
      content: reportContent,
      filePath,
      reviewReport: reportContent,
      chapterNumber: meta.chapterNumber,
      chapterDir,
    })
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* 顶部工具栏 */}
      <div
        className="flex items-center justify-between gap-2 px-3 h-9 flex-shrink-0"
        style={{
          borderBottom: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-editor-bg)',
        }}
      >
        {/* 左侧：章节标题 + 版本 */}
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-medium truncate" style={{ color: 'var(--color-text-secondary)' }}>
            {meta ? t('draftEditor.chapterLabel', { chapter: meta.chapterNumber, title: meta.chapterTitle }) : t('draftEditor.draft')}
          </span>
          {meta && (
            <span className="text-[0.7rem] flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>
              v{meta.version}
            </span>
          )}
          {meta && stage && <ChapterStagePill stage={stage} className="flex-shrink-0" />}
          {meta && stage && CHAPTER_STAGES.indexOf(stage) > 0 && (
            <button
              type="button"
              className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 transition-colors hover:bg-[var(--color-hover)]"
              style={{ color: 'var(--color-text-muted)' }}
              onClick={() => void doRewindStage()}
              disabled={isChapterBusy}
              title={t('draftEditor.rewindCurrent', {
                stage: tPanels(`outlineTree.stage.${stage}`),
                prev: tPanels(`outlineTree.stage.${CHAPTER_STAGES[CHAPTER_STAGES.indexOf(stage) - 1]}`),
              })}
              aria-label={t('draftEditor.rewindStage')}
            >
              <RotateCcw size={10} />
              {t('draftEditor.rewindStage')}
            </button>
          )}
          {/* 🕘 版本历史（P2-1）：只读稿也必须能看历史与对比 */}
          {meta && (
            <button
              type="button"
              className="flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 transition-colors hover:bg-[var(--color-hover)]"
              style={{ color: 'var(--color-text-muted)' }}
              onClick={openVersionHistory}
              title={t('draftEditor.versionHistoryTooltip')}
              aria-label={t('draftEditor.versionHistory')}
            >
              <History size={10} />
              {t('draftEditor.versionHistory')}
            </button>
          )}
        </div>

        {/* 右侧：临时解锁态（已定稿但作者要做少量文本修正）——只给编辑/保存/重新锁定，不出现 AI 操作与再定稿 */}
        {isReadonly && tempUnlocked && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {charCount > 0 && (
              <span className="text-xs tabular-nums mr-1" style={{ color: 'var(--color-text-muted)' }}>
                {charCount.toLocaleString()} {t('draftEditor.chars')}
              </span>
            )}
            {isDirty && (
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0 mr-0.5"
                style={{ backgroundColor: 'var(--color-warning)' }}
                title={t('draftEditor.unsavedTooltip')}
              />
            )}
            {isDirty && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => doSave(currentBodyRef.current)}
                disabled={saving}
                title={t('draftEditor.saveTooltip')}
              >
                <Save size={12} />
                {saving ? t('draftEditor.saving') : t('draftEditor.save')}
              </Button>
            )}
            <span
              className="text-[0.7rem] px-1.5 py-0.5 rounded flex-shrink-0"
              style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-warning)' }}
              title="定稿状态未变，仅临时允许在编辑器内直接修改文本（如统一人名等小改）"
            >
              临时解锁编辑中
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTempUnlocked(false)}
              title="改完后点这里恢复只读，不影响定稿状态"
            >
              重新锁定
            </Button>
          </div>
        )}

        {/* 右侧：字数 + 状态 + 待合并 + AI操作 + 定稿 */}
        {!isReadonly && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* 字数 */}
            {charCount > 0 && (
              <span className="text-xs tabular-nums mr-1" style={{ color: 'var(--color-text-muted)' }}>
                {charCount.toLocaleString()} {t('draftEditor.chars')}
              </span>
            )}

            {/* 未保存指示灯 */}
            {isDirty && (
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0 mr-0.5"
                style={{ backgroundColor: 'var(--color-warning)' }}
                title={t('draftEditor.unsavedTooltip')}
              />
            )}

            {/* 保存按钮 */}
            {isDirty && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => doSave(currentBodyRef.current)}
                disabled={saving}
                title={t('draftEditor.saveTooltip')}
              >
                <Save size={12} />
                {saving ? t('draftEditor.saving') : t('draftEditor.save')}
              </Button>
            )}

            {/* 状态标签 */}
            <span
              className="text-[0.7rem] px-1.5 py-0.5 rounded flex-shrink-0"
              style={{
                backgroundColor: 'var(--color-hover)',
                color: DRAFT_STATUS_COLOR[status] ?? 'var(--color-text-muted)',
              }}
            >
              {DRAFT_STATUS_LABEL[status] ?? status}
            </span>

            {/* 📋 待合并修稿 */}
            {pendingRevisions.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => openPendingRevision(pendingRevisions[0])}
                title={t('draftEditor.pendingMergeTooltip')}
              >
                <FileStack size={12} />
                {t('draftEditor.pendingMerge', { count: pendingRevisions.length })}
              </Button>
            )}

            {/* 📝 审稿报告 */}
            {reviewCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={openLatestReview}
                title={t('draftEditor.reviewReportTooltip')}
              >
                <FileText size={12} />
                {t('draftEditor.reviewReport', { count: reviewCount })}
              </Button>
            )}

            {/* 🧾 审稿台账 */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFindingsOpen(v => !v)}
              title={t('reviewPanel.tooltip')}
            >
              <ClipboardCheck size={12} />
              {t('draftEditor.reviewFindings')}
              {findingCounts.total > 0 && (
                <span
                  className="ml-0.5 px-1 rounded-full text-[10px] leading-4"
                  style={{
                    backgroundColor: findingCounts.errors > 0 ? 'var(--color-error)' : 'var(--color-warning)',
                    color: '#fff',
                  }}
                >
                  {findingCounts.total}
                </span>
              )}
            </Button>

            {/* AI 修稿 */}
            <Button
              variant="ai"
              size="sm"
              onClick={() => { setUserRefinePrompt(''); setConfirmAction('refine') }}
              disabled={isChapterBusy}
              title={t('draftEditor.aiRefineTooltip')}
            >
              <Sparkles size={12} />
              {t('draftEditor.aiRefine')}
            </Button>

            {/* AI 审稿 */}
            <Button
              variant="ai"
              size="sm"
              onClick={() => setConfirmAction('review')}
              disabled={isChapterBusy}
              title={t('draftEditor.aiReviewTooltip')}
            >
              <Search size={12} />
              {t('draftEditor.aiReview')}
            </Button>

            {/* 自动审校闭环 */}
            <Button
              variant="ai"
              size="sm"
              onClick={doAutoReview}
              disabled={isChapterBusy}
              title="自动审校 — 审稿→修复→复审自动闭环（最多3轮），仅严重矛盾触发重写，生成新草稿版本"
            >
              <RefreshCw size={12} />
              自动审校
            </Button>

            {/* 标点规范化（本地处理，不调模型） */}
            <Button
              variant="outline"
              size="sm"
              onClick={doNormalizePunctuation}
              disabled={isChapterBusy}
              title="标点规范化 — 把中文语境下的半角标点（, ; : ! ?、成对小括号与成对双引号）转为全角，并清理全角标点后多余空格；数字、西文、代码与链接不受影响。弹出 diff 供核对，确认后才写入。不调用模型"
            >
              <Pilcrow size={12} />
              标点
            </Button>

            {/* 去 AI 味 */}
            <Button
              variant="ai"
              size="sm"
              onClick={() => setConfirmAction('deaify')}
              disabled={isChapterBusy}
              title="去AI味 — 清除段尾升华/比喻滥用/万能过渡/播音腔对话等 AI 腔，保持情节与篇幅，生成修订稿供合并"
            >
              <Wand2 size={12} />
              去AI味
            </Button>

            {/* 配图（题图 / 场景插图） */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowImages(v => !v)}
              title="本章配图 — 生成章节题图 / 场景插图（文生图）"
            >
              <ImageIcon size={12} />
              配图
            </Button>

            {/* 定稿 */}
            <Button
              variant="success"
              size="sm"
              onClick={doFinalize}
              disabled={isChapterBusy}
              title={t('draftEditor.finalizeTooltip')}
            >
              <BadgeCheck size={12} />
              {t('draftEditor.finalize')}
            </Button>
          </div>
        )}

        {/* 已定稿/归档显示只读提示 */}
        {isReadonly && !tempUnlocked && (
          <div className="flex items-center gap-2 flex-shrink-0">
            {charCount > 0 && (
              <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
                {charCount.toLocaleString()} {t('draftEditor.chars')}
              </span>
            )}
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {status === 'finalized' ? t('draftEditor.finalizedReadonly') : t('draftEditor.archivedReadonly')}
            </span>
            {/* 临时解锁编辑（仅定稿态提供；不改变 status，只放开本组件内的编辑/保存门控） */}
            {status === 'finalized' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setTempUnlocked(true)}
                title="临时解锁做少量文本修正（如统一人名）。不会改变本章的定稿状态，也不会重新触发后处理"
              >
                临时解锁编辑
              </Button>
            )}
            {/* 审稿台账（只读态仍可查看历史结论） */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFindingsOpen(v => !v)}
              title={t('reviewPanel.tooltip')}
            >
              <ClipboardCheck size={11} />
              {t('draftEditor.reviewFindings')}
              {findingCounts.total > 0 && (
                <span
                  className="ml-0.5 px-1 rounded-full text-[10px] leading-4"
                  style={{
                    backgroundColor: findingCounts.errors > 0 ? 'var(--color-error)' : 'var(--color-warning)',
                    color: '#fff',
                  }}
                >
                  {findingCounts.total}
                </span>
              )}
            </Button>
            {/* 配图（只读态仍可为章节配图） */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowImages(v => !v)}
              title="本章配图 — 生成章节题图 / 场景插图（文生图）"
            >
              <ImageIcon size={11} />
              配图
            </Button>
            {/* 已定稿 → 有失败项时显示修复定稿按钮 */}
            {status === 'finalized' && meta && hasProcessFailure && (
              <Button
                variant="outline"
                size="sm"
                onClick={doRepairFinalize}
                disabled={isChapterBusy}
                title={t('draftEditor.repairFinalizeTooltip')}
              >
                <Wrench size={11} />
                {t('draftEditor.repairFinalize')}
              </Button>
            )}
            {/* 取消定稿：仅当前最新定稿章可用；更早章节需先倒序取消尾部章节 */}
            {status === 'finalized' && meta && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setUnfinalizeAck(false); setUnfinalizeOpen(true) }}
                disabled={isChapterBusy || unfinalizing || (maxFinalized > 0 && meta.chapterNumber !== maxFinalized)}
                title={maxFinalized > 0 && meta.chapterNumber !== maxFinalized
                  ? t('draftEditor.unfinalizeNotLatest', { chapter: maxFinalized })
                  : t('draftEditor.unfinalizeTooltip')}
              >
                <Undo2 size={11} />
                {t('draftEditor.unfinalize')}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* 本章配图面板（题图 / 场景插图，按需展开） */}
      {showImages && meta && currentProject && (
        <ChapterImagesPanel
          chapterNumber={meta.chapterNumber}
          chapterTitle={meta.chapterTitle}
          projectPath={currentProject.path}
        />
      )}

      {/* 后处理状态面板（仅定稿草稿显示） */}
      {status === 'finalized' && meta && (
        <div className="px-3 py-1.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <PostProcessStatusPanel
            scope={getChapterFinalizeScope(meta.chapterNumber)}
            onRetry={() => doRepairFinalize()}
            onStatusLoad={setHasProcessFailure}
          />
        </div>
      )}

      {/* 正文区 + 审稿台账抽屉 */}
      <div className="flex-1 overflow-hidden flex min-h-0">
        <div className="flex-1 min-w-0 overflow-hidden relative">
          <CodeMirrorEditor
            mode="prose"
            content={content}
            filePath={filePath}
            editable={!effectiveReadonly && !isChapterBusy}
            hideStatusBar
            onCharCountChange={setCharCount}
            onChange={(text) => {
              currentBodyRef.current = text
              // 只翻 dirty 标志（已 dirty 时零 store 写入），内容在保存/卸载时刷回。
              // 按 filePath 解析 tab id：个别入口（Agent 打开的章节）id 与 filePath 不同
              const tab = useEditorStore.getState().tabs.find(t => t.filePath === filePath && t.type === 'chapter')
              if (tab) useEditorStore.getState().markTabDirty(tab.id)
            }}
            onSave={(text) => doSave(text)}
          />
        </div>
        {meta && (
          <ReviewFindingsPanel
            chapterNumber={meta.chapterNumber}
            draftId={String(meta.id)}
            filePath={filePath}
            open={findingsOpen}
            onClose={() => setFindingsOpen(false)}
            onCountChange={setFindingCounts}
          />
        )}
      </div>

      {/* AI 操作确认弹窗（修稿含自定义提示词输入框） */}
      <Dialog open={confirmAction !== null} onOpenChange={(v) => !v && setConfirmAction(null)}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles size={15} className="text-[var(--color-accent)]" />
              {confirmAction === 'refine' ? t('draftEditor.refineDialogTitle') : confirmAction === 'review' ? t('draftEditor.reviewDialogTitle') : '去 AI 味确认'}
            </DialogTitle>
            <DialogDescription>
              {t('draftEditor.dialogTarget', { title: meta?.chapterTitle ?? t('draftEditor.draft'), version: meta?.version ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 py-2 text-sm space-y-1.5" style={{ color: 'var(--color-text-secondary)' }}>
            {confirmAction === 'refine' ? (
              <>
                <div className="font-medium text-[var(--color-text)]">{t('draftEditor.refineScopeTitle')}</div>
                <div>{t('draftEditor.refineScope1')}</div>
                <div>{t('draftEditor.refineScope2')}</div>
              </>
            ) : confirmAction === 'review' ? (
              <>
                <div>{t('draftEditor.reviewDescription')}</div>
                <div className="mt-3">
                  <div className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>{t('draftEditor.reviewFocusTitle')}</div>
                  <div className="flex flex-wrap gap-2">
                    {REVIEW_DIMS.map(d => (
                      <label
                        key={d.key}
                        className="flex items-center gap-1.5 cursor-pointer select-none px-2 py-1 rounded-md text-xs"
                        style={{
                          border: `1px solid ${reviewDims[d.key] ? 'var(--color-accent)' : 'var(--color-border)'}`,
                          backgroundColor: reviewDims[d.key] ? 'rgba(var(--color-accent-rgb),0.1)' : 'transparent',
                          color: reviewDims[d.key] ? 'var(--color-accent)' : 'var(--color-text-muted)',
                        }}
                        onClick={() => setReviewDims(prev => ({ ...prev, [d.key]: !prev[d.key] }))}
                      >
                        <div
                          className="w-3 h-3 rounded flex items-center justify-center flex-shrink-0"
                          style={{
                            backgroundColor: reviewDims[d.key] ? 'var(--color-accent)' : 'transparent',
                            border: `1.5px solid ${reviewDims[d.key] ? 'var(--color-accent)' : 'var(--color-border)'}`,
                          }}
                        >
                          {reviewDims[d.key] && (
                            <svg width="7" height="5" viewBox="0 0 9 7" fill="none"><path d="M1 3L3.5 5.5L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          )}
                        </div>
                        {d.label}
                      </label>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>将对本章草稿做「去 AI 味」清洗（只改表达层，保持情节/人设/篇幅）。</div>
                <div className="mt-3">
                  <div className="text-xs font-medium mb-2" style={{ color: 'var(--color-text)' }}>清洗强度：</div>
                  <div className="flex flex-wrap gap-2">
                    {DEAIFY_LEVELS.map(lv => (
                      <label
                        key={lv.key}
                        className="flex items-center gap-1.5 cursor-pointer select-none px-2 py-1 rounded-md text-xs"
                        style={{
                          border: `1px solid ${deaifyIntensity === lv.key ? 'var(--color-accent)' : 'var(--color-border)'}`,
                          backgroundColor: deaifyIntensity === lv.key ? 'rgba(var(--color-accent-rgb),0.1)' : 'transparent',
                          color: deaifyIntensity === lv.key ? 'var(--color-accent)' : 'var(--color-text-muted)',
                        }}
                        title={lv.desc}
                        onClick={() => setDeaifyIntensity(lv.key)}
                      >
                        <div
                          className="w-3 h-3 rounded-full flex items-center justify-center flex-shrink-0"
                          style={{ border: `1.5px solid ${deaifyIntensity === lv.key ? 'var(--color-accent)' : 'var(--color-border)'}` }}
                        >
                          {deaifyIntensity === lv.key && (
                            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--color-accent)' }} />
                          )}
                        </div>
                        {lv.key}
                      </label>
                    ))}
                  </div>
                  <div className="text-[0.7rem] mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
                    {DEAIFY_LEVELS.find(l => l.key === deaifyIntensity)?.desc}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* 修稿时显示自定义提示词输入框 */}
          {confirmAction === 'refine' && (
            <div className="px-5 pb-2">
              <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                {t('draftEditor.additionalRefinePrompt')}
              </label>
              <textarea
                className="w-full px-3 py-2 rounded-md text-sm"
                style={{
                  background: 'var(--color-bg-elevated)',
                  border: '1px solid var(--color-border)',
                  color: 'var(--color-text)',
                  minHeight: 72,
                  resize: 'vertical',
                  outline: 'none',
                }}
                placeholder={t('draftEditor.additionalRefinePlaceholder')}
                value={userRefinePrompt}
                onChange={e => setUserRefinePrompt(e.target.value)}
              />
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>{t('draftEditor.cancel')}</Button>
            <Button
              variant="ai"
              onClick={() => {
                const act = confirmAction
                setConfirmAction(null)
                if (act === 'refine') doRefine()
                else if (act === 'review') doReview()
                else if (act === 'deaify') doDeaify()
              }}
            >
              {t('draftEditor.confirmExecution')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 取消定稿确认：列出清理项，必须勾选确认 */}
      <Dialog open={unfinalizeOpen} onOpenChange={setUnfinalizeOpen}>
        <DialogContent className="max-w-[460px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 size={15} className="text-[var(--color-warning)]" />
              {t('draftEditor.unfinalizeConfirmTitle', { chapter: meta?.chapterNumber })}
            </DialogTitle>
            <DialogDescription>{t('draftEditor.unfinalizeConfirmIntro')}</DialogDescription>
          </DialogHeader>
          <div className="px-5 py-2 text-sm space-y-2" style={{ color: 'var(--color-text-secondary)' }}>
            <ul className="space-y-1 list-disc pl-4">
              <li>{t('draftEditor.unfinalizeCleanup1', { chapter: meta?.chapterNumber })}</li>
              <li>{t('draftEditor.unfinalizeCleanup2')}</li>
              <li>{t('draftEditor.unfinalizeCleanup3')}</li>
              <li>{t('draftEditor.unfinalizeCleanup4')}</li>
              <li>{t('draftEditor.unfinalizeCleanup5', { start: (meta?.chapterNumber ?? 0) + 1, end: (meta?.chapterNumber ?? 0) + 5 })}</li>
            </ul>
            <div
              className="rounded-md px-3 py-2 text-xs"
              style={{ backgroundColor: 'rgba(245,158,11,0.1)', color: 'var(--color-text-secondary)' }}
            >
              {t('draftEditor.unfinalizeBackupNote')}
            </div>
            <label className="flex items-start gap-2 cursor-pointer select-none pt-1">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={unfinalizeAck}
                onChange={e => setUnfinalizeAck(e.target.checked)}
              />
              <span className="text-xs" style={{ color: 'var(--color-text)' }}>
                {t('draftEditor.unfinalizeConfirmCheck')}
              </span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnfinalizeOpen(false)}>
              {t('draftEditor.cancel')}
            </Button>
            <Button
              variant="destructive"
              disabled={!unfinalizeAck || unfinalizing}
              onClick={() => void doUnfinalize()}
            >
              {t('draftEditor.unfinalizeConfirmAction')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 弹出式三栏合并视图 —— 使用统一 Dialog 组件 */}
      <Dialog open={mergeData !== null} onOpenChange={(v) => !v && setMergeData(null)}>
        <DialogContent
          className="p-0"
          style={{
            width: '90vw',
            maxWidth: '90vw',
            height: '85vh',
            maxHeight: '85vh',
            overflow: 'hidden',
          }}
          /* 阻止点击遮罩关闭，防止误触丢失合并进度 */
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader className="px-4 py-0" style={{ height: 38, display: 'flex', alignItems: 'center' }}>
            <DialogTitle className="flex items-center gap-2 text-[0.8rem]">
              {t('draftEditor.mergeDialogTitle', { chapter: meta?.chapterNumber, title: meta?.chapterTitle })}
            </DialogTitle>
          </DialogHeader>
          {/* 合并视图主体 */}
          <div className="flex-1 overflow-hidden" style={{ height: 'calc(85vh - 38px - 1px)' }}>
            {mergeData && (
              <ThreeWayMerge
                originalContent={mergeData.originalContent}
                modifiedContent={mergeData.modifiedContent}
                onComplete={handleMergeComplete}
                onCancel={() => setMergeData(null)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 标点规范化预览 —— 复用三栏合并视图，与「修稿合并」保持同一套外观与交互 */}
      <Dialog open={punctPreview !== null} onOpenChange={(v) => !v && setPunctPreview(null)}>
        <DialogContent
          className="p-0"
          style={{
            width: '90vw',
            maxWidth: '90vw',
            height: '85vh',
            maxHeight: '85vh',
            overflow: 'hidden',
          }}
          /* 阻止点击遮罩/ESC 关闭，避免误触丢失逐段取舍的结果 */
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader className="px-4 py-0" style={{ height: 38, display: 'flex', alignItems: 'center' }}>
            <DialogTitle className="flex items-center gap-2 text-[0.8rem]">
              <Pilcrow size={13} />
              标点规范化 — 第 {meta?.chapterNumber} 章 {meta?.chapterTitle}
              {punctPreview && (
                <span style={{ color: 'var(--color-text-muted)', fontWeight: 400 }}>
                  {punctPreview.result.count} 处（{describeNormalizeResult(punctPreview.result)}）
                  {punctPreview.result.skipped.unpairedQuotes > 0 &&
                    ` · ${punctPreview.result.skipped.unpairedQuotes} 处引号所在行引号数为奇数，无法配对已跳过`}
                  {punctPreview.result.skipped.periods > 0 &&
                    ` · ${punctPreview.result.skipped.periods} 处半角句点未处理`}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden" style={{ height: 'calc(85vh - 38px - 1px)' }}>
            {punctPreview && (
              <ThreeWayMerge
                originalContent={punctPreview.original}
                modifiedContent={punctPreview.result.text}
                onComplete={applyPunctuation}
                onCancel={() => setPunctPreview(null)}
                labels={{ modified: '规范化后', complete: '应用' }}
                defaultApplyAll
                inlineCharDiff
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
