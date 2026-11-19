/**
 * 去 AI 味本地规则引擎（P4-1，DR-05 默认方案「规则先行 + LLM 兜底」）
 *
 * 纯函数实现，不依赖 DB / IPC / i18n，便于单测与在批量管线中复用。
 * 职责：
 *  1. 在 LLM 清洗前后各扫一遍正文，给出「命中规则 + 片段」；
 *  2. 把命中结果压缩成提示词片段，作为 LLM 的优先改写清单；
 *  3. 支持风格档案里的自定义规则（style_profiles.rules，一行一条）。
 */

import { CLICHE_PATTERNS, scanNumericRepeats, scanSensoryStack } from '../style-scan'

export const DEAIFY_INTENSITIES = ['轻', '中', '重'] as const
export type DeaifyIntensity = (typeof DEAIFY_INTENSITIES)[number]

export type DeaifyCategory =
  | 'ending-elevation'
  | 'metaphor-overuse'
  | 'filler-transition'
  | 'parallelism'
  | 'emotion-telling'
  | 'broadcast-dialogue'
  | 'uniform-rhythm'
  | 'cliche-action'
  | 'numeric-repeat'
  | 'sensory-stack'
  | 'custom'

export interface DeaifyRuleMatch {
  ruleId: string
  category: DeaifyCategory
  /** warning：建议改写；info：仅供参考（重强度下才提示） */
  severity: 'warning' | 'info'
  count: number
  /** 最多保留 3 条上下文片段，供提示词引用 */
  excerpts: string[]
}

export interface DeaifyReport {
  intensity: DeaifyIntensity
  /** 命中条目总数（各规则 count 之和） */
  total: number
  matches: DeaifyRuleMatch[]
  /** 加权分：warning×3 + info×1，用于清洗前后对比 */
  score: number
}

export interface DetectOptions {
  intensity?: DeaifyIntensity
  /** 风格档案自定义规则：一行一条，按字面短语匹配 */
  customRules?: string[]
}

interface RuleSpec {
  id: string
  category: DeaifyCategory
  severity: 'warning' | 'info'
  pattern: RegExp
  /** 命中阈值（次数 > threshold 才算问题）；默认 1 表示命中即报 */
  threshold: Record<DeaifyIntensity, number>
}

const INTENSITY_RANK: Record<DeaifyIntensity, number> = { 轻: 1, 中: 2, 重: 3 }

/** 段尾升华 / 空洞收尾 */
const ENDING_ELEVATION_PATTERNS: RegExp[] = [
  /这一切[，,]?\s*(才)?(刚刚)?开始/g,
  /命运的齿轮(开始|已经)?转动/g,
  /而这[，,]?\s*(才)?(仅仅)?(只)?是(个)?开始/g,
  /仅仅是个开始/g,
  /(他|她)知道[，,]\s*这(一切)?(才)?(刚刚)?开始/g,
]

/** 万能过渡 / 模板化时间推进 */
const FILLER_TRANSITION_PATTERNS: RegExp[] = [
  /与此同时[，,]/g,
  /不知(道)?过了多久/g,
  /空气(仿佛|似乎|好像)?凝固/g,
  /时间(仿佛|似乎|好像)?静止/g,
  /毫无疑问[，,]/g,
  /不可否认[，,]/g,
  /值得一提的是[，,]/g,
  /综上所述[，,]/g,
  /总而言之[，,]/g,
  /换言之[，,]/g,
  /另一方面[，,]/g,
  /不仅如此[，,]/g,
]

/** 情绪解说（Tell 而非 Show） */
const EMOTION_TELLING_PATTERNS: RegExp[] = [
  /(他|她)(感到|感觉到|感受到)(一阵|一股|一丝|一种)?[^。！？]{0,12}/g,
  /(心中|内心|心里)(涌起|升起|泛起|涌上)[^。！？]{0,12}/g,
  /(他|她)的?内心深处[^。！？]{0,12}/g,
  /(他|她)(很|非常|十分)(愤怒|害怕|恐惧|悲伤|高兴|激动)/g,
]

