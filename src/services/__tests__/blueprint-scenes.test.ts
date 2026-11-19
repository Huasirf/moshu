import { describe, it, expect } from 'vitest'
import {
  isScenePlanUsable,
  normalizeScenes,
  parseScenePlan,
  renderScenePlan,
  splitScenesForPipeline,
} from '../blueprint-scenes'

const goodPlan = {
  scenes: [
    { id: 's1', title: '当铺门口', goal: '墨砚拿鱼皮册子换钱', conflict: '掌柜压价', turn: '册子里掉出盐晶', props: ['鱼皮册子', '盐晶'], characters: ['墨砚', '掌柜'], words: 600 },
    { id: 's2', title: '柜台验货', goal: '掌柜认出官皮', conflict: '墨砚遮掩', turn: '无', props: ['官皮'], characters: ['墨砚', '掌柜'], words: 500 },
    { id: 's3', title: '后院黑市', goal: '墨砚换到断名刀线索', conflict: '被巡渊卫盯上', turn: '巡渊卫是熟人', props: ['断名刀'], characters: ['墨砚', '巡渊卫'], words: 500 },
    { id: 's4', title: '巷口断章', goal: '墨砚决定夜探茶楼', conflict: '无', turn: '无', props: ['茶楼请柬'], characters: ['墨砚'], words: 400 },
  ],
}

describe('parseScenePlan', () => {
  it('解析带代码围栏的 JSON', () => {
    const list = parseScenePlan('```json\n' + JSON.stringify(goodPlan) + '\n```')
    expect(list).toHaveLength(4)
  })

  it('解析前后带解释文字的 JSON', () => {
    const list = parseScenePlan(`好的，以下是拆解结果：\n${JSON.stringify(goodPlan)}\n希望有帮助。`)
    expect(list).toHaveLength(4)
  })

  it('顶层直接是数组也能解析', () => {
    const list = parseScenePlan(JSON.stringify(goodPlan.scenes))
    expect(list).toHaveLength(4)
  })

  it('坏 JSON 返回空数组而不抛错', () => {
    expect(parseScenePlan('{"scenes": [')).toEqual([])
    expect(parseScenePlan('')).toEqual([])
  })
})

describe('normalizeScenes', () => {
  it('字段完整时原样保留并按预算统计', () => {
    const stats = normalizeScenes(goodPlan.scenes, 2000)
    expect(stats.scenes).toHaveLength(4)
    expect(stats.budget).toBe(2000)
    expect(stats.adjusted).toBe(false)
    expect(stats.warnings).toEqual([])
    expect(isScenePlanUsable(stats)).toBe(true)
  })

  it('缺失 words 时把剩余预算均分', () => {
    const list = goodPlan.scenes.map((s, i) => (i < 2 ? s : { ...s, words: undefined }))
    const stats = normalizeScenes(list, 2000)
    expect(stats.scenes.every((s) => (s.words || 0) > 0)).toBe(true)
    expect(stats.budget).toBeGreaterThan(1500)
  })

  it('预算偏离目标超过 10% 时按比例缩放', () => {
    const list = goodPlan.scenes.map((s) => ({ ...s, words: 1200 }))
    const stats = normalizeScenes(list, 2000)
    expect(stats.adjusted).toBe(true)
    expect(Math.abs(stats.budget - 2000) / 2000).toBeLessThanOrEqual(0.05)
    expect(stats.warnings.join()).toContain('已按比例缩放')
  })

  it('丢弃空条目并对缺字段容错', () => {
    const stats = normalizeScenes([{ title: '', goal: '' }, null, { title: '只有标题' }, goodPlan.scenes[0]], 2000)
    expect(stats.scenes).toHaveLength(2)
    expect(stats.scenes[1].title).toBe('当铺门口')
    expect(stats.scenes[1].props).toEqual(['鱼皮册子', '盐晶'])
  })

  it('场景数不足两个时给出警告且不可用', () => {
    const stats = normalizeScenes([goodPlan.scenes[0]], 2000)
    expect(isScenePlanUsable(stats)).toBe(false)
    expect(stats.warnings.join()).toContain('低于下限')
  })

  it('超过 5 个场景时截断', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ title: `场景${i}`, goal: '推进', words: 300 }))
    const stats = normalizeScenes(many, 2000)
    expect(stats.scenes).toHaveLength(5)
    expect(stats.warnings.join()).toContain('超过上限')
  })
})

describe('renderScenePlan', () => {
  it('渲染每场预算与全章区间', () => {
    const { scenes } = normalizeScenes(goodPlan.scenes, 2000)
    const text = renderScenePlan(scenes, 2000)
    expect(text).toContain('共 4 场')
    expect(text).toContain('当铺门口')
    expect(text).toContain('道具：鱼皮册子、盐晶')
    expect(text).toContain('1900–2400')
    expect(text).toContain('不得超过 2600')
  })

  it('无场景时返回空串（走旧路径）', () => {
    expect(renderScenePlan([], 2000)).toBe('')
  })
})

describe('splitScenesForPipeline', () => {
  it('按累计预算切在约 60% 处，两段都非空', () => {
    const { scenes } = normalizeScenes(goodPlan.scenes, 2000)
    const { first, rest } = splitScenesForPipeline(scenes, 0.6)
    expect(first.length).toBeGreaterThan(0)
    expect(rest.length).toBeGreaterThan(0)
    expect(first.length + rest.length).toBe(scenes.length)
    const budgetOf = (list: typeof scenes) => list.reduce((s, x) => s + (x.words || 0), 0)
    // 切点按「累计预算首次达到 60%」取整场，因此第一段可能略高于 60%
    expect(budgetOf(first)).toBeGreaterThanOrEqual(1000)
    expect(budgetOf(first)).toBeLessThanOrEqual(1800)
    expect(budgetOf(rest)).toBeGreaterThan(0)
  })

  it('2 场时切为 1 + 1，绝不把第二段切空', () => {
    const scenes = normalizeScenes([
      { title: 'A', goal: '推进', words: 900 },
      { title: 'B', goal: '收束', words: 1100 },
    ], 2000).scenes
    const { first, rest } = splitScenesForPipeline(scenes, 0.9)
    expect(first).toHaveLength(1)
    expect(rest).toHaveLength(1)
  })

  it('场景过少或无预算时退化为单段', () => {
    expect(splitScenesForPipeline([{ title: 'A', words: 1000 }]).rest).toHaveLength(0)
    const noBudget = [{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' }]
    const { first, rest } = splitScenesForPipeline(noBudget as any, 0.5)
    expect(first.length).toBe(2)
    expect(rest.length).toBe(2)
  })
})
