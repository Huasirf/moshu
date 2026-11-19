/**
 * StyleRepository — 风格档案 (style_profiles 表)
 *
 * 一套风格 = 若干条去味/行文规则 + 注入提示词的提示语；全局同时只有一套生效。
 * rules_json 存规则数组（字符串），由 P4 的规则引擎解释。
 */
import { getProjectDb } from '../database'

export interface StyleProfile {
  id: number
  name: string
  isActive: boolean
  rules: string[]
  promptHint: string
  createdAt: string
}

export interface StyleProfileInput {
  name: string
  rules?: string[]
  promptHint?: string
  isActive?: boolean
}

interface StyleRow {
  id: number
  name: string
  is_active: number
  rules_json: string
  prompt_hint: string
  created_at: string
}

const MAX_NAME_LEN = 100
const MAX_RULES = 300
const MAX_RULE_LEN = 1000
const MAX_HINT_LEN = 4000

function safeParse<T>(json: string, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) as T } catch { return fallback }
}

function rowToData(row: StyleRow): StyleProfile {
  return {
    id: row.id,
    name: row.name,
    isActive: row.is_active !== 0,
    rules: safeParse<string[]>(row.rules_json, []),
    promptHint: row.prompt_hint ?? '',
    createdAt: row.created_at,
  }
}

function normalize(input: StyleProfileInput) {
  const name = (input.name ?? '').trim()
  if (!name || name.length > MAX_NAME_LEN) throw new Error('INVALID_STYLE_NAME')
  const rules = input.rules ?? []
  if (!Array.isArray(rules) || rules.length > MAX_RULES
    || rules.some((r) => typeof r !== 'string' || r.length > MAX_RULE_LEN)) {
    throw new Error('INVALID_STYLE_RULES')
  }
  const promptHint = input.promptHint ?? ''
  if (promptHint.length > MAX_HINT_LEN) throw new Error('STYLE_HINT_TOO_LONG')
  return { name, rules, promptHint, isActive: !!input.isActive }
}

export class StyleRepository {
  static list(): StyleProfile[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare('SELECT * FROM style_profiles ORDER BY is_active DESC, id ASC').all()
    return (rows as StyleRow[]).map(rowToData)
  }

  static getById(id: number): StyleProfile | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare('SELECT * FROM style_profiles WHERE id = ?').get(id) as StyleRow | undefined
    return row ? rowToData(row) : null
  }

  /** 当前生效的风格档案（没有则 null） */
  static getActive(): StyleProfile | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare('SELECT * FROM style_profiles WHERE is_active = 1 LIMIT 1').get() as StyleRow | undefined
    return row ? rowToData(row) : null
  }

  /** 新建风格档案；isActive=true 时自动让其他档案失效。返回新 id */
  static create(input: StyleProfileInput): number {
    const db = getProjectDb()
    if (!db) throw new Error('PROJECT_CLOSED')
    const data = normalize(input)
    return db.transaction(() => {
      if (data.isActive) db.prepare('UPDATE style_profiles SET is_active = 0').run()
      const info = db.prepare(`
        INSERT INTO style_profiles (name, is_active, rules_json, prompt_hint)
        VALUES (?, ?, ?, ?)
      `).run(data.name, data.isActive ? 1 : 0, JSON.stringify(data.rules), data.promptHint)
      return Number(info.lastInsertRowid)
    })()
  }

  /** 全量更新一条档案（按 id） */
  static update(id: number, input: StyleProfileInput): void {
    const db = getProjectDb()
    if (!db) throw new Error('PROJECT_CLOSED')
    const data = normalize(input)
    db.transaction(() => {
      if (data.isActive) db.prepare('UPDATE style_profiles SET is_active = 0 WHERE id != ?').run(id)
      const info = db.prepare(`
        UPDATE style_profiles SET name = ?, is_active = ?, rules_json = ?, prompt_hint = ?
        WHERE id = ?
      `).run(data.name, data.isActive ? 1 : 0, JSON.stringify(data.rules), data.promptHint, id)
      if (info.changes === 0) throw new Error('STYLE_NOT_FOUND')
    })()
  }

  /** 切换生效档案 */
  static setActive(id: number): void {
    const db = getProjectDb()
    if (!db) throw new Error('PROJECT_CLOSED')
    db.transaction(() => {
      const exists = db.prepare('SELECT 1 FROM style_profiles WHERE id = ?').get(id)
      if (!exists) throw new Error('STYLE_NOT_FOUND')
      db.prepare('UPDATE style_profiles SET is_active = 0').run()
      db.prepare('UPDATE style_profiles SET is_active = 1 WHERE id = ?').run(id)
    })()
  }

  static delete(id: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare('DELETE FROM style_profiles WHERE id = ?').run(id)
  }
}
