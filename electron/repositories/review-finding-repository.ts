/**
 * ReviewFindingRepository — 审稿台账 (review_findings 表)
 *
 * 每条 finding 记录「哪一章、哪个阶段、哪类问题、严重程度、证据与定位提示」。
 * 审稿闸门（P3）据此判定章节能否进入下一阶段。
 */
import { getProjectDb } from '../database'

export const REVIEW_SEVERITIES = ['error', 'warning', 'info'] as const
export type ReviewSeverity = (typeof REVIEW_SEVERITIES)[number]

export const REVIEW_FINDING_STATUSES = ['open', 'fixed', 'ignored'] as const
export type ReviewFindingStatus = (typeof REVIEW_FINDING_STATUSES)[number]

export interface ReviewFinding {
  id: number
  chapterNumber: number
  draftId: string
  stage: string
  category: string
  severity: ReviewSeverity
  message: string
  evidence: string
  locationHint: string
  status: ReviewFindingStatus
  createdAt: string
}

export interface ReviewFindingInput {
  chapterNumber: number
  draftId?: string
  stage: string
  category: string
  severity: ReviewSeverity
  message: string
  evidence?: string
  locationHint?: string
}

interface FindingRow {
  id: number
  chapter_number: number
  draft_id: string
  stage: string
  category: string
  severity: string
  message: string
  evidence: string
  location_hint: string
  status: string
  created_at: string
}

const MAX_FIELD_LEN = 5000
const MAX_LIST_SIZE = 500

function rowToData(row: FindingRow): ReviewFinding {
  return {
    id: row.id,
    chapterNumber: row.chapter_number,
    draftId: row.draft_id ?? '',
    stage: row.stage,
    category: row.category,
    severity: (REVIEW_SEVERITIES as readonly string[]).includes(row.severity)
      ? row.severity as ReviewSeverity
      : 'info',
    message: row.message,
    evidence: row.evidence ?? '',
    locationHint: row.location_hint ?? '',
    status: (REVIEW_FINDING_STATUSES as readonly string[]).includes(row.status)
      ? row.status as ReviewFindingStatus
      : 'open',
    createdAt: row.created_at,
  }
}

function normalize(input: ReviewFindingInput) {
  if (!Number.isSafeInteger(input.chapterNumber) || input.chapterNumber < 1) {
    throw new Error('INVALID_CHAPTER_NUMBER')
  }
  if (!input.stage || input.stage.length > 100) throw new Error('INVALID_FINDING_STAGE')
  if (!input.category || input.category.length > 100) throw new Error('INVALID_FINDING_CATEGORY')
  if (!(REVIEW_SEVERITIES as readonly string[]).includes(input.severity)) {
    throw new Error('INVALID_FINDING_SEVERITY')
  }
  if (!input.message || input.message.length > MAX_FIELD_LEN) throw new Error('INVALID_FINDING_MESSAGE')
  const optional = (v: string | undefined) => {
    const text = v ?? ''
    if (text.length > MAX_FIELD_LEN) throw new Error('FINDING_TEXT_TOO_LONG')
    return text
  }
  return {
    chapterNumber: input.chapterNumber,
    draftId: optional(input.draftId),
    stage: input.stage,
    category: input.category,
    severity: input.severity,
    message: input.message,
    evidence: optional(input.evidence),
    locationHint: optional(input.locationHint),
  }
}

export class ReviewFindingRepository {
  /** 新增一条 finding，返回 id */
  static add(input: ReviewFindingInput): number {
    const db = getProjectDb()
    if (!db) throw new Error('PROJECT_CLOSED')
    const data = normalize(input)
    const info = db.prepare(`
      INSERT INTO review_findings (
        chapter_number, draft_id, stage, category, severity,
        message, evidence, location_hint, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')
    `).run(
      data.chapterNumber, data.draftId, data.stage, data.category, data.severity,
      data.message, data.evidence, data.locationHint,
    )
    return Number(info.lastInsertRowid)
  }

  /** 批量新增（同一章的一次审稿），事务写入 */
  static addMany(items: ReviewFindingInput[]): number[] {
    const db = getProjectDb()
    if (!db) throw new Error('PROJECT_CLOSED')
    if (!Array.isArray(items) || items.length > MAX_LIST_SIZE) throw new Error('TOO_MANY_FINDINGS')
    return db.transaction(() => items.map((item) => ReviewFindingRepository.add(item)))()
  }

  /** 章节的全部 findings（可按状态筛选），新建在前 */
  static listByChapter(chapterNumber: number, status?: ReviewFindingStatus): ReviewFinding[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = status
      ? db.prepare('SELECT * FROM review_findings WHERE chapter_number = ? AND status = ? ORDER BY id DESC')
        .all(chapterNumber, status)
      : db.prepare('SELECT * FROM review_findings WHERE chapter_number = ? ORDER BY id DESC')
        .all(chapterNumber)
    return (rows as FindingRow[]).map(rowToData)
  }

  /** 草稿的全部 findings */
  static listByDraft(draftId: string): ReviewFinding[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare('SELECT * FROM review_findings WHERE draft_id = ? ORDER BY id DESC').all(draftId)
    return (rows as FindingRow[]).map(rowToData)
  }

  /** 某章节未解决的 error 条数（审稿闸门用） */
  static countOpenErrors(chapterNumber: number): number {
    const db = getProjectDb()
    if (!db) return 0
    const row = db.prepare(`
      SELECT COUNT(*) AS n FROM review_findings
      WHERE chapter_number = ? AND status = 'open' AND severity = 'error'
    `).get(chapterNumber) as { n: number }
    return row.n
  }

  static updateStatus(id: number, status: ReviewFindingStatus): void {
    const db = getProjectDb()
    if (!db) throw new Error('PROJECT_CLOSED')
    if (!(REVIEW_FINDING_STATUSES as readonly string[]).includes(status)) {
      throw new Error('INVALID_FINDING_STATUS')
    }
    db.prepare('UPDATE review_findings SET status = ? WHERE id = ?').run(status, id)
  }

  static delete(id: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare('DELETE FROM review_findings WHERE id = ?').run(id)
  }

  /** 清空某章的 findings（重新审稿前） */
  static clearChapter(chapterNumber: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare('DELETE FROM review_findings WHERE chapter_number = ?').run(chapterNumber)
  }

  /**
   * 清空某章某一阶段的 findings（重跑该阶段审稿前）。
   * 只清指定 stage，保留另一阶段（规则 / LLM）的结论。
   */
  static clearChapterStage(chapterNumber: number, stage: string): void {
    const db = getProjectDb()
    if (!db) return
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) return
    if (!stage) return
    db.prepare('DELETE FROM review_findings WHERE chapter_number = ? AND stage = ?')
      .run(chapterNumber, stage)
  }
}
