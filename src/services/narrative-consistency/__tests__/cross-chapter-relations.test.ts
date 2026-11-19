import { describe, expect, it } from 'vitest'
import { checkCrossChapterRelations, type CrossChapterRelationFact } from '../consistency-gate.service'

function relation(overrides: Partial<CrossChapterRelationFact> = {}): CrossChapterRelationFact {
  return {
    fromName: '林砚',
    toName: '苏瑶',
    relationType: '同伴',
    affection: 20,
    status: 'active',
    ...overrides,
  }
}

describe('跨章关系冲突（P3-4）', () => {
  it('关系网已决裂，正文写成挚友 → warning', () => {
    const issues = checkCrossChapterRelations(
      8,
      '林砚与苏瑶是多年挚友，彼此信任。',
      [relation({ status: 'ended' })],
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'warning',
      category: 'relationship',
      chapterNumber: 8,
      characters: ['林砚', '苏瑶'],
    })
    expect(issues[0].evidence).toContain('挚友')
  })

  it('关系类型为宿敌且好感度为负 → warning', () => {
    const issues = checkCrossChapterRelations(
      9,
      '林砚和苏瑶相视一笑，两人是过命的兄弟。',
      [relation({ relationType: '宿敌', affection: -80 })],
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('宿敌')
  })

  it('关系正常时不报', () => {
    expect(checkCrossChapterRelations(
      3,
      '林砚与苏瑶是多年挚友，彼此信任。',
      [relation()],
    )).toEqual([])
  })

  it('两个名字不在同一句时不报（避免跨场景误判）', () => {
    expect(checkCrossChapterRelations(
      4,
      '林砚独自走进雪原。\n苏瑶在城中等待。',
      [relation({ status: 'ended' })],
    )).toEqual([])
  })

  it('名字未解析（空串）时跳过', () => {
    expect(checkCrossChapterRelations(
      5,
      '林砚与苏瑶是多年挚友。',
      [relation({ fromName: '', status: 'ended' })],
    )).toEqual([])
  })
})
