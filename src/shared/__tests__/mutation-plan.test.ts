import { describe, expect, it } from 'vitest'
import {
  buildStepChanges,
  collectAffectedChapters,
  collectTouchedEntities,
  createMutationPlan,
  deriveMutationRisk,
  validateMutationPlan,
  type MutationStep,
} from '../mutation-plan'

const step = (over: Partial<MutationStep> = {}): MutationStep => ({
  id: 's1',
  op: 'update_asset',
  title: '更新资产',
  payload: { id: 1 },
  risk: 'low',
  ...over,
})

describe('MutationPlan 协议', () => {
  it('合法计划通过校验', () => {
    const plan = createMutationPlan({
      intent: '把第 3 章主角改成断臂，后续设定跟着改',
      steps: [
        step({ id: 's1', op: 'update_character', payload: { name: '林砚' } }),
        step({ id: 's2', op: 'update_blueprint', chapterNumber: 4, payload: { keyEvents: '断臂后遗症' } }),
      ],
    })
    expect(validateMutationPlan(plan)).toEqual({ valid: true, errors: [] })
    expect(plan.affectedChapters).toEqual([4])
    expect(plan.touchedEntities).toContain('林砚')
    expect(plan.needsConfirm).toBe(true)
  })

  it('拒绝空步骤与重复 id', () => {
    expect(validateMutationPlan({ intent: 'x', steps: [] }).valid).toBe(false)
    const plan = { intent: 'x', steps: [step({ id: 'a' }), step({ id: 'a' })], risk: 'low' }
    const result = validateMutationPlan(plan)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.includes('重复'))).toBe(true)
  })

  it('按 op 校验 payload 必需字段', () => {
    const badAsset = validateMutationPlan({
      intent: 'x',
      steps: [step({ op: 'create_asset', payload: { entityType: 'item' } })],
      risk: 'medium',
    })
    expect(badAsset.valid).toBe(false)
    expect(badAsset.errors.some(e => e.includes('name'))).toBe(true)

    const badStage = validateMutationPlan({
      intent: 'x',
      steps: [step({ op: 'set_pipeline_stage', chapterNumber: 2, payload: { stage: 'unknown' } })],
      risk: 'medium',
    })
    expect(badStage.errors.some(e => e.includes('stage'))).toBe(true)

    const selfRelation = validateMutationPlan({
      intent: 'x',
      steps: [step({ op: 'update_relation', payload: { fromId: 'a', toId: 'a', relationType: 'ally' } })],
      risk: 'medium',
    })
    expect(selfRelation.errors.some(e => e.includes('自关系'))).toBe(true)
  })

  it('汇总章节与实体，风险按影响面升级', () => {
    const steps: MutationStep[] = [
      step({ id: 'a', op: 'update_blueprint', chapterNumber: 5, payload: {} }),
      step({ id: 'b', op: 'set_attribute', chapterNumber: 5, payload: { entityId: '林砚', attrKey: 'arm', value: '断臂' } }),
      step({ id: 'c', op: 'update_blueprint', chapterNumber: 3, payload: {} }),
    ]
    expect(collectAffectedChapters(steps)).toEqual([3, 5])
    expect(collectTouchedEntities(steps)).toEqual(['林砚'])
    expect(deriveMutationRisk(steps)).toBe('medium')
    expect(deriveMutationRisk([step({ op: 'delete_asset', payload: { id: 9 } })])).toBe('high')
  })
})

describe('确认卡片字段级 diff', () => {
  it('更新类操作只展示真正变化的字段', () => {
    const changes = buildStepChanges(
      step({ op: 'update_character', payload: { name: '林砚', role: '主角', background: '断臂' } }),
      { name: '林砚', role: '主角', background: '完好' },
    )
    expect(changes).toEqual([{ field: 'background', before: '完好', after: '断臂' }])
  })

  it('新建与删除展示完整字段', () => {
    const created = buildStepChanges(
      step({ op: 'create_asset', payload: { entityType: 'item', name: '玄铁令', summary: '信物' } }),
      null,
    )
    expect(created.find(c => c.field === 'name')).toEqual({ field: 'name', before: null, after: '玄铁令' })

    const deleted = buildStepChanges(
      step({ op: 'delete_asset', payload: { id: 3 } }),
      { id: 3, entityType: 'item', name: '玄铁令', summary: '', updatedAt: '2026-01-01' },
    )
    expect(deleted.some(c => c.field === 'name' && c.after === null)).toBe(true)
    expect(deleted.some(c => c.field === 'id')).toBe(false)
  })

  it('属性与流水线展示前后值', () => {
    expect(buildStepChanges(
      step({ op: 'set_attribute', chapterNumber: 3, payload: { entityId: '林砚', attrKey: 'arm', value: 2 } }),
      { numValue: 1, textValue: null },
    )).toEqual([{ field: 'arm', before: 1, after: 2 }])

    expect(buildStepChanges(
      step({ op: 'set_pipeline_stage', chapterNumber: 3, payload: { stage: 'drafted' } }),
      { stage: 'planned' },
    )).toEqual([{ field: 'stage', before: 'planned', after: 'drafted' }])
  })
})
