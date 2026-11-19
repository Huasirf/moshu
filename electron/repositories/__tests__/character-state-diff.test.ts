import { describe, it, expect } from 'vitest'
import { diffDynamicState, isSameStateValue, normalizeStateValue } from '../character-state-diff'

describe('normalizeStateValue', () => {
  it('天赋/技能支持数组、顿号分隔字符串与空值', () => {
    expect(normalizeStateValue('talents', ['十倍痛觉', ' 浊息亲和 '])).toEqual(['十倍痛觉', '浊息亲和'])
    expect(normalizeStateValue('skills', '斩铁式、血锈铭域')).toEqual(['斩铁式', '血锈铭域'])
    expect(normalizeStateValue('talents', '')).toEqual([])
    expect(normalizeStateValue('talents', null)).toEqual([])
  })

  it('文本字段空值归一为空串', () => {
    expect(normalizeStateValue('location', undefined)).toBe('')
    expect(normalizeStateValue('location', null)).toBe('')
    expect(normalizeStateValue('location', ' 后院 ')).toBe(' 后院 ')
  })
})

describe('isSameStateValue', () => {
  it('空数组与空串等价，非空数组按顺序比较', () => {
    expect(isSameStateValue('skills', [], '')).toBe(true)
    expect(isSameStateValue('skills', ['A'], 'A')).toBe(true)
    expect(isSameStateValue('skills', ['A', 'B'], ['B', 'A'])).toBe(false)
  })
})

describe('diffDynamicState', () => {
  it('只报发生变化的动态字段，且忽略固定档案字段', () => {
    const before = { location: '后院', powerLevel: '淬体三重', talents: ['十倍痛觉'] }
    const after = {
      location: '后院',
      powerLevel: '淬体四重',
      talents: ['十倍痛觉'],
      appearance: '大幅改写（固定档案，不应出现在差异里）',
    } as any
    const changes = diffDynamicState(before, after)
    expect(changes.map((c) => c.field)).toEqual(['powerLevel'])
    expect(changes[0].before).toBe('淬体三重')
    expect(changes[0].after).toBe('淬体四重')
  })

  it('新角色（无 before）只统计 after 实际携带的字段', () => {
    const changes = diffDynamicState(null, { location: '祠堂', skills: ['斩铁式'] })
    expect(changes.map((c) => c.field).sort()).toEqual(['location', 'skills'])
  })

  it('未携带的字段不产生差异（旧调用不传新字段时不清空既有值）', () => {
    const changes = diffDynamicState({ location: '后院', knownInfo: '旧情报' }, { location: '后院' })
    expect(changes).toEqual([])
  })
})
