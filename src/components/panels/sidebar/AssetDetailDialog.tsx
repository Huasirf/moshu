/**
 * AssetDetailDialog — 资产详情抽屉（只读）
 *
 * 资产库与现状面板共用；展示资产基础信息与 type_data 扩展字段。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '../../ui/Dialog'
import type { AssetData } from '../../../../electron/repositories/asset-repository'
import { ipc } from '../../../services/ipc-client'
import { requestEditorReveal } from '../../../services/editor-reveal'
import type { ChapterSearchResult } from '../../../../electron/repositories/chapter-search-repository'
import { openBuiltinEditor, openDraftTab, resolveDraftTab } from './SidebarShared'
import { useEditorStore } from '../../../stores/editor-store'

interface Props {
  asset: AssetData | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

const TYPE_LABEL_KEYS: Record<string, string> = {
  character: 'assets.types.character',
  item: 'assets.types.item',
  location: 'assets.types.location',
  skill: 'assets.types.skill',
  faction: 'assets.types.faction',
  secret: 'assets.types.secret',
  number: 'assets.types.number',
}

export function AssetDetailDialog({ asset, open, onOpenChange }: Props) {
  const { t } = useTranslation('panels')
  // P4-4：大纲中出现该资产的章节（来自 blueprints.asset_refs）
  const assetKey = asset ? `${asset.entityType}:${asset.id}` : ''
  const [appearanceData, setAppearanceData] = useState<{
    key: string
    items: Array<{ chapterNumber: number; title: string }>
  }>({ key: '', items: [] })
  // P5-3：正文中出现该资产的章节（全文搜索，含命中位置用于跳转）
  const [textAppearanceData, setTextAppearanceData] = useState<{
    key: string
    items: Array<{
      chapterNumber: number
      title: string
      draftId: number
      status: string
      matchCount: number
      offset: number
      length: number
      match: string
    }>
  }>({ key: '', items: [] })

  useEffect(() => {
    if (!open || !assetKey) return
    let cancelled = false
    const type = assetKey.split(':')[0]
    const id = assetKey.slice(type.length + 1)

    ipc.invoke('db:blueprint-get-all').then((list) => {
      if (cancelled || !Array.isArray(list)) return
      const matched = list
        .filter((bp) => (bp.assetRefs ?? []).some((ref) =>
          ref.type === type && String(ref.id) === id))
        .map((bp) => ({ chapterNumber: bp.chapterNumber, title: bp.title || '' }))
        .sort((a, b) => a.chapterNumber - b.chapterNumber)
      setAppearanceData({ key: assetKey, items: matched })
    }).catch(() => {
      if (!cancelled) setAppearanceData({ key: assetKey, items: [] })
    })

    const assetName = asset?.name?.trim() ?? ''
    if (assetName) {
      ipc.invoke('db:search-chapters', assetName).then((result) => {
        if (cancelled) return
        const chapters = (result as ChapterSearchResult | null)?.chapters ?? []
        const items = chapters
          .filter((ch) => ch.matchCount > 0 && ch.hits.length > 0)
          .map((ch) => {
            const hit = ch.hits[0]
            return {
              chapterNumber: ch.chapterNumber,
              title: ch.title,
              draftId: ch.draftId,
              status: ch.status,
              matchCount: ch.matchCount,
              offset: hit.offset,
              length: hit.length,
              match: hit.match,
            }
          })
          .sort((a, b) => a.chapterNumber - b.chapterNumber)
        setTextAppearanceData({ key: assetKey, items })
      }).catch(() => {
        if (!cancelled) setTextAppearanceData({ key: assetKey, items: [] })
      })
    }

    return () => { cancelled = true }
  }, [open, assetKey, asset?.name])

  if (!asset) return null
  const appearances = appearanceData.key === assetKey ? appearanceData.items : []
  const textAppearances = textAppearanceData.key === assetKey ? textAppearanceData.items : []

  const typeLabel = TYPE_LABEL_KEYS[asset.entityType] ? t(TYPE_LABEL_KEYS[asset.entityType]) : asset.entityType
  const statusLabel = t(`assets.status.${asset.status}`)
  const typeEntries = Object.entries(asset.typeData ?? {})

  const row = (label: string, value: ReactNode) => (
    <div className="flex gap-3 text-xs leading-5">
      <span className="w-20 shrink-0" style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span className="flex-1 break-words" style={{ color: 'var(--color-text)' }}>{value}</span>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{asset.name}</DialogTitle>
          <DialogDescription>{typeLabel} · {statusLabel}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2 pt-1">
          {row(t('assets.summary'), asset.summary || '—')}
          {row(t('assets.description'), asset.description || '—')}
          {row(t('assets.chapterRange'), `${asset.firstChapter || '—'} ~ ${asset.lastChapter || '—'}`)}
          {row(t('assets.tags'), asset.tags.length ? asset.tags.join(' / ') : '—')}
        </div>

        {typeEntries.length > 0 && (
          <div className="pt-3 mt-1 space-y-2" style={{ borderTop: '1px solid var(--color-border)' }}>
            <div className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
              {t('assets.typeData')}
            </div>
            {typeEntries.map(([key, value]) => (
              row(key, typeof value === 'object' ? JSON.stringify(value) : String(value))
            ))}
          </div>
        )}

        <div className="pt-3 mt-1 space-y-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {t('assets.appearances')}
          </div>
          {appearances.length === 0 ? (
            <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('assets.appearancesEmpty')}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {appearances.map((item) => (
                <button
                  key={item.chapterNumber}
                  className="text-[11px] px-2 py-0.5 rounded"
                  style={{ background: 'var(--color-hover)', color: 'var(--color-text)' }}
                  onClick={() => {
                    onOpenChange(false)
                    useEditorStore.getState().focusChapter(item.chapterNumber)
                    openBuiltinEditor('chapter-card-editor', t('outlineTree.openBlueprint'), 'chapter-card')
                  }}
                >
                  {item.chapterNumber}. {item.title || t('outlineTree.noTitle')}
                </button>
              ))}
            </div>
          )}
          <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
            {t('assets.appearancesHint')}
          </div>
        </div>

        <div className="pt-3 mt-1 space-y-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {t('assets.textAppearances')}
          </div>
          {textAppearances.length === 0 ? (
            <div className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('assets.textAppearancesEmpty')}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1">
              {textAppearances.map((item) => (
                <button
                  key={item.chapterNumber}
                  className="text-[11px] px-2 py-0.5 rounded"
                  style={{ background: 'var(--color-hover)', color: 'var(--color-text)' }}
                  title={t('assets.textAppearancesHint')}
                  onClick={() => {
                    onOpenChange(false)
                    const target = resolveDraftTab(item.draftId, item.status === 'finalized')
                    void openDraftTab(target, `${item.chapterNumber}. ${item.title || t('outlineTree.noTitle')}`)
                      .then(() => {
                        requestEditorReveal({
                          filePath: target.filePath,
                          from: item.offset,
                          to: item.offset + item.length,
                          text: item.match,
                        })
                      })
                  }}
                >
                  {item.chapterNumber}. {item.title || t('outlineTree.noTitle')}
                  {item.matchCount > 1 && (
                    <span style={{ color: 'var(--color-text-muted)' }}> ×{item.matchCount}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          <div className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
            {t('assets.textAppearancesHint')}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
