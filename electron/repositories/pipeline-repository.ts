/**
 * PipelineRepository — 章节流水线状态机 (chapter_pipeline 表)
 *
 * 每章一行，记录当前所处阶段；阶段取值见 src/shared/chapter-stage.ts。
 * 与 blueprints.status 的关系：blueprints.status 是冗余缓存，以本表为准。
 */
import { getProjectDb } from '../database'
import {
  CHAPTER_STAGES,
  checkStageTransition,
  type ChapterStage,
} from '../../src/shared/chapter-stage'

export interface ChapterPipelineState {
  chapterNumber: number
  stage: ChapterStage
  updatedAt: string
}

interface PipelineRow {
  chapter_number: number
  stage: string
  updated_at: string
}

function rowToData(row: PipelineRow): ChapterPipelineState {
  return {
    chapterNumber: row.chapter_number,
    stage: (CHAPTER_STAGES as readonly string[]).includes(row.stage)
      ? row.stage as ChapterStage
      : 'planned',
    updatedAt: row.updated_at,
  }
}

function assertChapter(chapterNumber: number): number {
  if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) throw new Error('INVALID_CHAPTER_NUMBER')
  return chapterNumber
}

function assertStage(stage: string): ChapterStage {
  if (!(CHAPTER_STAGES as readonly string[]).includes(stage)) throw new Error('INVALID_CHAPTER_STAGE')
  return stage as ChapterStage
}

export class PipelineRepository {
  static get(chapterNumber: number): ChapterPipelineState | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare('SELECT * FROM chapter_pipeline WHERE chapter_number = ?')
      .get(chapterNumber) as PipelineRow | undefined
    return row ? rowToData(row) : null
  }

  /** 全部章节状态（按章节号升序） */
  static getAll(): ChapterPipelineState[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare('SELECT * FROM chapter_pipeline ORDER BY chapter_number ASC').all()
    return (rows as PipelineRow[]).map(rowToData)
  }

  /**
   * 设置章节阶段（不存在则插入）。
   *
   * 走 `checkStageTransition` 守卫：只允许同阶段或前进一步，
   * 未 `deaiified` 的章节不能直接进入 `reviewed`。工作流推进与
   * MutationPlan 的 `set_pipeline_stage` 共用这一入口，避免两套规则。
   */
  static setStage(chapterNumber: number, stage: ChapterStage): ChapterPipelineState {
    const db = getProjectDb()
    if (!db) throw new Error('PROJECT_CLOSED')
    const chapter = assertChapter(chapterNumber)
    const next = assertStage(stage)
    const current = PipelineRepository.get(chapter)?.stage ?? null
    const violation = checkStageTransition(current, next)
    if (violation) {
      throw new Error(`INVALID_STAGE_TRANSITION: ${current ?? 'planned'} -> ${next} (${violation})`)
    }
    db.prepare(`
      INSERT INTO chapter_pipeline (chapter_number, stage, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(chapter_number) DO UPDATE SET
        stage = excluded.stage,
        updated_at = datetime('now')
    `).run(chapter, next)
    const saved = PipelineRepository.get(chapter)
    if (!saved) throw new Error('PIPELINE_WRITE_FAILED')
    return saved
  }

  /**
   * 回退一步（DR-03）。
   *
   * 只允许退一个阶段，且必须显式传入当前阶段做乐观校验：
   * 界面上确认框展示的是旧阶段，若期间流程已推进（如审稿完成），
   * 直接按旧值回退会退多步或退错方向，因此这里拒绝执行。
   */
  static rewind(
    chapterNumber: number,
    expectedStage: ChapterStage,
  ): ChapterPipelineState {
    const db = getProjectDb()
    if (!db) throw new Error('PROJECT_CLOSED')
    const chapter = assertChapter(chapterNumber)
    const expected = assertStage(expectedStage)
    const current = PipelineRepository.get(chapter)
    if (!current) throw new Error('PIPELINE_NOT_FOUND')
    if (current.stage !== expected) {
      throw new Error(`STAGE_STALE: ${current.stage} != ${expected}`)
    }
    const index = CHAPTER_STAGES.indexOf(current.stage)
    if (index <= 0) throw new Error('STAGE_REWIND_AT_START')
    const target = CHAPTER_STAGES[index - 1]
    db.prepare(`
      UPDATE chapter_pipeline SET stage = ?, updated_at = datetime('now')
      WHERE chapter_number = ?
    `).run(target, chapter)
    const saved = PipelineRepository.get(chapter)
    if (!saved) throw new Error('PIPELINE_WRITE_FAILED')
    return saved
  }

  /**
   * 取消定稿：把阶段直接退回 `deaiified`（重新生成/审校的起点）。
   *
   * 这是唯一允许跨阶段回退的入口，仅供「取消定稿」使用；
   * 常规回退仍走 `rewind` 的单步可校验路径。
   */
  static unfinalize(chapterNumber: number): ChapterPipelineState | null {
    const db = getProjectDb()
    if (!db) return null
    const chapter = assertChapter(chapterNumber)
    const current = PipelineRepository.get(chapter)
    if (!current) return null
    db.prepare(`
      UPDATE chapter_pipeline SET stage = 'deaiified', updated_at = datetime('now')
      WHERE chapter_number = ?
    `).run(chapter)
    return PipelineRepository.get(chapter)
  }

  static delete(chapterNumber: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare('DELETE FROM chapter_pipeline WHERE chapter_number = ?').run(chapterNumber)
  }
}
