/**
 * AttributeRepository — 属性系统 (attribute_defs / attribute_values)
 *
 * 属性定义是全局表（key 唯一），属性值按「实体 × 属性 × 章节 × 阶段」存储。
 * 读值语义：给定章节与阶段，取该点及之前最近的一条记录（没记录则视为未设定）。
 * 数值属性写入时自动计算相对上一条记录的差值（delta_num）。
 */
import { getProjectDb } from '../database'

export const ATTRIBUTE_VALUE_TYPES = ['number', 'enum', 'text'] as const
export type AttributeValueType = (typeof ATTRIBUTE_VALUE_TYPES)[number]

export const ATTRIBUTE_PHASES = ['before', 'after'] as const
export type AttributePhase = (typeof ATTRIBUTE_PHASES)[number]

export interface AttributeDef {
  key: string
  entityType: string
  label: string
  valueType: AttributeValueType
  enumValues: string[]
  unit: string
  minValue: number | null
  maxValue: number | null
  showInPanel: boolean
  sortOrder: number
  createdAt?: string
}

export interface AttributeValue {
  entityId: string
  attrKey: string
  chapterNumber: number
  phase: AttributePhase
  numValue: number | null
  textValue: string | null
  deltaNum: number | null
  source: string
  sourceEventId: number | null
  updatedAt: string
}

export interface AttributeValueInput {
  entityId: string
  attrKey: string
  chapterNumber: number
  phase?: AttributePhase
  numValue?: number | null
  textValue?: string | null
  source?: string
  sourceEventId?: number | null
}

export interface AttributePanelEntry {
  def: AttributeDef
  value: AttributeValue | null
}

interface DefRow {
  key: string
  entity_type: string
  label: string
  value_type: string
  enum_values_json: string
  unit: string
  min_value: number | null
  max_value: number | null
  show_in_panel: number
  sort_order: number
  created_at: string
}

interface ValueRow {
  entity_id: string
  attr_key: string
  chapter_number: number
  phase: string
  num_value: number | null
  text_value: string | null
  delta_num: number | null
  source: string
  source_event_id: number | null
  updated_at: string
}

const MAX_KEY_LEN = 100
const MAX_LABEL_LEN = 100
const MAX_TEXT_LEN = 5000
const MAX_ENUM_VALUES = 200

function safeParse<T>(json: string, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) as T } catch { return fallback }
}

function rowToDef(row: DefRow): AttributeDef {
  return {
    key: row.key,
    entityType: row.entity_type || 'character',
    label: row.label,
    valueType: (ATTRIBUTE_VALUE_TYPES as readonly string[]).includes(row.value_type)
      ? row.value_type as AttributeValueType
      : 'text',
    enumValues: safeParse<string[]>(row.enum_values_json, []),
    unit: row.unit,
    minValue: row.min_value,
    maxValue: row.max_value,
    showInPanel: row.show_in_panel !== 0,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  }
}

function rowToValue(row: ValueRow): AttributeValue {
  return {
    entityId: row.entity_id,
    attrKey: row.attr_key,
    chapterNumber: row.chapter_number,
    phase: row.phase === 'before' ? 'before' : 'after',
    numValue: row.num_value,
    textValue: row.text_value,
    deltaNum: row.delta_num,
    source: row.source,
    sourceEventId: row.source_event_id,
    updatedAt: row.updated_at,
  }
}

function assertPositiveInteger(value: number, code: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(code)
  return value
}

/** 属性定义入参校验 */
export function validateAttributeDef(input: AttributeDef): AttributeDef {
  const key = (input.key ?? '').trim()
  if (!key || key.length > MAX_KEY_LEN) throw new Error('INVALID_ATTRIBUTE_KEY')
  const label = (input.label ?? '').trim()
  if (!label || label.length > MAX_LABEL_LEN) throw new Error('INVALID_ATTRIBUTE_LABEL')
  if (!(ATTRIBUTE_VALUE_TYPES as readonly string[]).includes(input.valueType)) {
    throw new Error('INVALID_ATTRIBUTE_VALUE_TYPE')
  }
  const enumValues = input.enumValues ?? []
  if (!Array.isArray(enumValues) || enumValues.length > MAX_ENUM_VALUES
    || enumValues.some((v) => typeof v !== 'string' || v.length > MAX_LABEL_LEN)) {
    throw new Error('INVALID_ATTRIBUTE_ENUM_VALUES')
  }
  if (input.minValue !== null && input.minValue !== undefined && !Number.isFinite(input.minValue)) {
    throw new Error('INVALID_ATTRIBUTE_RANGE')
  }
  if (input.maxValue !== null && input.maxValue !== undefined && !Number.isFinite(input.maxValue)) {
    throw new Error('INVALID_ATTRIBUTE_RANGE')
  }
  return { ...input, key, label, enumValues }
}

