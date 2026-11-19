/**
 * 章节流水线阶段（chapter_pipeline.stage 使用 CHAPTER_STAGES；
 * blueprints.status 在此基础上多一个 'stale'，见下方 BLUEPRINT_STAGES）
 *
 * 顺序即流转顺序：规划 → 起草 → 去味 → 审稿 → 通过 → 定稿 → 写回完成。
 */
export const CHAPTER_STAGES = [
  'planned', 'drafted', 'deaiified', 'reviewed', 'approved', 'finalized', 'writeback_done',
] as const

export type ChapterStage = (typeof CHAPTER_STAGES)[number]

/** 阶段流转违规类型 */
export type StageTransitionError = 'STAGE_SKIP' | 'STAGE_REWIND'

/**
 * 章节阶段推进守卫：只允许「保持原阶段」或「前进一步」。
 *
 * - 无既有记录时视作 `planned`，因此首章允许直接写入 `drafted`，
 *   但未经历 `deaiified` 的章节不能一步跳到 `reviewed`。
 * - 回退（如定稿后重写）需显式调用 `db:pipeline-rewind`，只允许退一步（DR-03 已定稿）。
 */
export function checkStageTransition(
  current: ChapterStage | null | undefined,
  next: ChapterStage,
): StageTransitionError | null {
  const from = CHAPTER_STAGES.indexOf(current ?? 'planned')
  const to = CHAPTER_STAGES.indexOf(next)
  if (from < 0 || to < 0) return 'STAGE_SKIP'
  if (to === from || to === from + 1) return null
  return to < from ? 'STAGE_REWIND' : 'STAGE_SKIP'
}

/**
 * 蓝图状态：除章节阶段外多一个 'stale'（上游大纲改动后待重算）。
 *
 * 'stale' 只属于 blueprints.status，不进入 chapter_pipeline 状态机，
 * 避免把「待刷新」误当成一个可推进的写作阶段。
 * DR-07 已定稿：stale 按章节号 N+1..N+5 区间传播，不做依赖图计算。
 */
export const BLUEPRINT_STAGES = [...CHAPTER_STAGES, 'stale'] as const

export type BlueprintStage = (typeof BLUEPRINT_STAGES)[number]
