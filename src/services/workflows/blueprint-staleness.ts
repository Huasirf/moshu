/**
 * 大纲联动：把上游改动传播为下游蓝图的 'stale' 标记（P2-6）
 *
 * 只改 blueprints.status，不改内容；具体章节的刷新仍走
 * RefreshBlueprintCommand（见 chapter-workflow 的「刷新第 N 章蓝图」步骤），
 * 因此下游章节不会在保存时被静默重写。
 *
 * DR-07 已定稿：按章节号区间传播；如后续改为依赖图方案，只需替换 computeStaleChapters。
 */
import { ipc } from '../ipc-client'
import { computeStaleChapters } from '../../shared/blueprint-staleness'
import type { BlueprintData } from '../../../electron/repositories/blueprint-repository'

/**
 * 标记 editedChapter 之后一段区间内的既有蓝图为 stale。
 * 返回被标记的章节号（升序）；无需标记时返回空数组。
 */
export async function markDownstreamBlueprintsStale(
  editedChapter: number,
  options: { window?: number } = {},
): Promise<number[]> {
  const blueprints: BlueprintData[] = await ipc.invoke('db:blueprint-get-all')
  const chapters = computeStaleChapters({
    editedChapter,
    existingChapters: blueprints.map((bp) => bp.chapterNumber),
    window: options.window,
  })
  if (chapters.length === 0) return []

  const result = await ipc.invoke('db:blueprint-mark-stale', chapters)
  if (!result.success) throw new Error(result.error || 'BLUEPRINT_STALE_FAILED')
  return chapters
}
