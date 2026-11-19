/**
 * 定稿写回（P3-6，主进程）
 *
 * 把定稿时角色卡的前后状态写回 P1 数据层，并在**单个事务**内完成：
 *   - attribute_values：location / powerLevel / physicalState / mentalState 的章节快照
 *   - canon_item_events：keyItems 前后差异 → acquire / lose
 *   - chapter_pipeline：推进到 writeback_done
 *
 * 任一步失败整体回滚，不会出现「属性写了、道具没写」的半成品。
 * 重复执行幂等：属性走 PK upsert，道具事件按章 delete+insert。
 *
 * DR-08 已定稿：只写显式结构化关系；定稿抽取结果里没有结构化关系变更，
 * 将来关系抽取产出显式变更时，再在此事务内追加。
 */
import { getProjectDb } from '../database'
import { AttributeRepository } from '../repositories/attribute-repository'
import { ItemEventRepository, type CanonItemEventInput } from '../repositories/item-event-repository'
import { PipelineRepository } from '../repositories/pipeline-repository'
import { CharacterHistoryRepository } from '../repositories/character-history-repository'

export interface FinalizeCharacterState {
  location?: string
  powerLevel?: string
  physicalState?: string
  mentalState?: string
  keyItems?: string
  recentEvents?: string
  knownInfo?: string
  /** 天赋 / 体质（结构化） */
  talents?: string[]
  /** 功法 / 技能（结构化） */
  skills?: string[]
}

export interface FinalizeCharacterUpdate {
  name: string
  before?: FinalizeCharacterState | null
  after: FinalizeCharacterState
}

export interface FinalizeWritebackInput {
  chapterNumber: number
  characterUpdates: FinalizeCharacterUpdate[]
}

export interface FinalizeWritebackResult {
  attributeCount: number
  itemEventCount: number
  /** 写入角色状态历史表的字段变更条数 */
  historyCount: number
  stage: string
}

/** 写回 attribute_values 的规范字段（与角色卡 currentState 同名） */
const ATTRIBUTE_KEYS: Array<keyof FinalizeCharacterState> = [
  'location',
  'powerLevel',
  'physicalState',
  'mentalState',
]

/** keyItems 是顿号/逗号分隔的自由文本，拆成道具名集合 */
export function parseItemNames(raw?: string | null): Set<string> {
  return new Set(
    (raw ?? '')
      .split(/[、,，;；/|\s]+/)
      .map((name) => name.trim())
      .filter((name) => name.length >= 2),
  )
}

/** 由前后 keyItems 差异推导道具事件 */
export function diffItemEvents(
  chapterNumber: number,
  entityId: string,
  before: FinalizeCharacterState | null | undefined,
  after: FinalizeCharacterState,
): CanonItemEventInput[] {
  const beforeItems = parseItemNames(before?.keyItems)
  const afterItems = parseItemNames(after.keyItems)
  const events: CanonItemEventInput[] = []
  for (const itemName of afterItems) {
    if (!beforeItems.has(itemName)) {
      events.push({ chapterNumber, entityId, itemName, eventType: 'acquire', note: 'finalize' })
    }
  }
  for (const itemName of beforeItems) {
    if (!afterItems.has(itemName)) {
      events.push({ chapterNumber, entityId, itemName, eventType: 'lose', note: 'finalize' })
    }
  }
  return events
}

/** 执行定稿写回（单事务）；调用前 chapter_pipeline 应已处于 finalized */
export function executeFinalizeWriteback(input: FinalizeWritebackInput): FinalizeWritebackResult {
  const db = getProjectDb()
  if (!db) throw new Error('PROJECT_CLOSED')
  const { chapterNumber, characterUpdates } = input
  if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) throw new Error('INVALID_CHAPTER_NUMBER')

  let attributeCount = 0
  let itemEventCount = 0
  let historyCount = 0
  let stage = 'writeback_done'

  db.transaction(() => {
    const events: CanonItemEventInput[] = []

    for (const update of characterUpdates) {
      const name = (update.name ?? '').trim()
      if (!name || !update.after) continue

      for (const key of ATTRIBUTE_KEYS) {
        const value = update.after[key]
        if (typeof value !== 'string' || !value.trim()) continue
        AttributeRepository.setValue({
          entityId: name,
          attrKey: key,
          chapterNumber,
          phase: 'after',
          textValue: value,
          source: 'finalize',
        })
        attributeCount++
      }

      events.push(...diffItemEvents(chapterNumber, name, update.before, update.after))

      // 角色卡 2.0：字段级变更流水 + 本章末快照，与属性/道具写回同一事务
      historyCount += CharacterHistoryRepository.recordChapterState({
        characterName: name,
        chapterNumber,
        before: update.before ?? null,
        after: update.after,
        source: 'finalize',
      })
    }

    itemEventCount = ItemEventRepository.replaceChapter(chapterNumber, events)
    stage = PipelineRepository.setStage(chapterNumber, 'writeback_done').stage
  })()

  return { attributeCount, itemEventCount, historyCount, stage }
}
