/**
 * TimelineRepository — 章纲时间线（blueprint_timeline_events / project_timeline_config）
 *
 * 用途：
 * 1. 设计章纲时同步记录「本章第几个事件、发生时间、地点、参与者」；
 * 2. 生成/审稿时把前情时间线 + 本章计划事件作为参考注入给 Gemini；
 * 3. 与已定稿 canon_timeline_events 做次序漂移校验。
 */
import { getProjectDb } from '../database'
import { CanonRepository } from './canon-repository'
import type { TimelineEvent as CanonTimelineEvent } from '../../src/services/narrative-consistency/types'
import type {
  TimelineEvent, TimelineConfig, TimelineIssue,
} from '../../src/shared/rule-timeline'

export type { TimelineEvent, TimelineConfig, TimelineIssue } from '../../src/shared/rule-timeline'

interface EventRow {
  id: number
  chapter_number: number
  scene_index: number
  seq: number
  story_time: string
  absolute_time: string
  duration: string
  location: string
  participants: string
  summary: string
  rule_refs: string
}

function parseJsonArray(text: string): string[] {
  try {
    const parsed = JSON.parse(text)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function rowToEvent(row: EventRow): TimelineEvent {
  return {
    id: row.id,
    chapterNumber: row.chapter_number,
    sceneIndex: row.scene_index,
    seq: row.seq,
    storyTime: row.story_time,
    absoluteTime: row.absolute_time,
    duration: row.duration,
    location: row.location,
    participants: parseJsonArray(row.participants),
    summary: row.summary,
    ruleRefs: parseJsonArray(row.rule_refs),
  }
}

export function listChapterEvents(chapterNumber: number): TimelineEvent[] {
  const db = getProjectDb()
  if (!db) return []
  const rows = db.prepare(`
    SELECT * FROM blueprint_timeline_events WHERE chapter_number = ? ORDER BY seq ASC, id ASC
  `).all(chapterNumber) as EventRow[]
  return rows.map(rowToEvent)
}

export function listAllEvents(limit = 500): TimelineEvent[] {
  const db = getProjectDb()
  if (!db) return []
  const rows = db.prepare(`
    SELECT * FROM blueprint_timeline_events ORDER BY chapter_number ASC, seq ASC, id ASC LIMIT ?
  `).all(limit) as EventRow[]
  return rows.map(rowToEvent)
}

/** 覆盖保存某一章的事件（按传入顺序重排 seq） */
export function replaceChapterEvents(
  chapterNumber: number,
  events: Array<Partial<TimelineEvent> & { summary: string }>,
): TimelineEvent[] {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  db.transaction(() => {
    db.prepare(`DELETE FROM blueprint_timeline_events WHERE chapter_number = ?`).run(chapterNumber)
    const insert = db.prepare(`
      INSERT INTO blueprint_timeline_events
        (chapter_number, scene_index, seq, story_time, absolute_time, duration, location, participants, summary, rule_refs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    events.forEach((e, index) => {
      insert.run(
        chapterNumber,
        Number(e.sceneIndex) || 0,
        Number(e.seq) || index + 1,
        e.storyTime ?? '',
        e.absoluteTime ?? '',
        e.duration ?? '',
        e.location ?? '',
        JSON.stringify(Array.isArray(e.participants) ? e.participants : []),
        e.summary ?? '',
        JSON.stringify(Array.isArray(e.ruleRefs) ? e.ruleRefs : []),
      )
    })
  })()
  return listChapterEvents(chapterNumber)
}

export function getTimelineConfig(): TimelineConfig {
  const db = getProjectDb()
  if (!db) return { calendar: '', eraStart: '', timeFlow: '', notes: '' }
  const row = db.prepare(`SELECT calendar, era_start, time_flow, notes FROM project_timeline_config WHERE id = 'main'`)
    .get() as { calendar: string; era_start: string; time_flow: string; notes: string } | undefined
  if (!row) return { calendar: '', eraStart: '', timeFlow: '', notes: '' }
  return { calendar: row.calendar, eraStart: row.era_start, timeFlow: row.time_flow, notes: row.notes }
}

export function saveTimelineConfig(config: Partial<TimelineConfig>): TimelineConfig {
  const db = getProjectDb()
  if (!db) throw new Error('项目数据库未打开')
  const current = getTimelineConfig()
  const next: TimelineConfig = {
    calendar: config.calendar ?? current.calendar,
    eraStart: config.eraStart ?? current.eraStart,
    timeFlow: config.timeFlow ?? current.timeFlow,
    notes: config.notes ?? current.notes,
  }
  db.prepare(`
    INSERT INTO project_timeline_config (id, calendar, era_start, time_flow, notes)
    VALUES ('main', ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      calendar = excluded.calendar, era_start = excluded.era_start,
      time_flow = excluded.time_flow, notes = excluded.notes
  `).run(next.calendar, next.eraStart, next.timeFlow, next.notes)
  return next
}

/** 解析「绝对时间」为可比较数值（支持纯数字、天数、日期） */
function toComparable(time: string): number | null {
  const trimmed = (time || '').trim()
  if (!trimmed) return null
  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) return numeric
  const dayMatch = /第\s*(\d+)\s*[天日]/.exec(trimmed)
  if (dayMatch) return Number(dayMatch[1])
  const dateMatch = /(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/.exec(trimmed)
  if (dateMatch) {
    return Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])) / 86_400_000
  }
  return null
}

/**
 * 时间线校验：
 * - 同一章内 absolute_time 必须单调不减；
 * - 跨章：下一章事件的绝对时间不得早于上一章最后事件（除非明确标注回忆/倒叙）。
 */
export function validateTimeline(): TimelineIssue[] {
  const issues: TimelineIssue[] = []
  const events = listAllEvents(2000)
  if (events.length === 0) return issues

  let lastComparable: { value: number; chapter: number } | null = null
  let prevInChapter: number | null = null
  let prevChapter = events[0].chapterNumber

  for (const event of events) {
    if (event.chapterNumber !== prevChapter) {
      prevChapter = event.chapterNumber
      prevInChapter = null
    }
    const value = toComparable(event.absoluteTime)
    if (value === null) continue

    if (prevInChapter !== null && value < prevInChapter) {
      issues.push({
        level: 'error', chapterNumber: event.chapterNumber, eventId: event.id,
        message: `第 ${event.chapterNumber} 章内时间倒退：事件 #${event.seq}「${event.storyTime || event.absoluteTime}」早于前一事件`,
      })
    }
    if (lastComparable && event.chapterNumber > lastComparable.chapter && value < lastComparable.value) {
      issues.push({
        level: 'warning', chapterNumber: event.chapterNumber, eventId: event.id,
        message: `跨章时间倒退：第 ${event.chapterNumber} 章首事件早于第 ${lastComparable.chapter} 章末事件（如果是回忆/倒叙请在摘要注明）`,
      })
    }
    prevInChapter = value
    lastComparable = { value, chapter: event.chapterNumber }
  }

  return issues
}

/**
 * 生成时间线参考文本：
 * - 前情：已定稿且 confirmed 的 canon 事件优先；没有 canon 的旧章回退章纲计划
 * - 本章计划事件（按序）
 * - 紧接的后续 3 章计划（防止提前发生）
 *
 * pending / rejected 的 canon 事件不参与生成与审稿，避免把待确认时间当成事实。
 */
export function buildTimelineContext(chapterNumber: number): string {
  const all = listAllEvents(2000)
  const config = getTimelineConfig()
  const canonPrevious = CanonRepository.getTimelineUpTo(Math.max(1, chapterNumber - 1))
  const canonChapters = new Set(canonPrevious.map((e) => e.chapterNumber))
  // 已被 canon 覆盖的章节不再重复展示章纲计划，避免同一事件两套时间
  const planPrevious = all
    .filter((e) => e.chapterNumber < chapterNumber && !canonChapters.has(e.chapterNumber))
    .slice(-12)
  const current = all.filter((e) => e.chapterNumber === chapterNumber)
  const upcoming = all.filter((e) => e.chapterNumber > chapterNumber && e.chapterNumber <= chapterNumber + 3)

  const formatEvent = (e: TimelineEvent) =>
    `  ${e.seq}. [${e.storyTime || e.absoluteTime || '时间未填'}] ${e.location ? `${e.location}·` : ''}${e.summary}`
  const formatCanon = (e: CanonTimelineEvent) =>
    `  [第${e.chapterNumber}章]${e.absoluteTime ? `第${e.absoluteTime}天` : ''}${e.duration ? `（历时${e.duration}）` : ''} ${e.location ? `${e.location}·` : ''}${e.summary}${e.timeFlow === 'flashback' ? '（回忆）' : ''}`

  const parts: string[] = []
  if (config.calendar || config.timeFlow || config.notes) {
    parts.push(`【时间设定】${[config.calendar, config.eraStart && `纪元起点：${config.eraStart}`, config.timeFlow && `流速：${config.timeFlow}`, config.notes].filter(Boolean).join('；')}`)
  }
  if (canonPrevious.length > 0) {
    parts.push(`【前情时间线（已定稿）】\n${canonPrevious.slice(-16).map(formatCanon).join('\n')}`)
  }
  if (planPrevious.length > 0) {
    parts.push(`【前情时间线（章纲计划，未定稿部分）】\n${planPrevious.map((e) => `  [第${e.chapterNumber}章]${e.storyTime || e.absoluteTime || ''} ${e.location ? `${e.location}·` : ''}${e.summary}`).join('\n')}`)
  }
  if (current.length > 0) {
    parts.push(`【本章时间线（计划，必须按此次序与时间发生）】\n${current.map(formatEvent).join('\n')}`)
  }
  if (upcoming.length > 0) {
    parts.push(`【后续章节计划（不得提前发生）】\n${upcoming.map((e) => `  [第${e.chapterNumber}章]${e.storyTime || e.absoluteTime || ''} ${e.summary}`).join('\n')}`)
  }
  return parts.join('\n\n')
}
