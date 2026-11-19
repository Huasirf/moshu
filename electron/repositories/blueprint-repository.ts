/**
 * BlueprintRepository — 章节蓝图 (blueprints 表)
 *
 * 取代旧的 chapter-repository.ts，管理章节的规划元数据。
 */
import { getProjectDb } from '../database'
import type { AssetRef } from './asset-repository'
import { BLUEPRINT_STAGES, type BlueprintStage } from '../../src/shared/chapter-stage'

/** 场景拆解条目（scenes_json 的单项，字段按需扩展） */
export interface BlueprintScene {
    id?: string
    title?: string
    summary?: string
    assetRefs?: AssetRef[]
    /** 场景目标：这一场要推进到哪一步 */
    goal?: string
    /** 场景核心冲突 */
    conflict?: string
    /** 场景反转/转折 */
    turn?: string
    /** 场景字数预算（各场景合计≈本章目标字数） */
    words?: number
    /** 场景关键道具（名称） */
    props?: string[]
    /** 出场角色（名称） */
    characters?: string[]
    /** 场景所在地点 */
    location?: string
    /** 大场景编号：同一大场景内的环境描写沿用，不重复 */
    bigSceneId?: string
    /** 相对上一场的变化：none=同一大场景不切换；small=小场景切换；big=大场景切换 */
    change?: 'none' | 'small' | 'big'
    /** 环境描写句数上限：0=不写，1=一句带过，3=最多三句 */
    envQuota?: number
}

/** 蓝图行类型（DB 蛇形命名） */
export interface BlueprintRow {
    chapter_number: number
    title: string
    role: string
    purpose: string
    key_events: string
    characters: string
    suspense_hook: string
    user_guidance: string
    notes: string
    notes_updated_at: string
    asset_refs: string
    scenes_json: string
    words_target: number
    status: string
    beat_tags: string
    created_at: string
    updated_at: string
}

/** 前端使用的驼峰接口 */
export interface BlueprintData {
    chapterNumber: number
    title: string
    role: string
    purpose: string
    keyEvents: string
    characters: string[]
    suspenseHook: string
    userGuidance: string
    notes: string
    notesUpdatedAt: string
    /** 本章引用资产（不传则保留库中已有值） */
    assetRefs?: AssetRef[]
    /** 场景拆解（不传则保留库中已有值） */
    scenes?: BlueprintScene[]
    /** 本章目标字数，0 表示沿用项目基准 */
    wordsTarget?: number
    /** 章节状态（含 'stale'：上游大纲改动后待刷新） */
    status?: BlueprintStage
    /** 节拍标签 */
    beatTags?: string[]
}

function safeParse<T>(json: string, fallback: T): T {
    if (!json) return fallback
    try { return JSON.parse(json) as T } catch { return fallback }
}

function parseAssetRefs(json: string): AssetRef[] {
    const parsed = safeParse<unknown>(json, [])
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is AssetRef =>
        !!item && typeof item === 'object'
        && typeof (item as AssetRef).type === 'string'
        && typeof (item as AssetRef).id === 'string'
        && typeof (item as AssetRef).expect === 'string')
}

function rowToData(row: BlueprintRow): BlueprintData {
    return {
        chapterNumber: row.chapter_number,
        title: row.title,
        role: row.role,
        purpose: row.purpose,
        keyEvents: row.key_events,
        characters: safeParse<string[]>(row.characters, []),
        suspenseHook: row.suspense_hook,
        userGuidance: row.user_guidance,
        notes: row.notes,
        notesUpdatedAt: row.notes_updated_at,
        assetRefs: parseAssetRefs(row.asset_refs),
        scenes: safeParse<BlueprintScene[]>(row.scenes_json, []),
        wordsTarget: row.words_target ?? 0,
        status: (BLUEPRINT_STAGES as readonly string[]).includes(row.status)
            ? row.status as BlueprintStage
            : 'planned',
        beatTags: row.beat_tags ? row.beat_tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    }
}

export class BlueprintRepository {
    /** Apply only edited/deleted rows; reject stale editors atomically. Drafts are untouched. */
    static commit(items: BlueprintData[], deleted: number[], expected: BlueprintData[]): void {
        const db = getProjectDb()
        if (!db) throw new Error('PROJECT_CLOSED')
        const numbers = [...items.map(item => item.chapterNumber), ...deleted]
        if (numbers.some(n => !Number.isSafeInteger(n) || n < 1) || new Set(numbers).size !== numbers.length) {
            throw new Error('INVALID_CHAPTER')
        }
        db.transaction(() => {
            for (const number of numbers) {
                const current = BlueprintRepository.getByChapter(number)
                const baseline = expected.find(item => item.chapterNumber === number) || null
                // P1 新增字段缺省值归一：老客户端提交的 baseline 不含这些字段时按默认值比较，
                // 避免升级后第一次保存被误判为 BLUEPRINT_CONFLICT。
                const normalize = (item: BlueprintData) => ({
                    ...item,
                    assetRefs: item.assetRefs ?? [],
                    scenes: item.scenes ?? [],
                    wordsTarget: item.wordsTarget ?? 0,
                    status: item.status ?? ('planned' as const),
                    beatTags: item.beatTags ?? [],
                })
                const currentNorm = current ? normalize(current) : null
                const baselineNorm = baseline ? normalize(baseline) : null
                // Compare canonical field order, independent of IPC object key ordering.
                const equal = currentNorm === null || baselineNorm === null ? currentNorm === baselineNorm :
                    (Object.keys(currentNorm) as Array<keyof BlueprintData>).every(key => JSON.stringify(currentNorm[key]) === JSON.stringify(baselineNorm[key]))
                if (!equal) throw new Error('BLUEPRINT_CONFLICT')
            }
            for (const item of items) BlueprintRepository.upsert(item)
            for (const number of deleted) BlueprintRepository.delete(number)
        })()
    }

