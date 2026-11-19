/**
 * StatusPanelView — 现状面板（侧边栏面板，P1-6）
 *
 * 只读：按 attribute_defs.show_in_panel 展示所选实体在指定章节/阶段的属性值，
 * 点击某条属性跳转到资产详情（角色则跳角色管理）。
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Activity, RefreshCw } from 'lucide-react'
import { useProjectStore } from '../../../stores/project-store'
import { useAssetStore } from '../../../stores/asset-store'
import { useCharacterStore } from '../../../stores/character-store'
import { useEditorStore } from '../../../stores/editor-store'
import { useLayoutStore } from '../../../stores/layout-store'
import { ipc } from '../../../services/ipc-client'
import { globalEventBus } from '../../../shared/event-bus'
import { Button } from '../../ui/Button'
import { EmptyState } from '../../ui/EmptyState'
import { Input } from '../../ui/Input'
import { NativeSelect } from '../../ui/NativeSelect'
import { AssetDetailDialog } from './AssetDetailDialog'
import type { AssetData, AssetEntityType } from '../../../../electron/repositories/asset-repository'
import type { AttributePanelEntry, AttributePhase } from '../../../../electron/repositories/attribute-repository'

interface EntityOption {
  id: string
  type: AssetEntityType
  label: string
}

export default function StatusPanelView() {
  const { t } = useTranslation('panels')
  const currentProject = useProjectStore(s => s.currentProject)
  const projectPath = currentProject?.path ?? ''

  const assets = useAssetStore(s => s.assets)
  const defs = useAssetStore(s => s.defs)
  const loadAssets = useAssetStore(s => s.load)

  const characters = useCharacterStore(s => s.characters)
  const loadCharacters = useCharacterStore(s => s.load)
  const setSelectedName = useCharacterStore(s => s.setSelectedName)
  const setSidebarView = useLayoutStore(s => s.setSidebarView)

  // 当前编辑器打开的章节作为默认查阅点；用户改过之后以输入值为准
  const activeChapter = useEditorStore((s) => {
    const tab = s.tabs.find(t => t.id === s.activeTabId)
    return tab?.chapterNumber ?? 0
  })

  const [selectedKey, setSelectedKey] = useState('')
  const [chapterOverride, setChapterOverride] = useState<number | null>(null)
  const [phase, setPhase] = useState<AttributePhase>('after')
  const [entries, setEntries] = useState<AttributePanelEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<AssetData | null>(null)

  const chapter = chapterOverride ?? (activeChapter > 0 ? activeChapter : 1)

  useEffect(() => {
    if (!projectPath) return
    loadAssets(projectPath)
    if (characters.length === 0) loadCharacters()
  }, [projectPath, loadAssets, loadCharacters, characters.length])

  const options = useMemo<EntityOption[]>(() => [
    ...characters.map(c => ({ id: c.name, type: 'character' as const, label: c.name })),
    ...assets
      .filter(a => a.entityType !== 'character')
      .map(a => ({ id: String(a.id), type: a.entityType, label: a.name })),
  ], [characters, assets])

  // 默认选中第一个实体；实体消失时回退
  useEffect(() => {
    if (selectedKey && options.some(o => `${o.type}:${o.id}` === selectedKey)) return
    setSelectedKey(options.length > 0 ? `${options[0].type}:${options[0].id}` : '')
  }, [options, selectedKey])

  const selected = options.find(o => `${o.type}:${o.id}` === selectedKey) ?? null

  const loadState = useMemo(() => async () => {
    if (!projectPath || !selected) {
      setEntries([])
      return
    }
    setLoading(true)
    try {
      const rows = await ipc.invoke('db:attribute-panel-state', selected.id, chapter, phase, selected.type)
      setEntries(rows)
    } catch {
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [projectPath, selected, chapter, phase])

  useEffect(() => { loadState() }, [loadState])

  // 定稿写回后属性值可能变化，自动刷新
  useEffect(() => {
    return globalEventBus.on('FINALIZE_COMPLETE', () => {
      loadAssets(projectPath, true)
      loadState()
    })
  }, [projectPath, loadAssets, loadState])

  const openEntity = () => {
    if (!selected) return
    if (selected.type === 'character') {
      setSelectedName(selected.id)
      setSidebarView('characters')
      return
    }
    const asset = assets.find(a => String(a.id) === selected.id)
    if (asset) setDetail(asset)
  }

  if (options.length === 0) {
    return (
      <div className="h-full p-3">
        <EmptyState icon={<Activity size={28} />} message={t('statusPanel.noEntities')} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* 实体 / 章节 / 阶段选择 */}
      <div className="px-2 py-1.5 space-y-1.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <NativeSelect
          value={selectedKey}
          onChange={(e) => { setSelectedKey(e.target.value); setChapterOverride(null) }}
        >
          {options.map(o => (
            <option key={`${o.type}:${o.id}`} value={`${o.type}:${o.id}`}>
              {o.label}{o.type !== 'character' ? ` · ${t(`assets.types.${o.type}`)}` : ''}
            </option>
          ))}
        </NativeSelect>

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] shrink-0" style={{ color: 'var(--color-text-muted)' }}>
            {t('statusPanel.chapter')}
          </span>
          <Input
            type="number"
            min={1}
            value={chapter}
            onChange={(e) => {
              const next = Number(e.target.value)
              setChapterOverride(Number.isSafeInteger(next) && next > 0 ? next : 1)
            }}
            className="h-6 w-16 text-xs"
          />
          <div className="ml-auto flex items-center gap-0.5">
            {(['before', 'after'] as AttributePhase[]).map(p => (
              <button
                key={p}
                onClick={() => setPhase(p)}
                className="px-1.5 py-0.5 rounded text-[11px]"
                style={{
                  backgroundColor: phase === p ? 'var(--color-accent)' : 'transparent',
                  color: phase === p ? '#fff' : 'var(--color-text-secondary)',
                  border: `1px solid ${phase === p ? 'var(--color-accent)' : 'var(--color-border)'}`,
                }}
              >
                {t(`statusPanel.${p}`)}
              </button>
            ))}
            <Button variant="ghost" size="icon" title={t('statusPanel.refresh')} onClick={() => void loadState()}>
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </Button>
          </div>
        </div>
      </div>

      {/* 属性值列表 */}
      <div className="flex-1 overflow-y-auto px-2 py-1.5 space-y-1">
        {entries.length === 0 && !loading && (
          <EmptyState icon={<Activity size={28} />} message={t('statusPanel.noDefs')} />
        )}
        {entries.map(({ def, value }) => {
          const display = value?.numValue != null
            ? `${value.numValue}${def.unit ? ` ${def.unit}` : ''}`
            : (value?.textValue || t('statusPanel.noValue'))
          const delta = value?.deltaNum
          return (
            <button
              key={def.key}
              onClick={openEntity}
              className="w-full text-left px-2 py-1.5 rounded transition-colors hover:bg-[var(--color-hover)]"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs truncate" style={{ color: 'var(--color-text)' }}>{def.label}</span>
                <span className="text-xs shrink-0" style={{ color: value ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                  {display}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-0.5">
                <span className="text-[10px] truncate" style={{ color: 'var(--color-text-muted)' }}>
                  {value
                    ? t('statusPanel.changedAt', {
                      chapter: value.chapterNumber,
                      phase: t(`statusPanel.${value.phase}`),
                    })
                    : t('statusPanel.noValue')}
                </span>
                {delta != null && delta !== 0 && (
                  <span className="text-[10px] shrink-0" style={{ color: delta > 0 ? 'var(--color-success)' : 'var(--color-error)' }}>
                    {delta > 0 ? `+${delta}` : String(delta)}
                  </span>
                )}
              </div>
            </button>
          )
        })}
        {defs.length === 0 && entries.length === 0 && !loading && (
          <div className="text-[11px] px-1 pt-1" style={{ color: 'var(--color-text-muted)' }}>
            {t('statusPanel.noDefsHint')}
          </div>
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
