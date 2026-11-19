/**
 * AssetRepository — 资产总表 (canon_items 表)
 *
 * 用 entity_type 区分资产类别：item / location / skill / faction / secret / number。
 * 角色（character）仍以 characters 表为准，这里的实体类型位只为统一引用口径保留。
 * type_data_json 存各类型专属字段（如 number 的 value、skill 的等级），写入前做校验。
 */
import { getProjectDb } from '../database'

export const ASSET_ENTITY_TYPES = [
  'character', 'item', 'location', 'skill', 'faction', 'secret', 'number',
] as const
export type AssetEntityType = (typeof ASSET_ENTITY_TYPES)[number]

export const ASSET_STATUSES = ['active', 'inactive', 'archived'] as const
export type AssetStatus = (typeof ASSET_STATUSES)[number]

/** 章节引用资产的期望动作（蓝图 asset_refs 用） */
export const ASSET_REF_EXPECTS = [
  'appear', 'enter', 'acquire', 'lose', 'use', 'consume', 'conflict', 'resolve', 'mention',
] as const
export type AssetRefExpect = (typeof ASSET_REF_EXPECTS)[number]

/** 蓝图层 asset_refs 的单项结构 */
export interface AssetRef {
  type: AssetEntityType
  id: string
  expect: AssetRefExpect
}

export interface AssetData {
  id: number
  entityType: AssetEntityType
  name: string
  summary: string
  description: string
  status: AssetStatus
  firstChapter: number
  lastChapter: number
  tags: string[]
  typeData: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface AssetInput {
  id?: number
  entityType: AssetEntityType
  name: string
  summary?: string
  description?: string
  status?: AssetStatus
  firstChapter?: number
  lastChapter?: number
  tags?: string[]
  typeData?: Record<string, unknown>
}

interface AssetRow {
  id: number
  entity_type: string
  name: string
  summary: string
  description: string
  status: string
  first_chapter: number
  last_chapter: number
  tags_json: string
  type_data_json: string
  created_at: string
  updated_at: string
}

const MAX_NAME_LEN = 200
const MAX_TEXT_LEN = 20_000
const MAX_TYPE_DATA_LEN = 100_000
const MAX_TAGS = 50
const MAX_TAG_LEN = 50

function safeParse<T>(json: string, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) as T } catch { return fallback }
}

