/**
 * 时间校准器（N2）
 *
 * 职责：
 *   1. 把中文时间表达归一成「第 N 天 + 钟点 + 时长」；
 *   2. 与已确认的事件、上一章末锚点、下一章计划窗口比对；
 *   3. 按决策矩阵给出 pass / warning / error，供定稿后写入与审稿使用。
 *
 * 口径（与 docs/新书-静默环星/05-修改计划 一致）：
 *   - 没有重复且合理 → 放行
 *   - 已有时间点 → 比对一致性
 *   - 新增节点 → 检查合理范围
 *   - 回忆 / 倒叙 → 必须显式标注，不参与单调性
 *
 * 本文件是纯函数：不读 DB、不发 IPC、不调用模型。
 */

export type TimeConfidence = 'high' | 'medium' | 'low'

export interface TimeAnchor {
  offsetDay: number | null
  clock?: string
}

export interface ParsedTime {
  /** 第 N 天（可带小数：0.5 表示当天 12:00） */
  offsetDay: number | null
  /** HH:mm，解析不到时为空串 */
  clock: string
  /** 归一后的绝对时间字符串，直接落库 */
  absoluteTime: string
  durationMin: number | null
  durationText: string
  confidence: TimeConfidence
  kind: 'absolute_date' | 'day_index' | 'relative' | 'period' | 'vague' | 'parallel' | 'unknown'
  flashback: boolean
  evidence: string
}

export interface TimeCandidate {
  sequence: number
  storyTime?: string
  /** 模型归一后的绝对时间（第 N 天，可带小数） */
  absoluteTime?: string
  /** 原始时间描述（模型给的时间短语或正文时间句） */
  rawTime: string
  duration?: string
  location?: string
  participants?: string[]
  summary: string
  timeFlow?: 'sequential' | 'flashback'
  evidence?: string
}

export interface ExistingTimelineEvent {
  chapterNumber: number
  sequence: number
  absoluteTime?: string
  duration?: string
  location?: string
  summary?: string
  timeFlow?: string
  status?: string
}

export interface NormalizedEvent extends TimeCandidate {
  absoluteTime: string
  offsetDay: number | null
  clock: string
  durationMin: number | null
  confidence: TimeConfidence
  flashback: boolean
}

export type TimeIssueType =
  | 'new_node_passed'
  | 'new_node_conflict'
  | 'duplicate_consistent'
  | 'duplicate_drift'
  | 'range_violation'
  | 'hard_rule_violation'
  | 'flashback_unmarked'
  | 'vague_time'

export interface TimeIssue {
  type: TimeIssueType
  severity: 'pass' | 'warning' | 'error'
  quote: string
  parsed?: { offsetDay: number | null; clock: string; durationMin: number | null; confidence: TimeConfidence }
  existing?: { chapter: number; offsetDay: number | null; clock: string }
  reason: string
  fix: string
}

export interface CalibrateInput {
  chapterNumber: number
  events: TimeCandidate[]
  /** 上一章末已确认事件锚点 */
  previousAnchor?: TimeAnchor
  /** 同章已有事件（用于重复匹配） */
  existingChapterEvents?: ExistingTimelineEvent[]
  /** 下一章计划首事件的时间（防止提前发生） */
  nextChapterFirstOffset?: number | null
  /** 本章计划事件（章纲时间线） */
  blueprintEvents?: Array<{ seq: number; absoluteTime?: string; storyTime?: string }>
}

export interface CalibrateResult {
  events: NormalizedEvent[]
  issues: TimeIssue[]
  verdict: 'pass' | 'warning' | 'error'
}

const CN_DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}

/** 中文数词 → 数值（支持 半 / 十 / 二十三 / 两） */
export function cnToNumber(raw: string): number | null {
  const text = (raw || '').trim()
  if (!text) return null
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text)
  if (text === '半') return 0.5
  if (text.includes('十')) {
    const [tensRaw, onesRaw] = text.split('十')
    const tens = tensRaw ? CN_DIGITS[tensRaw] : 1
    const ones = onesRaw ? CN_DIGITS[onesRaw] : 0
    if (tens === undefined || ones === undefined) return null
    return tens * 10 + ones
  }
  let value = 0
  for (const ch of text) {
    const digit = CN_DIGITS[ch]
    if (digit === undefined) return null
    value = value * 10 + digit
  }
  return value
}

