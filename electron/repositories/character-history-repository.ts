/**
 * CharacterHistoryRepository — 角色卡 2.0 的按章留痕
 *
 * - character_state_history：字段级变更流水（固定档案不写，只写动态状态白名单字段）
 * - character_chapter_snapshots：每章定稿后的完整动态快照，下一章审稿/写稿按 N-1 取用
 *
 * 两张表都随定稿写回在同一事务内落库，保证「正文定稿了、状态历史却没写」不会发生。
 */
import { getProjectDb } from '../database'
import type { CharacterStateData } from './character-repository'
import { diffDynamicState } from './character-state-diff'

export interface CharacterStateHistoryRow {
    id: number
    characterName: string
    chapterNumber: number
    field: string
    before: unknown
    after: unknown
    source: string
    createdAt: string
}

export interface CharacterSnapshotRow {
    chapterNumber: number
    characterName: string
    state: CharacterStateData | null
}

function parseJsonSafe(raw: unknown): unknown {
    if (typeof raw !== 'string' || !raw) return null
    try {
        return JSON.parse(raw)
    } catch {
        return null
    }
}

export class CharacterHistoryRepository {
    /** 记录一章的角色状态变更 + 章末快照（调用方负责事务） */
    static recordChapterState(input: {
        characterName: string
        chapterNumber: number
        before?: Partial<CharacterStateData> | null
        after: Partial<CharacterStateData>
        source?: string
    }): number {
        const db = getProjectDb()
        if (!db) return 0
        const { characterName, chapterNumber, before, after } = input
        if (!characterName || !Number.isSafeInteger(chapterNumber) || chapterNumber < 1) return 0

        const changes = diffDynamicState(before, after)
        // 同一章可能重复定稿（修订后再次定稿），先清掉本章旧流水再写，保证台账幂等
        db.prepare(`
            DELETE FROM character_state_history
            WHERE character_name = ? AND chapter_number = ?
        `).run(characterName, chapterNumber)
        const insert = db.prepare(`
            INSERT INTO character_state_history
              (character_name, chapter_number, field, before_json, after_json, source)
            VALUES (?, ?, ?, ?, ?, ?)
        `)
        for (const change of changes) {
            insert.run(
                characterName,
                chapterNumber,
                change.field,
                JSON.stringify(change.before),
                JSON.stringify(change.after),
                input.source ?? 'finalize',
            )
        }

        // 快照始终写入（即使本章无变化），保证审稿按 N-1 取状态时能命中最近一章
        db.prepare(`
            INSERT INTO character_chapter_snapshots (chapter_number, character_name, state_json)
            VALUES (?, ?, ?)
            ON CONFLICT(chapter_number, character_name) DO UPDATE SET state_json = excluded.state_json
        `).run(chapterNumber, characterName, JSON.stringify(after ?? {}))

        return changes.length
    }

    /**
     * 删除某章产生的变更流水与章末快照（取消定稿回滚用）。
     * 同一事务内调用，避免「流水删了、快照还在」的半成品。
     */
    static deleteChapter(chapterNumber: number): void {
        const db = getProjectDb()
        if (!db) return
        db.prepare('DELETE FROM character_state_history WHERE chapter_number = ?').run(chapterNumber)
        db.prepare('DELETE FROM character_chapter_snapshots WHERE chapter_number = ?').run(chapterNumber)
    }

    /** 某角色的状态变更流水（最近的在前） */
    static getHistory(characterName: string, limit = 100): CharacterStateHistoryRow[] {
        const db = getProjectDb()
        if (!db) return []
        const rows = db.prepare(`
            SELECT * FROM character_state_history
            WHERE character_name = ?
            ORDER BY chapter_number DESC, id DESC
            LIMIT ?
        `).all(characterName, Math.max(1, Math.min(500, limit))) as Array<Record<string, unknown>>

        return rows.map((row) => ({
            id: row.id as number,
            characterName: row.character_name as string,
            chapterNumber: row.chapter_number as number,
            field: row.field as string,
            before: parseJsonSafe(row.before_json),
            after: parseJsonSafe(row.after_json),
            source: (row.source as string) || '',
            createdAt: (row.created_at as string) || '',
        }))
    }

    /** 某角色在「第 chapterNumber 章末」的快照；无则返回 null */
    static getSnapshot(characterName: string, chapterNumber: number): CharacterStateData | null {
        const db = getProjectDb()
        if (!db) return null
        const row = db.prepare(`
            SELECT state_json FROM character_chapter_snapshots
            WHERE character_name = ? AND chapter_number = ?
        `).get(characterName, chapterNumber) as { state_json: string } | undefined
        return row ? (parseJsonSafe(row.state_json) as CharacterStateData | null) : null
    }

    /** 某章末全部角色的快照（审稿按 N-1 取用） */
    static getSnapshotMap(chapterNumber: number): Record<string, CharacterStateData> {
        const db = getProjectDb()
        if (!db) return {}
        const rows = db.prepare(`
            SELECT character_name, state_json FROM character_chapter_snapshots
            WHERE chapter_number = ?
        `).all(chapterNumber) as Array<{ character_name: string; state_json: string }>

        const map: Record<string, CharacterStateData> = {}
        for (const row of rows) {
            const state = parseJsonSafe(row.state_json)
            if (state && typeof state === 'object') map[row.character_name] = state as CharacterStateData
        }
        return map
    }
}
