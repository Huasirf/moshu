import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import {
  isScenePlanUsable,
  normalizeScenes,
  parseScenePlan,
  type ScenePlanStats,
} from '../../blueprint-scenes'
import {
  buildOpenForeshadowingText,
  readChapterNotesTimeline,
  readCharacterStatesText,
} from '../workflow-utils'
import { isWorkflowCancelled } from '../workflow-errors'
import type { ChapterInfo } from '../chapter-workflow'
import type { BlueprintData } from '../../../../electron/repositories/blueprint-repository'
import sceneSkillPrompt from '../../prompts/skills/blueprint-scenes.md?raw'

/**
 * 章纲场景拆解 —— 把一章的蓝图拆成「按场推进 + 每场字数预算」的可执行场景表
 *
 * 为什么单独一步而不是塞进章节蓝图生成：
 * - 蓝图生成一次性产出几十章，单章 prompt 很长、输出预算有限，塞 scene 字段会拖垮整批；
 * - 场景拆解需要「已写剧情 / 角色现状 / 未回收伏笔」这些写前才有的信息，放在写稿前更准确；
 * - 拆解失败可以无痛降级为旧路径（仅 keyEvents），不污染蓝图主流程。
 *
 * 结果写回 blueprints.scenes_json；写稿命令读取 scenes 后按预算分配篇幅。
 */
export class PlanScenesCommand extends BaseWorkflowCommand<ScenePlanStats | null> {
  /** 拆解结果（供批量管线取用） */
  public result: ScenePlanStats | null = null

  constructor(
    private chapterNumber: number,
    /** 传入刷新后的章节信息（与写稿保持同一份） */
    private chapterInfo: ChapterInfo,
    private modelId?: string,
  ) {
    super()
  }

  async execute({ context, callbacks }: CommandExecuteParams): Promise<ScenePlanStats | null> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error('未打开项目')

    const n = this.chapterNumber
    const bp: BlueprintData | null = await ipc.invoke('db:blueprint-get', n)
    if (!bp) {
      callbacks.log(`⚠️ 第${n}章蓝图缺失，跳过场景拆解`)
      return null
    }

    const wordsTarget =
      Number(bp.wordsTarget) || Number(project.novelConfig.wordsPerChapter) || 2000

    callbacks.log(`🗂 第${n}章场景拆解（目标 ${wordsTarget} 字）...`)

    const [timeline, characterStates, foreshadowing] = await Promise.all([
      readChapterNotesTimeline(n),
      readCharacterStatesText(),
      buildOpenForeshadowingText(n),
    ])

    const prompt = [
      sceneSkillPrompt,
      '',
      '---',
      '',
      '## 本章蓝图',
      '```json',
      JSON.stringify(
        {
          chapterNumber: n,
          title: this.chapterInfo.title,
          role: this.chapterInfo.role,
          purpose: this.chapterInfo.purpose,
          keyEvents: this.chapterInfo.keyEvents,
          suspenseHook: this.chapterInfo.suspenseHook || '',
          characters: this.chapterInfo.characters,
          wordsTarget,
        },
        null,
        2,
      ),
      '```',
      '',
      '## 已写剧情要点（仅供保持因果连贯，不要复述）',
      timeline || '（本章为开篇，无前文）',
      '',
      '## 角色当前状态（不要写角色不知道的信息）',
      characterStates || '（无）',
      '',
      '## 未回收伏笔（本章若要回收，安排进对应场景的 goal）',
      foreshadowing || '（无）',
      '',
      `请输出 JSON：{"scenes":[...]}，共 3–5 场，sum(scenes.words) 必须落在 ${wordsTarget} 字的 -10%~+15% 内（即 ${Math.round(wordsTarget * 0.9)}–${Math.round(wordsTarget * 1.15)} 字）。`,
    ].join('\n')

    let stats: ScenePlanStats
    try {
      const raw = await this.callLLM(
        prompt,
        '你是长篇网文的执行编辑，擅长把章节大纲拆成可执行的场景清单。只输出 JSON，不要解释。',
        callbacks,
        { responseFormat: { type: 'json_object' } },
        context,
        this.modelId,
      )
      stats = normalizeScenes(parseScenePlan(raw), wordsTarget)
    } catch (e) {
      if (isWorkflowCancelled(e) || context.cancelled) throw e
      const msg = e instanceof Error ? e.message : String(e)
      // 拆解失败一律降级：写稿退回「仅 keyEvents」的老路径
      callbacks.log(`⚠️ 场景拆解失败，本章沿用 keyEvents 写稿：${msg}`)
      this.result = null
      return null
    }

    if (!isScenePlanUsable(stats)) {
      callbacks.log(`⚠️ 场景拆解结果不可用（${stats.warnings.join('；')}），本章沿用 keyEvents 写稿`)
      this.result = null
      return null
    }
    for (const warning of stats.warnings) callbacks.log(`  · ${warning}`)
    callbacks.log(
      `  ✅ 已拆解 ${stats.scenes.length} 场，预算合计 ${stats.budget} 字` +
        `${stats.adjusted ? '（已按目标字数缩放）' : ''}`,
    )

    // 写回蓝图：保留原有全部字段，只替换 scenes
    try {
      await ipc.invoke('db:blueprint-upsert', {
        ...bp,
        scenes: stats.scenes,
      })
      this.notifyRefresh(['blueprints'])
      callbacks.log(`  💾 已写入第${n}章场景表`)
    } catch (e) {
      callbacks.log(`  ⚠️ 场景表写回失败（本次写稿仍使用拆解结果）：${String(e)}`)
    }

    this.result = stats
    return stats
  }
}