const PERIOD_CLOCK: Array<{ pattern: RegExp; hour: number }> = [
  { pattern: /凌晨|拂晓|破晓/, hour: 3 },
  { pattern: /清晨|早晨|一大早|天亮/, hour: 6 },
  { pattern: /上午|早上/, hour: 9 },
  { pattern: /正午|中午|晌午/, hour: 12 },
  { pattern: /下午|午后/, hour: 15 },
  { pattern: /傍晚|黄昏|入夜|日落/, hour: 19 },
  { pattern: /夜里|夜晚|晚上|夜间/, hour: 21 },
  { pattern: /深夜|半夜|午夜|子夜/, hour: 23 },
]

const FLASHBACK_MARKERS = /(回忆|倒叙|闪回|那年|多年前|十年前|二十年前|记忆中|脑海里浮现)/

/** 月度 30 天历：6 月 30 日 = 第 1 天 */
function monthDayToOffset(month: number, day: number): number {
  return (month - 6) * 30 + day - 29
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function clockOfHour(hour: number): string {
  return `${pad2(hour % 24)}:00`
}

function toAbsolute(day: number | null, clock: string): string {
  if (day === null) return ''
  if (!clock) return String(Math.round(day * 100) / 100)
  const [h, m] = clock.split(':').map((x) => Number(x))
  const fraction = ((h || 0) + (m || 0) / 60) / 24
  return String(Math.round((day + fraction) * 100) / 100)
}

function durationFromText(text: string): { minutes: number | null; text: string } {
  const match = text.match(/([一二三四五六七八九十两\d]+|半)(?:个)?(天|日|时辰|小时|分钟|刻钟)/)
  if (!match) return { minutes: null, text: '' }
  const n = cnToNumber(match[1])
  if (n === null) return { minutes: null, text: match[0] }
  const unit = match[2]
  const factor = unit === '天' || unit === '日' ? 1440
    : unit === '时辰' ? 120
      : unit === '小时' ? 60
        : unit === '刻钟' ? 15
          : 1
  return { minutes: Math.round(n * factor), text: match[0] }
}

/**
 * 解析单条时间表达。
 * @param text       原始时间描述
 * @param anchor     参考锚点（上一事件 / 上一章末）
 */
export function parseTimeExpression(text: string, anchor?: TimeAnchor): ParsedTime {
  const evidence = (text || '').trim()
  const base: ParsedTime = {
    offsetDay: null,
    clock: '',
    absoluteTime: '',
    durationMin: null,
    durationText: '',
    confidence: 'low',
    kind: 'unknown',
    flashback: false,
    evidence,
  }
  if (!evidence) return base
  base.flashback = FLASHBACK_MARKERS.test(evidence)

  // 0) 模型直接给数字：3 / 3.5
  const numeric = evidence.match(/^\s*(\d+(?:\.\d+)?)\s*(?:天|日)?\s*$/)
  if (numeric) {
    const day = Number(numeric[1])
    return {
      ...base,
      offsetDay: day,
      clock: '',
      absoluteTime: toAbsolute(day, ''),
      confidence: 'high',
      kind: 'day_index',
    }
  }

  // 1) 绝对日期：6 月 30 日 / 7月1号
  const dateMatch = evidence.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/)
  if (dateMatch) {
    const day = monthDayToOffset(Number(dateMatch[1]), Number(dateMatch[2]))
    const period = PERIOD_CLOCK.find((p) => p.pattern.test(evidence))
    const clock = period ? clockOfHour(period.hour) : ''
    return {
      ...base,
      offsetDay: day,
      clock,
      absoluteTime: toAbsolute(day, clock),
      confidence: period ? 'high' : 'medium',
      kind: 'absolute_date',
    }
  }

  // 2) 第 N 天 / 场内第 N 天
  const dayIndex = evidence.match(/第\s*([一二三四五六七八九十两\d]+)\s*天/)
  if (dayIndex) {
    const n = cnToNumber(dayIndex[1])
    if (n !== null) {
      const period = PERIOD_CLOCK.find((p) => p.pattern.test(evidence))
      const clock = period ? clockOfHour(period.hour) : ''
      return {
        ...base,
        offsetDay: n,
        clock,
        absoluteTime: toAbsolute(n, clock),
        confidence: period ? 'high' : 'medium',
        kind: 'day_index',
      }
    }
  }

  // 3) 相对日期：三天后 / 两日后 / 次日 / 当晚
  const anchorDay = anchor?.offsetDay ?? null
  const anchorClock = anchor?.clock || ''
  const relativeDay = evidence.match(/([一二三四五六七八九十两\d]+)\s*(?:天|日)\s*(?:后|之后|以后)/)
  if (relativeDay) {
    const n = cnToNumber(relativeDay[1])
    if (n !== null && anchorDay !== null) {
      const day = anchorDay + n
      const period = PERIOD_CLOCK.find((p) => p.pattern.test(evidence))
      const clock = period ? clockOfHour(period.hour) : anchorClock
      return {
        ...base,
        offsetDay: day,
        clock,
        absoluteTime: toAbsolute(day, clock),
        confidence: 'high',
        kind: 'relative',
      }
    }
  }
  if (/次日|翌日|第二天|隔天/.test(evidence) && anchorDay !== null) {
    const day = anchorDay + 1
    const period = PERIOD_CLOCK.find((p) => p.pattern.test(evidence))
    const clock = period ? clockOfHour(period.hour) : anchorClock
    return {
      ...base,
      offsetDay: day,
      clock,
      absoluteTime: toAbsolute(day, clock),
      confidence: 'high',
      kind: 'relative',
    }
  }
  if (/当晚|当天|同日|当天夜里|当天晚上/.test(evidence) && anchorDay !== null) {
    const period = PERIOD_CLOCK.find((p) => p.pattern.test(evidence))
    const clock = period ? clockOfHour(period.hour) : anchorClock
    return {
      ...base,
      offsetDay: anchorDay,
      clock,
      absoluteTime: toAbsolute(anchorDay, clock),
      confidence: 'high',
      kind: 'relative',
    }
  }

  // 4) 小时后 / 时辰后（同一天推进钟点）
  const hourLater = evidence.match(/([一二三四五六七八九十两\d]+|半)\s*(?:个)?(小时|时辰|分钟|刻钟)\s*(?:后|之后|以后)/)
  if (hourLater && anchorDay !== null) {
    const n = cnToNumber(hourLater[1])
    if (n !== null) {
      const unit = hourLater[2]
      const addMin = unit === '时辰' ? n * 120
        : unit === '小时' ? n * 60
          : unit === '刻钟' ? n * 15
            : n
      const baseMinutes = anchorClock
        ? Number(anchorClock.split(':')[0]) * 60 + Number(anchorClock.split(':')[1] || 0)
        : 9 * 60
      const total = baseMinutes + addMin
      const dayShift = Math.floor(total / 1440)
      const minutesInDay = total % 1440
      const day = anchorDay + dayShift
      const clock = `${pad2(Math.floor(minutesInDay / 60))}:${pad2(minutesInDay % 60)}`
      return {
        ...base,
        offsetDay: day,
        clock,
        absoluteTime: toAbsolute(day, clock),
        confidence: 'high',
        kind: 'relative',
      }
    }
  }

  // 5) 持续时长（待了三天 / 耗了两个时辰）
  const duration = durationFromText(evidence)
  if (duration.minutes !== null) {
    const period = PERIOD_CLOCK.find((p) => p.pattern.test(evidence))
    const clock = period ? clockOfHour(period.hour) : (anchorClock || '')
    return {
      ...base,
      offsetDay: anchorDay,
      clock,
      absoluteTime: toAbsolute(anchorDay, clock),
      durationMin: duration.minutes,
      durationText: duration.text,
      confidence: 'medium',
      kind: 'period',
    }
  }

  // 6) 模糊时间：几天后 / 没多久 / 过了好一阵
  if (/几天后|没几天|数日后|没多久|没过多久|过了好一阵|不知过了多久/.test(evidence)) {
    const period = PERIOD_CLOCK.find((p) => p.pattern.test(evidence))
    const clock = period ? clockOfHour(period.hour) : (anchorClock || '')
    const day = anchorDay === null ? null : anchorDay + 2
    return {
      ...base,
      offsetDay: day,
      clock,
      absoluteTime: toAbsolute(day, clock),
      confidence: 'low',
      kind: 'vague',
    }
  }

  // 7) 时段（只有钟点，日期沿用锚点）
  const period = PERIOD_CLOCK.find((p) => p.pattern.test(evidence))
  if (period) {
    const clock = clockOfHour(period.hour)
    return {
      ...base,
      offsetDay: anchorDay,
      clock,
      absoluteTime: toAbsolute(anchorDay, clock),
      confidence: 'medium',
      kind: 'period',
    }
  }

  // 8) 并行叙述：与此同时 / 另一边
  if (/与此同时|同一时间|另一边|同一时刻/.test(evidence)) {
    return {
      ...base,
      offsetDay: anchorDay,
      clock: anchorClock,
      absoluteTime: toAbsolute(anchorDay, anchorClock),
      confidence: 'medium',
      kind: 'parallel',
    }
  }

  return base
}

