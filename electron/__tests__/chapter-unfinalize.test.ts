import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initProjectDatabase, closeProjectDatabase, getProjectDb } from '../database'
import { DraftRepository } from '../repositories/draft-repository'
import { PipelineRepository } from '../repositories/pipeline-repository'
import { executeChapterUnfinalize } from '../services/chapter-unfinalize'

/**
 * 取消定稿：
 *   - 只允许当前最新定稿章
 *   - 取消后草稿退回 draft、流水线退回 deaiified
 *   - 重复取消被拒绝（幂等保护）
 */
describe('取消定稿', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moshu-unfinalize-'))
    initProjectDatabase(projectDir)
  })

  afterEach(() => {
    closeProjectDatabase()
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  const createFinalizedDraft = (chapterNumber: number, version: number) => {
    const db = getProjectDb()!
    const contentId = Number(db.prepare(`INSERT INTO contents (body) VALUES (?)`).run(`ch${chapterNumber}-v${version}`).lastInsertRowid)
    return Number(db.prepare(`
      INSERT INTO drafts (chapter_number, version, status, content_id, word_count)
      VALUES (?, ?, 'finalized', ?, 100)
    `).run(chapterNumber, version, contentId).lastInsertRowid)
  }

  it('拒绝取消非最新定稿章', async () => {
    createFinalizedDraft(1, 1)
    createFinalizedDraft(2, 1)

    await expect(executeChapterUnfinalize(1)).rejects.toThrow(/UNFINALIZE_NOT_LATEST/)
    expect(DraftRepository.getMaxFinalizedChapter()).toBe(2)
  })

  it('取消最新定稿章：草稿退回 draft，流水线退回 deaiified', async () => {
    createFinalizedDraft(1, 1)
    getProjectDb()!.prepare(`
      INSERT INTO chapter_pipeline (chapter_number, stage) VALUES (1, 'writeback_done')
    `).run()

    const result = await executeChapterUnfinalize(1)

    expect(result.chapterNumber).toBe(1)
    expect(result.backupFile).toBeTruthy()
    expect(DraftRepository.getFinalizedByChapter(1)).toBeNull()
    expect(PipelineRepository.get(1)?.stage).toBe('deaiified')
    expect(DraftRepository.getMaxFinalizedChapter()).toBe(0)
  })

  it('重复取消同一章会被拒绝', async () => {
    createFinalizedDraft(1, 1)
    await executeChapterUnfinalize(1)

    await expect(executeChapterUnfinalize(1)).rejects.toThrow(/CHAPTER_NOT_FINALIZED/)
  })
})