export class AttributeRepository {
  /** 属性定义列表（可按实体类型筛选），按 sort_order、key 排序 */
  static listDefs(entityType?: string): AttributeDef[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = entityType
      ? db.prepare('SELECT * FROM attribute_defs WHERE entity_type = ? ORDER BY sort_order ASC, key ASC').all(entityType)
      : db.prepare('SELECT * FROM attribute_defs ORDER BY entity_type ASC, sort_order ASC, key ASC').all()
    return (rows as DefRow[]).map(rowToDef)
  }

  /** 新建或覆盖属性定义（key 为主键） */
  static upsertDef(input: AttributeDef): void {
    const db = getProjectDb()
    if (!db) throw new Error('PROJECT_CLOSED')
    const def = validateAttributeDef(input)
    db.prepare(`
      INSERT INTO attribute_defs (
        key, entity_type, label, value_type, enum_values_json, unit,
        min_value, max_value, show_in_panel, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        entity_type = excluded.entity_type,
        label = excluded.label,
        value_type = excluded.value_type,
        enum_values_json = excluded.enum_values_json,
        unit = excluded.unit,
        min_value = excluded.min_value,
        max_value = excluded.max_value,
        show_in_panel = excluded.show_in_panel,
        sort_order = excluded.sort_order
    `).run(
      def.key,
      def.entityType || 'character',
      def.label,
      def.valueType,
      JSON.stringify(def.enumValues),
      def.unit ?? '',
      def.minValue ?? null,
      def.maxValue ?? null,
      def.showInPanel ? 1 : 0,
      Number.isFinite(def.sortOrder) ? Math.trunc(def.sortOrder) : 0,
    )
  }