/** 从数字化的 absolute_time 还原 offsetDay / clock */
export function decodeAbsolute(value: string): { offsetDay: number | null; clock: string } {
  if (!value) return { offsetDay: null, clock: '' }
  const day = Number(value)
  if (Number.isNaN(day)) return { offsetDay: null, clock: '' }
  const base = Math.floor(day + 1e-9)
  const fraction = Math.max(0, day - base)
  if (fraction === 0) return { offsetDay: base, clock: '' }
  const minutes = Math.round(fraction * 24 * 60 / 15) * 15
  const hh = Math.floor(minutes / 60) % 24
  const mm = minutes % 60
  return { offsetDay: base, clock: `${pad2(hh)}:${pad2(mm)}` }
}

function daysBetweenClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= 0.02
}

function clockToMinutes(clock: string): number | null {
  if (!clock) return null
  const [h, m] = clock.split(':').map((x) => Number(x))
  if (Number.isNaN(h)) return null
  return h * 60 + (m || 0)
}

/**
 * 依次尝试 raw_time / story_time / absolute_time，取第一个能归一成「第 N 天」的解释。
 * 正文没有可归一的时间时，退回本章章纲计划事件（按 sequence 对齐），
 * 让「定稿后自动入轴」不至于因为正文省略日期而全部卡在待确认。
 */
