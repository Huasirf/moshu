import { describe, it, expect } from 'vitest'
import { applyReplacements, scanStyle } from '../style-scan'

describe('scanStyle', () => {
  it('统计禁用词命中次数并带上替换建议', () => {
    const text = '他摸了摸干枯的鱼皮册子，又看了一眼干枯的树皮。'
    const report = scanStyle(text, { bannedTerms: ['干枯的'], replacements: { '干枯的': '' } })
    const hit = report.hits.find(h => h.kind === 'banned')
    expect(hit).toMatchObject({ term: '干枯的', count: 2, suggestion: '' })
    expect(report.totalHits).toBeGreaterThanOrEqual(2)
  })

  it('命中冗余修饰语与名词化句式', () => {
    const text = '他对伤口进行了一次检查，作出了决定，然后拿起冰冷的铁钩。'
    const report = scanStyle(text)
    expect(report.hits.some(h => h.kind === 'decoration' && h.term === '冰冷的')).toBe(true)
    expect(report.hits.some(h => h.kind === 'nounified')).toBe(true)
  })

  it('抽象高频词超过阈值才提示', () => {
    const many = '气机'.repeat(10) + '。'.repeat(1000) // 约 1000 字，阈值 3
    const report = scanStyle(many)
    expect(report.hits.some(h => h.kind === 'hot' && h.term === '气机')).toBe(true)

    const few = '气机压了下来，他抬手挡了一下。'
    expect(scanStyle(few).hits.some(h => h.kind === 'hot')).toBe(false)
  })

  it('专名密度超限时给出提示', () => {
    const text = '【黑潮】【盐晶】【名骨】【铭域】这些都是他听过的东西。'
    const report = scanStyle(text)
    expect(report.hits.some(h => h.kind === 'density')).toBe(true)
  })

  it('套路化描写超过单章上限时命中 cliche', () => {
    const text = '他摩挲着食指骨节。'.repeat(3)
    const report = scanStyle(text)
    const hit = report.hits.find(h => h.kind === 'cliche')
    expect(hit?.term).toBe('摩挲食指骨节')
    expect(hit?.count).toBe(3)
  })

  it('套路词未超限时不提示', () => {
    // 反手/顺手为配额项（≤3 次/章），单次使用不应命中
    const text = '他反手把门带上，随后把手放下。'
    expect(scanStyle(text).hits.some(h => h.kind === 'cliche')).toBe(false)
  })

  it('命中新增套话并给出删除建议', () => {
    const text = '他弯腰去捡，肺部火辣辣地疼，两条腿沉得像灌满了铅，每一次呼吸都带着血腥味。他咬破舌尖，血腥味更浓了。'
    const report = scanStyle(text)
    const terms = report.hits.filter((h) => h.kind === 'cliche').map((h) => h.term)
    expect(terms).toContain('火辣辣地疼')
    expect(terms).toContain('像灌满了铅')
    expect(terms).toContain('血腥味')
  })

  it('同一段重复同一中文数字时命中 numeric', () => {
    const text = '三十六颗晶石同时亮起红光。三十六道射线交错射出。'
    const hit = scanStyle(text).hits.find((h) => h.kind === 'numeric')
    expect(hit?.term).toContain('三十六')
  })

  it('一段内体感词堆叠时命中 sensory', () => {
    const text = '在三倍重力下，单是弯腰屈膝的动作，就让脊椎骨发出一阵密集的酸响。那块绝缘片入手冰冷粗糙，焦瘤扎进指腹。原本不到两斤的废铁，此刻沉得坠腕，足有五六斤重。'
    expect(scanStyle(text).hits.some((h) => h.kind === 'sensory')).toBe(true)
  })

  it('旧状态卡与面板夹带非固定字段时命中 cliche', () => {
    const text = '【试炼 第 7 天·白门｜第 16 天·黄门·F 起】\n【接入 世界频道 0/3｜区域频道 0/10】'
    const terms = scanStyle(text).hits.filter((h) => h.kind === 'cliche').map((h) => h.term)
    expect(terms).toContain('非固定面板状态卡（聊天/商城/频道/试炼/人口/黑潮）')
    expect(terms).toContain('固定面板夹带非固定字段')
  })

  it('固定面板超过 8 行或属性面板超过 2 次时命中 panel', () => {
    const overQuota = '【装备】\n【主手 柴刀｜耐久 7/10】\n【护具 湿外套｜0 防】\n【背包 帆布包｜12/15kg】\n【道具】\n【兽筋 T1｜坚韧】\n【技能】\n【结构视界｜冷却 1 天】\n【力 4｜敏 4｜体 4｜心识 17】'
    expect(scanStyle(overQuota).hits.some((h) => h.kind === 'panel')).toBe(true)

    const attr = '【力 4｜敏 4｜体 4｜心识 17】\n他喘了口气。\n【力 4｜敏 4｜体 4｜心识 17】\n他继续走。\n【力 4｜敏 4｜体 4｜心识 17】'
    const hit = scanStyle(attr).hits.find((h) => h.kind === 'panel' && h.term.startsWith('属性面板'))
    expect(hit?.count).toBe(1)
  })

  it('空文本返回全 0 报告', () => {
    const report = scanStyle('')
    expect(report).toEqual({ wordCount: 0, hits: [], totalHits: 0 })
  })
})

describe('applyReplacements', () => {
  it('按词表替换并优先长词', () => {
    const text = '黑雾压下来，雾里全是灰雾。'
    const out = applyReplacements(text, { 雾: '霾', 黑雾: '黑潮余毒' })
    expect(out).toBe('黑潮余毒压下来，霾里全是灰霾。')
  })

  it('空词表原样返回', () => {
    expect(applyReplacements('原文', {})).toBe('原文')
  })
})
