/**
 * 批量生成运行台账（单章隔离后的汇总来源）
 *
 * 单章失败不再中断整批，因此需要一份台账记录每章结果，
 * 批次结束时统一输出「成功 / 偏长 / 失败 / 跳过」清单，供作者决定重跑哪些章。
 * 仅存于渲染进程内存，不落库（批次结果从草稿与运行日志可追溯）。
 */

export type BatchChapterStatus = 'ok' | 'warn' | 'failed' | 'skipped'

export interface BatchChapterResult {
  chapter: number
  status: BatchChapterStatus
  /** 定稿字数（failed/skipped 时可能为空） */
  words?: number
  /** 实际审稿轮数 */
  reviewRounds?: number
  /** 审稿是否通过 */
  reviewPassed?: boolean
  /** 是否完成了去AI味合并 */
  deaified?: boolean
  /** 失败发生的阶段（写稿/审稿/去味/定稿…） */
  stage?: string
  /** 补充说明：偏长档位、失败原因、未去味等 */
  message?: string
}

export interface BatchSummary {
  total: number
  ok: number
  warn: number
  failed: number
  skipped: number
  /** 逐章一行，便于直接写进日志 */
  lines: string[]
  /** 完整汇总文本 */
  text: string
}

let results: BatchChapterResult[] = []
let range: { start: number; end: number } | null = null

/** 批次开始时清空台账 */
export function resetBatchReport(start?: number, end?: number): void {
  results = []
  range = start !== undefined && end !== undefined ? { start, end } : null
}

/** 记录单章结果（同章重复记录时后者覆盖前者） */
export function recordBatchResult(result: BatchChapterResult): void {
  const idx = results.findIndex((r) => r.chapter === result.chapter)
  if (idx >= 0) results[idx] = result
  else results.push(result)
}

export function getBatchResults(): BatchChapterResult[] {
  return [...results].sort((a, b) => a.chapter - b.chapter)
}

/** 当前批次的章节范围（未设置时返回 null） */
export function getBatchRange(): { start: number; end: number } | null {
  return range ? { ...range } : null
}

/** 汇总台账（纯函数，可单测） */
export function summarizeBatch(
  list: BatchChapterResult[],
  chapterRange: { start: number; end: number } | null = null,
): BatchSummary {
  const sorted = [...list].sort((a, b) => a.chapter - b.chapter)
  const lines: string[] = []
  let ok = 0
  let warn = 0
  let failed = 0
  let skipped = 0

  for (const r of sorted) {
    if (r.status === 'ok') ok++
    else if (r.status === 'warn') warn++
    else if (r.status === 'failed') failed++
    else skipped++

    const parts: string[] = []
    if (r.words !== undefined) parts.push(`${r.words}字`)
    if (r.reviewRounds !== undefined) parts.push(`审稿${r.reviewRounds}轮${r.reviewPassed === false ? '（未通过）' : ''}`)
    if (r.deaified === false && r.status !== 'skipped') parts.push('未去味')
    if (r.stage) parts.push(`阶段:${r.stage}`)
    if (r.message) parts.push(r.message)

    const icon = r.status === 'ok' ? '✅' : r.status === 'warn' ? '⚠️' : r.status === 'skipped' ? '⏭' : '❌'
    lines.push(`${icon} 第${r.chapter}章${parts.length ? '：' + parts.join('，') : ''}`)
  }

  const scope = chapterRange ? `第${chapterRange.start}-${chapterRange.end}章` : `${sorted.length}章`
  const header = `📊 批量汇总（${scope}）：成功 ${ok} / 偏长 ${warn} / 失败 ${failed} / 跳过 ${skipped}`

  const failedChapters = sorted.filter((r) => r.status === 'failed').map((r) => r.chapter)
  const warnChapters = sorted.filter((r) => r.status === 'warn').map((r) => r.chapter)
  const tail: string[] = []
  if (failedChapters.length > 0) {
    tail.push(`失败章节需重跑：${failedChapters.join('、')}（可勾选「断点续跑」从失败章重新开始）`)
  }
  if (warnChapters.length > 0) {
    tail.push(`偏长/带残留问题章节建议人工复核：${warnChapters.join('、')}`)
  }

  const text = [header, ...lines, ...tail].join('\n')
  return { total: sorted.length, ok, warn, failed, skipped, lines, text }
}
