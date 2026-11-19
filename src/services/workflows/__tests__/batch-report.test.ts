import { describe, it, expect, beforeEach } from 'vitest'
import {
  getBatchResults,
  recordBatchResult,
  resetBatchReport,
  summarizeBatch,
} from '../batch-report'

describe('summarizeBatch', () => {
  it('按状态统计并生成逐章清单', () => {
    const summary = summarizeBatch([
      { chapter: 16, status: 'ok', words: 2200, reviewRounds: 1, reviewPassed: true, deaified: true },
      { chapter: 17, status: 'warn', words: 2850, reviewRounds: 3, reviewPassed: true, message: '2800 字，偏长' },
      { chapter: 18, status: 'failed', stage: '写稿', message: '正文完整性异常（REPEATED_HEAD）' },
      { chapter: 19, status: 'skipped', message: '已定稿' },
    ], { start: 16, end: 19 })

    expect(summary.total).toBe(4)
    expect(summary.ok).toBe(1)
    expect(summary.warn).toBe(1)
    expect(summary.failed).toBe(1)
    expect(summary.skipped).toBe(1)
    expect(summary.lines[0]).toContain('第16章')
    expect(summary.lines[0]).toContain('2200字')
    expect(summary.lines[2]).toContain('❌')
    expect(summary.lines[2]).toContain('阶段:写稿')
    expect(summary.text).toContain('成功 1 / 偏长 1 / 失败 1 / 跳过 1')
    expect(summary.text).toContain('失败章节需重跑：18')
  })

  it('未去味章节单独标注', () => {
    const summary = summarizeBatch([
      { chapter: 20, status: 'warn', words: 2100, deaified: false, message: '未去味（执行失败）' },
    ])
    expect(summary.lines[0]).toContain('未去味')
  })

  it('空台账输出零统计', () => {
    const summary = summarizeBatch([])
    expect(summary.total).toBe(0)
    expect(summary.text).toContain('成功 0')
  })
})

describe('batch report store', () => {
  beforeEach(() => resetBatchReport(16, 20))

  it('同章重复记录时覆盖而非累加', () => {
    recordBatchResult({ chapter: 16, status: 'failed', message: '第一次' })
    recordBatchResult({ chapter: 16, status: 'ok', words: 2000 })
    const results = getBatchResults()
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('ok')
  })

  it('按章号升序返回', () => {
    recordBatchResult({ chapter: 18, status: 'ok' })
    recordBatchResult({ chapter: 16, status: 'ok' })
    expect(getBatchResults().map((r) => r.chapter)).toEqual([16, 18])
  })
})
