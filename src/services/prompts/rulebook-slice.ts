/**
 * 规则注入切片（替代原先的 9000 字硬截断）
 *
 * 三层结构：
 * - L1 硬规则摘要：所有 severity=hard 的条目，一行一条（全部链路都注入）
 * - L2 本章相关规则：按本章关键词与条目匹配，注入全文
 * - L3 未展开清单：剩余条目只给编号 + 标题，让模型知道边界
 *
 * 目的：规则再多也不会"静默丢失"——超出预算的条目会以编号形式显式告知模型。
 */
import type { RuleItem } from '../../shared/rule-timeline'

export interface RulebookInjectionStats {
  total: number
  hard: number
  injected: number
  omitted: number
  chars: number
  truncatedHard: boolean
}

export interface RulebookInjection {
  text: string
  stats: RulebookInjectionStats
  omittedCodes: string[]
}

const DEFAULT_BUDGET = {
  hard: 2500,
  relevant: 5000,
  omitted: 1200,
}

interface KeywordSource {
  title?: string
  keyEvents?: string
  characters?: string[]
  scenes?: Array<Record<string, unknown>>
  knowledgeQueryHint?: string
}

function collectKeywords(source: KeywordSource): string[] {
  const chunks: string[] = [
    source.title || '',
    source.keyEvents || '',
    ...(source.characters || []),
    source.knowledgeQueryHint || '',
  ]
  for (const scene of source.scenes || []) {
    for (const key of ['location', 'props', 'description', 'goal', 'conflict', 'name']) {
      const value = scene[key]
      if (typeof value === 'string') chunks.push(value)
      else if (Array.isArray(value)) chunks.push(value.filter((v): v is string => typeof v === 'string').join(' '))
    }
  }
  return [...new Set(
    chunks.join(' ')
      .split(/[\s，。、；;：:！!？?（）()【】\[\]「」《》,.\-/]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && s.length <= 12),
  )]
}

function countHits(item: RuleItem, keywords: string[]): number {
  const haystack = `${item.group} ${item.title} ${item.body} ${item.tags.join(' ')}`
  let hits = 0
  for (const kw of keywords) {
    if (haystack.includes(kw)) hits += 1
  }
  return hits
}

function trimTo(text: string, max: number): string {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n…（本层超出预算，已截断）`
}

export function buildRulebookInjection(
  items: RuleItem[],
  source: KeywordSource,
  budget = DEFAULT_BUDGET,
): RulebookInjection {
  const active = items.filter((i) => i.active)
  if (active.length === 0) {
    return {
      text: '',
      stats: { total: 0, hard: 0, injected: 0, omitted: 0, chars: 0, truncatedHard: false },
      omittedCodes: [],
    }
  }

  const hard = active.filter((i) => i.severity === 'hard').sort((a, b) => a.sort - b.sort)

  // L1：硬规则摘要（编号 + 标题 + 极短正文首句）
  const hardLines = hard.map((i) => `[${i.code}] ${i.title}`)
  let hardText = trimTo(hardLines.join('\n'), budget.hard)
  const truncatedHard = hardText.length < hardLines.join('\n').length

  // L2：相关规则全文（先按命中数排序，命中为 0 且空间不足时不展开）
  const keywords = collectKeywords(source)
  const scored = active
    .map((item) => ({ item, score: countHits(item, keywords) + (item.severity === 'hard' ? 2 : 0) }))
    .sort((a, b) => b.score - a.score || a.item.sort - b.item.sort)

  const relevantLines: string[] = []
  const included = new Set<string>()
  let relevantChars = 0
  for (const { item, score } of scored) {
    if (score <= 0) break
    const block = `[${item.code}] ${item.title}\n${item.body}`
    if (relevantChars + block.length > budget.relevant) break
    relevantLines.push(block)
    included.add(item.code)
    relevantChars += block.length
  }
  const relevantText = relevantLines.join('\n\n')

  // L3：未展开清单
  const omitted = active.filter((i) => !included.has(i.code))
  const omittedText = trimTo(omitted.map((i) => `[${i.code}] ${i.title}`).join('\n'), budget.omitted)

  const sections: string[] = []
  if (hardText) sections.push(`【规则总纲 · 硬规则（不可违背）】\n${hardText}`)
  if (relevantText) sections.push(`【本章相关规则（全文）】\n${relevantText}`)
  if (omittedText) {
    sections.push(`【未展开规则（仅编号与标题；如涉及判定，先按编号回查规则区）】\n${omittedText}`)
  }

  const text = sections.join('\n\n')
  return {
    text,
    stats: {
      total: active.length,
      hard: hard.length,
      injected: included.size + hard.length,
      omitted: omitted.length,
      chars: text.length,
      truncatedHard,
    },
    omittedCodes: omitted.map((i) => i.code),
  }
}

/** 无结构化条目时的兼容注入：整份规则文本但不再静默截断，超出部分明确提示 */
export function fallbackRulebookText(rulebook: string, maxChars = 8000): string {
  const text = (rulebook || '').trim()
  if (!text) return ''
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n\n（规则全文共 ${text.length} 字，已超出单次注入预算，末尾 ${text.length - maxChars} 字未展开；建议在「规则区」整理为结构化条目）`
}
