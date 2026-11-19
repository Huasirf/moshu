/**
 * read_pipeline — 读取章节流水线状态
 */
import i18n from '../../../i18n'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import type { ChapterPipelineState } from '../../../../electron/repositories/pipeline-repository'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

export const readPipelineTool = buildAgentTool({
  name: 'read_pipeline',
  description: t('agent.tools.readPipeline.desc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      chapter_number: {
        type: 'string',
        description: t('agent.tools.readPipeline.chapterNumberDesc'),
      },
    },
  },
  requiresConfirmation: false,
  isReadOnly: true,
  execute: async (args) => {
    const project = useProjectStore.getState().currentProject
    if (!project) return { success: false, content: '', error: t('agent.tools.noProject') }

    const rawChapter = args.chapter_number
    try {
      if (rawChapter !== undefined && rawChapter !== '') {
        const chapterNumber = Number(rawChapter)
        if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) {
          return { success: false, content: '', error: t('agent.tools.readPipeline.invalidChapter') }
        }
        const state: ChapterPipelineState | null = await ipc.invoke('db:pipeline-get', chapterNumber)
        if (!state) return { success: true, content: t('agent.tools.readPipeline.empty', { chapter: chapterNumber }) }
        return {
          success: true,
          content: t('agent.tools.readPipeline.title', { chapter: state.chapterNumber, stage: state.stage, updatedAt: state.updatedAt }),
        }
      }

      const states: ChapterPipelineState[] = await ipc.invoke('db:pipeline-list')
      if (states.length === 0) return { success: true, content: t('agent.tools.readPipeline.emptyAll') }
      const lines = states.map(state => `- 第${state.chapterNumber}章：${state.stage}（${state.updatedAt}）`)
      return {
        success: true,
        content: `${t('agent.tools.readPipeline.listTitle', { count: states.length })}\n${lines.join('\n')}`,
      }
    } catch (error) {
      return { success: false, content: '', error: t('agent.tools.readPipeline.readFailed', { error: String(error) }) }
    }
  },
})
