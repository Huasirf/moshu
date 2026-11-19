import { describe, it, expect } from 'vitest'
import {
  describeWordGate,
  estimateMaxTokens,
  isImportantChapter,
  judgeWordCount,
  resolveChapterWordTarget,
  resolveWordTiers,
} from '../word-count-gate'

const tiers = resolveWordTiers(2000)

describe('resolveWordTiers', () => {
  it('按 2000 字基准派生 6 档边界', () => {
    expect(tiers).toMatchObject({
      target: 2000,
      shortFloor: 1700,
      normalMax: 2400,
      warnMax: 3000,
      softMax: 3600,
      hardMax: 4000,
    })
  })

  it('目标字数变化时等比缩放', () => {
    const t = resolveWordTiers(3000)
    expect(t.normalMax).toBe(3600)
    expect(t.hardMax).toBe(6000)
  })

  it('未设置目标字数时返回空档位', () => {
    expect(resolveWordTiers(0).target).toBe(0)
  })

  it('支持覆盖单档阈值', () => {
    expect(resolveWordTiers(2000, { normalMax: 2600 }).normalMax).toBe(2600)
  })
})

describe('重要章节放宽', () => {
  it('卷末章与高潮/收尾角色判为重要章节', () => {
    expect(isImportantChapter(30)).toBe(true)
    expect(isImportantChapter(29)).toBe(false)
    expect(isImportantChapter(29, '高潮')).toBe(true)
    expect(isImportantChapter(29, '收尾')).toBe(true)
    expect(isImportantChapter(29, '发展')).toBe(false)
  })

  it('重要章节目标字数上浮 35%，普通章节不变', () => {
    expect(resolveChapterWordTarget(2000, 30)).toBe(2700)
    expect(resolveChapterWordTarget(2000, 29, '发展')).toBe(2000)
    expect(resolveChapterWordTarget(0, 30)).toBe(0)
  })

  it('以 2700 字为目标时，4570 字的重要章节按 LONG 放行而不是失败', () => {
    const importantTiers = resolveWordTiers(resolveChapterWordTarget(2000, 30))
    const r = judgeWordCount({ wordCount: 4570, tiers: importantTiers, hasClimax: true })
    expect(r.tier).toBe('LONG')
    expect(r.action).toBe('pass-warn')
  })
})

describe('judgeWordCount', () => {
  it('1700 字以下判过短并要求重生成', () => {
    const r = judgeWordCount({ wordCount: 1500, tiers })
    expect(r.tier).toBe('TOO_SHORT')
    expect(r.action).toBe('regenerate')
  })

  it('1700–2400 直接通过', () => {
    expect(judgeWordCount({ wordCount: 1700, tiers }).tier).toBe('PASS')
    expect(judgeWordCount({ wordCount: 2400, tiers }).tier).toBe('PASS')
    expect(judgeWordCount({ wordCount: 2400, tiers }).action).toBe('pass')
  })

  it('2401–3000 记偏长但放行', () => {
    const r = judgeWordCount({ wordCount: 2838, tiers })
    expect(r.tier).toBe('WARN')
    expect(r.action).toBe('pass-warn')
  })

  it('3001–3600 无高潮标记时要求重生成', () => {
    expect(judgeWordCount({ wordCount: 3125, tiers }).action).toBe('regenerate')
  })

  it('3001–3600 有 climax 标记时放行', () => {
    const r = judgeWordCount({ wordCount: 3125, tiers, hasClimax: true })
    expect(r.tier).toBe('LONG')
    expect(r.action).toBe('pass-warn')
  })

  it('3001–3600 场景预算足够时放行', () => {
    const r = judgeWordCount({ wordCount: 3400, tiers, sceneBudget: 3200 })
    expect(r.action).toBe('pass-warn')
  })

  it('3601–4000 判 LONG_HARD 需重写', () => {
    const r = judgeWordCount({ wordCount: 3800, tiers })
    expect(r.tier).toBe('LONG_HARD')
    expect(r.action).toBe('regenerate')
  })

  it('超过 4000 直接判失败', () => {
    expect(judgeWordCount({ wordCount: 5411, tiers }).tier).toBe('REJECT')
    expect(judgeWordCount({ wordCount: 5411, tiers }).action).toBe('fail')
  })

  it('无目标字数时一律通过', () => {
    expect(judgeWordCount({ wordCount: 99999, tiers: resolveWordTiers(0) }).action).toBe('pass')
  })

  it('描述文本包含字数与档位', () => {
    expect(describeWordGate(judgeWordCount({ wordCount: 5411, tiers }))).toContain('5411')
    expect(describeWordGate(judgeWordCount({ wordCount: 5411, tiers }))).toContain('REJECT')
  })
})

describe('estimateMaxTokens', () => {
  it('按 1 字≈1 token 加 20% 余量估算', () => {
    expect(estimateMaxTokens(2000)).toBe(2480)
    expect(estimateMaxTokens(1300)).toBe(1640)
  })

  it('非法或非正数返回 0（调用方据此不传 maxTokens）', () => {
    expect(estimateMaxTokens(0)).toBe(0)
    expect(estimateMaxTokens(-5)).toBe(0)
    expect(estimateMaxTokens(Number.NaN)).toBe(0)
  })

  it('极小字数也有 256 的下限', () => {
    expect(estimateMaxTokens(10)).toBe(256)
  })
})
