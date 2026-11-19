import { describe, expect, it } from 'vitest'
import {
  LLM_REVIEW_STAGE,
  RULE_REVIEW_STAGE,
  isDuplicateFinding,
  mergeWithRuleFindings,
  reviewResultToFindings,
} from '../finding-mapper'
import type { ReviewFindingInput } from '../../../../electron/repositories/review-finding-repository'

function finding(overrides: Partial<ReviewFindingInput> = {}): ReviewFindingInput {
  return {
    chapterNumber: 3,
    stage: RULE_REVIEW_STAGE,
    category: 'pov',
    severity: 'error',
    message: '视角越界',
    evidence: '苏瑶心中暗道：这人好生奇怪。',
    locationHint: '第 1 段',
    ...overrides,
  }
}

describe('reviewResultToFindings', () => {
  it('error / warning 落台账，pass 跳过', () => {
    const findings = reviewResultToFindings({
      summary: '总体尚可',
      items: [
        { category: '剧情连贯性', severity: 'pass', description: '未发现矛盾' },
        { category: '角色状态', severity: 'error', quote: '林砚的右臂完好无损。', description: '与断臂设定冲突' },
        { category: '伏笔完整性', severity: 'warning', description: '到期伏笔未回收' },
      ],
    }, 7, '42')

    expect(findings).toHaveLength(2)
    expect(findings.every(f => f.stage === LLM_REVIEW_STAGE)).toBe(true)
    expect(findings.every(f => f.chapterNumber === 7 && f.draftId === '42')).toBe(true)
    expect(findings[0]).toMatchObject({
      category: '角色状态',
      severity: 'error',
      evidence: '林砚的右臂完好无损。',
    })
    expect(findings[1].evidence).toBe('')
  })

  it('缺失 category / description 时给出可读兜底', () => {
    const [item] = reviewResultToFindings({
      summary: '',
      items: [{ category: '  ', severity: 'warning', description: '' }],
    }, 1)
    expect(item.category).toBe('未分类')
    expect(item.message).toContain('未分类')
  })
})

describe('去重', () => {
  it('规则证据窗口包含 LLM 原文时视为重复', () => {
    expect(isDuplicateFinding(
      finding({ evidence: '片刻后，苏瑶心中暗道：这人好生奇怪。她退后一步。' }),
      finding({ stage: LLM_REVIEW_STAGE, evidence: '苏瑶心中暗道：这人好生奇怪。' }),
    )).toBe(true)
  })

  it('证据为空或过短时不判重', () => {
    expect(isDuplicateFinding(finding({ evidence: '' }), finding({ evidence: '苏瑶心中暗道' }))).toBe(false)
    expect(isDuplicateFinding(finding({ evidence: '短句' }), finding({ evidence: '短句' }))).toBe(false)
  })

  it('合并后同一原文只留一条，严重度取更高', () => {
    const rule = [finding({ severity: 'warning', message: '禁用词重复' })]
    const llm = [finding({
      stage: LLM_REVIEW_STAGE,
      severity: 'error',
      message: '该句与第 2 章矛盾',
    })]

    const merged = mergeWithRuleFindings(rule, llm)
    expect(merged).toHaveLength(1)
    expect(merged[0].severity).toBe('error')
    expect(merged[0].message).toContain('禁用词重复')
    expect(merged[0].message).toContain('第 2 章矛盾')
    expect(merged[0].stage).toBe(RULE_REVIEW_STAGE)
  })

  it('不同原文的 LLM finding 会追加到结果', () => {
    const merged = mergeWithRuleFindings(
      [finding()],
      [finding({ stage: LLM_REVIEW_STAGE, evidence: '另一句完全不同的原文证据。' })],
    )
    expect(merged).toHaveLength(2)
    expect(merged[1].stage).toBe(LLM_REVIEW_STAGE)
  })
})
