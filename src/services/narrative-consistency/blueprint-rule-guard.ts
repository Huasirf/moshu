/**
 * 蓝图规则闸门：在蓝图生成阶段拦截已废弃设定与属性账断裂。
 * 只做确定性校验，不调用 LLM；写作阶段仍以 rulebook 为准。
 */

export const BANNED_BLUEPRINT_TERMS = [
  '极境', '满编', '独吞', '劣质破障', '功法系数',
  '意识属性', '团队会战', '厮杀排名', '守点', '竞速',
  '心识强度', '最高待遇', '完整小队编制', '编制贡献度', '面板最终值',
] as const

/** 只拦截“等级+巅峰/极限/半步”这类阶位表述，放行“状态调至巅峰”等普通修辞 */
const BANNED_PATTERNS: Array<{ label: string; re: RegExp }> = [
  { label: '半步XX级', re: /半步[FEDCBAS]级/ },
  { label: 'XX级巅峰', re: /[FEDCBAS]级(?:的)?(?:巅峰|极限)|巅峰(?:境|期)/ },
]

export const RULE_ONLY_TERMS = ['份额'] as const

export interface AttributeLedger {
  before: [number, number, number, number]
  after: [number, number, number, number]
  gain: [number, number, number, number]
}

const LEDGER_RE = /进\s*=\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)[；;，,]\s*出\s*=\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/

/** 顺序固定：心识 / 体魄 / 力量 / 敏捷 */
export function parseAttributeLedger(text: string): AttributeLedger | null {
  const m = (text || '').match(LEDGER_RE)
  if (!m) return null
  const nums = m.slice(1, 9).map(Number)
  const before = nums.slice(0, 4) as AttributeLedger['before']
  const after = nums.slice(4, 8) as AttributeLedger['after']
  return {
    before,
    after,
    gain: after.map((v, i) => v - before[i]) as AttributeLedger['gain'],
  }
}

export function scanBannedBlueprintTerms(text: string): string[] {
  const src = text || ''
  const hits: string[] = BANNED_BLUEPRINT_TERMS.filter(term => src.includes(term))
  for (const p of BANNED_PATTERNS) if (p.re.test(src)) hits.push(p.label)
  return hits
}

export function checkQuarterRule(attrs: number[]): string | null {
  const positive = attrs.filter(v => Number.isFinite(v) && v > 0)
  if (positive.length < 4) return null
  const max = Math.max(...positive)
  const min = Math.min(...positive)
  if (min * 4 < max) return `1/4铁律破裂：最低${min}，最高${max}（下限应为${Math.ceil(max / 4)}）`
  return null
}

export interface BlueprintRuleIssue {
  chapterNumber: number
  level: 'error' | 'warning'
  message: string
}

/**
 * @param guidance 蓝图 userGuidance（必须含【属性账】）
 * @param previous 上一章章末四维（顺序 心识/体魄/力量/敏捷），无则为 null
 * @param exemptQuarter 开篇初始账允许低于1/4线
 */
export function validateBlueprintLedger(
  chapterNumber: number,
  guidance: string,
  previous: AttributeLedger['after'] | null,
  exemptQuarter = false,
): { issues: BlueprintRuleIssue[]; ledger: AttributeLedger | null } {
  const issues: BlueprintRuleIssue[] = []
  const ledger = parseAttributeLedger(guidance)
  if (!ledger) {
    issues.push({ chapterNumber, level: 'error', message: '缺少【属性账】进=…/…/…/…；出=…/…/…/…（顺序：心识/体魄/力量/敏捷）' })
    return { issues, ledger }
  }
  if (previous && ledger.before.some((v, i) => v !== previous[i])) {
    issues.push({
      chapterNumber, level: 'error',
      message: `属性账断链：本章进=${ledger.before.join('/')}，上一章出=${previous.join('/')}`,
    })
  }
  const mismatch = ledger.gain.findIndex(g => g < 0)
  if (mismatch >= 0) {
    // 月供抽取与破障代价是规则内的心识扣除，允许仅第1项（心识）为负；
    // 其余任何属性负增长仍视为账本错误。
    const ruleDeduction = mismatch === 0
      && /(月供|破障|扣除|抽取)/.test(guidance)
      && ledger.gain.slice(1).every(g => g >= 0)
    if (!ruleDeduction) {
      issues.push({ chapterNumber, level: 'error', message: `属性账为负增长：第${mismatch + 1}项` })
    }
  }
  if (!exemptQuarter) {
    const q = checkQuarterRule(ledger.after)
    if (q) issues.push({ chapterNumber, level: 'error', message: q })
  }
  return { issues, ledger }
}

export function validateBlueprintText(
  chapterNumber: number,
  fields: { purpose?: string; keyEvents?: string; userGuidance?: string; suspenseHook?: string },
): BlueprintRuleIssue[] {
  const text = [fields.purpose, fields.keyEvents, fields.userGuidance, fields.suspenseHook].filter(Boolean).join('\n')
  // 负向口径行（“禁止写X”）本身包含废弃词，扫描前剔除，避免把规则当违规
  const cleaned = text.split('\n').filter(l => !l.includes('禁止写') && !l.includes('旧稿中的')).join('\n')
  return scanBannedBlueprintTerms(cleaned).map(term => ({
    chapterNumber,
    level: 'error' as const,
    message: `出现已废弃术语「${term}」`,
  }))
}

export function summarizeIssues(issues: BlueprintRuleIssue[], limit = 8): string {
  const errors = issues.filter(i => i.level === 'error')
  const warnings = issues.filter(i => i.level === 'warning')
  const lines = [...errors, ...warnings].slice(0, limit).map(i => `第${i.chapterNumber}章：${i.message}`)
  const tail = issues.length > limit ? `\n……另有${issues.length - limit}条` : ''
  return lines.join('\n') + tail
}
