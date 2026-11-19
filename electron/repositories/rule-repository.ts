/**
 * RuleRepository — 规则结构化条目库（rule_items / rule_snapshots）
 *
 * 设计要点：
 * - 条目是主数据源，带稳定编号 R-组-序，正文与审稿都按编号引用；
 * - project_core.rulebook 只是由条目编译出来的兼容产物（导出/旧链路使用）；
 * - 每次保存自动生成快照，可回滚。
 */
import { randomUUID } from 'node:crypto'
import { getProjectDb } from '../database'
import type {
  RuleItem, RuleSnapshotMeta, RuleSnapshotFull,
} from '../../src/shared/rule-timeline'

export type { RuleItem, RuleSeverity, RuleSnapshotMeta, RuleSnapshotFull } from '../../src/shared/rule-timeline'

interface RuleRow {
  id: string
  code: string
  grp: string
  title: string
  body: string
  severity: string
  tags: string
  active: number
  sort: number
  updated_at: string
}

const MAX_SNAPSHOTS = 30

function rowToItem(row: RuleRow): RuleItem {
  let tags: string[] = []
  try {
    const parsed = JSON.parse(row.tags)
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string')
  } catch { /* 忽略坏数据 */ }
  return {
    id: row.id,
    code: row.code,
    group: row.grp,
    title: row.title,
    body: row.body,
    severity: row.severity === 'hard' ? 'hard' : 'soft',
    tags,
    active: row.active !== 0,
    sort: row.sort,
    updatedAt: row.updated_at,
  }
}

export function listRuleItems(): RuleItem[] {
  const db = getProjectDb()
  if (!db) return []
  const rows = db.prepare(`SELECT * FROM rule_items ORDER BY sort ASC, code ASC`).all() as RuleRow[]
  return rows.map(rowToItem)
}

/** 把条目编译为可读文本（兼容旧链路 / 导出） */
export function compileRulebook(items: RuleItem[]): string {
  const active = items.filter((i) => i.active).sort((a, b) => a.sort - b.sort)
  const groups: Array<{ name: string; items: RuleItem[] }> = []
  for (const item of active) {
    const name = item.group || '总则'
    let group = groups.find((g) => g.name === name)
    if (!group) {
      group = { name, items: [] }
      groups.push(group)
    }
    group.items.push(item)
  }
  return groups.map((g) => {
    const lines = g.items.map((i) => `[${i.code}] ${i.title}\n${i.body}`.trim())
    return `【${g.name}】\n${lines.join('\n')}`
  }).join('\n\n')
}

function hashText(text: string): string {
  // 轻量哈希即可（用于判断快照是否重复，不做安全用途）
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0
  return h.toString(36)
}

function createSnapshot(content: string, itemsCount: number): void {
  const db = getProjectDb()
  if (!db) return
  const hash = hashText(content)
  const last = db.prepare(`SELECT hash FROM rule_snapshots ORDER BY id DESC LIMIT 1`).get() as { hash?: string } | undefined
  if (last?.hash === hash) return
  db.prepare(`INSERT INTO rule_snapshots (hash, chars, items_count, content) VALUES (?, ?, ?, ?)`)
    .run(hash, content.length, itemsCount, content)
  const stale = db.prepare(`SELECT id FROM rule_snapshots ORDER BY id DESC LIMIT -1 OFFSET ?`).all(MAX_SNAPSHOTS) as Array<{ id: number }>
  if (stale.length > 0) {
    db.prepare(`DELETE FROM rule_snapshots WHERE id IN (${stale.map(() => '?').join(',')})`).run(...stale.map((s) => s.id))
  }
}

/**
 * 覆盖式保存：删除全部条目后按传入顺序重新写入，并刷新 project_core.rulebook。
 * 编号由前端传入；缺失编号的条目自动补 R-组-序。
 */
