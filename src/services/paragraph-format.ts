/**
 * 段落节奏归一化（确定性后处理，不调用 LLM）
 *
 * 生成模型偶尔会连续输出超长自然段，阅读观感很差。这里在定稿写盘前，
 * 把超过阈值的段落按句末标点拆成若干段；单句本身超长时再退到逗号/分号处拆。
 * 只改换行，不改写任何字词，因此不会影响审稿结论与正文内容。
 */

export interface ParagraphFormatOptions {
  /** 超过该字数视为长段（按非空白字符计） */
  maxChars?: number
  /** 拆分后每段尽量不超过该字数 */
  targetChars?: number
  /**
   * 绝对上限：超过该字数的段落无论前后是否长段都拆分。
   * 用于拦住 300 字以上的“文字墙”，同时保留合理的长段。
   */
  absoluteMaxChars?: number
}

export interface ParagraphFormatStats {
  /** 拆分前超过阈值的段落数 */
  longParagraphs: number
  /** 实际被拆分的段落数 */
  splitParagraphs: number
  /** 拆分前最长段落字数 */
  maxBefore: number
  /** 拆分后最长段落字数 */
  maxAfter: number
}

export interface ParagraphFormatResult {
  content: string
  stats: ParagraphFormatStats
}

// 手机竖屏约 17–18 字/行：4 行 ≈ 70 字。段落节奏按此校准。
export const DEFAULT_MAX_PARAGRAPH_CHARS = 90
export const DEFAULT_TARGET_PARAGRAPH_CHARS = 70
export const DEFAULT_ABSOLUTE_MAX_PARAGRAPH_CHARS = 120

/** 句末标点（省略号按句末处理） */
const SENTENCE_ENDS = '。！？!?…'
/** 句末标点后紧跟的收尾符号 */
const CLOSERS = '」』”’"\'）】》'
/** 超长单句的次级切分点 */
const CLAUSE_DELIMS = '，,；;：:'

/** 可见字数：去掉空白字符后的字符数 */
function visibleLength(text: string): number {
  return Array.from(text).filter((ch) => !/\s/.test(ch)).length
}

/**
 * 引号/括号是否配对。
 * 不配对的段落一律不拆，避免把一句对白从引号中间切开。
 */
function isBalanced(text: string): boolean {
  const pairs: Array<[string, string]> = [
    ['“', '”'], ['「', '」'], ['『', '』'], ['（', '）'], ['(', ')'], ['《', '》'], ['【', '】'],
  ]
  for (const [open, close] of pairs) {
    const openCount = (text.split(open).length - 1)
    const closeCount = (text.split(close).length - 1)
    if (openCount !== closeCount) return false
  }
  // 英文双引号按偶数判断，避免把 "..." 从中拆开
  if ((text.split('"').length - 1) % 2 !== 0) return false
  return true
}

/** 按句末标点切句，句末符号与其后的右引号/右括号归入同一句 */
function splitSentences(text: string): string[] {
  const sentences: string[] = []
  let buffer = ''
  for (let i = 0; i < text.length; i++) {
    buffer += text[i]
    if (SENTENCE_ENDS.includes(text[i])) {
      while (i + 1 < text.length && SENTENCE_ENDS.includes(text[i + 1])) buffer += text[++i]
      while (i + 1 < text.length && CLOSERS.includes(text[i + 1])) buffer += text[++i]
      sentences.push(buffer)
      buffer = ''
    }
  }
  if (buffer) sentences.push(buffer)
  return sentences
}

/** 按逗号/分号/冒号切分句，用于没有句末标点的超长单句 */
function splitClauses(text: string): string[] {
  const clauses: string[] = []
  let buffer = ''
  for (let i = 0; i < text.length; i++) {
    buffer += text[i]
    if (CLAUSE_DELIMS.includes(text[i])) {
      while (i + 1 < text.length && CLOSERS.includes(text[i + 1])) buffer += text[++i]
      clauses.push(buffer)
      buffer = ''
    }
  }
  if (buffer) clauses.push(buffer)
  return clauses
}

