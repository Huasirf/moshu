/**
 * 取消定稿（主进程）
 *
 * 只允许取消「当前最新的定稿章」，把一章从定稿态完整回滚到 deaiified：
 *   - 先自动备份数据库
 *   - 数据库清理在单个事务内完成，任一步失败整体回滚
 *   - 物理正文文件与知识库文档在事务提交后删除，失败记为可重试警告
 *
 * 清理范围与定稿写入一一对应（见 finalize-chapter.command.ts / finalize-writeback.ts）：
 *   草稿状态、流水线阶段、蓝图 notes/status、Canon 摘要/时间轴/事实/剧情线、
 *   角色状态快照与变更流水、本章属性值/道具事件、本章新植与回收的伏笔、
 *   卷末卷摘要与全书摘要、后处理跑批记录；下游 N+1..N+5 蓝图标 stale。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { getProjectDb, getCurrentProjectPath } from '../database'
import { backupNow } from '../db-auto-backup'
import { DraftRepository } from '../repositories/draft-repository'
import { PipelineRepository } from '../repositories/pipeline-repository'
import { BlueprintRepository } from '../repositories/blueprint-repository'
import { CanonRepository } from '../repositories/canon-repository'
import { AttributeRepository } from '../repositories/attribute-repository'
import { ItemEventRepository } from '../repositories/item-event-repository'
import { CharacterRepository } from '../repositories/character-repository'
import { CharacterHistoryRepository } from '../repositories/character-history-repository'
import { ForeshadowingRepository } from '../repositories/foreshadowing-repository'
import { PostProcessRepository } from '../repositories/post-process-repository'
import {
  finalizedChapterFileName,
  chapterSummaryFileName,
} from '../../src/services/workflows/chapter-file-name'
import { ARC_SIZE, arcRangeOf, isArcEnd } from '../../src/services/narrative-consistency'

/** 手动备份保留份数（与 db-controller 中保持一致） */
const MANUAL_BACKUP_KEEP = 20
/** 下游蓝图过期标记的传播范围（DR-07） */
const STALE_PROPAGATION = 5

export interface ChapterUnfinalizeResult {
  chapterNumber: number
  /** 自动备份文件路径 */
  backupFile: string
  /** 已删除的物理文件（项目根正文） */
  removedFiles: string[]
  /** 已从知识库移除的文档名 */
  removedKbDocs: string[]
  /** 可重试的非致命警告（文件/知识库删除失败、快照缺失等） */
  warnings: string[]
}

function assertChapter(chapterNumber: number): number {
  if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) {
    throw new Error('INVALID_CHAPTER_NUMBER')
  }
  return chapterNumber
}

/**
 * 取消定稿。返回清理结果；校验失败直接抛错（调用方转成 UI 提示）。
 */
