import { describe, it, expect } from 'vitest'
import {
  parseAttributeLedger,
  validateBlueprintLedger,
  validateBlueprintText,
} from '../blueprint-rule-guard'

const OK_GUIDE = '【属性账】进=200/145/50/50；出=204/149/51/51；得=心识+4,体魄+4,力量+1,敏捷+1。'

describe('蓝图属性账闸门', () => {
  it('解析进/出/得，并接上上一章出', () => {
    const ledger = parseAttributeLedger(OK_GUIDE)
    expect(ledger?.after).toEqual([204, 149, 51, 51])
    const result = validateBlueprintLedger(28, OK_GUIDE, [200, 145, 50, 50])
    expect(result.issues).toHaveLength(0)
  })

  it('断链与1/4违规会被拦截', () => {
    const broken = '【属性账】进=200/145/50/50；出=400/149/51/51；得=心识+200,体魄+4,力量+1,敏捷+1。'
    const result = validateBlueprintLedger(28, broken, [200, 145, 50, 50])
    expect(result.issues.some(i => i.level === 'error' && i.message.includes('1/4'))).toBe(true)

    const gap = '【属性账】进=300/145/50/50；出=304/149/51/51；得=心识+4,体魄+4,力量+1,敏捷+1。'
    const gapResult = validateBlueprintLedger(28, gap, [200, 145, 50, 50])
    expect(gapResult.issues.some(i => i.message.includes('断链'))).toBe(true)
  })

  it('缺账视为 error', () => {
    const result = validateBlueprintLedger(1, '无账本', null, true)
    expect(result.issues[0].level).toBe('error')
  })

  it('只放行月供/破障造成的心识单点扣除', () => {
    const monthly = '【属性账】进=169/120/43/43；出=168/120/43/43；得=心识-1（每月1日月供抽取）。'
    const ok = validateBlueprintLedger(15, monthly, [169, 120, 43, 43])
    expect(ok.issues).toHaveLength(0)

    const wrongAttr = '【属性账】进=169/120/43/43；出=169/119/43/43；得=体魄-1（月供抽取）。'
    const bad = validateBlueprintLedger(15, wrongAttr, [169, 120, 43, 43])
    expect(bad.issues.some(i => i.message.includes('负增长'))).toBe(true)

    const unexplained = '【属性账】进=169/120/43/43；出=168/120/43/43；得=心识-1。'
    const noReason = validateBlueprintLedger(15, unexplained, [169, 120, 43, 43])
    expect(noReason.issues.some(i => i.message.includes('负增长'))).toBe(true)
  })
})

describe('废弃术语扫描', () => {
  it('拦截阶位型表述，放行普通修辞与负向口径行', () => {
    const bad = validateBlueprintText(9, { purpose: '打穿D级巅峰的守卫' })
    expect(bad.some(i => i.message.includes('XX级巅峰'))).toBe(true)

    const fine = validateBlueprintText(9, { purpose: '把状态调至巅峰' })
    expect(fine).toHaveLength(0)

    const ruleLine = validateBlueprintText(9, { userGuidance: '禁止写极境/半步/巅峰/满编/独吞/劣质破障/功法系数。' })
    expect(ruleLine).toHaveLength(0)
  })

  it('拦截满编、独吞、功法系数等硬废弃词', () => {
    const issues = validateBlueprintText(2, { purpose: '按满编小队结算，独吞全队份额，功法系数放大' })
    expect(issues.some(i => i.message.includes('满编'))).toBe(true)
    expect(issues.some(i => i.message.includes('独吞'))).toBe(true)
    expect(issues.some(i => i.message.includes('功法系数'))).toBe(true)
  })

  it('拦截隐藏强度、最高待遇与旧编制口径', () => {
    const issues = validateBlueprintText(4, {
      purpose: '心识强度压过同阶，轮空判胜享最高待遇',
      keyEvents: '他占一个完整小队编制，按编制贡献度结算，面板最终值已含增幅',
    })
    for (const term of ['心识强度', '最高待遇', '完整小队编制', '编制贡献度', '面板最终值']) {
      expect(issues.some(i => i.message.includes(term)), term).toBe(true)
    }
  })

  it('拦截 A级极限 这类阶位表述', () => {
    const issues = validateBlueprintText(16, { purpose: '楚狂人卡在A级极限多年' })
    expect(issues.some(i => i.message.includes('XX级巅峰'))).toBe(true)
  })
})
