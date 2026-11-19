import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initProjectDatabase, closeProjectDatabase, getProjectDb } from '../database'
import { DraftRepository } from '../repositories/draft-repository'

/**
 * 定稿唯一性：同一章任何时刻只能有一个 status='finalized'；
 * 新版本定稿时，旧定稿自动降级为 archived，仍可在版本历史里回退。
 */
describe('定稿唯一性', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moshu-finalize-'))
    initProjectDatabase(projectDir)
  })

  afterEach(() => {
    closeProjectDatabase()
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  const createDraft = (chapterNumber: number, version: number, status: string) => {
    const db = getProjectDb()!
    const contentId = Number(db.prepare(`INSERT INTO contents (body) VALUES (?)`).run(`v${version}`).lastInsertRowid)
    return Number(db.prepare(`
      INSERT INTO drafts (chapter_number, version, status, content_id, word_count)
      VALUES (?, ?, ?, ?, 100)
    `).run(chapterNumber, version, status, contentId).lastInsertRowid)
  }

  it('finalizeExclusive 会把同章旧定稿降级，并只保留目标版本', () => {
    const v1 = createDraft(1, 1, 'finalized')
    const v2 = createDraft(1, 2, 'draft')
    const v3 = createDraft(1, 3, 'draft')

    DraftRepository.finalizeExclusive(1, v2, 120)
    let rows = getProjectDb()!.prepare(`SELECT id, status FROM drafts WHERE chapter_number = 1 ORDER BY version`).all() as Array<{ id: number; status: string }>
    expect(rows).toEqual([
      { id: v1, status: 'archived' },
      { id: v2, status: 'finalized' },
      { id: v3, status: 'draft' },
    ])
    expect(DraftRepository.getFinalizedByChapter(1)?.id).toBe(v2)

    DraftRepository.finalizeExclusive(1, v3, 140)
    rows = getProjectDb()!.prepare(`SELECT id, status FROM drafts WHERE chapter_number = 1 ORDER BY version`).all() as Array<{ id: number; status: string }>
    expect(rows).toEqual([
      { id: v1, status: 'archived' },
      { id: v2, status: 'archived' },
      { id: v3, status: 'finalized' },
    ])
    expect(DraftRepository.getFinalizedByChapter(1)?.id).toBe(v3)

    const finalizedCount = (getProjectDb()!.prepare(`
      SELECT COUNT(*) AS n FROM drafts WHERE chapter_number = 1 AND status = 'finalized'
    `).get() as { n: number }).n
    expect(finalizedCount).toBe(1)
  })
})
