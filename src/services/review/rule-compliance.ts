/**
 * 规则合规校验（P8）
 *
 * 1. 数值闸：从「硬规则」里解析可量化的上限/下限（如「不得超过 9 级」），
 *    在正文中扫描越界数值，零成本、可解释；
 * 2. 逐条勾选：给审稿模型的规则区追加「按编号逐条判定」的要求，
 *    模型返回 rule_verdicts，这里转成台账 findings。
 *
 * 设计约定：本文件是纯函数，不读 DB、不发 IPC。
 */
import type { ReviewFindingInput } from '../../../electron/repositories/review-finding-repository'
import type { RuleItem } from '../../shared/rule-timeline'

/** 单条规则在勾选清单里最多展示的正文字数 */
const CHECKLIST_BODY_LIMIT = 260

/** 可识别的计量单位（用于数值闸；没有单位时不做数值比较，避免误判） */
const UNITS = [
  '级', '层', '阶', '星', '重', '品', '成', '个', '人', '名', '位', '次', '枚', '件', '条', '种', '道',
  '万', '亿', '倍', '米', '里', '尺', '寸', '斤', '两', '石', '斗', '升',
  '年', '月', '日', '天', '时辰', '时', '岁', '%', '点', '分',
]

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function unitPattern(): string {
  return UNITS.map(escapeRegex).join('|')
}

export interface RuleVerdict {
  ruleCode: string
  verdict: 'pass' | 'violation' | 'unclear'
  quote: string
  reason: string
}

/** 追加到规则注入文本后的「逐条勾选」要求（只对硬规则生效） */
export function buildRuleComplianceSection(items: RuleItem[]): string {
  const hard = items.filter(item => item.active && item.severity === 'hard' && item.code)
  if (hard.length === 0) return ''
  const list = hard.map(item => {
    const body = item.body.length > CHECKLIST_BODY_LIMIT
      ? `${item.body.slice(0, CHECKLIST_BODY_LIMIT)}…`
      : item.body
    return `[${item.code}] ${item.title || '（无标题）'}\n  ${body}`
  }).join('\n')

  return [
    '【硬规则逐条勾选要求】',
    '请对下列每条硬规则单独判定，并在返回的 JSON 顶层额外输出 rule_verdicts 数组：',
    '{"rule_verdicts":[{"rule_code":"R-1-1","verdict":"pass|violation|unclear","quote":"原文证据","reason":"判定理由"}]}',
    '要求：每条硬规则必须出现一条记录，不得省略；无违规写 pass，无法判断写 unclear（并在 reason 说明缺什么信息）。',
    '若正文违反某条硬规则，还必须同时在 items 中给出一条 error 级别的问题。',
    '规则清单：',
    list,
  ].join('\n')
}

/** 从模型 JSON 里提取 rule_verdicts（容忍字段名偏差） */
export function parseRuleVerdicts(raw: unknown): RuleVerdict[] {
  if (!raw || typeof raw !== 'object') return []
  const obj = raw as Record<string, unknown>
  const list = [obj.rule_verdicts, obj.ruleVerdicts, obj.rule_checks, obj.ruleChecks]
    .find(Array.isArray) as unknown[] | undefined
  if (!list) return []
  const verdicts: RuleVerdict[] = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const it = entry as Record<string, unknown>
    const code = String(it.rule_code ?? it.ruleCode ?? it.code ?? '').trim()
    if (!code) continue
    const rawVerdict = String(it.verdict ?? it.result ?? '').trim().toLowerCase()
    const verdict: RuleVerdict['verdict'] =
      rawVerdict === 'pass' || rawVerdict === '通过' ? 'pass'
        : rawVerdict === 'violation' || rawVerdict === '违规' || rawVerdict === 'fail' ? 'violation'
          : 'unclear'
    verdicts.push({
      ruleCode: code,
      verdict,
      quote: String(it.quote ?? it.evidence ?? '').trim(),
      reason: String(it.reason ?? it.description ?? '').trim(),
    })
  }
  return verdicts
}

/** rule_verdicts → findings（pass 不落台账；violation 记 error，unclear 记 warning） */
export function ruleVerdictFindings(
  verdicts: RuleVerdict[],
  items: RuleItem[],
  chapterNumber: number,
  draftId?: string,
): ReviewFindingInput[] {
  const byCode = new Map(items.map(item => [item.code, item]))
  const findings: ReviewFindingInput[] = []
  for (const verdict of verdicts) {
    if (verdict.verdict === 'pass') continue
    const item = byCode.get(verdict.ruleCode)
    const title = item?.title || '未匹配到条目'
    const category = `规则合规 · ${verdict.ruleCode}`
    if (verdict.verdict === 'violation') {
      findings.push({
        chapterNumber,
        draftId,
        stage: 'rule-compliance',
        category,
        severity: 'error',
        message: `违反硬规则 ${verdict.ruleCode}「${title}」：${verdict.reason || '模型判定与规则冲突'}`,
        evidence: verdict.quote,
        locationHint: '',
      })
    } else {
      findings.push({
        chapterNumber,
        draftId,
        stage: 'rule-compliance',
        category,
        severity: 'warning',
        message: `硬规则 ${verdict.ruleCode}「${title}」无法判定：${verdict.reason || '正文缺少可核对信息'}`,
        evidence: verdict.quote,
        locationHint: '',
      })
    }
  }
  return findings
}