function rowToData(row: AssetRow): AssetData {
  return {
    id: row.id,
    entityType: (ASSET_ENTITY_TYPES as readonly string[]).includes(row.entity_type)
      ? row.entity_type as AssetEntityType
      : 'item',
    name: row.name,
    summary: row.summary,
    description: row.description,
    status: (ASSET_STATUSES as readonly string[]).includes(row.status)
      ? row.status as AssetStatus
      : 'active',
    firstChapter: row.first_chapter,
    lastChapter: row.last_chapter,
    tags: safeParse<string[]>(row.tags_json, []),
    typeData: safeParse<Record<string, unknown>>(row.type_data_json, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function assertInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`INVALID_${field.toUpperCase()}`)
  return value
}

/**
 * type_data 校验：必须是普通对象、可 JSON 序列化、体积受控；
 * number 类型若带 value 则必须是有限数字。
 */
export function validateAssetTypeData(entityType: AssetEntityType, raw: unknown): Record<string, unknown> {
  if (raw === undefined || raw === null) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID_TYPE_DATA')
  const text = JSON.stringify(raw)
  if (text.length > MAX_TYPE_DATA_LEN) throw new Error('TYPE_DATA_TOO_LARGE')
  const data = raw as Record<string, unknown>
  if (entityType === 'number' && data.value !== undefined && !Number.isFinite(data.value)) {
    throw new Error('INVALID_NUMBER_VALUE')
  }
  return data
}

function normalizeInput(input: AssetInput): Required<Omit<AssetInput, 'id'>> {
  if (!(ASSET_ENTITY_TYPES as readonly string[]).includes(input.entityType)) {
    throw new Error('INVALID_ENTITY_TYPE')
  }
  const name = (input.name ?? '').trim()
  if (!name || name.length > MAX_NAME_LEN) throw new Error('INVALID_ASSET_NAME')
  const status = input.status ?? 'active'
  if (!(ASSET_STATUSES as readonly string[]).includes(status)) throw new Error('INVALID_ASSET_STATUS')
  const summary = input.summary ?? ''
  const description = input.description ?? ''
  if (summary.length > MAX_TEXT_LEN || description.length > MAX_TEXT_LEN) throw new Error('ASSET_TEXT_TOO_LONG')
  const tags = input.tags ?? []
  if (!Array.isArray(tags) || tags.length > MAX_TAGS || tags.some((t) => typeof t !== 'string' || t.length > MAX_TAG_LEN)) {
    throw new Error('INVALID_ASSET_TAGS')
  }
  return {
    entityType: input.entityType,
    name,
    summary,
    description,
    status,
    firstChapter: assertInteger(input.firstChapter ?? 0, 'first_chapter'),
    lastChapter: assertInteger(input.lastChapter ?? 0, 'last_chapter'),
    tags: tags.map((t) => t.trim()).filter(Boolean),
    typeData: validateAssetTypeData(input.entityType, input.typeData),
  }
}

export class AssetRepository {
  /** 资产列表（可按类型筛选），同类按名称排序 */
  static getAll(entityType?: AssetEntityType): AssetData[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = entityType
      ? db.prepare('SELECT * FROM canon_items WHERE entity_type = ? ORDER BY entity_type ASC, name ASC').all(entityType)
      : db.prepare('SELECT * FROM canon_items ORDER BY entity_type ASC, name ASC').all()
    return (rows as AssetRow[]).map(rowToData)
  }

  static getById(id: number): AssetData | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare('SELECT * FROM canon_items WHERE id = ?').get(id) as AssetRow | undefined
    return row ? rowToData(row) : null
  }

  static getByName(entityType: AssetEntityType, name: string): AssetData | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare('SELECT * FROM canon_items WHERE entity_type = ? AND name = ?')
      .get(entityType, name.trim()) as AssetRow | undefined
    return row ? rowToData(row) : null
  }

  /**
   * 写入资产：带 id 按 id 更新；不带 id 按 (entity_type, name) 幂等 upsert。
   * 返回落库后的 id。
   */
  static upsert(input: AssetInput): number {
    const db = getProjectDb()
    if (!db) throw new Error('PROJECT_CLOSED')
    const data = normalizeInput(input)
    if (input.id !== undefined) {
      const info = db.prepare(`
        UPDATE canon_items
        SET entity_type = ?, name = ?, summary = ?, description = ?, status = ?,
            first_chapter = ?, last_chapter = ?, tags_json = ?, type_data_json = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        data.entityType, data.name, data.summary, data.description, data.status,
        data.firstChapter, data.lastChapter, JSON.stringify(data.tags), JSON.stringify(data.typeData),
        input.id,
      )
      if (info.changes === 0) throw new Error('ASSET_NOT_FOUND')
      return input.id
    }
    db.prepare(`
      INSERT INTO canon_items (
        entity_type, name, summary, description, status,
        first_chapter, last_chapter, tags_json, type_data_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, name) DO UPDATE SET
        summary = excluded.summary,
        description = excluded.description,
        status = excluded.status,
        first_chapter = excluded.first_chapter,
        last_chapter = excluded.last_chapter,
        tags_json = excluded.tags_json,
        type_data_json = excluded.type_data_json,
        updated_at = datetime('now')
    `).run(
      data.entityType, data.name, data.summary, data.description, data.status,
      data.firstChapter, data.lastChapter, JSON.stringify(data.tags), JSON.stringify(data.typeData),
    )
    const row = db.prepare('SELECT id FROM canon_items WHERE entity_type = ? AND name = ?')
      .get(data.entityType, data.name) as { id: number } | undefined
    if (!row) throw new Error('ASSET_WRITE_FAILED')
    return row.id
  }

  static delete(id: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare('DELETE FROM canon_items WHERE id = ?').run(id)
  }

  static count(entityType?: AssetEntityType): number {
    const db = getProjectDb()
    if (!db) return 0
    const row = (entityType
      ? db.prepare('SELECT COUNT(*) AS n FROM canon_items WHERE entity_type = ?').get(entityType)
      : db.prepare('SELECT COUNT(*) AS n FROM canon_items').get()) as { n: number }
    return row.n
  }
}
