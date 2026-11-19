import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initProjectDatabase, closeProjectDatabase } from '../database'
import { BlueprintRepository } from '../repositories/blueprint-repository'
import type { BlueprintData } from '../repositories/blueprint-repository'
import { AssetRepository } from '../repositories/asset-repository'
import { AttributeRepository } from '../repositories/attribute-repository'
import { RelationRepository } from '../repositories/relation-repository'
import { PipelineRepository } from '../repositories/pipeline-repository'
import { StyleRepository } from '../repositories/style-repository'
import { ReviewFindingRepository } from '../repositories/review-finding-repository'

/** P1 数据层：资产库 / 属性 / 关系 / 流水线 / 风格 / 审稿台账 的读写路径 */

function makeBlueprint(overrides: Partial<BlueprintData> = {}): BlueprintData {
  return {
    chapterNumber: 1,
    title: '第一章',
    role: '开篇',
    purpose: '引出主角',
    keyEvents: '主角觉醒',
    characters: ['林轩'],
    suspenseHook: '神秘令牌',
    userGuidance: '',
    notes: '',
    notesUpdatedAt: '',
    ...overrides,
  }
}

describe('P1 数据层 Repository', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moshu-p1-'))
    initProjectDatabase(projectDir)
  })

  afterEach(() => {
    closeProjectDatabase()
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  describe('蓝图资产引用', () => {
    it('写入并读回 asset_refs / scenes / wordsTarget / status / beatTags', () => {
      BlueprintRepository.upsert(makeBlueprint({
        assetRefs: [{ type: 'item', id: '7', expect: 'acquire' }],
        scenes: [{ id: 's1', title: '山门', summary: '主角入门' }],
        wordsTarget: 3200,
        status: 'drafted',
        beatTags: ['激励事件', '转折'],
      }))

      const saved = BlueprintRepository.getByChapter(1)!
      expect(saved.assetRefs).toEqual([{ type: 'item', id: '7', expect: 'acquire' }])
      expect(saved.scenes?.[0].title).toBe('山门')
      expect(saved.wordsTarget).toBe(3200)
      expect(saved.status).toBe('drafted')
      expect(saved.beatTags).toEqual(['激励事件', '转折'])
    })

    it('不带新字段的旧调用方式不会清空已存的 P1 字段', () => {
      BlueprintRepository.upsert(makeBlueprint({
        assetRefs: [{ type: 'location', id: '3', expect: 'enter' }],
        wordsTarget: 4000,
        status: 'reviewed',
      }))
      // 模拟旧版 UI：只提交原有字段
      BlueprintRepository.upsert(makeBlueprint({ title: '第一章（改）' }))

      const saved = BlueprintRepository.getByChapter(1)!
      expect(saved.title).toBe('第一章（改）')
      expect(saved.assetRefs).toEqual([{ type: 'location', id: '3', expect: 'enter' }])
      expect(saved.wordsTarget).toBe(4000)
      expect(saved.status).toBe('reviewed')
    })

    it('非法章节状态被拒绝', () => {
      expect(() => BlueprintRepository.upsert(makeBlueprint({ status: 'unknown' as never })))
        .toThrow(/INVALID_CHAPTER_STATUS/)
    })
  })

  describe('资产库', () => {
    it('按类型 upsert / 查询 / 删除，同名同类型幂等合并', () => {
      const id = AssetRepository.upsert({
        entityType: 'item',
        name: '玄铁令',
        summary: '信物',
        tags: ['信物'],
        typeData: { grade: '地阶' },
      })
      expect(id).toBeGreaterThan(0)

      const again = AssetRepository.upsert({ entityType: 'item', name: '玄铁令', description: '更新描述' })
      expect(again).toBe(id)
      expect(AssetRepository.count('item')).toBe(1)
      expect(AssetRepository.getById(id)!.description).toBe('更新描述')

      AssetRepository.upsert({ entityType: 'location', name: '青云宗' })
      expect(AssetRepository.getAll().map((a) => a.entityType)).toEqual(['item', 'location'])
      expect(AssetRepository.getAll('location')).toHaveLength(1)

      AssetRepository.delete(id)
      expect(AssetRepository.getById(id)).toBeNull()
    })

    it('type_data 与入参校验', () => {
      expect(() => AssetRepository.upsert({ entityType: 'item', name: '  ' })).toThrow(/INVALID_ASSET_NAME/)
      expect(() => AssetRepository.upsert({ entityType: 'spaceship' as never, name: 'x' }))
        .toThrow(/INVALID_ENTITY_TYPE/)
      expect(() => AssetRepository.upsert({ entityType: 'number', name: '好感度', typeData: { value: 'high' } }))
        .toThrow(/INVALID_NUMBER_VALUE/)
      expect(() => AssetRepository.upsert({ entityType: 'item', name: 'x', typeData: [] as never }))
        .toThrow(/INVALID_TYPE_DATA/)
    })
  })

  describe('属性系统', () => {
    beforeEach(() => {
      AttributeRepository.upsertDef({
        key: 'constitution',
        entityType: 'character',
        label: '体质',
        valueType: 'number',
        enumValues: [],
        unit: '',
        minValue: 0,
        maxValue: 100,
        showInPanel: true,
        sortOrder: 1,
      })
    })

    it('第 5 章 +2 后，第 6 章读回累计值', () => {
      AttributeRepository.setValue({ entityId: '林轩', attrKey: 'constitution', chapterNumber: 1, numValue: 10 })
      const changed = AttributeRepository.setValue({
        entityId: '林轩', attrKey: 'constitution', chapterNumber: 5, numValue: 12,
      })
      expect(changed.deltaNum).toBe(2)

      const atChapter6 = AttributeRepository.getValueAt('林轩', 'constitution', 6)!
      expect(atChapter6.numValue).toBe(12)
      expect(atChapter6.chapterNumber).toBe(5)

      // 第 4 章仍是旧值
      expect(AttributeRepository.getValueAt('林轩', 'constitution', 4)!.numValue).toBe(10)
      // 第 5 章 before 仍是旧值，after 是新值
      expect(AttributeRepository.getValueAt('林轩', 'constitution', 5, 'before')!.numValue).toBe(10)
      expect(AttributeRepository.getValueAt('林轩', 'constitution', 5, 'after')!.numValue).toBe(12)
    })

    it('越界值与非法阶段被拒绝；面板按 show_in_panel 输出', () => {
      expect(() => AttributeRepository.setValue({
        entityId: '林轩', attrKey: 'constitution', chapterNumber: 1, numValue: 1000,
      })).toThrow(/ATTRIBUTE_OUT_OF_RANGE/)
      expect(() => AttributeRepository.setValue({
        entityId: '林轩', attrKey: 'constitution', chapterNumber: 1, numValue: 1, phase: 'middle' as never,
      })).toThrow(/INVALID_ATTRIBUTE_PHASE/)

      AttributeRepository.setValue({ entityId: '林轩', attrKey: 'constitution', chapterNumber: 2, numValue: 20 })
      const panel = AttributeRepository.getPanelState('林轩', 3, 'after', 'character')
      expect(panel).toHaveLength(1)
      expect(panel[0].def.label).toBe('体质')
      expect(panel[0].value?.numValue).toBe(20)
    })

    it('属性定义列表按类型与排序返回', () => {
      AttributeRepository.upsertDef({
        key: 'mood',
        entityType: 'character',
        label: '心境',
        valueType: 'text',
        enumValues: [],
        unit: '',
        minValue: null,
        maxValue: null,
        showInPanel: true,
        sortOrder: 0,
      })
      expect(AttributeRepository.listDefs('character').map((d) => d.key)).toEqual(['mood', 'constitution'])
      expect(AttributeRepository.listDefs('item')).toHaveLength(0)
    })
  })

  describe('关系网', () => {
    it('upsert / 查询 / 删除', () => {
      RelationRepository.upsert({
        fromId: '林轩', toId: '苏瑶', relationType: '同门', affection: 30, sinceChapter: 1,
      })
      expect(RelationRepository.list('林轩')).toHaveLength(1)
      expect(RelationRepository.listForEntity('苏瑶')).toHaveLength(1)

      RelationRepository.upsert({
        fromId: '林轩', toId: '苏瑶', relationType: '同门', affection: 55, lastChangedChapter: 8,
      })
      expect(RelationRepository.get('林轩', '苏瑶', '同门')!.affection).toBe(55)

      expect(() => RelationRepository.upsert({ fromId: '林轩', toId: '林轩', relationType: '自恋' }))
        .toThrow(/SELF_RELATION/)

      RelationRepository.delete('林轩', '苏瑶', '同门')
      expect(RelationRepository.list()).toHaveLength(0)
    })
  })

  describe('章节流水线', () => {
    it('设置与逐级推进阶段，非法阶段被拒绝', () => {
      PipelineRepository.setStage(1, 'drafted')
      expect(PipelineRepository.get(1)!.stage).toBe('drafted')
      PipelineRepository.setStage(1, 'deaiified')
      PipelineRepository.setStage(1, 'reviewed')
      PipelineRepository.setStage(2, 'planned')
      expect(PipelineRepository.getAll().map((s) => s.stage)).toEqual(['reviewed', 'planned'])
      expect(() => PipelineRepository.setStage(1, 'done' as never)).toThrow(/INVALID_CHAPTER_STAGE/)
      expect(() => PipelineRepository.setStage(0, 'planned')).toThrow(/INVALID_CHAPTER_NUMBER/)
    })

    it('未 deaiified 不允许 reviewed（跳级被拒绝）', () => {
      PipelineRepository.setStage(5, 'drafted')
      expect(() => PipelineRepository.setStage(5, 'reviewed'))
        .toThrow(/INVALID_STAGE_TRANSITION: drafted -> reviewed \(STAGE_SKIP\)/)
      expect(PipelineRepository.get(5)!.stage).toBe('drafted')
    })

    it('同一阶段重复写入幂等', () => {
      PipelineRepository.setStage(6, 'planned')
      const again = PipelineRepository.setStage(6, 'planned')
      expect(again.stage).toBe('planned')
      expect(PipelineRepository.get(6)!.stage).toBe('planned')
    })

    it('回退阶段被拒绝（需显式重置）', () => {
      PipelineRepository.setStage(7, 'drafted')
      PipelineRepository.setStage(7, 'deaiified')
      expect(() => PipelineRepository.setStage(7, 'drafted'))
        .toThrow(/INVALID_STAGE_TRANSITION: deaiified -> drafted \(STAGE_REWIND\)/)
    })

    it('显式回退一步：带旧阶段校验，起点不可回退', () => {
      PipelineRepository.setStage(8, 'drafted')
      PipelineRepository.setStage(8, 'deaiified')
      const rewind = PipelineRepository.rewind(8, 'deaiified')
      expect(rewind.stage).toBe('drafted')
      expect(PipelineRepository.get(8)!.stage).toBe('drafted')

      // 确认框展示的旧阶段与库里不一致时拒绝，避免多退一步
      expect(() => PipelineRepository.rewind(8, 'deaiified')).toThrow(/STAGE_STALE/)

      PipelineRepository.setStage(9, 'planned')
      expect(() => PipelineRepository.rewind(9, 'planned')).toThrow(/STAGE_REWIND_AT_START/)
      expect(() => PipelineRepository.rewind(10, 'planned')).toThrow(/PIPELINE_NOT_FOUND/)
    })
  })

  describe('风格档案', () => {
    it('新建 / 切换生效 / 更新规则', () => {
      const a = StyleRepository.create({ name: '冷峻', rules: ['少用形容词'], isActive: true })
      const b = StyleRepository.create({ name: '轻快', rules: ['短句'], isActive: true })

      expect(StyleRepository.getActive()!.id).toBe(b)
      expect(StyleRepository.list().map((s) => s.isActive)).toEqual([true, false])

      StyleRepository.setActive(a)
      expect(StyleRepository.getActive()!.id).toBe(a)

      StyleRepository.update(a, { name: '冷峻', rules: ['少用形容词', '避免排比'], promptHint: '克制', isActive: true })
      expect(StyleRepository.getById(a)!.rules).toHaveLength(2)
      expect(StyleRepository.getActive()!.promptHint).toBe('克制')

      StyleRepository.delete(b)
      expect(StyleRepository.list()).toHaveLength(1)
    })
  })

  describe('审稿台账', () => {
    it('新增 / 按章与状态查询 / 更新状态 / 统计未解决错误', () => {
      ReviewFindingRepository.add({
        chapterNumber: 3, stage: 'draft', category: 'continuity', severity: 'error', message: '与第 1 章设定冲突',
      })
      ReviewFindingRepository.add({
        chapterNumber: 3, stage: 'deaiify', category: 'style', severity: 'warning', message: '句式重复',
      })
      expect(ReviewFindingRepository.listByChapter(3)).toHaveLength(2)
      expect(ReviewFindingRepository.listByChapter(3, 'open')).toHaveLength(2)
      expect(ReviewFindingRepository.countOpenErrors(3)).toBe(1)

      const [latest] = ReviewFindingRepository.listByChapter(3)
      ReviewFindingRepository.updateStatus(latest.id, 'fixed')
      expect(ReviewFindingRepository.countOpenErrors(3)).toBe(1) // latest 是 warning
      const errors = ReviewFindingRepository.listByChapter(3).filter((f) => f.severity === 'error')
      ReviewFindingRepository.updateStatus(errors[0].id, 'fixed')
      expect(ReviewFindingRepository.countOpenErrors(3)).toBe(0)

      expect(() => ReviewFindingRepository.updateStatus(errors[0].id, 'unknown' as never))
        .toThrow(/INVALID_FINDING_STATUS/)
      expect(() => ReviewFindingRepository.add({
        chapterNumber: 3, stage: 'draft', category: 'x', severity: 'fatal' as never, message: 'x',
      })).toThrow(/INVALID_FINDING_SEVERITY/)
    })

    it('批量写入在一个事务里完成', () => {
      const ids = ReviewFindingRepository.addMany([
        { chapterNumber: 4, stage: 'review', category: 'logic', severity: 'info', message: 'a' },
        { chapterNumber: 4, stage: 'review', category: 'logic', severity: 'warning', message: 'b' },
      ])
      expect(ids).toHaveLength(2)
      expect(ReviewFindingRepository.listByChapter(4)).toHaveLength(2)
    })
  })
})
