/**
 * LLM 审稿结果 → review_findings（P3-3）
 *
 * 审稿提示词要求模型输出 { items:[{category,severity,quote,description}], summary }。
 * 这里把归一化后的结果映射为台账条目，并与本地规则审稿的 findings 做证据级去重：
 * 同一处原文被两边同时报出时只保留一条（规则条目更可定位，优先保留）。
 *
 * DR-04 已定稿：13 维清单与权重维持当前实现；本模块只做结构映射，
 * 新增维度无需改这里（category 原样透传）。
 */
import type { ReviewFindingInput, ReviewSeverity } from '../../../electron/repositories/review-finding-repository'
import type { ReviewResult } from '../workflows/review-result'

/** 规则审稿阶段标识（与 rule-review.ts 产出保持一致） */
export const RULE_REVIEW_STAGE = 'rule-review'
/** LLM 审稿阶段标识 */
export const LLM_REVIEW_STAGE = 'llm-review'
/** 逐条规则勾选阶段标识（rule-compliance.ts 产出） */
export const RULE_COMPLIANCE_STAGE = 'rule-compliance'

const SEVERITY_RANK: Record<ReviewSeverity, number> = { info: 0, warning: 1, error: 2 }

/** 映射严重度：pass 不落台账；其余按 error/warning/info 归一 */
function toSeverity(value: string): ReviewSeverity | null {
  if (value === 'pass') return null
  if (value === 'error') return 'error'
  if (value === 'warning') return 'warning'
  return 'info'
}

/** 去掉空白与标点，只保留可用于比对的文字 */
function normalizeEvidence(text: string): string {
  return text.replace(/[\s，。；！？、,.!?;:"“”'‘’（）()【】[\]]/g, '')
}

/**
 * 判定两条 finding 是否在说同一处原文。
 * 证据为空时不做去重（宁可重复，也不误删）。
 */
export function isDuplicateFinding(a: ReviewFindingInput, b: ReviewFindingInput): boolean {
  const left = normalizeEvidence(a.evidence ?? '')
  const right = normalizeEvidence(b.evidence ?? '')
  if (left.length < 6 || right.length < 6) return false
  return left.includes(right) || right.includes(left)
}

/** LLM 审稿结果 → findings（pass 不落库） */
export function reviewResultToFindings(
  result: ReviewResult,
  chapterNumber: number,
  draftId?: string,
): ReviewFindingInput[] {
  const findings: ReviewFindingInput[] = []
  for (const item of result.items) {
    const severity = toSeverity(item.severity)
    if (!severity) continue
    const category = item.category.trim() || '未分类'
    const message = item.description.trim() || `${category}：模型未给出描述`
    findings.push({
      chapterNumber,
      draftId,
      stage: LLM_REVIEW_STAGE,
      category,
      severity,
      message,
      evidence: item.quote?.trim() ?? '',
      locationHint: '',
    })
  }
  return findings
}

/**
 * 从 LLM findings 中去掉已被规则审稿覆盖的条目（同一原文证据）。
 * 若 LLM 给出的严重度更高，则用高严重度替换规则条目，避免低估风险。
 */
export function mergeWithRuleFindings(
  ruleFindings: ReviewFindingInput[],
  llmFindings: ReviewFindingInput[],
): ReviewFindingInput[] {
  const merged = ruleFindings.map((f) => ({ ...f }))
  const additions: ReviewFindingInput[] = []
  for (const item of llmFindings) {
    const index = merged.findIndex((m) => isDuplicateFinding(m, item))
    if (index === -1) {
      additions.push(item)
      continue
    }
    const existing = merged[index]
    if (SEVERITY_RANK[item.severity] > SEVERITY_RANK[existing.severity]) {
      merged[index] = {
        ...existing,
        severity: item.severity,
        message: `${existing.message}（LLM 审稿：${item.message}）`,
      }
    }
  }
  return [...merged, ...additions]
}
