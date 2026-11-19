/**
 * 世界设定切片 — 按当前章节只取相关规则与关卡卡
 *
 * 全书 worldSetting 会随章节增长到几万字（关卡卡、人物势力、月供、副本规则）。
 * 每章把整份设定塞进 prompt 既超预算，也会稀释当前任务。这里按固定小节
 * 提取「世界总览 + 颜色表 + 等级/1/4 + 闯入匹配 + 当前关卡卡 + 副本结算」，
 * 其余内容只留一行索引；后续章节再按蓝图里的关卡名自动命中对应卡片。
 */

export interface WorldSettingChapterInfo {
  title?: string
  purpose?: string
  keyEvents?: string
  suspenseHook?: string
  scenes?: Array<{
    title?: string
    goal?: string
    conflict?: string
    turn?: string
    props?: string[]
  }>
}

export interface WorldSettingSliceOptions {
  /** 切片总字数上限，默认 12000 */
  maxChars?: number
  /** 最多带几张关卡卡，默认 2 */
  maxCards?: number
}

interface TrialCard {
  number: number
  name: string
  body: string
}

const SECTION_OVERVIEW = '## 一、世界总览'
const SECTION_COLOR_TABLE = '### 5. 试炼颜色与类型总表'
const SECTION_LEVELS = '## 二、等级与属性体系'
const SECTION_ENTRY = '## 三、闯入规则'
const SECTION_MONTHLY = '## 四、月供'
const SECTION_GENERATION = '## 三、试炼副本生成规则'

/** 取 [start, end) 之间的文本；找不到 start 返回空 */
function sliceBetween(text: string, start: string, ends: string[]): string {
  const from = text.indexOf(start)
  if (from < 0) return ''
  const bodyStart = from + start.length
  let bodyEnd = text.length
  for (const end of ends) {
    const i = text.indexOf(end, bodyStart)
    if (i >= 0 && i < bodyEnd) bodyEnd = i
  }
  return text.slice(bodyStart, bodyEnd).trim()
}

/** 按段落边界截断，避免切在句子中间 */
function clip(text: string, max: number): string {
  const src = (text || '').trim()
  if (!src || src.length <= max) return src
  const cut = src.slice(0, max)
  const lastBreak = Math.max(cut.lastIndexOf('\n\n'), cut.lastIndexOf('\n'))
  const head = lastBreak > max * 0.55 ? cut.slice(0, lastBreak) : cut
  return `${head.trimEnd()}\n（本节已截断，只保留与本章相关的部分）`
}

/** 解析全部关卡卡：### 关卡N：名称（...）\n正文 */
function parseCards(text: string): TrialCard[] {
  const cards: TrialCard[] = []
  const re = /### 关卡(\d+)：([^\n（]+)[^\n]*\n([\s\S]*?)(?=### 关卡\d+：|## 三、试炼副本生成规则|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const number = Number(m[1])
    const name = m[2].trim()
    const body = (m[3] || '').trim()
    if (name && body) cards.push({ number, name, body })
  }
  return cards
}

/** 当前章节文本（标题/目标/事件/场景） */
function chapterQuery(info: WorldSettingChapterInfo): string {
  const scenes = info.scenes || []
  return [
    info.title || '',
    info.purpose || '',
    info.keyEvents || '',
    info.suspenseHook || '',
    ...scenes.flatMap((s) => [s.title || '', s.goal || '', s.conflict || '', s.turn || '', ...(s.props || [])]),
  ].join('\n')
}

/** 关卡索引：每张卡一行，保留关卡名、颜色档次、类型 */
function cardIndex(cards: TrialCard[]): string {
  return cards
    .map((c) => {
      const color = (c.body.match(/颜色档次\*\*：([^\n]+)/) || c.body.match(/颜色档次：([^\n]+)/) || [])[1] || ''
      const type = (c.body.match(/类型\*\*：([^\n]+)/) || c.body.match(/类型：([^\n]+)/) || [])[1] || ''
      return `- 关卡${c.number}：${c.name}${color ? `｜${color.trim()}` : ''}${type ? `｜${type.trim()}` : ''}`
    })
    .join('\n')
}

export function buildWorldSettingSlice(
  worldSetting: string,
  chapterInfo: WorldSettingChapterInfo,
  options: WorldSettingSliceOptions = {},
): string {
  const src = (worldSetting || '').trim()
  if (!src) return ''
  const maxCards = Math.max(0, options.maxCards ?? 2)
  const maxChars = Math.max(3000, options.maxChars ?? 12000)

  const overview = sliceBetween(src, SECTION_OVERVIEW, [SECTION_COLOR_TABLE, SECTION_LEVELS])
  const colorTable = sliceBetween(src, SECTION_COLOR_TABLE, [SECTION_LEVELS, SECTION_ENTRY, SECTION_MONTHLY])
  const levels = sliceBetween(src, SECTION_LEVELS, [SECTION_ENTRY, SECTION_MONTHLY])
  const entry = sliceBetween(src, SECTION_ENTRY, [SECTION_MONTHLY, '【人物与势力】', '【关卡体系】'])
  const generation = sliceBetween(src, SECTION_GENERATION, ['### 关卡11：', '### 关卡12：'])

  const cards = parseCards(src)
  const query = chapterQuery(chapterInfo)
  const selected = cards
    .map((card) => ({ card, score: query.includes(card.name) ? card.name.length + 10 : 0 }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxCards)
    .map((x) => x.card)

  // 本章没有明确点名的关卡卡时，不带整张卡，只给索引；场景细节由本章蓝图负责
  const blocks: string[] = []
  blocks.push('【本章相关世界设定切片（非全书全文；未列出的内容按需遵守正史与规则区）】')
  if (overview) blocks.push(`## 世界总览（节选）\n${clip(overview, 1500)}`)
  if (colorTable) blocks.push(`## 试炼颜色与类型总表\n${clip(colorTable, 1400)}`)
  if (levels) blocks.push(`## 等级、1/4铁律与心识派生\n${clip(levels, 2200)}`)
  if (entry) blocks.push(`## 闯入、匹配与颜色规则\n${clip(entry, 1000)}`)

  if (selected.length > 0) {
    for (const card of selected) {
      blocks.push(`### 关卡${card.number}：${card.name}\n${clip(card.body, 1600)}`)
    }
  } else if (cards.length > 0) {
    blocks.push('## 本章未命中具体关卡卡\n本章场景细节以蓝图为准；以下只列关卡索引，避免误用其他关卡的机制。')
  }

  if (generation) blocks.push(`## 副本生成与结算规则\n${clip(generation, 1700)}`)
  if (cards.length > 0) blocks.push(`## 关卡索引（只用于确认世界观，不展开）\n${clip(cardIndex(cards), 800)}`)

  const out = blocks.filter(Boolean).join('\n\n')
  if (out.length <= maxChars) return out
  return `${out.slice(0, maxChars).trimEnd()}\n\n（世界设定切片已按预算截断；未列出的关卡卡以蓝图与规则区为准）`
}
