import { ipcMain, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { closeProjectDatabase, getProjectDb, getCurrentProjectPath } from '../database'
import { backupNow } from '../db-auto-backup'
import { getBackupDir } from '../db-backup'
import { readRehearsalContext, requireProjectDatabase } from '../repositories/rehearsal-repository'
import { indexStory, readStoryDocument, applyStoryRevision, listStoryRevisions, undoStoryRevision } from '../repositories/story-revision-repository'
import type { StoryReadRequest, StoryRevisionRequest } from '../../src/shared/story-revision'
import { MOSHU_HOME } from '../utils/config-utils'

// 导入所有 Repository
import { ProjectCoreRepository, ProjectCoreData } from '../repositories/project-core-repository'
import {
  listRuleItems, replaceRuleItems, listRuleSnapshots, getRuleSnapshot, restoreRuleSnapshot,
  compileRulebook,
} from '../repositories/rule-repository'
import {
  listChapterEvents, listAllEvents, replaceChapterEvents,
  getTimelineConfig, saveTimelineConfig, validateTimeline,
} from '../repositories/timeline-repository'
import { BlueprintRepository, BlueprintData } from '../repositories/blueprint-repository'
import { CharacterRepository, CharacterData, CharacterStateData } from '../repositories/character-repository'
import { DraftRepository } from '../repositories/draft-repository'
import { ChapterSearchRepository, type ChapterSearchResult } from '../repositories/chapter-search-repository'
import { RevisionRepository } from '../repositories/revision-repository'
import { ReviewRepository } from '../repositories/review-repository'
import { PostProcessRepository } from '../repositories/post-process-repository'

import { ForeshadowingRepository, ForeshadowingData } from '../repositories/foreshadowing-repository'
import { ChapterImageRepository } from '../repositories/chapter-image-repository'

// 沿用的旧表
import { LLMHistoryRepository } from '../repositories/llm-repository'
import { SummaryRepository } from '../repositories/summary-repository'
import { CanonRepository } from '../repositories/canon-repository'
import { AssetRepository } from '../repositories/asset-repository'
import { AttributeRepository } from '../repositories/attribute-repository'
import { RelationRepository } from '../repositories/relation-repository'
import { PipelineRepository } from '../repositories/pipeline-repository'
import { StyleRepository } from '../repositories/style-repository'
import { ReviewFindingRepository } from '../repositories/review-finding-repository'
import { executeMutationPlan, previewMutationPlan } from '../services/mutation-plan-executor'
import { executeFinalizeWriteback, type FinalizeWritebackInput } from '../services/finalize-writeback'
import { executeChapterUnfinalize } from '../services/chapter-unfinalize'
import { CharacterHistoryRepository } from '../repositories/character-history-repository'
import type { MutationPlanExecutionOptions } from '../../src/shared/mutation-plan'
import {
  safeValidate,
  validateCanonTimelineEventInput,
  validateCanonFactInput,
  validateCanonPlotLineInput,
  validateCanonCharacterStateSnapshot,
  validateCanonChapterSummary,
  validateCanonArcSummary,
  validateCanonWritebackPayload,
  validateChapterSearchArgs,
  validateAssetInput,
  validateAttributeDefInput,
  validateAttributeValueInput,
  validateEntityRelationInput,
  validateStyleProfileInput,
  validateReviewFindingInput,
  VALID_ASSET_TYPES,
  VALID_FINDING_STATUSES,
} from '../ipc-validation'
import type {
  TimelineEvent,
  CharacterStateSnapshot,
  PlotLine,
  Fact,
  ChapterSummary,
} from '../../src/services/narrative-consistency/types'
import type { AssetEntityType } from '../repositories/asset-repository'
import type { AttributePhase } from '../repositories/attribute-repository'
import type { ChapterStage } from '../../src/shared/chapter-stage'
import type { ReviewFindingStatus } from '../repositories/review-finding-repository'

/** 手动备份保留份数（与自动备份分开计数） */
const MANUAL_BACKUP_KEEP = 20

export function registerDatabaseController() {
  const agentStatePath = path.join(MOSHU_HOME, 'author-agent-state.json')
  ipcMain.handle('agent:state-read', () => {
    if (!fs.existsSync(agentStatePath)) return null
    return fs.readFileSync(agentStatePath, 'utf8')
  })
  ipcMain.handle('agent:state-write', (_event, serialized: string) => {
    if (typeof serialized !== 'string' || serialized.length > 50_000_000 || !Array.isArray(JSON.parse(serialized)?.state?.conversations)) throw new Error('对话记录格式错误或过大。')
    fs.mkdirSync(MOSHU_HOME, { recursive: true })
    const temporary = `${agentStatePath}.tmp`
    fs.writeFileSync(temporary, serialized, 'utf8')
    fs.renameSync(temporary, agentStatePath)
  })
  ipcMain.handle('story:index', (_event, projectPath: string, query?: string, offset?: number) => indexStory(projectPath, query, offset))
  ipcMain.handle('story:read', (_event, projectPath: string, request: StoryReadRequest) => readStoryDocument(projectPath, request))
  ipcMain.handle('story:apply', (_event, projectPath: string, request: StoryRevisionRequest) => applyStoryRevision(projectPath, request))
  ipcMain.handle('story:history', (_event, projectPath: string) => listStoryRevisions(projectPath))
  ipcMain.handle('story:undo', (_event, projectPath: string, id: string) => undoStoryRevision(projectPath, id))
  ipcMain.handle('db:rehearsal-context', (_event, projectPath: string, chapterNumber: number) => {
    return readRehearsalContext(projectPath, chapterNumber)
  })

  // ===== 备份 =====
  ipcMain.handle('db:backup-now', async () => {
    const db = getProjectDb()
    const projectPath = getCurrentProjectPath()
    if (!db || !projectPath) return { success: false, error: '未打开项目' }
    try {
      const file = await backupNow(db, projectPath, 'manual', MANUAL_BACKUP_KEEP)
      return { success: true, file }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('db:backup-open-dir', async () => {
    const projectPath = getCurrentProjectPath()
    if (!projectPath) return { success: false, error: '未打开项目' }
    const dir = getBackupDir(projectPath)
    await fs.promises.mkdir(dir, { recursive: true })
    // shell.openPath 成功返回空字符串，失败返回错误描述
    const error = await shell.openPath(dir)
    return error ? { success: false, error } : { success: true }
  })

  ipcMain.handle('db:close', async () => {
    closeProjectDatabase()
    return { success: true }
  })

  // ============================================================
  // 1. project_core — 项目主台账
  // ============================================================
  ipcMain.handle('db:project-core-get', async () => {
    return ProjectCoreRepository.get()
  })

  ipcMain.handle('db:project-core-update', async (_event, data: Partial<ProjectCoreData>) => {
    try {
      ProjectCoreRepository.update(data)
      return { success: true }
    } catch (err) {
      console.error('[db:project-core-update] 失败:', err)
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // 1.1 rule_items — 结构化规则库
  // ============================================================
  ipcMain.handle('db:rule-items-list', async () => listRuleItems())

  ipcMain.handle('db:rule-items-save', async (_event, items: Parameters<typeof replaceRuleItems>[0]) => {
    try {
      const result = replaceRuleItems(items)
      return { success: true, items: result.items, compiled: result.compiled }
    } catch (err) {
      console.error('[db:rule-items-save] 失败:', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:rule-items-seed', async (_event, rulebook?: string) => {
    try {
      const { seedRuleItemsFromRulebook } = await import('../repositories/rule-repository')
      const text = rulebook ?? ''
      const count = seedRuleItemsFromRulebook(text)
      const items = listRuleItems()
      return { success: true, items, compiled: compileRulebook(items), count }
    } catch (err) {
      console.error('[db:rule-items-seed] 失败:', err)
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:rule-snapshot-list', async (_event, limit?: number) => listRuleSnapshots(limit))

  ipcMain.handle('db:rule-snapshot-get', async (_event, id: number) => getRuleSnapshot(id))

  ipcMain.handle('db:rule-snapshot-restore', async (_event, id: number) => {
    try {
      restoreRuleSnapshot(id)
      const restored = listRuleItems()
      return { success: true, items: restored, compiled: compileRulebook(restored) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // 1.2 章纲时间线
  // ============================================================
  ipcMain.handle('db:timeline-events-get', async (_event, chapterNumber: number) => listChapterEvents(chapterNumber))
  ipcMain.handle('db:timeline-events-all', async (_event, limit?: number) => listAllEvents(limit))
  ipcMain.handle('db:timeline-events-save', async (
    _event, chapterNumber: number, events: Parameters<typeof replaceChapterEvents>[1],
  ) => {
    try {
      const saved = replaceChapterEvents(chapterNumber, events)
      return { success: true, events: saved }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:timeline-config-get', async () => getTimelineConfig())
  ipcMain.handle('db:timeline-config-save', async (_event, config: Partial<Parameters<typeof saveTimelineConfig>[0]>) => {
    return saveTimelineConfig(config)
  })
  ipcMain.handle('db:timeline-validate', async () => validateTimeline())
  ipcMain.handle('db:timeline-context', async (_event, chapterNumber: number) => {
    const { buildTimelineContext } = await import('../repositories/timeline-repository')
    return buildTimelineContext(chapterNumber)
  })

  // ============================================================
  // 2. blueprints — 章节蓝图
  // ============================================================
  ipcMain.handle('db:blueprint-get-all', async (_event, projectPath?: string) => {
    if (projectPath !== undefined) requireProjectDatabase(projectPath)
    return BlueprintRepository.getAll()
  })

  ipcMain.handle('db:blueprint-commit', (_event, items: BlueprintData[], deleted: number[], expected: BlueprintData[], projectPath: string) => {
    try {
      requireProjectDatabase(projectPath)
      BlueprintRepository.commit(items, deleted, expected)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:blueprint-get', async (_event, chapterNumber: number) => {
    return BlueprintRepository.getByChapter(chapterNumber)
  })

  ipcMain.handle('db:blueprint-upsert', async (_event, data: BlueprintData, projectPath?: string) => {
    try {
      if (!getProjectDb()) throw new Error('PROJECT_CLOSED')
      if (projectPath !== undefined) requireProjectDatabase(projectPath)
      BlueprintRepository.upsert(data)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:blueprint-upsert-many', async (_event, items: BlueprintData[], projectPath?: string) => {
    try {
      if (!getProjectDb()) throw new Error('PROJECT_CLOSED')
      if (projectPath !== undefined) requireProjectDatabase(projectPath)
      BlueprintRepository.upsertMany(items)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:blueprint-update-notes', async (_event, chapterNumber: number, notes: string) => {
    try {
      BlueprintRepository.updateNotes(chapterNumber, notes)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:blueprint-mark-stale', async (_event, chapterNumbers: unknown) => {
    if (!Array.isArray(chapterNumbers)) return { success: false, error: 'EXPECTED_ARRAY' }
    try {
      const updated = BlueprintRepository.markStale(chapterNumbers as number[])
      return { success: true, updated }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // 3. characters — 角色卡
  // ============================================================
  ipcMain.handle('db:character-get-all', async () => {
    return CharacterRepository.getAll()
  })

  ipcMain.handle('db:character-upsert', async (_event, data: CharacterData) => {
    try {
      CharacterRepository.upsert(data)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:character-save-all', async (_event, items: CharacterData[]) => {
    try {
      CharacterRepository.saveAll(items)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:character-rename', async (_event, oldName: string, newName: string) => {
    try {
      CharacterRepository.rename(oldName, newName)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:character-delete', async (_event, name: string) => {
    try {
      CharacterRepository.delete(name)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:character-update-state', async (_event, name: string, state: CharacterStateData) => {
    try {
      CharacterRepository.updateState(name, state)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:character-history-list', async (_event, name: string, limit?: number) => {
    try {
      return CharacterHistoryRepository.getHistory(name, limit ?? 100)
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:character-snapshot-map', async (_event, chapterNumber: number) => {
    try {
      if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 0) return {}
      return CharacterHistoryRepository.getSnapshotMap(chapterNumber)
    } catch {
      return {}
    }
  })

  ipcMain.handle('db:character-update-speech', async (_event, name: string, speechStyle: string) => {
    try {
      CharacterRepository.updateSpeechStyle(name, speechStyle)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:character-update-portrait', async (_event, name: string, portraitPath: string) => {
    try {
      CharacterRepository.updatePortrait(name, portraitPath)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // 章节配图 chapter_images（题图 / 场景插图）
  // ============================================================
  ipcMain.handle('db:chapter-image-list', async (_event, chapterNumber: number) => {
    return ChapterImageRepository.listByChapter(chapterNumber)
  })

  ipcMain.handle('db:chapter-image-add', async (_event, payload: { chapterNumber: number; kind: 'header' | 'scene'; path: string; prompt: string }) => {
    try {
      const id = ChapterImageRepository.add(payload.chapterNumber, payload.kind, payload.path, payload.prompt)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:chapter-image-delete', async (_event, id: number) => {
    try {
      ChapterImageRepository.remove(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // 4. drafts — 草稿
  // ============================================================
  ipcMain.handle('db:draft-create', async (_event, params: {
    chapterNumber: number
    version: number
    source: 'write' | 'rewrite'
    content: string
    wordCount: number
  }) => {
    try {
      const id = DraftRepository.create(params)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:draft-list', async (_event, chapterNumber: number) => {
    return DraftRepository.listByChapter(chapterNumber)
  })

  ipcMain.handle('db:draft-list-all', async () => {
    return DraftRepository.listAll()
  })

  ipcMain.handle('db:draft-get-meta', async (_event, id: number) => {
    return DraftRepository.getMeta(id)
  })

  ipcMain.handle('db:draft-get-full', async (_event, id: number) => {
    return DraftRepository.getFull(id)
  })

  ipcMain.handle('db:draft-get-latest', async (_event, chapterNumber: number) => {
    return DraftRepository.getLatestByChapter(chapterNumber)
  })

  ipcMain.handle('db:draft-get-finalized', async (_event, chapterNumber: number) => {
    return DraftRepository.getFinalizedByChapter(chapterNumber)
  })

  ipcMain.handle('db:draft-get-max-finalized-chapter', async () => {
    return DraftRepository.getMaxFinalizedChapter()
  })
  ipcMain.handle('db:draft-next-version', async (_event, chapterNumber: number) => {
    return DraftRepository.getNextVersion(chapterNumber)
  })

  ipcMain.handle('db:draft-update-status', async (_event, id: number, status: string, wordCount?: number) => {
    try {
      DraftRepository.updateStatus(id, status, wordCount)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:draft-finalize', async (_event, chapterNumber: number, id: number, wordCount: number) => {
    try {
      DraftRepository.finalizeExclusive(chapterNumber, id, wordCount)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // 取消定稿：只允许当前最新定稿章，先备份再单事务回滚
  ipcMain.handle('db:chapter-unfinalize', async (_event, chapterNumber: number) => {
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) {
      return { success: false, error: 'INVALID_CHAPTER_NUMBER' }
    }
    try {
      return { success: true, result: await executeChapterUnfinalize(chapterNumber) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:draft-update-content', async (_event, id: number, content: string, wordCount: number) => {
    try {
      DraftRepository.updateContent(id, content, wordCount)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // 全局搜索：各章代表稿（定稿优先，否则最新未归档草稿）的正文字面量匹配
  ipcMain.handle('db:search-chapters', async (_event, query: unknown, options?: unknown): Promise<ChapterSearchResult> => {
    const empty: ChapterSearchResult = { chapters: [], totalMatches: 0, truncated: false, countCapped: false }
    const v = safeValidate(validateChapterSearchArgs, { query, options })
    if (!v.ok) return { ...empty, error: v.error }
    try {
      return ChapterSearchRepository.search(v.data.query, v.data.options)
    } catch (err) {
      return { ...empty, error: String(err) }
    }
  })

  // ============================================================
  // 5. revisions — 修稿
  // ============================================================
ipcMain.handle('db:revision-create', async (_event, params: {
    baseDraftId: number
    revisionIndex: number
    revisionType: 'refine' | 'review-fix'
    userPrompt?: string
    reviewSourceId?: number
    content: string
    wordCount: number
  }) => {
    try {
      const id = RevisionRepository.create(params)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:revision-list', async (_event, baseDraftId: number) => {
    return RevisionRepository.listByDraft(baseDraftId)
  })

  ipcMain.handle('db:revision-get-pending', async (_event, baseDraftId: number) => {
    return RevisionRepository.getPending(baseDraftId)
  })

  ipcMain.handle('db:revision-get-full', async (_event, id: number) => {
    return RevisionRepository.getFull(id)
  })

  ipcMain.handle('db:revision-next-index', async (_event, baseDraftId: number) => {
    return RevisionRepository.getNextIndex(baseDraftId)
  })

  ipcMain.handle('db:revision-mark-merged', async (_event, id: number, mergedToDraftId: number) => {
    try {
      RevisionRepository.markMerged(id, mergedToDraftId)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:revision-mark-discarded', async (_event, id: number) => {
    try {
      RevisionRepository.markDiscarded(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // 6. reviews — 审稿
  // ============================================================
  ipcMain.handle('db:review-create', async (_event, params: {
    baseDraftId: number
    reviewIndex: number
    content: string
  }) => {
    try {
      const id = ReviewRepository.create(params)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:review-list', async (_event, baseDraftId: number) => {
    return ReviewRepository.listByDraft(baseDraftId)
  })

  ipcMain.handle('db:review-get-latest', async (_event, baseDraftId: number) => {
    return ReviewRepository.getLatestByDraft(baseDraftId)
  })

  ipcMain.handle('db:review-get-full', async (_event, id: number) => {
    return ReviewRepository.getFull(id)
  })

  ipcMain.handle('db:review-next-index', async (_event, baseDraftId: number) => {
    return ReviewRepository.getNextIndex(baseDraftId)
  })

  // ============================================================
  // 7. post_process — 后处理跑批
  // ============================================================
  ipcMain.handle('db:post-process-create-run', async (_event, params: {
    triggerSourceType: string
    triggerSourceId: string
    sourceLabel: string
    steps: Array<{ key: string; label: string; critical: boolean }>
  }) => {
    try {
      const id = PostProcessRepository.createRun(params)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:post-process-get-latest-run', async (_event, sourceType: string, sourceId: string) => {
    return PostProcessRepository.getLatestRun(sourceType, sourceId)
  })

  ipcMain.handle('db:post-process-get-steps', async (_event, runId: string) => {
    return PostProcessRepository.getSteps(runId)
  })

  ipcMain.handle('db:post-process-mark-step-ok', async (_event, runId: string, stepKey: string) => {
    try {
      PostProcessRepository.markStepOk(runId, stepKey)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:post-process-mark-step-failed', async (_event, runId: string, stepKey: string, errorMsg: string) => {
    try {
      PostProcessRepository.markStepFailed(runId, stepKey, errorMsg)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:post-process-is-all-passed', async (_event, sourceType: string, sourceId: string) => {
    return PostProcessRepository.isAllCriticalPassed(sourceType, sourceId)
  })

  // ============================================================
  // 10. foreshadowings — 伏笔/线索台账
  // ============================================================
  ipcMain.handle('db:foreshadow-get-all', async () => {
    return ForeshadowingRepository.getAll()
  })

  ipcMain.handle('db:foreshadow-get-open', async () => {
    return ForeshadowingRepository.getOpen()
  })

  ipcMain.handle('db:foreshadow-create', async (_event, data: {
    content: string
    plantedChapter: number
    expectedChapter?: number | null
    notes?: string
  }) => {
    try {
      const id = ForeshadowingRepository.create(data)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:foreshadow-mark-paid', async (_event, id: number, paidChapter: number) => {
    try {
      ForeshadowingRepository.markPaid(id, paidChapter)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:foreshadow-update', async (_event, data: ForeshadowingData) => {
    try {
      ForeshadowingRepository.update(data)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:foreshadow-delete', async (_event, id: number) => {
    try {
      ForeshadowingRepository.remove(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // 沿用旧表
  // ============================================================
  ipcMain.handle('db:log-llm-call', async (_event, call) => {
    try {
      LLMHistoryRepository.logCall(call)
      return { success: true }
    } catch (error) {
      console.error('[db:log-llm-call] Error:', error)
      return { success: false }
    }
  })

  ipcMain.handle('db:get-llm-stats', async () => {
    return LLMHistoryRepository.getStats()
  })

  ipcMain.handle('db:get-llm-history', async (_event, limit?: number) => {
    return LLMHistoryRepository.getHistory(limit ?? 50)
  })

  ipcMain.handle('db:save-summary-snapshot', async (_event, chapterNumber: number, characterStates: string) => {
    SummaryRepository.saveSnapshot(chapterNumber, characterStates)
    return { success: true }
  })

  ipcMain.handle('db:get-latest-summary', async () => {
    return SummaryRepository.getLatestSnapshot()
  })

  // ============================================================
  // Canon Store —— 叙事一致性持久化
  // ============================================================

  // 时间线
  ipcMain.handle('db:canon-timeline-get', async (_event, maxChapter: number, includeFlashback?: boolean) => {
    return CanonRepository.getTimelineUpTo(maxChapter, includeFlashback !== false)
  })
  ipcMain.handle('db:canon-timeline-get-chapter', async (_event, chapterNumber: number) => {
    return CanonRepository.getTimelineByChapter(chapterNumber)
  })
  ipcMain.handle('db:canon-timeline-append', async (_event, event: Omit<TimelineEvent, 'id' | 'createdAt'>) => {
    const v = safeValidate(validateCanonTimelineEventInput, event)
    if (!v.ok) return { success: false, error: v.error }
    try {
      const id = CanonRepository.appendTimelineEvent(v.data)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:canon-timeline-clear-chapter', async (_event, chapterNumber: number) => {
    CanonRepository.clearChapterTimeline(chapterNumber)
    return { success: true }
  })
  ipcMain.handle('db:canon-timeline-clear-extracted', async (_event, chapterNumber: number) => {
    CanonRepository.clearChapterExtractedTimeline(chapterNumber)
    return { success: true }
  })
  ipcMain.handle('db:canon-timeline-set-status', async (_event, id: number, status: 'confirmed' | 'pending' | 'rejected') => {
    if (!['confirmed', 'pending', 'rejected'].includes(status)) return { success: false }
    return { success: CanonRepository.setTimelineEventStatus(id, status) }
  })
  ipcMain.handle('db:canon-timeline-pending', async () => {
    return CanonRepository.getPendingTimelineEvents()
  })

  // 角色状态
  ipcMain.handle('db:canon-character-state-get-all', async () => {
    return CanonRepository.getAllCharacterStates()
  })
  ipcMain.handle('db:canon-character-state-get', async (_event, character: string) => {
    return CanonRepository.getCharacterState(character)
  })
  ipcMain.handle('db:canon-character-state-upsert', async (_event, snapshot: CharacterStateSnapshot) => {
    const v = safeValidate(validateCanonCharacterStateSnapshot, snapshot)
    if (!v.ok) return { success: false, error: v.error }
    try {
      CanonRepository.upsertCharacterState(v.data)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // 剧情线
  ipcMain.handle('db:canon-plot-list', async (_event, status?: PlotLine['status']) => {
    return CanonRepository.getPlotLines(status ? { status } : undefined)
  })
  ipcMain.handle('db:canon-plot-add', async (_event, line: Omit<PlotLine, 'id'>) => {
    const v = safeValidate(validateCanonPlotLineInput, line)
    if (!v.ok) return { success: false, error: v.error }
    try {
      const id = CanonRepository.addPlotLine(v.data)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:canon-plot-advance', async (_event, id: number, currentState: string, lastAdvancedAt: number) => {
    CanonRepository.advancePlotLine(id, currentState, lastAdvancedAt)
    return { success: true }
  })
  ipcMain.handle('db:canon-plot-resolve', async (_event, id: number, chapterNumber: number) => {
    CanonRepository.resolvePlotLine(id, chapterNumber)
    return { success: true }
  })

  // 事实
  ipcMain.handle('db:canon-fact-list', async () => {
    return CanonRepository.getFacts()
  })
  ipcMain.handle('db:canon-fact-add', async (_event, fact: Omit<Fact, 'id'>) => {
    const v = safeValidate(validateCanonFactInput, fact)
    if (!v.ok) return { success: false, error: v.error }
    try {
      const id = CanonRepository.addFact(v.data)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:canon-fact-clear-chapter', async (_event, chapterNumber: number) => {
    CanonRepository.clearChapterFacts(chapterNumber)
    return { success: true }
  })

  // 章节摘要
  ipcMain.handle('db:canon-summary-get', async (_event, chapterNumber: number) => {
    return CanonRepository.getSummary(chapterNumber)
  })
  ipcMain.handle('db:canon-summary-list-recent', async (_event, limit?: number) => {
    return CanonRepository.getRecentSummaries(limit ?? 5)
  })
  ipcMain.handle('db:canon-summary-upsert', async (_event, summary: ChapterSummary) => {
    const v = safeValidate(validateCanonChapterSummary, summary)
    if (!v.ok) return { success: false, error: v.error }
    try {
      CanonRepository.upsertSummary(v.data)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:canon-summary-list-range', async (_event, fromChapter: number, toChapter: number) => {
    if (!Number.isInteger(fromChapter) || !Number.isInteger(toChapter)) return []
    return CanonRepository.getSummariesInRange(fromChapter, toChapter)
  })

  // 分层摘要（卷 / 全书）
  ipcMain.handle('db:canon-arc-summary-list', async () => {
    return CanonRepository.listArcSummaries()
  })
  ipcMain.handle('db:canon-arc-summary-upsert', async (_event, summary: unknown) => {
    const v = safeValidate(validateCanonArcSummary, summary)
    if (!v.ok) return { success: false, error: v.error }
    try {
      CanonRepository.upsertArcSummary(v.data)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // 原子写回（推荐路径：单次事务）
  ipcMain.handle('db:canon-writeback-atomic', async (_event, payload: {
    chapterNumber: number
    newEvents: Omit<TimelineEvent, 'id' | 'createdAt'>[]
    characterDeltas: Array<{ character: string; after: Partial<CharacterStateSnapshot>; chapterNumber: number }>
    plotLineChanges?: {
      added?: Omit<PlotLine, 'id'>[]
      advanced?: Array<{ id: number; currentState: string; lastAdvancedAt: number }>
      resolved?: number[]
    }
    newFacts: Omit<Fact, 'id'>[]
  }) => {
    const v = safeValidate(validateCanonWritebackPayload, payload)
    if (!v.ok) return { success: false, error: v.error }
    try {
      const result = CanonRepository.writebackAtomically(v.data)
      return { success: true, ...result }
    } catch (err) {
      console.error('[db:canon-writeback-atomic] failed:', err)
      return { success: false, error: String(err) }
    }
  })

  // ===== P1 数据层：资产库 =====
  ipcMain.handle('db:asset-list', async (_event, entityType?: AssetEntityType) => {
    if (entityType && !(VALID_ASSET_TYPES as readonly string[]).includes(entityType)) return []
    return AssetRepository.getAll(entityType)
  })
  ipcMain.handle('db:asset-get', async (_event, id: number) => {
    if (!Number.isSafeInteger(id) || id < 1) return null
    return AssetRepository.getById(id)
  })
  ipcMain.handle('db:asset-upsert', async (_event, raw: unknown) => {
    const v = safeValidate(validateAssetInput, raw)
    if (!v.ok) return { success: false, error: v.error }
    try {
      return { success: true, id: AssetRepository.upsert(v.data) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:asset-delete', async (_event, id: number) => {
    if (!Number.isSafeInteger(id) || id < 1) return { success: false, error: 'INVALID_ID' }
    try {
      AssetRepository.delete(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ===== P1 数据层：属性系统 =====
  ipcMain.handle('db:attribute-def-list', async (_event, entityType?: string) => {
    if (entityType !== undefined && (typeof entityType !== 'string' || entityType.length > 100)) return []
    return AttributeRepository.listDefs(entityType)
  })
  ipcMain.handle('db:attribute-def-upsert', async (_event, raw: unknown) => {
    const v = safeValidate(validateAttributeDefInput, raw)
    if (!v.ok) return { success: false, error: v.error }
    try {
      AttributeRepository.upsertDef(v.data)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:attribute-def-delete', async (_event, key: string) => {
    if (typeof key !== 'string' || !key.trim()) return { success: false, error: 'INVALID_KEY' }
    try {
      AttributeRepository.deleteDef(key)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:attribute-value-get', async (
    _event,
    entityId: string,
    attrKey: string,
    chapterNumber: number,
    phase: AttributePhase = 'after',
  ) => {
    if (typeof entityId !== 'string' || !entityId.trim()) return null
    if (typeof attrKey !== 'string' || !attrKey.trim()) return null
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) return null
    return AttributeRepository.getValueAt(entityId, attrKey, chapterNumber, phase)
  })
  ipcMain.handle('db:attribute-value-list', async (_event, entityId: string, attrKey?: string) => {
    if (typeof entityId !== 'string' || !entityId.trim()) return []
    if (attrKey !== undefined && typeof attrKey !== 'string') return []
    return AttributeRepository.listValues(entityId, attrKey)
  })
  ipcMain.handle('db:attribute-value-set', async (_event, raw: unknown) => {
    const v = safeValidate(validateAttributeValueInput, raw)
    if (!v.ok) return { success: false, error: v.error }
    try {
      return { success: true, value: AttributeRepository.setValue(v.data) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:attribute-panel-state', async (
    _event,
    entityId: string,
    chapterNumber: number,
    phase: AttributePhase = 'after',
    entityType?: string,
  ) => {
    if (typeof entityId !== 'string' || !entityId.trim()) return []
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) return []
    if (entityType !== undefined && typeof entityType !== 'string') return []
    return AttributeRepository.getPanelState(entityId, chapterNumber, phase, entityType)
  })

  // ===== P1 数据层：关系网 =====
  ipcMain.handle('db:relation-list', async (_event, fromId?: string) => {
    if (fromId !== undefined && (typeof fromId !== 'string' || fromId.length > 200)) return []
    return RelationRepository.list(fromId)
  })
  ipcMain.handle('db:relation-upsert', async (_event, raw: unknown) => {
    const v = safeValidate(validateEntityRelationInput, raw)
    if (!v.ok) return { success: false, error: v.error }
    try {
      return { success: true, relation: RelationRepository.upsert(v.data) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:relation-delete', async (_event, fromId: string, toId: string, relationType: string) => {
    if ([fromId, toId, relationType].some((s) => typeof s !== 'string' || !s.trim())) {
      return { success: false, error: 'INVALID_RELATION_KEY' }
    }
    try {
      RelationRepository.delete(fromId, toId, relationType)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ===== P1 数据层：章节流水线 =====
  ipcMain.handle('db:pipeline-get', async (_event, chapterNumber: number) => {
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) return null
    return PipelineRepository.get(chapterNumber)
  })
  ipcMain.handle('db:pipeline-list', async () => PipelineRepository.getAll())
  ipcMain.handle('db:pipeline-set-stage', async (_event, chapterNumber: number, stage: ChapterStage) => {
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) {
      return { success: false, error: 'INVALID_CHAPTER_NUMBER' }
    }
    if (typeof stage !== 'string') return { success: false, error: 'INVALID_CHAPTER_STAGE' }
    try {
      return { success: true, state: PipelineRepository.setStage(chapterNumber, stage) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:pipeline-rewind', async (_event, chapterNumber: number, expectedStage: ChapterStage) => {
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) {
      return { success: false, error: 'INVALID_CHAPTER_NUMBER' }
    }
    if (typeof expectedStage !== 'string') return { success: false, error: 'INVALID_CHAPTER_STAGE' }
    try {
      return { success: true, state: PipelineRepository.rewind(chapterNumber, expectedStage) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ===== P1 数据层：风格档案 =====
  ipcMain.handle('db:style-list', async () => StyleRepository.list())
  ipcMain.handle('db:style-get-active', async () => StyleRepository.getActive())
  ipcMain.handle('db:style-create', async (_event, raw: unknown) => {
    const v = safeValidate(validateStyleProfileInput, raw)
    if (!v.ok) return { success: false, error: v.error }
    try {
      return { success: true, id: StyleRepository.create(v.data) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:style-update', async (_event, id: number, raw: unknown) => {
    if (!Number.isSafeInteger(id) || id < 1) return { success: false, error: 'INVALID_ID' }
    const v = safeValidate(validateStyleProfileInput, raw)
    if (!v.ok) return { success: false, error: v.error }
    try {
      StyleRepository.update(id, v.data)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:style-set-active', async (_event, id: number) => {
    if (!Number.isSafeInteger(id) || id < 1) return { success: false, error: 'INVALID_ID' }
    try {
      StyleRepository.setActive(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:style-delete', async (_event, id: number) => {
    if (!Number.isSafeInteger(id) || id < 1) return { success: false, error: 'INVALID_ID' }
    try {
      StyleRepository.delete(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ===== P1 数据层：审稿台账 =====
  ipcMain.handle('db:review-finding-add', async (_event, raw: unknown) => {
    const v = safeValidate(validateReviewFindingInput, raw)
    if (!v.ok) return { success: false, error: v.error }
    try {
      return { success: true, id: ReviewFindingRepository.add(v.data) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:review-finding-add-many', async (_event, raw: unknown) => {
    if (!Array.isArray(raw)) return { success: false, error: 'EXPECTED_ARRAY' }
    if (raw.length > 500) return { success: false, error: 'TOO_MANY_FINDINGS' }
    const items = []
    for (let i = 0; i < raw.length; i++) {
      const v = safeValidate((item) => validateReviewFindingInput(item, `findings[${i}]`), raw[i])
      if (!v.ok) return { success: false, error: v.error }
      items.push(v.data)
    }
    try {
      return { success: true, ids: ReviewFindingRepository.addMany(items) }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:review-finding-list', async (
    _event,
    chapterNumber: number,
    status?: ReviewFindingStatus,
  ) => {
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) return []
    if (status !== undefined && !(VALID_FINDING_STATUSES as readonly string[]).includes(status)) return []
    return ReviewFindingRepository.listByChapter(chapterNumber, status)
  })
  ipcMain.handle('db:review-finding-update-status', async (_event, id: number, status: ReviewFindingStatus) => {
    if (!Number.isSafeInteger(id) || id < 1) return { success: false, error: 'INVALID_ID' }
    if (!(VALID_FINDING_STATUSES as readonly string[]).includes(status)) {
      return { success: false, error: 'INVALID_FINDING_STATUS' }
    }
    try {
      ReviewFindingRepository.updateStatus(id, status)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:review-finding-delete', async (_event, id: number) => {
    if (!Number.isSafeInteger(id) || id < 1) return { success: false, error: 'INVALID_ID' }
    try {
      ReviewFindingRepository.delete(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:review-finding-clear-stage', async (_event, chapterNumber: number, stage: string) => {
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) {
      return { success: false, error: 'INVALID_CHAPTER_NUMBER' }
    }
    if (typeof stage !== 'string' || !stage) return { success: false, error: 'INVALID_FINDING_STAGE' }
    try {
      ReviewFindingRepository.clearChapterStage(chapterNumber, stage)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:review-finding-count-open-errors', async (_event, chapterNumber: number) => {
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) return 0
    return ReviewFindingRepository.countOpenErrors(chapterNumber)
  })

  // ===== P3 章节流水线：定稿写回（单事务） =====
  ipcMain.handle('db:finalize-writeback', async (_event, input: FinalizeWritebackInput) => {
    return executeFinalizeWriteback(input)
  })

  // ===== P2 中控 AI：改动计划执行（单事务） =====
  ipcMain.handle('db:mutation-plan-execute', async (_event, plan: unknown, options?: MutationPlanExecutionOptions) => {
    const skipStepIds = Array.isArray(options?.skipStepIds)
      ? options.skipStepIds.filter((id): id is string => typeof id === 'string')
      : undefined
    return executeMutationPlan(plan, { skipStepIds })
  })
  ipcMain.handle('db:mutation-plan-preview', async (_event, plan: unknown) => {
    return previewMutationPlan(plan)
  })
}
