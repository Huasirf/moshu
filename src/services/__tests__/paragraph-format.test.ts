import { describe, it, expect } from 'vitest'
import {
  normalizeParagraphs,
  DEFAULT_MAX_PARAGRAPH_CHARS,
  DEFAULT_TARGET_PARAGRAPH_CHARS,
  DEFAULT_ABSOLUTE_MAX_PARAGRAPH_CHARS,
} from '../paragraph-format'

/** 造一个指定字数的句子（以句号结尾） */
function sentence(chars: number): string {
  const body = '字'.repeat(Math.max(0, chars - 1))
  return body + '。'
}

/** 100 字的长段（超过 90 字阈值，但未到 120 字绝对上限） */
function longParagraph(): string {
  return sentence(50).repeat(2)
}

describe('normalizeParagraphs', () => {
  it('短段落保持原样，不改换行与缩进', () => {
    const input = '第一段。\n\n第二段，也不长。\n\n　　缩进的一段。'
    const result = normalizeParagraphs(input)
    expect(result.content).toBe(input)
    expect(result.stats.splitParagraphs).toBe(0)
    expect(result.stats.longParagraphs).toBe(0)
  })

  it('单个长段允许保留（重要场面用长段）', () => {
    const long = longParagraph()
    const result = normalizeParagraphs(`开头。\n\n${long}\n\n结尾。`)
    expect(result.content).toBe(`开头。\n\n${long}\n\n结尾。`)
    expect(result.stats.longParagraphs).toBe(1)
    expect(result.stats.splitParagraphs).toBe(0)
  })

  it('连续两个长段时拆开后一个', () => {
    const long = longParagraph()
    const result = normalizeParagraphs(`${long}\n\n${long}`)
    const paragraphs = result.content.split('\n').filter(Boolean)

    expect(paragraphs.length).toBeGreaterThan(2)
    expect(result.stats.longParagraphs).toBe(2)
    expect(result.stats.splitParagraphs).toBe(1)
    expect(result.stats.maxBefore).toBe(100)
    // 第一个长段按新规则保留，所以全局最长仍是 100；被拆开的是第二个
    expect(result.stats.maxAfter).toBe(100)
    const lengths = paragraphs.map(p => p.replace(/\s/g, '').length)
    expect(lengths.filter(n => n <= DEFAULT_TARGET_PARAGRAPH_CHARS).length).toBeGreaterThanOrEqual(2)
    // 只改换行，字词与标点总量不变
    expect(result.content.replace(/\n/g, '')).toBe(long + long)
  })

  it('长—短—长不算连续，两个长段都保留', () => {
    const long = longParagraph()
    const input = `${long}\n\n短段。\n\n${long}`
    const result = normalizeParagraphs(input)
    expect(result.content).toBe(input)
    expect(result.stats.longParagraphs).toBe(2)
    expect(result.stats.splitParagraphs).toBe(0)
  })

  it('超过绝对上限的单段即使独立也强制拆分', () => {
    const huge = sentence(50).repeat(8) // 400 字
    expect(huge.length).toBeGreaterThan(DEFAULT_ABSOLUTE_MAX_PARAGRAPH_CHARS)
    const result = normalizeParagraphs(huge)
    expect(result.stats.splitParagraphs).toBe(1)
    expect(result.content.split('\n').length).toBeGreaterThan(1)
    expect(result.content.replace(/\n/g, '')).toBe(huge)
  })

  it('保留拆分前的缩进', () => {
    const long = '　　' + longParagraph()
    const result = normalizeParagraphs(`${long}\n\n${long}`)
    const paragraphs = result.content.split('\n').filter(Boolean)
    expect(paragraphs.length).toBeGreaterThan(2)
    for (const paragraph of paragraphs) expect(paragraph.startsWith('　　')).toBe(true)
  })

  it('空行分隔的稿子，拆出的段落之间同样保留空行', () => {
    const long = longParagraph()
    const result = normalizeParagraphs(`第一段。\n\n${long}\n\n${long}\n\n最后一段。`)
    expect(result.content).toContain('\n\n')
    expect(result.content.split('\n\n').length).toBeGreaterThan(3)
    expect(result.content.startsWith('第一段。\n\n')).toBe(true)
    expect(result.content.endsWith('最后一段。')).toBe(true)
  })

  it('纯对白的长段不会被拆成只有左引号的半截段落', () => {
    const speech = `“${sentence(40)}${sentence(40)}${sentence(40)}”`
    // 前面放一个长段以触发“连续长段”逻辑，验证对白本身仍不会被硬拆
    const result = normalizeParagraphs(`${longParagraph()}\n\n${speech}`)
    expect(result.content.endsWith(speech)).toBe(true)
    expect(result.stats.splitParagraphs).toBe(0)
    for (const paragraph of result.content.split('\n').filter(Boolean)) {
      const left = paragraph.split('“').length - 1
      const right = paragraph.split('”').length - 1
      expect(left).toBe(right)
    }
  })

  it('叙述夹对白时只在引号闭合处断开，每段引号都配对', () => {
    const long = `前文交代。${sentence(60)}${sentence(60)}“${sentence(40)}${sentence(40)}${sentence(40)}”后文收束。`
    const result = normalizeParagraphs(`${longParagraph()}\n\n${long}`)
    const paragraphs = result.content.split('\n').filter(Boolean).slice(1)
    expect(paragraphs.length).toBeGreaterThan(1)
    for (const paragraph of paragraphs) {
      expect((paragraph.split('“').length - 1)).toBe(paragraph.split('”').length - 1)
    }
    expect(result.content.replace(/\n/g, '')).toBe(longParagraph() + long)
  })

  it('引号不配对的段落不拆分', () => {
    const unbalanced = '“' + sentence(50).repeat(4)
    const result = normalizeParagraphs(`${longParagraph()}\n\n${unbalanced}`)
    expect(result.content.endsWith(unbalanced)).toBe(true)
  })

  it('引号配对的长对白可以安全拆分，且右引号跟随前一句', () => {
    const long = `“${sentence(60)}${sentence(60)}”${sentence(60)}`
    const result = normalizeParagraphs(`${longParagraph()}\n\n${long}`)
    expect(result.stats.splitParagraphs).toBe(1)
    // 拆分后引号仍成对
    expect((result.content.split('“').length - 1)).toBe(1)
    expect((result.content.split('”').length - 1)).toBe(1)
    expect(result.content.replace(/\n/g, '')).toBe(longParagraph() + long)
  })

  it('没有句末标点时可退到逗号处拆开', () => {
    const clauses = Array.from({ length: 18 }, () => '这是一个很长的分句').join('，') + '，结尾'
    expect(clauses.length).toBeGreaterThan(DEFAULT_MAX_PARAGRAPH_CHARS)
    const result = normalizeParagraphs(`${longParagraph()}\n\n${clauses}`)
    expect(result.stats.splitParagraphs).toBe(1)
    expect(result.content.replace(/\n/g, '')).toBe(longParagraph() + clauses)
  })

  it('单句超长且无法再切分时原样返回', () => {
    const single = '字'.repeat(400) + '。'
    const result = normalizeParagraphs(single)
    expect(result.content).toBe(single)
    expect(result.stats.longParagraphs).toBe(1)
    expect(result.stats.splitParagraphs).toBe(0)
  })

  it('可自定义阈值与绝对上限', () => {
    const input = sentence(10).repeat(5) // 50 字
    const result = normalizeParagraphs(input, { maxChars: 30, targetChars: 20, absoluteMaxChars: 30 })
    expect(result.stats.longParagraphs).toBe(1)
    expect(result.stats.splitParagraphs).toBe(1)
    expect(result.content.split('\n').length).toBeGreaterThan(1)
  })

  it('多段落混合：单独长段保留，空行保留', () => {
    const long = longParagraph()
    const input = `开头。\n\n${long}\n\n结尾。`
    const result = normalizeParagraphs(input)
    const paragraphs = result.content.split('\n')
    expect(paragraphs[0]).toBe('开头。')
    expect(paragraphs.includes('')).toBe(true)
    expect(result.content.endsWith('结尾。')).toBe(true)
    expect(result.stats.longParagraphs).toBe(1)
    expect(result.stats.splitParagraphs).toBe(0)
  })

  it('空内容不报错', () => {
    const result = normalizeParagraphs('')
    expect(result.content).toBe('')
    expect(result.stats).toMatchObject({ longParagraphs: 0, splitParagraphs: 0 })
  })
})