/** 播音腔对白标签 */
const BROADCAST_DIALOGUE_PATTERN = /(说道|问道|答道|回道|喝道|冷笑道)/g

/** 比喻词 */
const METAPHOR_PATTERN = /(仿佛|宛如|犹如|好似|像是)/g

const RULES: RuleSpec[] = [
  {
    id: 'cliche-action',
    category: 'cliche-action',
    severity: 'warning',
    // 与 style-scan 共用同一份套路词表，避免两处口径漂移
    pattern: new RegExp(CLICHE_PATTERNS.map((r) => r.pattern.source).join('|'), 'g'),
    threshold: { 轻: 4, 中: 2, 重: 1 },
  },
  {
    id: 'ending-elevation',
    category: 'ending-elevation',
    severity: 'warning',
    pattern: new RegExp(ENDING_ELEVATION_PATTERNS.map((r) => r.source).join('|'), 'g'),
    // 轻强度只报 3 次以上，避免误伤；中/重命中即报
    threshold: { 轻: 2, 中: 0, 重: 0 },
  },
  {
    id: 'filler-transition',
    category: 'filler-transition',
    severity: 'warning',
    pattern: new RegExp(FILLER_TRANSITION_PATTERNS.map((r) => r.source).join('|'), 'g'),
    threshold: { 轻: 2, 中: 0, 重: 0 },
  },
  {
    id: 'emotion-telling',
    category: 'emotion-telling',
    severity: 'warning',
    pattern: new RegExp(EMOTION_TELLING_PATTERNS.map((r) => r.source).join('|'), 'g'),
    threshold: { 轻: 3, 中: 1, 重: 0 },
  },
  {
    id: 'metaphor-overuse',
    category: 'metaphor-overuse',
    severity: 'warning',
    pattern: METAPHOR_PATTERN,
    // 与写作模板口径一致：整章压到 3 次以内（>3 即报）
    threshold: { 轻: 6, 中: 3, 重: 3 },
  },
  {
    id: 'broadcast-dialogue',
    category: 'broadcast-dialogue',
    severity: 'info',
    pattern: BROADCAST_DIALOGUE_PATTERN,
    threshold: { 轻: 6, 中: 4, 重: 1 },
  },
]

function excerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 8)
  const end = Math.min(text.length, index + length + 8)
  return text.slice(start, end).replace(/\s+/g, ' ').trim()
}

function collectMatches(
  text: string,
  pattern: RegExp,
  limit = 3,
): { count: number; excerpts: string[] } {
  const excerpts: string[] = []
  let count = 0
  const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    count += 1
    if (excerpts.length < limit) excerpts.push(excerptAround(text, m.index, m[0].length))
    if (m[0].length === 0) re.lastIndex += 1
  }
  return { count, excerpts }
}

