/**
 * 大纲联动的影响范围（P2-6）
 *
 * DR-07 已定稿：按「章节号区间」N+1..N+5 计算受影响章节，再由用户逐章刷新，
 * 不按依赖图扩散，也不整卷重写。
 */

/** 默认向下游传播的章节窗口（仅统计已存在的蓝图） */
export const DEFAULT_STALE_WINDOW = 5

export interface StaleRangeInput {
  /** 被改动的章节号 */
  editedChapter: number
  /** 当前已存在的蓝图章节号 */
  existingChapters: number[]
  /** 下游传播窗口，默认 DEFAULT_STALE_WINDOW */
  window?: number
}

/**
 * 计算需要标记为 stale 的章节：editedChapter+1 .. min(editedChapter+window, 最大已存在章节)。
 * 只返回实际存在蓝图的章节，升序。
 */
export function computeStaleChapters(input: StaleRangeInput): number[] {
  const edited = Math.trunc(input.editedChapter)
  if (!Number.isSafeInteger(edited) || edited < 0) return []
  const existing = Array.from(new Set(
    input.existingChapters.filter((n) => Number.isSafeInteger(n) && n > edited),
  ))
  if (existing.length === 0) return []

  const window = Math.max(1, Math.trunc(input.window ?? DEFAULT_STALE_WINDOW))
  const maxExisting = Math.max(...existing)
  const upper = Math.min(edited + window, maxExisting)
  return existing.filter((n) => n > edited && n <= upper).sort((a, b) => a - b)
}

/** 参与 stale 判定的蓝图内容字段（notes / userGuidance 属于作者微操，不算结构改动） */
export interface BlueprintContentSnapshot {
  title?: string
  role?: string
  purpose?: string
  keyEvents?: string
  characters?: string[]
  suspenseHook?: string
}

/** 蓝图结构字段是否发生改动 */
export function hasBlueprintContentChange(
  before: BlueprintContentSnapshot | null | undefined,
  after: BlueprintContentSnapshot,
): boolean {
  if (!before) return true
  if (before.title !== after.title) return true
  if (before.role !== after.role) return true
  if (before.purpose !== after.purpose) return true
  if (before.keyEvents !== after.keyEvents) return true
  if (before.suspenseHook !== after.suspenseHook) return true
  return JSON.stringify(before.characters ?? []) !== JSON.stringify(after.characters ?? [])
}
