import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initProjectDatabase, closeProjectDatabase, getProjectDb, getCurrentProjectPath, SCHEMA_VERSION } from '../database'
import { getBackupDir, listBackups } from '../db-backup'
import { backupNow } from '../db-auto-backup'

/**
 * schema 迁移：事务化、失败不升版本、迁移前备份、拒绝打开更新版本的库。
 * 依赖 better-sqlite3 原生模块：本机 node_modules 里的是按 Electron ABI 编译的，
 * 直接用 Node 跑会因 ABI 不匹配而失败（CI 上按 Node 安装，可正常运行）。
 */
describe('项目数据库 schema 迁移', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moshu-migrate-'))
  })

  afterEach(() => {
    closeProjectDatabase()
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  const indexNames = () => (getProjectDb()!
    .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_canon_%_unique'`)
    .all() as Array<{ name: string }>).map((r) => r.name).sort()

  it('新库打开后升到当前版本并建好唯一约束，且不产生无意义的备份', () => {
    initProjectDatabase(projectDir)
    const db = getProjectDb()!
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION)
    expect(indexNames()).toEqual(['idx_canon_facts_unique', 'idx_canon_plot_unique', 'idx_canon_timeline_unique'])
    expect(fs.existsSync(getBackupDir(projectDir))).toBe(false)
  })

  it('老库迁移：先备份，再去重并加约束', () => {
    initProjectDatabase(projectDir)
    let db = getProjectDb()!
    // 伪造一个迁移前的老库：去掉约束、写入重复数据、版本号退回 0
    db.exec(`DROP INDEX idx_canon_facts_unique; DROP INDEX idx_canon_plot_unique; DROP INDEX idx_canon_timeline_unique;`)
    const insertFact = db.prepare(`INSERT INTO canon_facts (category, statement, introduced_at) VALUES ('identity', ?, 1)`)
    insertFact.run('林轩是青云宗弟子')
    insertFact.run('林轩是青云宗弟子')
    db.pragma('user_version = 0')
    closeProjectDatabase()

    initProjectDatabase(projectDir)
    db = getProjectDb()!
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION)
    expect((db.prepare(`SELECT COUNT(*) AS n FROM canon_facts`).get() as { n: number }).n).toBe(1)
    expect(indexNames()).toContain('idx_canon_facts_unique')
    const backups = fs.readdirSync(getBackupDir(projectDir))
    expect(backups.some((f) => f.startsWith('moshu-pre-migration-') && f.endsWith('.db'))).toBe(true)
  })

  it('打开项目后记录当前项目路径，关闭后清空', () => {
    initProjectDatabase(projectDir)
    expect(getCurrentProjectPath()).toBe(projectDir)
    closeProjectDatabase()
    expect(getCurrentProjectPath()).toBeNull()
  })

  it('备份是可打开的完整副本，且只保留最新的若干份', async () => {
    initProjectDatabase(projectDir)
    const db = getProjectDb()!
    db.prepare(`INSERT INTO canon_facts (category, statement, introduced_at) VALUES ('identity', '备份内容', 1)`).run()

    for (let i = 0; i < 3; i++) await backupNow(db, projectDir, 'manual', 2)
    const files = listBackups(projectDir, 'manual')
    expect(files).toHaveLength(2)

    // 备份文件本身是一个完整可读的 SQLite 库
    const { createRequire } = await import('node:module')
    const Database = createRequire(import.meta.url)('better-sqlite3') as typeof import('better-sqlite3')
    const copy = new Database(files[files.length - 1], { readonly: true })
    try {
      const row = copy.prepare(`SELECT statement FROM canon_facts`).get() as { statement: string }
      expect(row.statement).toBe('备份内容')
    } finally {
      copy.close()
    }
  })

  it('库版本比应用新时拒绝打开，避免旧版本写坏数据', () => {
    initProjectDatabase(projectDir)
    getProjectDb()!.pragma(`user_version = ${SCHEMA_VERSION + 1}`)
    closeProjectDatabase()

    expect(() => initProjectDatabase(projectDir)).toThrow(/高于当前 墨枢 支持的版本/)
    expect(getProjectDb()).toBeNull()
  })

  it('v4 → v5：同一章只保留最新定稿，其余降级为 archived', () => {
    initProjectDatabase(projectDir)
    let db = getProjectDb()!
    const insertContent = db.prepare(`INSERT INTO contents (body) VALUES (?)`)
    const insertDraft = db.prepare(`INSERT INTO drafts (chapter_number, version, status, content_id, word_count) VALUES (?, ?, ?, ?, 100)`)
    for (const version of [1, 2, 3]) {
      const contentId = Number(insertContent.run(`v${version}`).lastInsertRowid)
      insertDraft.run(2, version, 'finalized', contentId)
    }
    db.pragma('user_version = 4')
    closeProjectDatabase()

    initProjectDatabase(projectDir)
    db = getProjectDb()!
    const rows = db.prepare(`SELECT version, status FROM drafts WHERE chapter_number = 2 ORDER BY version`).all() as Array<{ version: number; status: string }>
    expect(rows).toEqual([
      { version: 1, status: 'archived' },
      { version: 2, status: 'archived' },
      { version: 3, status: 'finalized' },
    ])
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION)
  })

  it('v1 → v2：老库补齐 P1 列与表，已有蓝图数据不丢，重复打开幂等', () => {
    initProjectDatabase(projectDir)
    let db = getProjectDb()!
    db.prepare(`INSERT INTO blueprints (chapter_number, title) VALUES (1, '第一章')`).run()
    // 把 P1 新增列删掉，模拟 v1 老库
    for (const col of ['asset_refs', 'scenes_json', 'words_target', 'status', 'beat_tags']) {
      db.exec(`ALTER TABLE blueprints DROP COLUMN ${col}`)
    }
    db.pragma('user_version = 1')
    closeProjectDatabase()

    initProjectDatabase(projectDir)
    db = getProjectDb()!
    expect(Number(db.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION)
    const columns = (db.prepare('PRAGMA table_info(blueprints)').all() as Array<{ name: string }>).map((c) => c.name)
    expect(columns).toEqual(expect.arrayContaining(['asset_refs', 'scenes_json', 'words_target', 'status', 'beat_tags']))
    const row = db.prepare('SELECT * FROM blueprints WHERE chapter_number = 1').get() as Record<string, unknown>
    expect(row.title).toBe('第一章')
    expect(row.asset_refs).toBe('[]')
    expect(row.scenes_json).toBe('[]')
    expect(row.words_target).toBe(0)
    expect(row.status).toBe('planned')
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>)
      .map((t) => t.name)
    expect(tables).toEqual(expect.arrayContaining([
      'canon_items', 'attribute_defs', 'attribute_values', 'entity_relations',
      'review_findings', 'chapter_pipeline', 'style_profiles',
    ]))

    // 已在 v2 的库再次打开：迁移整段跳过，不报错
    closeProjectDatabase()
    initProjectDatabase(projectDir)
    expect(Number(getProjectDb()!.pragma('user_version', { simple: true }))).toBe(SCHEMA_VERSION)
  })
})
