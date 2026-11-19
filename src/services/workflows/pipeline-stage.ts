/**
 * 章节流水线推进（P3-1 / P3-6）
 *
 * 工作流与 MutationPlan 共用 PipelineRepository 的阶段守卫：
 * 守卫只允许「同阶段 / 前进一步」，因此这里按阶段顺序逐步推进，
 * 不直接跳级。无流水线记录的旧章节从 planned 起步补齐。
 *
 * 注意：本函数服务于「流程推进」，不能替代审稿闸门；
 * 质量判定仍由 review findings + consistency gate 负责。
 */
import { CHAPTER_STAGES, type ChapterStage } from '../../shared/chapter-stage'
import { ipc } from '../ipc-client'

/** 把章节推进到目标阶段；失败返回 null（调用方决定是否中断） */
export async function advanceChapterStage(
  chapterNumber: number,
  target: ChapterStage,
): Promise<ChapterStage | null> {
  const current = await ipc.invoke('db:pipeline-get', chapterNumber).catch(() => null)
  const currentStage: ChapterStage = current?.stage ?? 'planned'
  const from = Math.max(0, CHAPTER_STAGES.indexOf(currentStage))
  const to = CHAPTER_STAGES.indexOf(target)
  if (to < 0) return null
  if (to <= from) return currentStage

  for (let index = from + 1; index <= to; index++) {
    const result = await ipc.invoke('db:pipeline-set-stage', chapterNumber, CHAPTER_STAGES[index])
    if (!result.success) return null
  }
  return target
}
