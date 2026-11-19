/**
 * read_character_state — 读取角色在某章结束时的属性现状
 */
import i18n from '../../../i18n'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import type { AttributePanelEntry } from '../../../../electron/repositories/attribute-repository'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

export const readCharacterStateTool = buildAgentTool({
  name: 'read_character_state',
  description: t('agent.tools.readCharacterState.desc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      entity_id: {
        type: 'string',
        description: t('agent.tools.readCharacterState.entityIdDesc'),
      },
      chapter_number: {
        type: 'string',
        description: t('agent.tools.readCharacterState.chapterNumberDesc'),
        default: '1',
      },
    },
  },
  requiresConfirmation: false,
  isReadOnly: true,
  execute: async (args) => {
    const project = useProjectStore.getState().currentProject
    if (!project) return { success: false, content: '', error: t('agent.tools.noProject') }

    const entityId = (args.entity_id as string | undefined)?.trim()
    const chapterNumber = Number(args.chapter_number) || 1

    try {
      if (!entityId) {
        const chars = await ipc.invoke('db:character-get-all')
        const list = (Array.isArray(chars) ? chars : []) as Array<{ name?: string; role?: string; currentState?: string }>
        if (list.length === 0) return { success: true, content: t('agent.tools.readCharacterState.empty') }
        const lines = list.map(c => `- ${c.name ?? '未命名'}（${c.role ?? ''}）${c.currentState ? `：${c.currentState}` : ''}`)
        return {
          success: true,
          content: `${t('agent.tools.readCharacterState.listTitle', { chapter: chapterNumber })}\n${lines.join('\n')}`,
        }
      }

      const entries: AttributePanelEntry[] = await ipc.invoke(
        'db:attribute-panel-state', entityId, chapterNumber, 'after', 'character',
      )
      const visible = entries.filter(entry => entry.def.showInPanel)
      if (visible.length === 0) return { success: true, content: t('agent.tools.readCharacterState.noDefs', { name: entityId }) }

      const lines = visible.map(({ def, value }) => {
        if (!value) return `- ${def.label}：${t('agent.tools.readCharacterState.noValue')}`
        const current = value.textValue ?? (value.numValue === null ? '' : String(value.numValue))
        const delta = value.deltaNum ? `（本章 ${value.deltaNum > 0 ? '+' : ''}${value.deltaNum}）` : ''
        return `- ${def.label}：${current}${def.unit ?? ''}${delta}`
      })
      return {
        success: true,
        content: `${t('agent.tools.readCharacterState.title', { name: entityId, chapter: chapterNumber })}\n${lines.join('\n')}`,
      }
    } catch (error) {
      return { success: false, content: '', error: t('agent.tools.readCharacterState.readFailed', { error: String(error) }) }
    }
  },
})
