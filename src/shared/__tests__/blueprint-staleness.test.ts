import { describe, it, expect } from 'vitest'
import { computeStaleChapters, hasBlueprintContentChange, DEFAULT_STALE_WINDOW } from '../blueprint-staleness'

describe('大纲联动范围', () => {
  it('按区间向下游传播，并夹在已存在章节之内', () => {
    const existing = [1, 2, 3, 4, 5, 6, 7, 10]
    expect(computeStaleChapters({ editedChapter: 3, existingChapters: existing })).toEqual([4, 5, 6, 7])
    expect(computeStaleChapters({ editedChapter: 3, existingChapters: existing, window: 1 })).toEqual([4])
    expect(computeStaleChapters({ editedChapter: 8, existingChapters: existing })).toEqual([10])
    expect(computeStaleChapters({ editedChapter: 10, existingChapters: existing })).toEqual([])
  })

  it('忽略非法章节号并去重', () => {
    expect(computeStaleChapters({ editedChapter: 1, existingChapters: [2, 2, 0, -1, 3.5, 3] })).toEqual([2, 3])
    expect(DEFAULT_STALE_WINDOW).toBeGreaterThan(0)
  })

  it('只把结构字段变化视为大纲改动', () => {
    const before = { title: '第一节', role: '发展', purpose: '铺垫', keyEvents: '入门', suspenseHook: '令牌', characters: ['林轩'] }
    expect(hasBlueprintContentChange(before, { ...before, notes: '作者备注' } as typeof before)).toBe(false)
    expect(hasBlueprintContentChange(before, { ...before, keyEvents: '夺令' })).toBe(true)
    expect(hasBlueprintContentChange(before, { ...before, characters: ['林轩', '苏瑶'] })).toBe(true)
    expect(hasBlueprintContentChange(null, before)).toBe(true)
  })
})