function resolveCandidateTime(
  candidate: TimeCandidate,
  anchor: TimeAnchor,
  planEvent?: { seq: number; absoluteTime?: string; storyTime?: string },
): ParsedTime {
  // 正文原句优先；模型归一后的 absolute_time 比 story_time 更精确，排在其次
  const sources = [candidate.rawTime, candidate.absoluteTime, candidate.storyTime]
    .map((s) => (s || '').trim())
    .filter(Boolean)
  let firstParsed: ParsedTime | null = null
  for (const text of sources) {
    const parsed = parseTimeExpression(text, anchor)
    if (!firstParsed) firstParsed = parsed
    if (parsed.offsetDay !== null) return parsed
  }

  if (planEvent) {
    for (const text of [planEvent.absoluteTime, planEvent.storyTime]) {
      const parsed = parseTimeExpression(String(text || ''), anchor)
      if (parsed.offsetDay !== null) {
        return {
          ...parsed,
          evidence: firstParsed?.evidence || candidate.evidence || candidate.summary,
          confidence: 'medium',
        }
      }
    }
  }

  return firstParsed || parseTimeExpression(candidate.rawTime || '', anchor)
}

/**
 * 校准一章的时间事件。
 */
export function calibrateChapterTime(input: CalibrateInput): CalibrateResult {
  const issues: TimeIssue[] = []
  const normalized: NormalizedEvent[] = []
  const existing = input.existingChapterEvents || []
  const prevDay = input.previousAnchor?.offsetDay ?? null
  let lastDay = prevDay
  let hasError = false
  let hasWarning = false

  const push = (issue: TimeIssue) => {
    issues.push(issue)
    if (issue.severity === 'error') hasError = true
    if (issue.severity === 'warning') hasWarning = true
  }

  const sorted = [...input.events].sort((a, b) => a.sequence - b.sequence)
  for (const candidate of sorted) {
    const planEvent = input.blueprintEvents?.find((e) => e.seq === candidate.sequence)
    const parsed = resolveCandidateTime(candidate, { offsetDay: lastDay, clock: input.previousAnchor?.clock }, planEvent)
    const flashback = candidate.timeFlow === 'flashback' || parsed.flashback
    const event: NormalizedEvent = {
      ...candidate,
      absoluteTime: parsed.absoluteTime,
      offsetDay: parsed.offsetDay,
      clock: parsed.clock,
      durationMin: parsed.durationMin,
      confidence: parsed.confidence,
      flashback,
      timeFlow: flashback ? 'flashback' : 'sequential',
    }
    normalized.push(event)

    // 无法解析：不自动写，进待确认
    if (parsed.offsetDay === null) {
      push({
        type: 'vague_time',
        severity: 'warning',
        quote: parsed.evidence || candidate.summary,
        parsed: { offsetDay: null, clock: parsed.clock, durationMin: parsed.durationMin, confidence: parsed.confidence },
        reason: '时间表达无法归一为「第 N 天」，不自动写入时间轴。',
        fix: '把时间写具体：第几天、什么时段，或改成「次日 / 三天后」。',
      })
      continue
    }

    // 同章已有事件 → 比对一致性
    const sameEvent = existing.find((e) => e.sequence === candidate.sequence)
      || existing.find((e) => e.location && candidate.location && e.location === candidate.location)
    if (sameEvent) {
      const existingParsed = sameEvent.absoluteTime
        ? decodeAbsolute(sameEvent.absoluteTime)
        : parseTimeExpression(sameEvent.summary || '')
      const existingDay = sameEvent.absoluteTime
        ? existingParsed.offsetDay
        : parseTimeExpression(sameEvent.summary || '').offsetDay
      if (existingDay !== null && !daysBetweenClose(parsed.offsetDay, existingDay)) {
        push({
          type: 'duplicate_drift',
          severity: 'error',
          quote: parsed.evidence || candidate.summary,
          parsed: { offsetDay: parsed.offsetDay, clock: parsed.clock, durationMin: parsed.durationMin, confidence: parsed.confidence },
          existing: { chapter: sameEvent.chapterNumber, offsetDay: existingDay, clock: existingParsed.clock },
          reason: `正文写的是第 ${parsed.offsetDay} 天，时间轴上同一事件是第 ${existingDay} 天。`,
          fix: '按定稿正文或时间轴二者之一改，不能两套并存。',
        })
      } else {
        const existingClock = existingParsed.clock
        const clockDiff = clockToMinutes(parsed.clock) !== null && clockToMinutes(existingClock) !== null
          ? Math.abs((clockToMinutes(parsed.clock) as number) - (clockToMinutes(existingClock) as number))
          : 0
        const existingDuration = durationFromText(sameEvent.duration || '').minutes
        const durationDiff = parsed.durationMin !== null && existingDuration !== null
          ? Math.abs(parsed.durationMin - existingDuration) / Math.max(existingDuration, 1)
          : 0
        if (clockDiff > 30 || durationDiff > 0.2) {
          push({
            type: 'duplicate_drift',
            severity: 'warning',
            quote: parsed.evidence || candidate.summary,
            parsed: { offsetDay: parsed.offsetDay, clock: parsed.clock, durationMin: parsed.durationMin, confidence: parsed.confidence },
            existing: { chapter: sameEvent.chapterNumber, offsetDay: existingDay, clock: existingClock },
            reason: '日期一致，但钟点或时长超出容差（钟点 ±30 分钟，时长 ±20%）。',
            fix: '确认以哪一版为准，再更新正文或时间轴。',
          })
        } else {
          push({
            type: 'duplicate_consistent',
            severity: 'pass',
            quote: parsed.evidence || candidate.summary,
            parsed: { offsetDay: parsed.offsetDay, clock: parsed.clock, durationMin: parsed.durationMin, confidence: parsed.confidence },
            existing: { chapter: sameEvent.chapterNumber, offsetDay: existingDay, clock: existingClock },
            reason: '与时间轴已有事件一致，判为同一事件，不重复写。',
            fix: '',
          })
        }
      }
    } else {
      // 新增节点：范围与单调性
      if (!flashback && prevDay !== null && parsed.offsetDay < prevDay - 0.02) {
        push({
          type: 'new_node_conflict',
          severity: 'error',
          quote: parsed.evidence || candidate.summary,
          parsed: { offsetDay: parsed.offsetDay, clock: parsed.clock, durationMin: parsed.durationMin, confidence: parsed.confidence },
          existing: { chapter: input.chapterNumber - 1, offsetDay: prevDay, clock: input.previousAnchor?.clock || '' },
          reason: `本章事件落在第 ${parsed.offsetDay} 天，早于上一章末的第 ${prevDay} 天，且未标回忆 / 倒叙。`,
          fix: '改正文时间，或在摘要首字标注「回忆」并改用倒叙口径。',
        })
      } else if (input.nextChapterFirstOffset != null && parsed.offsetDay > input.nextChapterFirstOffset + 0.02) {
        push({
          type: 'range_violation',
          severity: 'error',
          quote: parsed.evidence || candidate.summary,
          parsed: { offsetDay: parsed.offsetDay, clock: parsed.clock, durationMin: parsed.durationMin, confidence: parsed.confidence },
          reason: `本章事件在第 ${parsed.offsetDay} 天，已经越过下一章计划首事件的第 ${input.nextChapterFirstOffset} 天。`,
          fix: '把事件提前，或调整后续章纲。',
        })
      } else if (parsed.confidence === 'low') {
        push({
          type: 'vague_time',
          severity: 'warning',
          quote: parsed.evidence || candidate.summary,
          parsed: { offsetDay: parsed.offsetDay, clock: parsed.clock, durationMin: parsed.durationMin, confidence: parsed.confidence },
          reason: '模糊时间（几天后 / 没多久），只作参考，不自动确认。',
          fix: '需要自动入轴时改成明确时间。',
        })
      } else if (parsed.flashback && !candidate.timeFlow) {
        push({
          type: 'flashback_unmarked',
          severity: 'warning',
          quote: parsed.evidence || candidate.summary,
          parsed: { offsetDay: parsed.offsetDay, clock: parsed.clock, durationMin: parsed.durationMin, confidence: parsed.confidence },
          reason: '检测到回忆词但没有显式标注时间流向。',
          fix: '在事件摘要首字写「回忆」，并置 time_flow=flashback。',
        })
      } else {
        push({
          type: 'new_node_passed',
          severity: 'pass',
          quote: parsed.evidence || candidate.summary,
          parsed: { offsetDay: parsed.offsetDay, clock: parsed.clock, durationMin: parsed.durationMin, confidence: parsed.confidence },
          reason: `新增节点第 ${parsed.offsetDay} 天，落在上一章末之后、下一章计划之前。`,
          fix: '',
        })
      }
    }

    if (!flashback && parsed.offsetDay !== null) {
      if (lastDay !== null && parsed.offsetDay < lastDay - 0.02) {
        push({
          type: 'new_node_conflict',
          severity: 'error',
          quote: parsed.evidence || candidate.summary,
          parsed: { offsetDay: parsed.offsetDay, clock: parsed.clock, durationMin: parsed.durationMin, confidence: parsed.confidence },
          reason: `同章事件时间倒流：第 ${parsed.offsetDay} 天排在第 ${lastDay} 天之后。`,
          fix: '调整事件顺序，或标为回忆。',
        })
      }
      lastDay = parsed.offsetDay
    }
  }

  return {
    events: normalized,
    issues,
    verdict: hasError ? 'error' : (hasWarning ? 'warning' : 'pass'),
  }
}

/** 从正文句子中扫出带时间表达的候选（审稿用，不调用模型） */
export function extractTimeCandidatesFromText(content: string, startSequence = 1): TimeCandidate[] {
  const sentences = content
    .split(/[。！？\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4 && s.length <= 200)
  const TIME_HINT = /第\s*[一二三四五六七八九十两\d]+\s*天|[\d]+\s*月\s*[\d]+\s*[日号]|[一二三四五六七八九十两\d]+\s*(?:天|日|小时|时辰|分钟)\s*(?:后|之后|以后)|次日|翌日|第二天|当晚|当天|清晨|早晨|上午|正午|中午|下午|傍晚|入夜|夜里|深夜|凌晨|几天后|没多久|过了好一阵|与此同时|另一边|半日|半刻/
  const out: TimeCandidate[] = []
  let sequence = startSequence
  for (const sentence of sentences) {
    if (!TIME_HINT.test(sentence)) continue
    out.push({
      sequence: sequence++,
      rawTime: sentence,
      summary: sentence.slice(0, 80),
      evidence: sentence,
    })
  }
  return out
}