export function replaceRuleItems(input: Array<Partial<RuleItem> & { group: string; title: string; body: string }>): {
  items: RuleItem[]
  compiled: string
} {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  const now = new Date().toISOString()
  const usedCodes = new Set<string>()
  const groupCounters = new Map<string, number>()
  const normalized = input.map((raw, index) => {
    const group = (raw.group || '总则').trim()
    let code = (raw.code || '').trim()
    if (!code || usedCodes.has(code)) {
      const groupSeq = groupCounters.get(group) ?? 0
      const groupIndex = [...groupCounters.keys()].indexOf(group) + 1
      code = `R-${groupIndex}-${groupSeq + 1}`
      groupCounters.set(group, groupSeq + 1)
    } else {
      groupCounters.set(group, (groupCounters.get(group) ?? 0) + 1)
    }
    usedCodes.add(code)
    return {
      id: raw.id && raw.id.length > 0 ? raw.id : randomUUID(),
      code,
      group,
      title: (raw.title || '').trim(),
      body: (raw.body || '').trim(),
      severity: raw.severity === 'hard' ? 'hard' : 'soft',
      tags: Array.isArray(raw.tags) ? raw.tags : [],
      active: raw.active !== false,
      sort: index,
      updatedAt: now,
    }
  })

  db.transaction(() => {
    db.prepare(`DELETE FROM rule_items`).run()
    const insert = db.prepare(`
      INSERT INTO rule_items (id, code, grp, title, body, severity, tags, active, sort, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    for (const item of normalized) {
      insert.run(
        item.id, item.code, item.group, item.title, item.body,
        item.severity, JSON.stringify(item.tags), item.active ? 1 : 0, item.sort, item.updatedAt,
      )
    }
    const compiled = compileRulebook(normalized as RuleItem[])
    db.prepare(`UPDATE project_core SET rulebook = ?, updated_at = datetime('now') WHERE id = 'main'`).run(compiled)
    createSnapshot(compiled, normalized.length)
  })()

  return { items: listRuleItems(), compiled: compileRulebook(listRuleItems()) }
}

function splitIntoSentences(text: string): string[] {
  return text.split(/[。；;!！?？]/).map((s) => s.trim()).filter(Boolean)
}

function deriveTitle(body: string): string {
  const first = splitIntoSentences(body)[0] || body
  return first.length > 34 ? `${first.slice(0, 34)}…` : first
}

const HARD_PATTERN = /(禁止|严禁|不得|必须|铁律|上限|仅可|只能|不可|唯一|锁定|固定为|不得超过|不能超过)/
const SOFT_PATTERN = /(建议|可选|可以|尽量|酌情|优先)/

/**
 * 首次打开旧项目时，把 project_core.rulebook 解析成结构化条目（零手工迁移）。
 * 返回写入条目数；已有条目时不做任何事。
 */
export function seedRuleItemsFromRulebook(rulebook: string): number {
  const db = getProjectDb()
  if (!db) return 0
  const existing = db.prepare(`SELECT COUNT(*) AS c FROM rule_items`).get() as { c: number }
  if (existing.c > 0) return 0
  const text = (rulebook || '').trim()
  if (!text) return 0

  const groups: Array<{ name: string; entries: string[] }> = []
  let current: { name: string; entries: string[] } = { name: '', entries: [] }
  const flush = () => {
    if (current.entries.length > 0) {
      groups.push({ name: current.name || `第${groups.length + 1}组`, entries: current.entries })
    }
    current = { name: '', entries: [] }
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) { flush(); continue }
    const numbered = /^\s*(\d+)\s*[.、)．]\s*(.+)$/.exec(line)
    if (numbered) {
      current.entries.push(numbered[2].trim())
      continue
    }
    // 非编号短行视为分组标题（如「等阶体系」）
    if (!current.name && trimmed.length <= 24 && !/[，。；,;：:！!？?]$/.test(trimmed)) {
      current.name = trimmed.replace(/^【|】$/g, '')
      continue
    }
    if (current.entries.length > 0) {
      current.entries[current.entries.length - 1] += ` ${trimmed}`
    } else {
      current.entries.push(trimmed)
    }
  }
  flush()

  const items: Array<Partial<RuleItem> & { group: string; title: string; body: string }> = []
  groups.forEach((group, gi) => {
    group.entries.forEach((entry, ei) => {
      const isHard = HARD_PATTERN.test(entry) && !SOFT_PATTERN.test(entry)
      items.push({
        group: group.name,
        code: `R-${gi + 1}-${ei + 1}`,
        title: deriveTitle(entry),
        body: entry,
        severity: isHard ? 'hard' : 'soft',
        tags: [],
        active: true,
      })
    })
  })

  replaceRuleItems(items)
  console.log(`[MoShu DB] 规则区已自动解析为 ${items.length} 条结构化条目`)
  return items.length
}

export function listRuleSnapshots(limit = 30): RuleSnapshotMeta[] {
  const db = getProjectDb()
  if (!db) return []
  const rows = db.prepare(`
    SELECT id, hash, chars, items_count, created_at FROM rule_snapshots
    ORDER BY id DESC LIMIT ?
  `).all(limit) as Array<{ id: number; hash: string; chars: number; items_count: number; created_at: string }>
  return rows.map((r) => ({
    id: r.id, hash: r.hash, chars: r.chars, itemsCount: r.items_count, createdAt: r.created_at,
  }))
}

export function getRuleSnapshot(id: number): RuleSnapshotFull | null {
  const db = getProjectDb()
  if (!db) return null
  const row = db.prepare(`SELECT id, hash, chars, items_count, content, created_at FROM rule_snapshots WHERE id = ?`)
    .get(id) as { id: number; hash: string; chars: number; items_count: number; content: string; created_at: string } | undefined
  if (!row) return null
  return {
    id: row.id, hash: row.hash, chars: row.chars, itemsCount: row.items_count,
    content: row.content, createdAt: row.created_at,
  }
}

/** 回滚：把快照文本重新解析为条目并覆盖当前规则库 */
export function restoreRuleSnapshot(id: number): number {
  const snapshot = getRuleSnapshot(id)
  if (!snapshot) return 0
  const db = getProjectDb()
  if (!db) return 0
  db.prepare(`DELETE FROM rule_items`).run()
  return seedRuleItemsFromRulebook(snapshot.content)
}
