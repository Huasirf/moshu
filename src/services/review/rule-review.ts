/**
 * 本地规则审稿（P3-2）
 *
 * 在调用 LLM 审稿之前先跑一遍零成本、可解释的规则检查，产出
 * `review_findings` 条目（与 LLM 审稿共用同一张台账）。
 *
 * 覆盖维度：
 *   - 禁用词（warning）
 *   - 视角越界：非 POV 角色的内心描写（error）
 *   - 道具未持有：角色使用未在其 keyItems 中的已知道具（error）
 *   - 地点冲突：同章内无转场动作的地点跳变（warning）
 *   - 时间倒流：非闪回段落中的显式回溯（error）
 *
 * 严重度按 DR-04 已定稿方案：仅「道具未持有 / 视角越界 / 时间倒流」记 error，其余记 warning / info。
 *
 * 设计约定：本文件是纯函数，不读 DB、不发 IPC；调用方（review-chapter.command）
 * 负责把角色状态、道具归属与蓝图读成入参。
 */
import type { ReviewFindingInput } from '../../../electron/repositories/review-finding-repository'
import { checkSensoryIssues } from './sensory-review'

/** 默认禁用词表：AI 腔高频词，可在项目配置中覆盖 */
export const DEFAULT_BANNED_WORDS = [
  '不禁',
  '不由得',
  '不由自主',
  '心中一凛',
  '倒吸一口凉气',
  '嘴角勾起',
  '嘴角泛起',
  '眼中闪过一丝',
  '空气仿佛凝固',
  '仿佛时间静止',
]

/** 各维度默认严重度（DR-04 默认方案） */
export const RULE_SEVERITY = {
  'banned-word': 'warning',
  pov: 'error',
  item: 'error',
  location: 'warning',
  timeline: 'error',
} as const

export type RuleReviewCategory = keyof typeof RULE_SEVERITY

export interface RuleReviewCharacter {
  name: string
  /** 本章是否为视角人物 */
  isPov?: boolean
  /** 角色当前已知所在地点（canon/角色卡） */
  location?: string
  /** 当前持有道具（顿号/逗号分隔） */
  keyItems?: string
}

export interface RuleReviewItem {
  name: string
  /** 当前持有人；null 表示无人持有 / 尚未被任何人取得 */
  owner: string | null
}

export interface RuleReviewInput {
  chapterNumber: number
  content: string
  /** 本章叙述视角人物；未指定时跳过视角校验 */
  povCharacter?: string
  characters?: RuleReviewCharacter[]
  /** 已知道具及其持有人（来自 canon keyItems / 资产库） */
  items?: RuleReviewItem[]
  /** 禁用词表；缺省使用 DEFAULT_BANNED_WORDS */
  bannedWords?: string[]
}

const USE_VERBS = '拿起|握住|拔出|取出|掏出|祭出|催动|挥动|挥起|使用|服下|吞下|灌下|掷出|丢出'
const ACQUIRE_VERBS = '获得|得到|捡到|捡起|接过|收下|夺过|拿到|取回|摸到'
const MOVE_VERBS = ['来到', '抵达', '到达', '前往', '回到', '返回', '走进', '走入']
const FLASHBACK_MARKERS = ['回忆', '记忆中', '想起', '闪回', '倒带', '当年', '多年前', '十年前']
const PRONOUNS = /^(他|她|它|我|你|他们|她们|众人|大家)/

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function splitParagraphs(content: string): string[] {
  return content.split(/\n+/).map((line) => line.trim()).filter(Boolean)
}

/** 取命中位置附近的句子片段，作为可读证据 */
function evidenceAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 30)
  const end = Math.min(text.length, index + length + 30)
  return text.slice(start, end).replace(/\s+/g, ' ').trim()
}

function isFlashbackContent(content: string): boolean {
  return FLASHBACK_MARKERS.filter((marker) => content.includes(marker)).length >= 2
}

function finding(
  input: RuleReviewInput,
  category: RuleReviewCategory,
  message: string,
  evidence: string,
  locationHint: string,
): ReviewFindingInput {
  return {
    chapterNumber: input.chapterNumber,
    stage: 'rule-review',
    category,
    severity: RULE_SEVERITY[category],
    message,
    evidence,
    locationHint,
  }
}

/** 禁用词：每个词最多报 3 次，避免刷屏 */
export function checkBannedWords(input: RuleReviewInput): ReviewFindingInput[] {
  const words = input.bannedWords ?? DEFAULT_BANNED_WORDS
  const findings: ReviewFindingInput[] = []
  for (const word of words) {
    if (!word || word.length < 2) continue
    let from = 0
    let hits = 0
    while (hits < 3) {
      const index = input.content.indexOf(word, from)
      if (index === -1) break
      findings.push(finding(
        input,
        'banned-word',
        `命中禁用词「${word}」，建议替换为具体动作或细节。`,
        evidenceAround(input.content, index, word.length),
        '',
      ))
      from = index + word.length
      hits++
    }
  }
  return findings
}

/** 视角越界：非 POV 角色的内心活动 */
export function checkPovViolation(input: RuleReviewInput): ReviewFindingInput[] {
  const pov = input.povCharacter
  if (!pov) return []
  const findings: ReviewFindingInput[] = []
  const paragraphs = splitParagraphs(input.content)
  for (const character of input.characters ?? []) {
    if (!character.name || character.name === pov || character.isPov) continue
    const pattern = new RegExp(
      `${escapeRegex(character.name)}(?:心中|心里|内心|心头|暗自|暗想|心想|心道|脑海里|默默地想)`,
      'g',
    )
    const seen = new Set<string>()
    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i]
      let match: RegExpExecArray | null
      pattern.lastIndex = 0
      while ((match = pattern.exec(paragraph)) !== null) {
        const evidence = evidenceAround(paragraph, match.index, match[0].length)
        if (seen.has(evidence)) continue
        seen.add(evidence)
        findings.push(finding(
          input,
          'pov',
          `视角越界：「${character.name}」不是本章 POV 角色（${pov}），不应直接描写其内心活动。`,
          evidence,
          `第 ${i + 1} 段`,
        ))
      }
    }
  }
  return findings
}

