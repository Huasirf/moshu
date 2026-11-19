/**
 * 审稿台账的共享口径（P5）
 *
 * 台账按章节存储，同一章存在多份草稿版本；界面与定稿闸门都必须只认
 * 「属于当前稿」的条目，否则旧版本的结论会一直拦住新版本。
 * 这里集中定义过滤与计数，避免 DraftEditor 与审稿面板各写一套。
 */
import type { ReviewFinding } from '../../../electron/repositories/review-finding-repository'

/**
 * 该 finding 是否属于指定草稿。
 * 早期台账条目可能没有 draft_id（空串），此时视为整章通用。
 */
export function isFindingForDraft(finding: ReviewFinding, draftId: string | number): boolean {
  const target = String(draftId)
  return !finding.draftId || finding.draftId === target
}

export interface FindingSummary {
  total: number
  errors: number
  warnings: number
}

/** 统计 open 条目的总数与严重度分布（供工具栏红点与面板头部使用） */
export function summarizeFindings(findings: ReviewFinding[]): FindingSummary {
  let errors = 0
  let warnings = 0
  for (const finding of findings) {
    if (finding.severity === 'error') errors++
    else if (finding.severity === 'warning') warnings++
  }
  return { total: findings.length, errors, warnings }
}
