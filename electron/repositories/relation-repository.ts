/**
 * RelationRepository — 关系网 (entity_relations 表)
 *
 * 以 (from_id, to_id, relation_type) 为唯一键；from_id / to_id 是实体标识
 * （资产 id、角色名等，具体命名由调用方约定）。
 */
import { getProjectDb } from '../database'

export const RELATION_STATUSES = ['active', 'broken', 'paused', 'ended'] as const
export type RelationStatus = (typeof RELATION_STATUSES)[number]

export interface EntityRelation {
  fromId: string
  toId: string
  relationType: string
  affection: number
  status: RelationStatus
  sinceChapter: number
  lastChangedChapter: number
  note: string
  updatedAt: string
}

export interface EntityRelationInput {
  fromId: string
  toId: string
  relationType: string
  affection?: number
  status?: RelationStatus
  sinceChapter?: number
  lastChangedChapter?: number
  note?: string
}

interface RelationRow {
  from_id: string
  to_id: string
  relation_type: string
  affection: number
  status: string
  since_chapter: number
  last_changed_chapter: number
  note: string
  updated_at: string
}

const MAX_ID_LEN = 200
const MAX_TYPE_LEN = 100
const MAX_NOTE_LEN = 2000

function rowToData(row: RelationRow): EntityRelation {
  return {
    fromId: row.from_id,
    toId: row.to_id,
    relationType: row.relation_type,
    affection: row.affection ?? 0,
    status: (RELATION_STATUSES as readonly string[]).includes(row.status)
      ? row.status as RelationStatus
      : 'active',
    sinceChapter: row.since_chapter ?? 0,
    lastChangedChapter: row.last_changed_chapter ?? 0,
    note: row.note ?? '',
    updatedAt: row.updated_at,
  }
}

function normalize(input: EntityRelationInput) {
  const fromId = (input.fromId ?? '').trim()
  const toId = (input.toId ?? '').trim()
  const relationType = (input.relationType ?? '').trim()
  if (!fromId || fromId.length > MAX_ID_LEN) throw new Error('INVALID_RELATION_FROM')
  if (!toId || toId.length > MAX_ID_LEN) throw new Error('INVALID_RELATION_TO')
  if (fromId === toId) throw new Error('SELF_RELATION')
  if (!relationType || relationType.length > MAX_TYPE_LEN) throw new Error('INVALID_RELATION_TYPE')
  const status = input.status ?? 'active'
  if (!(RELATION_STATUSES as readonly string[]).includes(status)) throw new Error('INVALID_RELATION_STATUS')
  const affection = input.affection ?? 0
  if (!Number.isSafeInteger(affection)) throw new Error('INVALID_RELATION_AFFECTION')
  const sinceChapter = input.sinceChapter ?? 0
  const lastChangedChapter = input.lastChangedChapter ?? sinceChapter
  if (!Number.isSafeInteger(sinceChapter) || sinceChapter < 0
    || !Number.isSafeInteger(lastChangedChapter) || lastChangedChapter < 0) {
    throw new Error('INVALID_RELATION_CHAPTER')
  }
  const note = input.note ?? ''
  if (note.length > MAX_NOTE_LEN) throw new Error('RELATION_NOTE_TOO_LONG')
  return { fromId, toId, relationType, affection, status, sinceChapter, lastChangedChapter, note }
}

export class RelationRepository {
  /** 关系列表；传 fromId 只看该实体发出的关系 */
  static list(fromId?: string): EntityRelation[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = fromId
      ? db.prepare('SELECT * FROM entity_relations WHERE from_id = ? ORDER BY to_id ASC, relation_type ASC').all(fromId)
      : db.prepare('SELECT * FROM entity_relations ORDER BY from_id ASC, to_id ASC, relation_type ASC').all()
    return (rows as RelationRow[]).map(rowToData)
  }

  /** 与某实体相关的全部关系（双向） */
  static listForEntity(entityId: string): EntityRelation[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      'SELECT * FROM entity_relations WHERE from_id = ? OR to_id = ? ORDER BY relation_type ASC',
    ).all(entityId, entityId)
    return (rows as RelationRow[]).map(rowToData)
  }

  static get(fromId: string, toId: string, relationType: string): EntityRelation | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare(
      'SELECT * FROM entity_relations WHERE from_id = ? AND to_id = ? AND relation_type = ?',
    ).get(fromId, toId, relationType) as RelationRow | undefined
    return row ? rowToData(row) : null
  }

  static upsert(input: EntityRelationInput): EntityRelation {
    const db = getProjectDb()
    if (!db) throw new Error('PROJECT_CLOSED')
    const data = normalize(input)
    db.prepare(`
      INSERT INTO entity_relations (
        from_id, to_id, relation_type, affection, status,
        since_chapter, last_changed_chapter, note, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(from_id, to_id, relation_type) DO UPDATE SET
        affection = excluded.affection,
        status = excluded.status,
        since_chapter = excluded.since_chapter,
        last_changed_chapter = excluded.last_changed_chapter,
        note = excluded.note,
        updated_at = datetime('now')
    `).run(
      data.fromId, data.toId, data.relationType, data.affection, data.status,
      data.sinceChapter, data.lastChangedChapter, data.note,
    )
    const saved = RelationRepository.get(data.fromId, data.toId, data.relationType)
    if (!saved) throw new Error('RELATION_WRITE_FAILED')
    return saved
  }

  static delete(fromId: string, toId: string, relationType: string): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare('DELETE FROM entity_relations WHERE from_id = ? AND to_id = ? AND relation_type = ?')
      .run(fromId, toId, relationType)
  }

  /** 删除与某实体相关的全部关系（实体被删时联动清理） */
  static deleteForEntity(entityId: string): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare('DELETE FROM entity_relations WHERE from_id = ? OR to_id = ?').run(entityId, entityId)
  }
}
