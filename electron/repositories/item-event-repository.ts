/**
 * ItemEventRepository — 道具流转事件 (canon_item_events 表，P3-6)
 *
 * 定稿写回时由角色 keyItems 的前后差异推导：
 *   新增道具 → acquire，消失道具 → lose。
 * 表由 v2→v3 迁移创建，唯一索引保证重复执行不产生重复事件。
 *
 * DR-02 已定稿：目前只记录取得/失去；use / consume / grant / destroy
 * 需要 LLM 抽取结构化道具事件后再补齐。
 */
import { getProjectDb } from '../database'

export const ITEM_EVENT_TYPES = ['acquire', 'lose', 'use', 'consume', 'grant', 'destroy'] as const
export type ItemEventType = (typeof ITEM_EVENT_TYPES)[number]

export interface CanonItemEvent {
  id: number
  chapterNumber: number
  entityId: string
  itemName: string
  eventType: ItemEventType
  note: string
  createdAt: string
}

export interface CanonItemEventInput {
  chapterNumber: number
  entityId: string
  itemName: string
  eventType: ItemEventType
  note?: string
}

interface ItemEventRow {
  id: number
  chapter_number: number
  entity_id: string
  item_name: string
  event_type: string
  note: string
  created_at: string
}

function rowToData(row: ItemEventRow): CanonItemEvent {
  return {
    id: row.id,
    chapterNumber: row.chapter_number,
    entityId: row.entity_id,
    itemName: row.item_name,
    eventType: (ITEM_EVENT_TYPES as readonly string[]).includes(row.event_type)
      ? row.event_type as ItemEventType
      : 'acquire',
    note: row.note,
    createdAt: row.created_at,
  }
}

function assertInput(input: CanonItemEventInput): void {
  if (!Number.isSafeInteger(input.chapterNumber) || input.chapterNumber < 1) {
    throw new Error('INVALID_CHAPTER_NUMBER')
  }
  if (!input.entityId) throw new Error('INVALID_ENTITY_ID')
  if (!input.itemName) throw new Error('INVALID_ITEM_NAME')
  if (!(ITEM_EVENT_TYPES as readonly string[]).includes(input.eventType)) {
    throw new Error('INVALID_ITEM_EVENT_TYPE')
  }
}

export class ItemEventRepository {
  /**
   * 用给定事件替换该章的既有记录（在调用方事务内执行）。
   * 唯一索引兜底：同章/同实体/同道具/同类型不会重复。
   */
  static replaceChapter(chapterNumber: number, events: CanonItemEventInput[]): number {
    const db = getProjectDb()
    if (!db) throw new Error('PROJECT_CLOSED')
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) throw new Error('INVALID_CHAPTER_NUMBER')

    db.prepare('DELETE FROM canon_item_events WHERE chapter_number = ?').run(chapterNumber)
    const insert = db.prepare(`
      INSERT OR IGNORE INTO canon_item_events (
        chapter_number, entity_id, item_name, event_type, note
      ) VALUES (?, ?, ?, ?, ?)
    `)
    let inserted = 0
    for (const event of events) {
      if (event.chapterNumber !== chapterNumber) continue
      assertInput(event)
      inserted += insert.run(
        event.chapterNumber,
        event.entityId,
        event.itemName,
        event.eventType,
        event.note ?? '',
      ).changes
    }
    return inserted
  }

  static listByChapter(chapterNumber: number): CanonItemEvent[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      'SELECT * FROM canon_item_events WHERE chapter_number = ? ORDER BY id ASC',
    ).all(chapterNumber) as ItemEventRow[]
    return rows.map(rowToData)
  }

  /** 某道具的全部流转记录（按章节升序），供「出现章节」与归属回溯 */
  static listByItem(itemName: string): CanonItemEvent[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      'SELECT * FROM canon_item_events WHERE item_name = ? ORDER BY chapter_number ASC, id ASC',
    ).all(itemName) as ItemEventRow[]
    return rows.map(rowToData)
  }
}