interface NumericLimit {
  ruleCode: string
  ruleTitle: string
  kind: 'max' | 'min'
  value: number
  unit: string
}

/** 容差类表述：这类数字是允许的浮动范围，不是封顶 */
const TOLERANCE_RE = /(个体差|个体差异|差异|偏差|误差|浮动|波动|容差)/

/**
 * 规则主语词：数值闸只在正文里出现主语词的附近比较数值。
 * 取标题里的中文名词段（前 4 字 + 原文），避免把全书任意「数字+单位」都算进来。
 */
function subjectTokens(item: RuleItem): string[] {
  const runs = (item.title || '').match(/[\u4e00-\u9fa5]{2,}/g) || []
  const tokens = new Set<string>()
  for (const run of runs) {
    if (run.length >= 4) tokens.add(run.slice(0, 4))
    if (run.length <= 6) tokens.add(run)
  }
  return [...tokens]
}

/** 从硬规则正文里解析数值上下限（容差类约束不参与） */
function extractLimits(item: RuleItem): NumericLimit[] {
  const limits: NumericLimit[] = []
  const upper = new RegExp(
    `(不得超过|不能超过|不可超过|不超过|不得高于|不得多于|至多|最多|上限(?:为|是|值)?|封顶)\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(${unitPattern()})`,
    'g',
  )
  const lower = new RegExp(
    `(不得少于|不低于|至少|最少|下限(?:为|是)?|保底)\\s*([0-9]+(?:\\.[0-9]+)?)\\s*(${unitPattern()})`,
    'g',
  )
  for (const [pattern, kind] of [[upper, 'max'], [lower, 'min']] as const) {
    let match: RegExpExecArray | null
    pattern.lastIndex = 0
    while ((match = pattern.exec(item.body)) !== null) {
      const prefix = item.body.slice(Math.max(0, match.index - 12), match.index)
      if (TOLERANCE_RE.test(prefix)) continue
      const value = Number(match[2])
      if (!Number.isFinite(value)) continue
      limits.push({ ruleCode: item.code, ruleTitle: item.title, kind, value, unit: match[3] })
    }
  }
  return limits
}

function evidenceAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 24)
  const end = Math.min(text.length, index + length + 24)
  return text.slice(start, end).replace(/\s+/g, ' ').trim()
}

/**
 * 数值闸：扫描正文中的「数字 + 单位」，与硬规则的上下限比较。
 * 只作启发式提示（warning）：必须命中规则主语词的邻近窗口，避免跨语境误报；
 * 每条规则最多报 3 处。
 */
export function runNumericRuleGate(
  items: RuleItem[],
  content: string,
  chapterNumber: number,
  draftId?: string,
): ReviewFindingInput[] {
  const findings: ReviewFindingInput[] = []
  const seen = new Set<string>()

  for (const item of items) {
    if (!item.active || item.severity !== 'hard' || !item.body) continue
    const limits = extractLimits(item)
    if (limits.length === 0) continue
    const tokens = subjectTokens(item)

    for (const limit of limits) {
      const scan = new RegExp(`([0-9]+(?:\\.[0-9]+)?)\\s*(${escapeRegex(limit.unit)})`, 'g')
      let match: RegExpExecArray | null
      let reported = 0
      scan.lastIndex = 0
      while ((match = scan.exec(content)) !== null && reported < 3) {
        const value = Number(match[1])
        if (!Number.isFinite(value)) continue
        // 规则主体没出现在数字附近时不做比较（同单位不同语境，例如「属性点」与「心域容量差」）
        if (tokens.length > 0) {
          const windowStart = Math.max(0, match.index - 40)
          const windowEnd = Math.min(content.length, match.index + match[0].length + 40)
          const window = content.slice(windowStart, windowEnd)
          if (!tokens.some((token) => window.includes(token))) continue
        }
        const violated = limit.kind === 'max' ? value > limit.value : value < limit.value
        if (!violated) continue
        const key = `${limit.ruleCode}:${match[0]}`
        if (seen.has(key)) continue
        seen.add(key)
        reported++
        findings.push({
          chapterNumber,
          draftId,
          stage: 'rule-compliance',
          category: `规则数值 · ${limit.ruleCode}`,
          severity: 'warning',
          message: `疑似违反硬规则 ${limit.ruleCode}「${limit.ruleTitle}」：规则要求${
            limit.kind === 'max' ? '不超过' : '不少于'
          } ${limit.value}${limit.unit}，正文出现 ${value}${limit.unit}（启发式提示，需人工确认）。`,
          evidence: evidenceAround(content, match.index, match[0].length),
          locationHint: '',
        })
      }
    }
  }
  return findings
}