/** 机械排比：连续 ≥3 句以相同主语开头（按句号/问号/叹号切句） */
export function checkParallelism(text: string): { count: number; excerpts: string[] } {
  const sentences = text
    .split(/[。！？!?]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
  const excerpts: string[] = []
  let runs = 0
  let runStart = 0

  for (let i = 1; i <= sentences.length; i++) {
    const prev = sentences[i - 1] ?? ''
    const cur = sentences[i] ?? ''
    const sameSubject = !!cur && cur.slice(0, 1) === prev.slice(0, 1)
    if (sameSubject) continue
    const runLength = i - runStart
    if (runLength >= 3) {
      runs += 1
      if (excerpts.length < 3) {
        excerpts.push(sentences.slice(runStart, Math.min(i, runStart + 3)).join('。'))
      }
    }
    runStart = i
  }
  return { count: runs, excerpts }
}

/** 过度工整：句长过于均匀（句均 12~45 字且变异系数 < 0.35） */
export function checkUniformRhythm(text: string): { count: number; excerpts: string[] } {
  const lengths = text
    .split(/[。！？!?]/)
    .map((s) => s.trim().length)
    .filter((n) => n > 0)
  if (lengths.length < 12) return { count: 0, excerpts: [] }
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length
  if (mean < 12 || mean > 45) return { count: 0, excerpts: [] }
  const variance = lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length
  const cv = Math.sqrt(variance) / mean
  if (cv >= 0.35) return { count: 0, excerpts: [] }
  return {
    count: 1,
    excerpts: [`平均句长 ${Math.round(mean)} 字，句长变异系数 ${cv.toFixed(2)}（过于整齐）`],
  }
}

function matchCustomRules(
  text: string,
  customRules: string[],
  intensity: DeaifyIntensity,
): DeaifyRuleMatch[] {
  const matches: DeaifyRuleMatch[] = []
  for (const raw of customRules) {
    const phrase = (raw ?? '').trim()
    if (!phrase || phrase.length < 2) continue
    const { count, excerpts } = collectMatches(text, new RegExp(escapeRegExp(phrase), 'g'))
    const threshold = intensity === '轻' ? 3 : 1
    if (count >= threshold) {
      matches.push({
        ruleId: `custom:${phrase}`,
        category: 'custom',
        severity: 'info',
        count,
        excerpts,
      })
    }
  }
  return matches
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 扫描正文的 AI 味特征。
 * 强度只影响阈值，不改变规则集合：轻=只报高频/高置信，重=命中即报。
 */
export function detectAIFlavor(text: string, options: DetectOptions = {}): DeaifyReport {
  const intensity = options.intensity ?? '中'
  const matches: DeaifyRuleMatch[] = []
  const body = text ?? ''

  if (body.trim()) {
    for (const rule of RULES) {
      const { count, excerpts } = collectMatches(body, rule.pattern)
      if (count > rule.threshold[intensity]) {
        matches.push({
          ruleId: rule.id,
          category: rule.category,
          severity: rule.severity,
          count,
          excerpts,
        })
      }
    }

    const parallel = checkParallelism(body)
    if (parallel.count > 0) {
      matches.push({
        ruleId: 'parallelism',
        category: 'parallelism',
        severity: 'warning',
        count: parallel.count,
        excerpts: parallel.excerpts,
      })
    }

    const rhythm = checkUniformRhythm(body)
    if (rhythm.count > 0 && INTENSITY_RANK[intensity] >= INTENSITY_RANK['中']) {
      matches.push({
        ruleId: 'uniform-rhythm',
        category: 'uniform-rhythm',
        severity: 'info',
        count: rhythm.count,
        excerpts: rhythm.excerpts,
      })
    }

    const numeric = scanNumericRepeats(body)
    if (numeric.length > 0) {
      matches.push({
        ruleId: 'numeric-repeat',
        category: 'numeric-repeat',
        severity: 'warning',
        count: numeric.length,
        excerpts: numeric.map((x) => x.excerpt).slice(0, 3),
      })
    }

    const sensory = scanSensoryStack(body)
    if (sensory.length > 0) {
      matches.push({
        ruleId: 'sensory-stack',
        category: 'sensory-stack',
        severity: 'warning',
        count: sensory.length,
        excerpts: sensory.map((x) => x.excerpt).slice(0, 3),
      })
    }

    matches.push(...matchCustomRules(body, options.customRules ?? [], intensity))
  }

  const total = matches.reduce((sum, m) => sum + m.count, 0)
  const score = matches.reduce((sum, m) => sum + (m.severity === 'warning' ? 3 : 1) * m.count, 0)
  return { intensity, total, matches, score }
}

/**
 * 把扫描结果压成提示词片段。
 * translate 由调用方注入（命令层用 i18n），保持本模块无 i18n 依赖。
 */
export function formatDeaifyHint(
  report: DeaifyReport,
  translate: (match: DeaifyRuleMatch) => string,
  maxItems = 8,
): string {
  if (report.matches.length === 0) return ''
  return report.matches
    .slice(0, maxItems)
    .map((match) => {
      const example = match.excerpts[0] ? `；例：${match.excerpts[0]}` : ''
      return `- ${translate(match)}（命中 ${match.count} 处）${example}`
    })
    .join('\n')
}
