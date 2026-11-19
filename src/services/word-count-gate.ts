/**
 * 字数分档门禁（纯函数，可单测）
 *
 * 基准目标 2,300 字（2000 → 2000 / 2600 / 3400 / 3900 / 4000）：
 * 正文不得低于绝对下限 2,000 字；2,000–2,600 为正常区间；
 * 2,601–3,400 记「偏长」放行；3,401–3,900 需本章有 climax 标记或场景预算支持；
 * 3,901–4,000 需重写（人工确认可放行）；任何章节 >4,000 字直接判失败。
 *
 * 分档阈值默认按目标字数等比派生，同时叠加绝对下限 2,000 与绝对硬上限 4,000，
 * 因此调整「每章字数」时不会出现档位与目标脱节，也不会突破上下限。
 */

import { isArcEnd } from './narrative-consistency/arc-summary'

export type WordTier = 'TOO_SHORT' | 'PASS' | 'WARN' | 'LONG' | 'LONG_HARD' | 'REJECT'

/** 重要章节（卷末/高潮/收尾）的目标字数上调比例 */
export const IMPORTANT_CHAPTER_TARGET_FACTOR = 1.35

/** 判定为重要章节的蓝图角色：高潮、决战、收尾、终章 */
export const IMPORTANT_CHAPTER_ROLE_RE = /climax|高潮|决战|收尾|终章/i

/** 是否为重要章节：卷末章或高潮/收尾类角色 */
export function isImportantChapter(chapterNumber?: number, role?: string): boolean {
  if (role && IMPORTANT_CHAPTER_ROLE_RE.test(role)) return true
  return typeof chapterNumber === 'number' && isArcEnd(chapterNumber)
}

/**
 * 本章实际目标字数：重要章节在全局目标上上浮，单章显式覆盖值始终优先。
 * 生成与门禁都调用这里，保证「提示词要求」与「判定档位」一致。
 */
export function resolveChapterWordTarget(
  baseTarget: number,
  chapterNumber?: number,
  role?: string,
): number {
  const base = Number.isFinite(baseTarget) ? Math.max(0, Math.round(baseTarget)) : 0
  if (base <= 0) return 0
  return isImportantChapter(chapterNumber, role)
    ? Math.round(base * IMPORTANT_CHAPTER_TARGET_FACTOR)
    : base
}

export type WordGateAction = 'pass' | 'pass-warn' | 'regenerate' | 'fail'

export interface WordTiers {
  target: number
  /** 下限：低于此值判过短 */
  shortFloor: number
  /** 正常上限：到此为止直接通过 */
  normalMax: number
  /** 偏长上限：到此为止只记警告 */
  warnMax: number
  /** 软上限：到此为止需 climax/场景预算背书 */
  softMax: number
  /** 硬上限：超过直接判失败 */
  hardMax: number
}

export interface WordGateInput {
  wordCount: number
  tiers: WordTiers
  /** 本章 beatTags 是否含 climax（或等价高潮标记） */
  hasClimax?: boolean
  /** 本章场景字数预算合计 */
  sceneBudget?: number
}

export interface WordGateResult {
  tier: WordTier
  action: WordGateAction
  wordCount: number
  tiers: WordTiers
  reason: string
}

const RATIO = {
  shortFloor: 0.87,
  normalMax: 1.13,
  warnMax: 1.48,
  softMax: 1.7,
  hardMax: 1.74,
} as const

/** 绝对下限：无论目标字数多少，正文都不得低于 2,000 字 */
export const ABSOLUTE_SHORT_FLOOR = 2000

/** 绝对硬上限：任何章节超过 4,000 字直接判失败（重要章节上浮也不例外） */
export const ABSOLUTE_HARD_MAX = 4000