export async function executeChapterUnfinalize(chapterNumber: number): Promise<ChapterUnfinalizeResult> {
  const chapter = assertChapter(chapterNumber)
  const db = getProjectDb()
  const projectPath = getCurrentProjectPath()
  if (!db || !projectPath) throw new Error('PROJECT_CLOSED')

  const finalizedDraft = DraftRepository.getFinalizedByChapter(chapter)
  if (!finalizedDraft) throw new Error('CHAPTER_NOT_FINALIZED')
  const maxFinalized = DraftRepository.getMaxFinalizedChapter()
  if (maxFinalized !== chapter) {
    throw new Error(`UNFINALIZE_NOT_LATEST: ${chapter} (latest=${maxFinalized})`)
  }

  // 先备份：备份失败直接中止，避免不可逆清理
  const backupFile = await backupNow(db, projectPath, 'manual', MANUAL_BACKUP_KEEP)

  const blueprint = BlueprintRepository.getByChapter(chapter)
  const title = blueprint?.title ?? ''
  const warnings: string[] = []

  // 第 N-1 章的角色快照是回滚角色当前状态的唯一依据
  const snapshots = CharacterHistoryRepository.getSnapshotMap(Math.max(0, chapter - 1))
  let deletedArcStart: number | null = null

  db.transaction(() => {
    DraftRepository.unfinalize(chapter)
    PipelineRepository.unfinalize(chapter)

    // 蓝图：清空本章派生要点，状态回到 deaiified（与流水线一致）
    if (blueprint) {
      BlueprintRepository.upsert({ ...blueprint, notes: '', status: 'deaiified' })
    }

    // Canon：摘要 / 时间轴（自动抽取）/ 事实 / 剧情线
    CanonRepository.deleteSummary(chapter)
    CanonRepository.clearChapterExtractedTimeline(chapter)
    CanonRepository.clearChapterFacts(chapter)
    CanonRepository.revertPlotLinesForChapter(chapter)

    // 角色：属性值、道具事件、章节快照与变更流水
    AttributeRepository.deleteChapterValues(chapter)
    ItemEventRepository.replaceChapter(chapter, [])
    CharacterHistoryRepository.deleteChapter(chapter)

    // 角色卡 currentState：按第 N-1 章快照恢复；缺快照的角色跳过并告警
    for (const character of CharacterRepository.getAll()) {
      if (character.currentState?.updatedAtChapter !== chapter) continue
      const snapshot = snapshots[character.name]
      if (!snapshot) {
        warnings.push(`角色「${character.name}」缺少第 ${Math.max(1, chapter - 1)} 章快照，当前状态未回滚`)
        continue
      }
      CharacterRepository.updateState(character.name, {
        location: snapshot.location || '',
        powerLevel: snapshot.powerLevel || '',
        physicalState: snapshot.physicalState || '',
        mentalState: snapshot.mentalState || '',
        keyItems: snapshot.keyItems || '',
        recentEvents: snapshot.recentEvents || '',
        knownInfo: snapshot.knownInfo || '',
        talents: snapshot.talents || [],
        skills: snapshot.skills || [],
        updatedAtChapter: snapshot.updatedAtChapter || Math.max(1, chapter - 1),
      })
    }
    CanonRepository.rollbackCharacterStates(chapter, snapshots)

    // 伏笔：删除本章新植，撤销本章回收
    ForeshadowingRepository.deleteByPlantedChapter(chapter)
    ForeshadowingRepository.revertPaidChapter(chapter)

    // 卷末章：本次生成的卷摘要与全书摘要都已过期
    if (isArcEnd(chapter) && ARC_SIZE > 0) {
      const [arcStart] = arcRangeOf(chapter)
      CanonRepository.deleteArcSummary(arcStart)
      CanonRepository.deleteBookSummary()
      deletedArcStart = arcStart
    }

    // 后处理跑批记录
    PostProcessRepository.deleteBySource('chapter_finalize', String(chapter))

    // 下游蓝图待刷新（按 N+1..N+5 区间传播）
    BlueprintRepository.markStale(
      Array.from({ length: STALE_PROPAGATION }, (_, i) => chapter + 1 + i),
    )
  })()

  if (deletedArcStart !== null) {
    warnings.push(`已删除第 ${deletedArcStart} 卷摘要与全书摘要，下次卷末定稿时会重新生成`)
  }

  // ── 事务提交后的外部清理：失败只记警告，可重试 ──
  const removedFiles: string[] = []
  const contentFileName = finalizedChapterFileName(chapter, title)
  const physicalPath = path.join(projectPath, contentFileName)
  try {
    await fs.unlink(physicalPath)
    removedFiles.push(contentFileName)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      warnings.push(`正文文件删除失败：${contentFileName}（${String(error)}）`)
    }
  }

  const removedKbDocs: string[] = []
  const expectedDocs = new Set([
    contentFileName,
    chapterSummaryFileName(chapter, title),
  ])
  try {
    const { listDocuments, removeDocument } = await import('../knowledge-base')
    const docs = await listDocuments(projectPath) as Array<{ id: string; fileName: string }>
    for (const doc of docs) {
      if (!expectedDocs.has(doc.fileName)) continue
      const ok = await removeDocument(doc.id, projectPath)
      if (ok) removedKbDocs.push(doc.fileName)
      else warnings.push(`知识库文档删除失败：${doc.fileName}`)
    }
  } catch (error) {
    warnings.push(`知识库清理失败：${String(error)}`)
  }

  return {
    chapterNumber: chapter,
    backupFile,
    removedFiles,
    removedKbDocs,
    warnings,
  }
}