    /** 获取所有蓝图（按章节号排序） */
    static getAll(): BlueprintData[] {
        const db = getProjectDb()
        if (!db) return []

        const rows = db.prepare(
            'SELECT * FROM blueprints ORDER BY chapter_number ASC'
        ).all() as BlueprintRow[]

        return rows.map(rowToData)
    }

    /** 获取单个蓝图 */
    static getByChapter(chapterNumber: number): BlueprintData | null {
        const db = getProjectDb()
        if (!db) return null

        const row = db.prepare(
            'SELECT * FROM blueprints WHERE chapter_number = ?'
        ).get(chapterNumber) as BlueprintRow | undefined

        return row ? rowToData(row) : null
    }

    /** 获取蓝图总数 */
    static count(): number {
        const db = getProjectDb()
        if (!db) return 0

        const row = db.prepare(
            'SELECT COUNT(*) as cnt FROM blueprints'
        ).get() as { cnt: number }

        return row.cnt
    }

    /** 插入或更新蓝图（新字段缺省时保留库中已有值） */
    static upsert(data: BlueprintData): void {
        const db = getProjectDb()
        if (!db) return

        if (data.status !== undefined && !(BLUEPRINT_STAGES as readonly string[]).includes(data.status)) {
            throw new Error('INVALID_CHAPTER_STATUS')
        }
        if (data.wordsTarget !== undefined && (!Number.isSafeInteger(data.wordsTarget) || data.wordsTarget < 0)) {
            throw new Error('INVALID_WORDS_TARGET')
        }
        const assetRefs = data.assetRefs === undefined ? null : JSON.stringify(data.assetRefs)
        const scenes = data.scenes === undefined ? null : JSON.stringify(data.scenes)
        const wordsTarget = data.wordsTarget ?? null
        const status = data.status ?? null
        const beatTags = data.beatTags === undefined ? null : data.beatTags.join(',')

        db.prepare(`
      INSERT INTO blueprints (
        chapter_number, title, role, purpose, key_events, characters,
        suspense_hook, user_guidance, notes, notes_updated_at,
        asset_refs, scenes_json, words_target, status, beat_tags
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        COALESCE(?, '[]'), COALESCE(?, '[]'), COALESCE(?, 0), COALESCE(?, 'planned'), COALESCE(?, ''))
      ON CONFLICT(chapter_number) DO UPDATE SET
        title = excluded.title,
        role = excluded.role,
        purpose = excluded.purpose,
        key_events = excluded.key_events,
        characters = excluded.characters,
        suspense_hook = excluded.suspense_hook,
        user_guidance = excluded.user_guidance,
        notes = excluded.notes,
        notes_updated_at = excluded.notes_updated_at,
        asset_refs = COALESCE(?, asset_refs),
        scenes_json = COALESCE(?, scenes_json),
        words_target = COALESCE(?, words_target),
        status = COALESCE(?, status),
        beat_tags = COALESCE(?, beat_tags),
        updated_at = datetime('now')
    `).run(
            data.chapterNumber,
            data.title,
            data.role,
            data.purpose,
            data.keyEvents,
            JSON.stringify(data.characters),
            data.suspenseHook,
            data.userGuidance,
            data.notes,
            data.notesUpdatedAt,
            assetRefs,
            scenes,
            wordsTarget,
            status,
            beatTags,
            assetRefs,
            scenes,
            wordsTarget,
            status,
            beatTags,
        )
    }

    /** 批量插入/更新蓝图（事务） */
    static upsertMany(items: BlueprintData[]): void {
        const db = getProjectDb()
        if (!db) return

        const tx = db.transaction(() => {
            for (const item of items) {
                BlueprintRepository.upsert(item)
            }
        })
        tx()
    }

    /** 删除蓝图 */
    static delete(chapterNumber: number): void {
        const db = getProjectDb()
        if (!db) return

        db.prepare('DELETE FROM blueprints WHERE chapter_number = ?').run(chapterNumber)
    }

    /**
     * 把指定章节的蓝图标记为 'stale'（上游大纲改动 → 下游待刷新）。
     * 只改 status 与 updated_at，不动正文与用户微操字段。返回实际更新行数。
     */
    static markStale(chapterNumbers: number[]): number {
        const db = getProjectDb()
        if (!db) return 0
        const numbers = Array.from(new Set(chapterNumbers))
            .filter((n) => Number.isSafeInteger(n) && n > 0)
        if (numbers.length === 0) return 0

        const update = db.prepare(`
      UPDATE blueprints SET status = 'stale', updated_at = datetime('now')
      WHERE chapter_number = ?
    `)
        let changes = 0
        db.transaction(() => {
            for (const chapterNumber of numbers) changes += update.run(chapterNumber).changes
        })()
        return changes
    }

    /** 仅更新 notes 字段 */
    static updateNotes(chapterNumber: number, notes: string): void {
        const db = getProjectDb()
        if (!db) return

        db.prepare(`
      UPDATE blueprints
      SET notes = ?, notes_updated_at = datetime('now'), updated_at = datetime('now')
      WHERE chapter_number = ?
    `).run(notes, chapterNumber)
    }
}
