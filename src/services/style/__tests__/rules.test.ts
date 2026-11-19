import { describe, expect, it } from 'vitest'
import {
  checkParallelism,
  checkUniformRhythm,
  detectAIFlavor,
  formatDeaifyHint,
} from '../rules'

const endingText = '他推开门。他知道，这一切才刚刚开始。命运的齿轮开始转动。'
const fillerText = '与此同时，门外传来脚步。不知过了多久，风停了。'
const emotionText = '她感到一阵恐惧。他心中涌起愤怒。'
const metaphorText = '风仿佛刀割。月光犹如水。山宛如巨兽。夜好似墨。'
const broadcastText = '“走吧。”他说道。“等一下。”她问道。'

describe('P4-1 去 AI 味本地规则引擎', () => {
  it('命中段尾升华与万能过渡', () => {
    const report = detectAIFlavor(endingText + fillerText)
    const ids = report.matches.map((m) => m.ruleId)
    expect(ids).toContain('ending-elevation')
    expect(ids).toContain('filler-transition')
    expect(report.total).toBeGreaterThanOrEqual(3)
  })

  it('强度只改变阈值：轻强度放过低频命中，重强度命中即报', () => {
    const light = detectAIFlavor(emotionText, { intensity: '轻' })
    expect(light.matches.find((m) => m.ruleId === 'emotion-telling')).toBeUndefined()

    const medium = detectAIFlavor(emotionText, { intensity: '中' })
    expect(medium.matches.find((m) => m.ruleId === 'emotion-telling')?.count).toBe(2)

    const heavy = detectAIFlavor('她感到一丝不安。', { intensity: '重' })
    expect(heavy.matches.map((m) => m.ruleId)).toContain('emotion-telling')
  })

  it('比喻词超过 3 次才报（与写作模板口径一致）', () => {
    const four = detectAIFlavor(metaphorText)
    expect(four.matches.find((m) => m.ruleId === 'metaphor-overuse')?.count).toBe(4)

    const three = detectAIFlavor('风仿佛刀割。月光犹如水。山宛如巨兽。')
    expect(three.matches.find((m) => m.ruleId === 'metaphor-overuse')).toBeUndefined()
  })

  it('播音腔对白标签按强度收紧', () => {
    expect(detectAIFlavor(broadcastText).matches.some((m) => m.ruleId === 'broadcast-dialogue')).toBe(false)
    expect(detectAIFlavor(broadcastText, { intensity: '重' }).matches.some((m) => m.ruleId === 'broadcast-dialogue')).toBe(true)
  })

  it('连续 3 句同主语视为机械排比', () => {
    const result = checkParallelism('他抬手。他转身。他离开。雨停了。')
    expect(result.count).toBe(1)
    expect(result.excerpts[0]).toContain('他抬手')

    expect(checkParallelism('他抬手。她转身。他离开。').count).toBe(0)
  })

  it('句长变异系数过低时提示过度工整，轻强度不提示', () => {
    const uniform = '他走进房间坐在椅子上看着窗外。他拿起杯子喝了一口水又放下。他站起身走到门口停下来。'.repeat(5)
    expect(checkUniformRhythm(uniform).count).toBe(1)
    expect(detectAIFlavor(uniform, { intensity: '轻' }).matches.some((m) => m.ruleId === 'uniform-rhythm')).toBe(false)
    expect(detectAIFlavor(uniform, { intensity: '中' }).matches.some((m) => m.ruleId === 'uniform-rhythm')).toBe(true)
  })

  it('风格档案自定义规则按字面短语匹配，并尊重强度阈值', () => {
    const text = '他不由分说地冲了出去。她不由分说地跟上。'
    const medium = detectAIFlavor(text, { customRules: ['不由分说'] })
    expect(medium.matches.find((m) => m.category === 'custom')?.count).toBe(2)

    const light = detectAIFlavor('他不由分说地冲了出去。', { intensity: '轻', customRules: ['不由分说'] })
    expect(light.matches.some((m) => m.category === 'custom')).toBe(false)

    // 正则元字符按字面处理，不抛错、不误匹配
    expect(detectAIFlavor('他用 C++ 写代码。', { customRules: ['C++'] }).matches[0]?.count).toBe(1)
  })

  it('命中同一段数字复读与体感堆叠', () => {
    const numeric = detectAIFlavor('三十六颗晶石同时亮起红光。三十六道射线交错射出。')
    expect(numeric.matches.map((m) => m.ruleId)).toContain('numeric-repeat')

    const sensory = detectAIFlavor(
      '他跑到第七十米时，肺部火辣辣地疼，每一次呼吸都带着血腥味，两条腿沉得像灌满了铅，脚掌每次落地都震得脚踝骨发麻，整个人几乎要跪下去。',
    )
    expect(sensory.matches.map((m) => m.ruleId)).toContain('sensory-stack')
  })

  it('空正文不产生命中，提示为空', () => {
    const report = detectAIFlavor('   ')
    expect(report.total).toBe(0)
    expect(report.score).toBe(0)
    expect(formatDeaifyHint(report, () => 'x')).toBe('')
  })

  it('提示片段包含标签、命中数与例文', () => {
    const report = detectAIFlavor(endingText)
    const hint = formatDeaifyHint(report, (m) => `标签:${m.category}`)
    expect(hint).toContain('标签:ending-elevation')
    expect(hint).toMatch(/命中 \d+ 处/)
    expect(hint).toContain('例：')
  })
})