/**
 * 把短句打包成目标长度以内的段落。
 * 只在「当前段落的引号/括号已闭合」处断开：否则会把一句长对白的引号拆到两段里，
 * 读者会看到只有左引号却没有右引号的段落。
 */
function packParts(parts: string[], targetChars: number): string[] {
  const result: string[] = []
  let current = ''
  for (const part of parts) {
    if (!part) continue
    if (current && visibleLength(current + part) > targetChars) {
      if (isBalanced(current)) {
        result.push(current)
        current = part
      } else {
        // 引号还没闭合，继续并入下一句，宁可这一段略长
        current += part
      }
    } else {
      current += part
    }
  }
  if (current) result.push(current)
  return result
}

/** 拆一个超长段落；拆不动时原样返回 */
function splitParagraph(paragraph: string, targetChars: number): string[] {
  if (!isBalanced(paragraph)) return [paragraph]
  const packed = packParts(splitSentences(paragraph), targetChars)
  // 仍有超长段：说明单句太长，退到逗号/分号切分
  return packed.flatMap((chunk) => {
    if (visibleLength(chunk) <= targetChars) return [chunk]
    const clauses = packParts(splitClauses(chunk), targetChars)
    // 切分后若出现引号不配对的碎片，说明切在了对白中间，保持原段
    if (clauses.length > 1 && clauses.every(isBalanced)) return clauses
    return [chunk]
  })
}

/**
 * 归一化段落节奏。
 *
 * 逐行处理：空行原样保留；单独一个长段允许保留（重要场面需要），
 * 但连续两个长段会把后一个拆开，超过绝对上限的长段也直接拆。保留原有缩进。
 */
export function normalizeParagraphs(
  content: string,
  options: ParagraphFormatOptions = {},
): ParagraphFormatResult {
  const maxChars = options.maxChars ?? DEFAULT_MAX_PARAGRAPH_CHARS
  const targetChars = options.targetChars ?? DEFAULT_TARGET_PARAGRAPH_CHARS
  const absoluteMax = Math.max(maxChars, options.absoluteMaxChars ?? DEFAULT_ABSOLUTE_MAX_PARAGRAPH_CHARS)

  const stats: ParagraphFormatStats = {
    longParagraphs: 0,
    splitParagraphs: 0,
    maxBefore: 0,
    maxAfter: 0,
  }

  // 沿用原有排版风格：段落间用空行分隔的稿子，拆出来的段落之间也留空行
  const usesBlankLines = /\n[ \t]*\r?\n/.test(content)
  const separator = usesBlankLines ? '\n\n' : '\n'

  const lines = content.split('\n')
  const output: string[] = []
  // 上一个非空段落是否为长段：空行不打断“连续”的判定
  let previousLong = false

  for (const line of lines) {
    if (!line.trim()) {
      output.push(line)
      continue
    }

    const indentMatch = line.match(/^(\s*)(.*)$/)
    const indent = indentMatch?.[1] ?? ''
    const body = indentMatch?.[2] ?? ''
    const length = visibleLength(body)
    stats.maxBefore = Math.max(stats.maxBefore, length)

    if (length > maxChars) {
      stats.longParagraphs++
      // 单独一个长段可以保留；连续长段或超过绝对上限才拆
      if (previousLong || length > absoluteMax) {
        const chunks = splitParagraph(body, targetChars)
        if (chunks.length > 1) {
          stats.splitParagraphs++
          output.push(chunks.map((chunk) => indent + chunk).join(separator))
        } else {
          output.push(line)
        }
      } else {
        output.push(line)
      }
      previousLong = true
    } else {
      output.push(line)
      previousLong = false
    }
  }

  const merged = output.join('\n')
  for (const line of merged.split('\n')) {
    if (!line.trim()) continue
    stats.maxAfter = Math.max(stats.maxAfter, visibleLength(line))
  }

  return {
    content: merged,
    stats,
  }
}
