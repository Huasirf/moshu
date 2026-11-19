/**
 * read_relations — 读取实体关系网
 */
import i18n from '../../../i18n'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import type { EntityRelation } from '../../../../electron/repositories/relation-repository'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

export const readRelationsTool = buildAgentTool({
  name: 'read_relations',
  description: t('agent.tools.readRelations.desc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      from_id: {
        type: 'string',
        description: t('agent.tools.readRelations.fromIdDesc'),
      },
    },
  },
  requiresConfirmation: false,
  isReadOnly: true,
  execute: async (args) => {
    const project = useProjectStore.getState().currentProject
    if (!project) return { success: false, content: '', error: t('agent.tools.noProject') }

    const fromId = (args.from_id as string | undefined)?.trim()
    try {
      const relations: EntityRelation[] = await ipc.invoke('db:relation-list', fromId || undefined)
      if (relations.length === 0) return { success: true, content: t('agent.tools.readRelations.empty') }

      const lines = relations.map(relation => {
        const status = relation.status ? `（${relation.status}）` : ''
        const note = relation.note ? `：${relation.note}` : ''
        return `- ${relation.fromId} --${relation.relationType}--> ${relation.toId}${status}${note}`
      })
      return {
        success: true,
        content: `${t('agent.tools.readRelations.title', { count: relations.length })}\n${lines.join('\n')}`,
      }
    } catch (error) {
      return { success: false, content: '', error: t('agent.tools.readRelations.readFailed', { error: String(error) }) }
    }
  },
})