/** 按目标字数派生分档阈值；target 非正数时返回全 0（调用方据此跳过门禁） */
export function resolveWordTiers(target: number, override: Partial<Omit<WordTiers, 'target'>> = {}): WordTiers {
  const t = Number.isFinite(target) ? Math.max(0, Math.round(target)) : 0
  if (t <= 0) {
    return { target: 0, shortFloor: 0, normalMax: 0, warnMax: 0, softMax: 0, hardMax: 0 }
  }
  // 目标本身不低于绝对下限时才叠加，避免短章任务被 2,000 字的绝对下限卡死
  const derivedFloor = Math.round(t * RATIO.shortFloor)
  return {
    target: t,
    shortFloor: override.shortFloor ?? (t >= ABSOLUTE_SHORT_FLOOR ? Math.max(derivedFloor, ABSOLUTE_SHORT_FLOOR) : derivedFloor),
    normalMax: override.normalMax ?? Math.round(t * RATIO.normalMax),
    warnMax: override.warnMax ?? Math.round(t * RATIO.warnMax),
    softMax: override.softMax ?? Math.round(t * RATIO.softMax),
    hardMax: override.hardMax ?? Math.round(t * RATIO.hardMax),
  }
}

/** 判定一章字数落在哪一档、该采取什么动作 */
export function judgeWordCount(input: WordGateInput): WordGateResult {
  const { tiers, wordCount } = input
  const base = { wordCount, tiers }
  if (wordCount > ABSOLUTE_HARD_MAX) {
    return {
      ...base,
      tier: 'REJECT',
      action: 'fail',
      reason: `${wordCount} 字 > 绝对硬上限 ${ABSOLUTE_HARD_MAX} 字`,
    }
  }
  if (!tiers.target || tiers.target <= 0) {
    return { ...base, tier: 'PASS', action: 'pass', reason: '未设置目标字数，跳过字数门禁' }
  }

  if (wordCount < tiers.shortFloor) {
    return {
      ...base,
      tier: 'TOO_SHORT',
      action: 'regenerate',
      reason: `${wordCount} 字 < 下限 ${tiers.shortFloor} 字`,
    }
  }
  if (wordCount <= tiers.normalMax) {
    return { ...base, tier: 'PASS', action: 'pass', reason: `${wordCount} 字，正常区间` }
  }
  if (wordCount <= tiers.warnMax) {
    return {
      ...base,
      tier: 'WARN',
      action: 'pass-warn',
      reason: `${wordCount} 字，偏长（正常上限 ${tiers.normalMax}）`,
    }
  }
  if (wordCount <= tiers.softMax) {
    // 场景预算达到正常上限即可背书长章：拆了长场景的章允许写到 softMax
    const budgetOk = (input.sceneBudget ?? 0) >= tiers.normalMax
    if (input.hasClimax || budgetOk) {
      return {
        ...base,
        tier: 'LONG',
        action: 'pass-warn',
        reason: `${wordCount} 字，长章（${input.hasClimax ? '本章为高潮章' : `场景预算 ${input.sceneBudget} 字`}）`,
      }
    }
    return {
      ...base,
      tier: 'LONG',
      action: 'regenerate',
      reason: `${wordCount} 字，超出正常篇幅且无高潮标记/场景预算支持`,
    }
  }
  if (wordCount <= tiers.hardMax) {
    return {
      ...base,
      tier: 'LONG_HARD',
      action: 'regenerate',
      reason: `${wordCount} 字，接近硬上限 ${tiers.hardMax}，需重写或人工确认`,
    }
  }
  return {
    ...base,
    tier: 'REJECT',
    action: 'fail',
    reason: `${wordCount} 字 > 硬上限 ${tiers.hardMax}，判定为超长失败`,
  }
}

/** 日志用的紧凑描述 */
export function describeWordGate(r: WordGateResult): string {
  return `本章 ${r.wordCount} 字 → ${r.tier}（${r.reason}）`
}

/**
 * 由目标字数估算一次生成的 max_tokens 物理上限。
 *
 * 模型对 prompt 里的「写 N 字」常常执行不到位（实测目标 2000 会写出 5000+），
 * 单靠提示词无法保证篇幅，必须在协议层给输出设上限。
 * 中文按约 1 字 ≈ 1 token 保守估计，再留 20% 余量与 80 token 的收尾空间；
 * 下限 256，避免极短任务被卡死。
 */
export function estimateMaxTokens(words: number): number {
  if (!Number.isFinite(words) || words <= 0) return 0
  return Math.max(256, Math.round(words * 1.2) + 80)
}
