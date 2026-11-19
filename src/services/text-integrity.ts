/**
 * 正文完整性守卫（纯函数，可单测）
 *
 * 拦截三类曾经真实入库的问题稿：
 * - REPEATED_HEAD：同一章首段被重复拼接（第 11 章 23,445 字事故：3 份生成结果首尾相接）
 * - REPEATED_BLOCK：整段内容重复（模型复读 / 拼接边界重叠）
 * - TRUNCATED：输出被 max_tokens 截断在半句、半个引号或未闭合的括号里
 *
 * 字数分档（TOO_SHORT / TOO_LONG）由调用方按需传入阈值触发；
 * 守卫本身只做「结构性损坏」判定，不替作者判断篇幅是否合适。
 */

export type IntegrityCode =
  | 'REPEATED_HEAD'
  | 'REPEATED_BLOCK'
  | 'TRUNCATED'
  | 'TOO_SHORT'
  | 'TOO_LONG'

export interface IntegrityIssue {
  code: IntegrityCode
  detail: string
}

export interface IntegrityOptions {
  /** 篇幅下限（非空白字符数）；传入后低于它会产生 TOO_SHORT */
  minWords?: number
  /** 篇幅硬上限；传入后高于它会产生 TOO_LONG */
  hardMax?: number
}

export interface IntegrityReport {
  ok: boolean
  issues: IntegrityIssue[]
  /** 非空白字符数，与生成链路 countWords 口径一致 */
  wordCount: number
}

/** 首段重复检测窗口：前 80 字 */
const HEAD_WINDOW = 80
/** 整段重复检测窗口：任意 200 字完全相同即判定为重复段 */
const BLOCK_WINDOW = 200

/** 结尾可接受的收束符号（含中英文引号/括号的右半边） */
const END_MARKERS = new Set([
  '。', '！', '？', '…', '—', '～', '~',
  '.', '!', '?',
  '”', '"', '’', "'",
  '」', '』', '）', ')', '】', ']', '》', '〉',
])

/** 需要配对的符号：前 → 后 */
const BRACKET_PAIRS: Array<[string, string]> = [
  ['“', '”'],
  ['「', '」'],
  ['『', '』'],
  ['（', '）'],
  ['【', '】'],
  ['《', '》'],
  ['〈', '〉'],
]

/** 统计正文字数：忽略空白字符 */
export function countDraftWords(text: string): number {
  return (text || '').replace(/\s/g, '').length
}

/** 去掉所有空白，用于跨段落比对 */
function compact(text: string): string {
  return (text || '').replace(/\s/g, '')
}

/**
 * 查找任意 ≥window 长度的完全重复片段（非重叠）。
 * 返回重复片段在紧凑文本中的起点，找不到返回 -1。
 */
function findRepeatedBlock(text: string, window: number): number {
  if (text.length < window * 2) return -1
  const seen = new Map<number, number>()
  for (let i = 0; i + window <= text.length; i++) {
    let hash = 0x811c9dc5
    for (let j = 0; j < window; j++) {
      hash ^= text.charCodeAt(i + j)
      hash = Math.imul(hash, 0x01000193)
    }
    const first = seen.get(hash)
    if (first === undefined) {
      seen.set(hash, i)
      continue
    }
    // 哈希命中后做真实比对，避免碰撞误报；要求两段不重叠
    if (i - first >= window && text.slice(first, first + window) === text.slice(i, i + window)) {
      return i
    }
    // 同一哈希的多次出现只保留最早一次即可（重叠窗口无需单独记录）
  }
  return -1
}

/** 检查结尾是否被截断 */
function checkTruncation(raw: string): IntegrityIssue | null {
  const trimmed = (raw || '').trimEnd()
  if (!trimmed) return null

  // 1) 未闭合的成对符号（半句对白 / 半个括号）
  for (const [open, close] of BRACKET_PAIRS) {
    const opens = trimmed.split(open).length - 1
    const closes = trimmed.split(close).length - 1
    if (opens > closes) {
      return {
        code: 'TRUNCATED',
        detail: `未闭合的「${open}」（出现 ${opens} 次，闭合 ${closes} 次），疑似输出被截断`,
      }
    }
  }

  // 2) 末尾 30 字内没有任何收束符号
  const tail = trimmed.slice(-30)
  for (const ch of tail) {
    if (END_MARKERS.has(ch)) return null
  }
  return {
    code: 'TRUNCATED',
    detail: `末尾 30 字内无收束标点，末尾为「${tail}」`,
  }
}

/**
 * 正文完整性检查。
 * ok=false 表示该稿不应进入下一环节（重复/截断/越界）；
 */
export function checkDraftIntegrity(content: string, options: IntegrityOptions = {}): IntegrityReport {
  const text = content || ''
  const body = compact(text)
  const issues: IntegrityIssue[] = []

  // REPEATED_HEAD：前 80 字在正文后续再次出现
  if (body.length >= HEAD_WINDOW * 2) {
    const head = body.slice(0, HEAD_WINDOW)
    const again = body.indexOf(head, HEAD_WINDOW)
    if (again >= 0) {
      issues.push({
        code: 'REPEATED_HEAD',
        detail: `开头 ${HEAD_WINDOW} 字在第 ${again} 字处再次出现，疑似多份生成结果拼接`,
      })
    }
  }

  // REPEATED_BLOCK：任意 200 字完全重复
  const repeatedAt = findRepeatedBlock(body, BLOCK_WINDOW)
  if (repeatedAt >= 0 && !issues.some((i) => i.code === 'REPEATED_HEAD')) {
    issues.push({
      code: 'REPEATED_BLOCK',
      detail: `正文自第 ${repeatedAt} 字起出现 ${BLOCK_WINDOW} 字以上的完全重复片段`,
    })
  }

  // TRUNCATED
  const truncated = checkTruncation(text)
  if (truncated) issues.push(truncated)

  const wordCount = countDraftWords(text)
  if (options.minWords !== undefined && wordCount > 0 && wordCount < options.minWords) {
    issues.push({ code: 'TOO_SHORT', detail: `${wordCount} 字，低于下限 ${options.minWords} 字` })
  }
  if (options.hardMax !== undefined && wordCount > options.hardMax) {
    issues.push({ code: 'TOO_LONG', detail: `${wordCount} 字，超过硬上限 ${options.hardMax} 字` })
  }

  return { ok: issues.length === 0, issues, wordCount }
}