  static deleteDef(key: string): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare('DELETE FROM attribute_defs WHERE key = ?').run(key)
  }

  /**
   * 取某实体某属性在指定章节/阶段的值：该点及之前最近一条记录。
   * phase='after' 时包含同一章 before，phase='before' 时不包含同一章 after。
   */
  static getValueAt(
    entityId: string,
    attrKey: string,
    chapterNumber: number,
    phase: AttributePhase = 'after',
  ): AttributeValue | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare(`
      SELECT * FROM attribute_values
      WHERE entity_id = ? AND attr_key = ?
        AND (chapter_number < ? OR (chapter_number = ? AND (? = 'after' OR phase = 'before')))
      ORDER BY chapter_number DESC, CASE phase WHEN 'after' THEN 1 ELSE 0 END DESC
      LIMIT 1
    `).get(entityId, attrKey, chapterNumber, chapterNumber, phase) as ValueRow | undefined
    return row ? rowToValue(row) : null
  }

  /** 某实体某属性的全部历史记录（按章节、阶段升序） */
  static listValues(entityId: string, attrKey?: string): AttributeValue[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = attrKey
      ? db.prepare(`
          SELECT * FROM attribute_values WHERE entity_id = ? AND attr_key = ?
          ORDER BY chapter_number ASC, CASE phase WHEN 'before' THEN 0 ELSE 1 END ASC
        `).all(entityId, attrKey)
      : db.prepare(`
          SELECT * FROM attribute_values WHERE entity_id = ?
          ORDER BY attr_key ASC, chapter_number ASC, CASE phase WHEN 'before' THEN 0 ELSE 1 END ASC
        `).all(entityId)
    return (rows as ValueRow[]).map(rowToValue)
  }

  /**
   * 写入属性值：数值型自动按上一条记录算 delta（其余传 null）。
   * 同一 (实体, 属性, 章节, 阶段) 重复写入为覆盖。
   */
  static setValue(input: AttributeValueInput): AttributeValue {
    const db = getProjectDb()
    if (!db) throw new Error('PROJECT_CLOSED')
    const entityId = (input.entityId ?? '').trim()
    const attrKey = (input.attrKey ?? '').trim()
    if (!entityId) throw new Error('INVALID_ENTITY_ID')
    if (!attrKey) throw new Error('INVALID_ATTRIBUTE_KEY')
    const chapterNumber = assertPositiveInteger(input.chapterNumber, 'INVALID_CHAPTER_NUMBER')
    const phase = input.phase ?? 'after'
    if (!(ATTRIBUTE_PHASES as readonly string[]).includes(phase)) throw new Error('INVALID_ATTRIBUTE_PHASE')
    if (input.sourceEventId !== undefined && input.sourceEventId !== null && !Number.isSafeInteger(input.sourceEventId)) {
      throw new Error('INVALID_SOURCE_EVENT_ID')
    }
    if (input.textValue !== undefined && input.textValue !== null && input.textValue.length > MAX_TEXT_LEN) {
      throw new Error('ATTRIBUTE_TEXT_TOO_LONG')
    }

    const numValue = input.numValue === undefined ? null : input.numValue
    let deltaNum: number | null = null
    if (numValue !== null) {
      if (!Number.isFinite(numValue)) throw new Error('INVALID_ATTRIBUTE_NUMBER')
      const def = db.prepare('SELECT * FROM attribute_defs WHERE key = ?').get(attrKey) as DefRow | undefined
      if (def) {
        const min = def.min_value
        const max = def.max_value
        if (min !== null && numValue < min) throw new Error('ATTRIBUTE_OUT_OF_RANGE')
        if (max !== null && numValue > max) throw new Error('ATTRIBUTE_OUT_OF_RANGE')
      }
      const previous = AttributeRepository.previousValue(entityId, attrKey, chapterNumber, phase)
      if (previous && previous.numValue !== null) deltaNum = numValue - previous.numValue
    }

    db.prepare(`
      INSERT INTO attribute_values (
        entity_id, attr_key, chapter_number, phase, num_value, text_value, delta_num,
        source, source_event_id, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(entity_id, attr_key, chapter_number, phase) DO UPDATE SET
        num_value = excluded.num_value,
        text_value = excluded.text_value,
        delta_num = excluded.delta_num,
        source = excluded.source,
        source_event_id = excluded.source_event_id,
        updated_at = datetime('now')
    `).run(
      entityId,
      attrKey,
      chapterNumber,
      phase,
      numValue,
      input.textValue ?? null,
      deltaNum,
      input.source ?? '',
      input.sourceEventId ?? null,
    )

    const row = db.prepare(`
      SELECT * FROM attribute_values
      WHERE entity_id = ? AND attr_key = ? AND chapter_number = ? AND phase = ?
    `).get(entityId, attrKey, chapterNumber, phase) as ValueRow
    return rowToValue(row)
  }

  /** 严格早于当前写入点的最近一条值（同章 before 对 after 可见） */
  private static previousValue(
    entityId: string,
    attrKey: string,
    chapterNumber: number,
    phase: AttributePhase,
  ): AttributeValue | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare(`
      SELECT * FROM attribute_values
      WHERE entity_id = ? AND attr_key = ?
        AND (chapter_number < ? OR (chapter_number = ? AND ? = 'after' AND phase = 'before'))
      ORDER BY chapter_number DESC, CASE phase WHEN 'after' THEN 1 ELSE 0 END DESC
      LIMIT 1
    `).get(entityId, attrKey, chapterNumber, chapterNumber, phase) as ValueRow | undefined
    return row ? rowToValue(row) : null
  }

  /** 现状面板：show_in_panel 的定义 + 各自在指定章节/阶段的值 */
  static getPanelState(
    entityId: string,
    chapterNumber: number,
    phase: AttributePhase = 'after',
    entityType?: string,
  ): AttributePanelEntry[] {
    return AttributeRepository.listDefs(entityType)
      .filter((def) => def.showInPanel)
      .map((def) => ({
        def,
        value: AttributeRepository.getValueAt(entityId, def.key, chapterNumber, phase),
      }))
  }

  /** 删除某章的全部属性值（取消定稿回滚用；本章快照与本章派生数据一并失效） */
  static deleteChapterValues(chapterNumber: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare('DELETE FROM attribute_values WHERE chapter_number = ?').run(chapterNumber)
  }

  /** 清空某实体的全部属性值（删除资产时联动清理） */
  static deleteEntityValues(entityId: string): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare('DELETE FROM attribute_values WHERE entity_id = ?').run(entityId)
  }
}
