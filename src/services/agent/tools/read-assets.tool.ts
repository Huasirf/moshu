/**
 * read_assets — 读取资产总表（道具/地点/技能/势力/秘密/数值）
 */
import i18n from '../../../i18n'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { MUTATION_ASSET_TYPES, type MutationAssetType } from '../../../../src/shared/mutation-plan'
import type { AssetData } from '../../../../electron/repositories/asset-repository'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

export const readAssetsTool = buildAgentTool({
  name: 'read_assets',
  description: t('agent.tools.readAssets.desc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      entity_type: {
        type: 'string',
        description: t('agent.tools.readAssets.entityTypeDesc'),
        enum: [...MUTATION_ASSET_TYPES],
      },
    },
  },
  requiresConfirmation: false,
  isReadOnly: true,
  execute: async (args) => {
    const project = useProjectStore.getState().currentProject
    if (!project) return { success: false, content: '', error: t('agent.tools.noProject') }

    const rawType = args.entity_type as string | undefined
    if (rawType && !MUTATION_ASSET_TYPES.includes(rawType as MutationAssetType)) {
      return { success: false, content: '', error: t('agent.tools.readAssets.invalidType', { type: rawType }) }
    }

    try {
      const assets: AssetData[] = await ipc.invoke('db:asset-list', rawType as MutationAssetType | undefined)
      if (assets.length === 0) return { success: true, content: t('agent.tools.readAssets.empty') }

      const lines = assets.map(asset => {
        const range = asset.firstChapter || asset.lastChapter
          ? `第${asset.firstChapter || '?'}-${asset.lastChapter || '?'}章`
          : ''
        return `- [${asset.entityType}] ${asset.name}（${asset.status}）${range ? ` ${range}` : ''}${asset.summary ? `：${asset.summary}` : ''}`
      })
      return {
        success: true,
        content: `${t('agent.tools.readAssets.listTitle', { count: assets.length })}\n${lines.join('\n')}`,
      }
    } catch (error) {
      return { success: false, content: '', error: t('agent.tools.readAssets.readFailed', { error: String(error) }) }
    }
  },
})