/** 道具未持有：角色使用已知道具，但当前持有人不是他，且本章未取得 */
export function checkItemPossession(input: RuleReviewInput): ReviewFindingInput[] {
  const findings: ReviewFindingInput[] = []
  const characters = (input.characters ?? []).filter((c) => !!c.name)
  const paragraphs = splitParagraphs(input.content)

  for (const item of input.items ?? []) {
    if (!item.name || item.name.length < 2) continue
    const escapedItem = escapeRegex(item.name)
    const acquired = new RegExp(`(?:${ACQUIRE_VERBS})[^。]{0,10}${escapedItem}`).test(input.content)
    if (acquired) continue

    for (const character of characters) {
      // 只在「同一小句」内判断：名字后紧跟动作才算该角色使用道具。
      // 跨逗号/分号会误伤——例如「绑着阿箬的红布条，……拔出断名刀」实际是墨砚在拔刀；
      // 名字前是「的/着/把/给/向…」说明它是宾语或状语的一部分，也不是施动者。
      const pattern = new RegExp(
        `(?<!的|着|了|把|给|向|朝|与|跟|对|是)${escapeRegex(character.name)}[^。，；！？]{0,10}(?:${USE_VERBS})[^。，；！？]{0,8}${escapedItem}`,
        'g',
      )
      let match: RegExpExecArray | null
      for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i]
        pattern.lastIndex = 0
        while ((match = pattern.exec(paragraph)) !== null) {
          const user = match[0].slice(0, character.name.length)
          if (PRONOUNS.test(user)) continue
          if (item.owner === character.name) continue
          findings.push(finding(
            input,
            'item',
            `道具未持有：「${character.name}」使用了「${item.name}」，但当前持有者为${
              item.owner ? `「${item.owner}」` : '无人'
            }，且本章未检测到取得该道具的动作。`,
            evidenceAround(paragraph, match.index, match[0].length),
            `第 ${i + 1} 段`,
          ))
        }
      }
    }
  }
  return findings
}

/** 地点冲突：同章内同一角色在两个段落换地点，且第二处没有转场动词 */
export function checkLocationConflict(input: RuleReviewInput): ReviewFindingInput[] {
  const findings: ReviewFindingInput[] = []
  const paragraphs = splitParagraphs(input.content)
  const locationPattern = /([\u4e00-\u9fa5]{2,8})(在|身处|站在|来到|抵达|到达|前往|回到|返回|走进|走入)([^，。；！？\s“”"']{2,8})/g

  for (const character of input.characters ?? []) {
    if (!character.name) continue
    const sequence: Array<{ paragraph: number; location: string; verb: string; evidence: string }> = []
    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i]
      let match: RegExpExecArray | null
      locationPattern.lastIndex = 0
      while ((match = locationPattern.exec(paragraph)) !== null) {
        if (match[1] !== character.name) continue
        sequence.push({
          paragraph: i,
          location: match[3],
          verb: match[2],
          evidence: evidenceAround(paragraph, match.index, match[0].length),
        })
      }
    }

    // 只比较相邻的有效地点变化；重复地点不重复报
    for (let i = 1; i < sequence.length; i++) {
      const prev = sequence[i - 1]
      const current = sequence[i]
      if (prev.location === current.location) continue
      if (MOVE_VERBS.includes(current.verb)) continue
      findings.push(finding(
        input,
        'location',
        `地点冲突：「${character.name}」从「${prev.location}」（第 ${prev.paragraph + 1} 段）直接出现在「${
          current.location
        }」（第 ${current.paragraph + 1} 段），中间缺少转场动作。`,
        current.evidence,
        `第 ${current.paragraph + 1} 段`,
      ))
    }
  }
  return findings
}

/** 时间倒流：非闪回内容中的显式回溯 */
export function checkTimeReversal(input: RuleReviewInput): ReviewFindingInput[] {
  if (isFlashbackContent(input.content)) return []
  const findings: ReviewFindingInput[] = []
  const paragraphs = splitParagraphs(input.content)
  const reversal = /(回到|倒退到|倒回到|退回到)(?:了)?(昨天|前天|前日|三日前|三天前|去年|十年前|二十年前)/g

  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i]
    let match: RegExpExecArray | null
    reversal.lastIndex = 0
    while ((match = reversal.exec(paragraph)) !== null) {
      const window = paragraph.slice(Math.max(0, match.index - 20), match.index + match[0].length + 20)
      // 「想起十年前」这类回忆是合法的回溯叙述
      if (FLASHBACK_MARKERS.some((marker) => window.includes(marker))) continue
      findings.push(finding(
        input,
        'timeline',
        `时间倒流：检测到「${match[0]}」，若非闪回请确认时间线是否自洽。`,
        evidenceAround(paragraph, match.index, match[0].length),
        `第 ${i + 1} 段`,
      ))
    }
  }
  return findings
}

/** 聚合入口：一次跑完所有本地规则 */
export function reviewChapterRules(input: RuleReviewInput): ReviewFindingInput[] {
  return [
    ...checkBannedWords(input),
    ...checkPovViolation(input),
    ...checkItemPossession(input),
    ...checkLocationConflict(input),
    ...checkTimeReversal(input),
    ...checkSensoryIssues(input.chapterNumber, input.content),
  ]
}
