import { describe, expect, it } from 'vitest'
import {
  buildRuleComplianceSection,
  parseRuleVerdicts,
  ruleVerdictFindings,
  runNumericRuleGate,
} from '../rule-compliance'
import type { RuleItem } from '../../../shared/rule-timeline'

function rule(overrides: Partial<RuleItem> = {}): RuleItem {
  return {
    id: 'r1',
    code: 'R-1-1',
    group: '总则',
    title: '',
    body: '',
    severity: 'hard',
    tags: [],
    active: true,
    sort: 0,
    updatedAt: '',
    ...overrides,
  }
}

describe('规则数值闸', () => {
  it('硬规则上限在主体附近被突破时记 warning', () => {
    const findings = runNumericRuleGate(
      [rule({ title: '阶位上限', body: '任何角色不得超过 9 级' })],
      '他的阶位上限被人强行突破，踏入了 12 级的领域。',
      3,
      'draft-1',
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warning')
    expect(findings[0].message).toContain('12级')
    expect(findings[0].evidence).toContain('12 级')
  })

  it('未越界时不报问题', () => {
    const findings = runNumericRuleGate(
      [rule({ title: '阶位上限', body: '任何角色不得超过 9 级' })],
      '他压制修为，停在 8 级。',
      3,
    )
    expect(findings).toHaveLength(0)
  })

  it('软规则与无单位数值不参与数值闸', () => {
    const soft = runNumericRuleGate(
      [rule({ severity: 'soft', body: '建议不超过 3 级' })],
      '他达到了 5 级。',
      3,
    )
    const noUnit = runNumericRuleGate(
      [rule({ body: '最多 3 次' })],
      '他尝试了 5 遍。',
      3,
    )
    expect(soft).toHaveLength(0)
    expect(noUnit).toHaveLength(0)
  })

  it('下限被违反时同样记 warning', () => {
    const findings = runNumericRuleGate(
      [rule({ title: '最低人数', body: '每队至少 3 人' })],
      '按最低人数要求，他们只有 2 人出发。',
      3,
    )
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('warning')
    expect(findings[0].message).toContain('不少于')
  })

  it('容差类数字不当作封顶', () => {
    const findings = runNumericRuleGate(
      [rule({ title: '心域容量', body: '心域容量初始 13%-17%（个体差不超过 4 点）' })],
      '心识 10 点，力量 50 点，敏捷 20 点。',
      2,
    )
    expect(findings).toHaveLength(0)
  })

  it('只在规则主体附近比较数值，跨语境不报', () => {
    const findings = runNumericRuleGate(
      [rule({ title: '静默环星停留', body: '灰舟在静默环星停留不超过 5 天' })],
      '常规场限时 7 天，内部流速 4:1。',
      2,
    )
    expect(findings).toHaveLength(0)

    const hit = runNumericRuleGate(
      [rule({ title: '静默环星停留', body: '灰舟在静默环星停留不超过 5 天' })],
      '灰舟在静默环星上停留了 7 天，静默窗口已经开始收窄。',
      4,
    )
    expect(hit).toHaveLength(1)
    expect(hit[0].severity).toBe('warning')
  })
})

describe('硬规则勾选清单', () => {
  it('只列硬规则并包含编号', () => {
    const text = buildRuleComplianceSection([
      rule({ code: 'R-1-1', title: '阶位上限', body: '不得超过 9 级' }),
      rule({ code: 'R-2-1', title: '软建议', body: '建议用短句', severity: 'soft' }),
    ])
    expect(text).toContain('R-1-1')
    expect(text).toContain('rule_verdicts')
    expect(text).not.toContain('R-2-1')
  })

  it('没有硬规则时返回空串', () => {
    expect(buildRuleComplianceSection([rule({ severity: 'soft' })])).toBe('')
  })
})

describe('规则勾选结果解析', () => {
  it('解析 rule_verdicts 并兼容中文判定词', () => {
    const verdicts = parseRuleVerdicts({
      rule_verdicts: [
        { rule_code: 'R-1-1', verdict: 'pass', quote: '', reason: '未越界' },
        { rule_code: 'R-2-1', verdict: '违规', quote: '他到了 12 级', reason: '突破上限' },
      ],
    })
    expect(verdicts).toHaveLength(2)
    expect(verdicts[0].verdict).toBe('pass')
    expect(verdicts[1].verdict).toBe('violation')
  })

  it('缺失字段时按 unclear 处理', () => {
    const verdicts = parseRuleVerdicts({ rule_verdicts: [{ rule_code: 'R-3-1' }] })
    expect(verdicts[0].verdict).toBe('unclear')
  })

  it('pass 不落台账，violation 记 error，unclear 记 warning', () => {
    const items = [rule({ code: 'R-1-1', title: '阶位上限' })]
    const findings = ruleVerdictFindings([
      { ruleCode: 'R-1-1', verdict: 'pass', quote: '', reason: '' },
      { ruleCode: 'R-1-1', verdict: 'violation', quote: '12 级', reason: '越界' },
      { ruleCode: 'R-1-1', verdict: 'unclear', quote: '', reason: '缺信息' },
    ], items, 3, 'draft-1')
    expect(findings).toHaveLength(2)
    expect(findings[0].severity).toBe('error')
    expect(findings[1].severity).toBe('warning')
    expect(findings[0].category).toContain('R-1-1')
  })
})
