import { describe, expect, it } from 'vitest'
import {
  buildRecallQuery,
  computeRecallMetrics,
  mergeAnnotations,
  sampleRecallChapters,
  type RecallEvalCase,
} from '../recall-eval'

const bp = (chapterNumber: number, title = `场景${chapterNumber}`, keyEvents = '主角追查线索') => ({
  chapterNumber,
  title,
  keyEvents,
  characters: ['墨砚', '阿箬'],
})

const makeCase = (chapterNumber: number, relevant: Array<boolean | null>): RecallEvalCase => ({
  chapterNumber,
  title: `场景${chapterNumber}`,
  query: 'q',
  hits: relevant.map((_, i) => ({ fileName: `第${chapterNumber}章 正文${i}.txt`, score: 0.8, text: 't' })),
  relevant,
})

describe('recall-eval（P2-4）', () => {
  it('检索语句与写稿同构：标题 + 关键事件 + 角色', () => {
    expect(buildRecallQuery(bp(3))).toBe('场景3 主角追查线索 墨砚 阿箬')
    expect(buildRecallQuery({ chapterNumber: 2, title: '  第二章  ' })).toBe('第二章')
  })

  it('抽样排除第 1 章且结果确定、无重复', () => {
    const all = Array.from({ length: 30 }, (_, i) => bp(i + 1))
    const sample = sampleRecallChapters(all, 20)
    expect(sample).toHaveLength(20)
    expect(sample[0].chapterNumber).toBe(2)
    expect(sample[sample.length - 1].chapterNumber).toBe(30)
    expect(new Set(sample.map((s) => s.chapterNumber)).size).toBe(20)
    // 同一输入两次抽样结果一致
    expect(sampleRecallChapters(all, 20).map((s) => s.chapterNumber))
      .toEqual(sample.map((s) => s.chapterNumber))
  })

  it('不足抽样规模时返回全部可用章节', () => {
    const sample = sampleRecallChapters([bp(2), bp(3), bp(4)], 20)
    expect(sample.map((s) => s.chapterNumber)).toEqual([2, 3, 4])
  })

  it('重新抽样按章节 + 文档名沿用旧标注', () => {
    const previous = [{
      ...makeCase(5, [true, false]),
      hits: [
        { fileName: '第4章 旧.txt', score: 0.9, text: 'a' },
        { fileName: '第3章 旧.txt', score: 0.7, text: 'b' },
      ],
    }]
    const next: RecallEvalCase[] = [{
      chapterNumber: 5,
      title: '场景5',
      query: 'q',
      hits: [
        { fileName: '第3章 旧.txt', score: 0.6, text: 'b' },
        { fileName: '第2章 新.txt', score: 0.5, text: 'c' },
      ],
      relevant: [null, null],
    }]
    const merged = mergeAnnotations(next, previous)
    expect(merged[0].relevant).toEqual([false, null])
  })

  it('precision@5 与章级 recall@5 计算正确', () => {
    const cases = [
      makeCase(2, [true, false, null, null, null]),
      makeCase(3, [false, false, null, null, null]),
      makeCase(4, [null, null, null, null, null]),
    ]
    const metrics = computeRecallMetrics(cases)
    expect(metrics.totalCases).toBe(3)
    expect(metrics.annotatedCases).toBe(2)
    expect(metrics.annotatedHits).toBe(4)
    expect(metrics.relevantHits).toBe(1)
    expect(metrics.precisionAt5).toBeCloseTo(0.25)
    // 2 章已标注，其中 1 章至少有一条相关命中
    expect(metrics.recallAt5).toBeCloseTo(0.5)
    expect(metrics.hitChapters).toBe(1)
  })

  it('无标注时不产生 NaN', () => {
    const metrics = computeRecallMetrics([makeCase(2, [null, null])])
    expect(metrics.precisionAt5).toBe(0)
    expect(metrics.recallAt5).toBe(0)
  })
})
