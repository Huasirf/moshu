import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initProjectDatabase, closeProjectDatabase } from '../database'
import { AttributeRepository } from '../repositories/attribute-repository'
import { ItemEventRepository } from '../repositories/item-event-repository'
import { PipelineRepository } from '../repositories/pipeline-repository'
import {
  diffItemEvents,
  executeFinalizeWriteback,
  parseItemNames,
  type FinalizeCharacterUpdate,
} from '../services/finalize-writeback'

const updates: FinalizeCharacterUpdate[] = [
  {
    name: '林砚',
    before: {
      location: '山门',
      powerLevel: '炼气三层',
      physicalState: '右臂受伤',
      mentalState: '警惕',
      keyItems: '玄铁令、青锋剑',
    },
    after: {
      location: '青云宗',
      powerLevel: '炼气四层',
      physicalState: '右臂已愈',
      mentalState: '坚定',
      keyItems: '青锋剑、照骨镜',
    },
  },
]

function advanceToFinalized(chapterNumber: number): void {
  for (const stage of ['drafted', 'deaiified', 'reviewed', 'approved', 'finalized'] as const) {
    PipelineRepository.setStage(chapterNumber, stage)
  }
}

describe('P3-6 定稿写回', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moshu-p3-'))
    initProjectDatabase(projectDir)
  })

  afterEach(() => {
    closeProjectDatabase()
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  it('解析 keyItems 并按前后差异推导取得 / 失去事件', () => {
    expect([...parseItemNames('玄铁令、青锋剑，照骨镜')]).toEqual(['玄铁令', '青锋剑', '照骨镜'])
    const events = diffItemEvents(4, '林砚', updates[0].before, updates[0].after)
    expect(events).toHaveLength(2)
    expect(events.find((e) => e.eventType === 'acquire')?.itemName).toBe('照骨镜')
    expect(events.find((e) => e.eventType === 'lose')?.itemName).toBe('玄铁令')
  })

  it('单事务写入属性 / 道具事件并推进到 writeback_done', () => {
    PipelineRepository.setStage(4, 'drafted')
    advanceToFinalized(4)

    const result = executeFinalizeWriteback({ chapterNumber: 4, characterUpdates: updates })

    expect(result.attributeCount).toBe(4)
    expect(result.itemEventCount).toBe(2)
    expect(result.stage).toBe('writeback_done')
    expect(PipelineRepository.get(4)!.stage).toBe('writeback_done')

    expect(AttributeRepository.getValueAt('林砚', 'location', 4, 'after')?.textValue).toBe('青云宗')
    expect(AttributeRepository.getValueAt('林砚', 'powerLevel', 4, 'after')?.textValue).toBe('炼气四层')
    expect(ItemEventRepository.listByChapter(4).map((e) => `${e.eventType}:${e.itemName}`))
      .toEqual(['acquire:照骨镜', 'lose:玄铁令'])
  })

  it('重复执行幂等：属性不累积、道具事件不重复', () => {
    advanceToFinalized(4)
    executeFinalizeWriteback({ chapterNumber: 4, characterUpdates: updates })
    // 重跑同一章：writeback_done → writeback_done 属同阶段，允许重复执行
    const second = executeFinalizeWriteback({ chapterNumber: 4, characterUpdates: updates })
    expect(second.stage).toBe('writeback_done')

    expect(AttributeRepository.listValues('林砚').filter((v) => v.chapterNumber === 4)).toHaveLength(4)
    expect(ItemEventRepository.listByChapter(4)).toHaveLength(2)
  })

  it('流水线未到 finalized 时整单回滚，属性不落库', () => {
    expect(() => executeFinalizeWriteback({ chapterNumber: 9, characterUpdates: updates }))
      .toThrow(/INVALID_STAGE_TRANSITION: planned -> writeback_done \(STAGE_SKIP\)/)
    expect(AttributeRepository.listValues('林砚')).toHaveLength(0)
    expect(ItemEventRepository.listByChapter(9)).toHaveLength(0)
  })

  it('v2→v3 迁移可重复执行，道具事件表在新旧库都可用', () => {
    closeProjectDatabase()
    initProjectDatabase(projectDir)
    expect(ItemEventRepository.listByChapter(1)).toEqual([])
    expect(ItemEventRepository.listByItem('玄铁令')).toEqual([])
  })
})
