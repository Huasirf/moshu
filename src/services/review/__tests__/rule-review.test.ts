import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BANNED_WORDS,
  RULE_SEVERITY,
  checkItemPossession,
  checkLocationConflict,
  checkPovViolation,
  checkTimeReversal,
  reviewChapterRules,
  type RuleReviewInput,
} from '../rule-review'

function input(overrides: Partial<RuleReviewInput> = {}): RuleReviewInput {
  return { chapterNumber: 3, content: '', ...overrides }
}

describe('本地规则审稿', () => {
  it('禁用词记 warning，并给出证据', () => {
    const findings = reviewChapterRules(input({
      content: '他心中一凛，不由得后退半步。\n片刻后，他嘴角勾起。',
    }))
    const banned = findings.filter(f => f.category === 'banned-word')
    expect(banned.length).toBeGreaterThanOrEqual(2)
    expect(banned.every(f => f.severity === 'warning')).toBe(true)
    expect(banned.map(f => f.message).join()).toContain('心中一凛')
    expect(banned[0].evidence).toBeTruthy()
    expect(banned.every(f => f.stage === 'rule-review')).toBe(true)
  })

  it('非 POV 角色的内心描写记 error，POV 角色本身不报', () => {
    const content = '苏瑶心中暗道：这人好生奇怪。\n林砚心中一沉，却未作声。'
    const findings = checkPovViolation(input({
      content,
      povCharacter: '林砚',
      characters: [{ name: '林砚' }, { name: '苏瑶' }],
    }))

    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('error')
    expect(findings[0].category).toBe('pov')
    expect(findings[0].message).toContain('苏瑶')
    expect(findings[0].locationHint).toBe('第 1 段')
  })

  it('未指定 POV 时跳过视角校验', () => {
    expect(checkPovViolation(input({
      content: '苏瑶心中暗道：这人好生奇怪。',
      characters: [{ name: '苏瑶' }],
    }))).toEqual([])
  })

  it('使用未持有道具记 error；持有者使用不报', () => {
    const characters = [{ name: '林砚' }, { name: '苏瑶' }]
    const items = [{ name: '玄铁令', owner: '苏瑶' }]

    const violation = checkItemPossession(input({
      content: '林砚祭出玄铁令，青光大盛。',
      characters,
      items,
    }))
    expect(violation).toHaveLength(1)
    expect(violation[0].severity).toBe('error')
    expect(violation[0].message).toContain('玄铁令')

    expect(checkItemPossession(input({
      content: '苏瑶祭出玄铁令，青光大盛。',
      characters,
      items,
    }))).toEqual([])
  })

  it('本章显式取得道具后使用不报', () => {
    expect(checkItemPossession(input({
      content: '林砚接过玄铁令，收入怀中。\n片刻后，林砚祭出玄铁令。',
      characters: [{ name: '林砚' }],
      items: [{ name: '玄铁令', owner: null }],
    }))).toEqual([])
  })

  it('名字只是宾语/状语时不算该角色使用道具', () => {
    const characters = [{ name: '墨砚' }, { name: '阿箬' }]
    const items = [{ name: '断名刀', owner: '墨砚' }]
    // 阿箬出现在「绑着阿箬的红布条」里，真正拔刀的是墨砚（旧正则 16 字窗口会误伤并拦下定稿）
    expect(checkItemPossession(input({
      content: '墨砚单手按紧胸前绑着阿箬的红布条，借着气浪翻涌的掩护，拔出腰后断名刀。',
      characters,
      items,
    }))).toEqual([])
  })

  it('同章地点跳变记 warning，合法转场不报', () => {
    const characters = [{ name: '林砚' }]
    const jump = checkLocationConflict(input({
      content: '林砚在青云宗山门前停下脚步。\n林砚在一处荒原上睁开眼。',
      characters,
    }))
    expect(jump).toHaveLength(1)
    expect(jump[0].severity).toBe('warning')
    expect(jump[0].category).toBe('location')

    expect(checkLocationConflict(input({
      content: '林砚在青云宗山门前停下脚步。\n林砚来到荒原上睁开眼。',
      characters,
    }))).toEqual([])
  })

  it('显式时间倒流记 error，闪回内容豁免', () => {
    const reversal = checkTimeReversal(input({ content: '他回到三天前那个清晨，重新来过。' }))
    expect(reversal).toHaveLength(1)
    expect(reversal[0].severity).toBe('error')
    expect(reversal[0].category).toBe('timeline')

    expect(checkTimeReversal(input({
      content: '他回忆起当年的往事，记忆中仿佛回到三日前，那年的一切历历在目。',
    }))).toEqual([])
  })

  it('干净正文不产生 finding', () => {
    expect(reviewChapterRules(input({
      content: '林砚推门而入，风雪灌进衣领。他抖了抖肩上的雪，把剑靠在门边。',
      povCharacter: '林砚',
      characters: [{ name: '林砚' }],
    }))).toEqual([])
  })

  it('严重度默认方案与 DR-04 一致', () => {
    expect(RULE_SEVERITY.pov).toBe('error')
    expect(RULE_SEVERITY.item).toBe('error')
    expect(RULE_SEVERITY.timeline).toBe('error')
    expect(RULE_SEVERITY['banned-word']).toBe('warning')
    expect(RULE_SEVERITY.location).toBe('warning')
    expect(DEFAULT_BANNED_WORDS.length).toBeGreaterThan(0)
  })
})
