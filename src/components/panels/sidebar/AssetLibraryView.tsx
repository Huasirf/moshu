/**
 * AssetLibraryView — 资产库（侧边栏面板，P1-7）
 *
 * 顶部按实体类型筛选；列表展示资产摘要，点击打开详情抽屉。
 * 角色（character）仍以 characters 表为准，点击跳转角色管理视图。
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Boxes, RefreshCw } from 'lucide-react'
import { useProjectStore } from '../../../stores/project-store'
import { useAssetStore } from '../../../stores/asset-store'
import { useCharacterStore, ROLE_LABELS } from '../../../stores/character-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { AssetDetailDialog } from './AssetDetailDialog'
import type { AssetData, AssetEntityType } from '../../../../electron/repositories/asset-repository'

type Filter = 'all' | AssetEntityType

const FILTERS: Filter[] = ['all', 'character', 'item', 'location', 'skill', 'faction', 'secret', 'number']

const STATUS_COLOR: Record<string, string> = {
  active: 'rgb(34,197,94)',
  inactive: 'var(--color-text-muted)',
  archived: 'var(--color-warning)',
}

export default function AssetLibraryView() {
  const { t } = useTranslation('panels')
  const currentProject = useProjectStore(s => s.currentProject)
  const projectPath = currentProject?.path ?? ''

  const assets = useAssetStore(s => s.assets)
  const loading = useAssetStore(s => s.loading)
  const loadAssets = useAssetStore(s => s.load)

  const characters = useCharacterStore(s => s.characters)
  const loadCharacters = useCharacterStore(s => s.load)
  const selectedName = useCharacterStore(s => s.selectedName)
  const setSelectedName = useCharacterStore(s => s.setSelectedName)
  const setSidebarView = useLayoutStore(s => s.setSidebarView)

  const [filter, setFilter] = useState<Filter>('all')
  const [detail, setDetail] = useState<AssetData | null>(null)

  useEffect(() => {
    if (projectPath) loadAssets(projectPath)
  }, [projectPath, loadAssets])

  useEffect(() => {
    if (projectPath && filter === 'character' && characters.length === 0) loadCharacters()
  }, [projectPath, filter, characters.length, loadCharacters])

  const visibleAssets = useMemo(
    () => (filter === 'all' ? assets : assets.filter(a => a.entityType === filter)),
    [assets, filter],
  )

  const openCharacter = (name: string) => {
    setSelectedName(name)
    if (selectedName !== name) setSidebarView('characters')
  }

  const typeLabel = (type: string) =>
    FILTERS.includes(type as Filter) && type !== 'all' ? t(`assets.types.${type}`) : type

  return (
    <div className="flex flex-col h-full">
      {/* 类型筛选 */}
      <div className="flex items-center gap-1 px-2 py-1.5 overflow-x-auto no-select" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {FILTERS.map(f => {
          const active = filter === f
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="px-2 py-0.5 rounded text-[11px] whitespace-nowrap transition-colors"
              style={{
                backgroundColor: active ? 'var(--color-accent)' : 'transparent',
                color: active ? '#fff' : 'var(--color-text-secondary)',
                border: `1px solid ${active ? 'var(--color-accent)' : 'var(--color-border)'}`,
              }}
            >
              {f === 'all' ? t('assets.all') : t(`assets.types.${f}`)}
            </button>
          )
        })}
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto shrink-0"
          title={t('assets.refresh')}
          onClick={() => { if (projectPath) loadAssets(projectPath, true) }}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </Button>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto px-2 py-1.5 space-y-1">
        {filter === 'character'
          ? characters.map(c => (
            <button
              key={c.name}
              onClick={() => openCharacter(c.name)}
              className="w-full text-left px-2 py-1.5 rounded transition-colors hover:bg-[var(--color-hover)]"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs truncate" style={{ color: 'var(--color-text)' }}>{c.name}</span>
                <span className="text-[10px] shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                  {ROLE_LABELS[c.role] ?? c.role}
                </span>
              </div>
              {c.appearance && (
                <div className="text-[11px] truncate mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {c.appearance}
                </div>
              )}
              {/* 动态状态摘要：境界 / 位置随章节自动更新，一眼看出角色当前进度 */}
              {(c.currentState?.powerLevel || c.currentState?.location) && (
                <div className="flex items-center gap-1.5 mt-0.5 text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
                  {c.currentState?.powerLevel && <span className="truncate">{c.currentState.powerLevel}</span>}
                  {c.currentState?.powerLevel && c.currentState?.location && <span>·</span>}
                  {c.currentState?.location && <span className="truncate">{c.currentState.location}</span>}
                </div>
              )}
            </button>
          ))
          : visibleAssets.map(a => (
            <button
              key={a.id}
              onClick={() => setDetail(a)}
              className="w-full text-left px-2 py-1.5 rounded transition-colors hover:bg-[var(--color-hover)]"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs truncate" style={{ color: 'var(--color-text)' }}>{a.name}</span>
                <span className="text-[10px] shrink-0" style={{ color: 'var(--color-text-muted)' }}>
                  {typeLabel(a.entityType)}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[11px] truncate flex-1" style={{ color: 'var(--color-text-secondary)' }}>
                  {a.summary || a.description || '—'}
                </span>
                <span className="text-[10px] shrink-0" style={{ color: STATUS_COLOR[a.status] }}>
                  {t(`assets.status.${a.status}`)}
                </span>
              </div>
            </button>
          ))}

        {filter !== 'character' && visibleAssets.length === 0 && !loading && (
          <EmptyState icon={<Boxes size={28} />} message={t('assets.empty')} />
        )}
        {filter === 'character' && characters.length === 0 && !loading && (
          <EmptyState icon={<Boxes size={28} />} message={t('assets.empty')} />
        )}
      </div>

      <AssetDetailDialog
        asset={detail}
        open={!!detail}
        onOpenChange={(open) => { if (!open) setDetail(null) }}
      />
    </div>
  )
}
