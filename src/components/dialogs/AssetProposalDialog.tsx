import { useTranslation } from 'react-i18next'
import { Globe2, Users, ShieldQuestion } from 'lucide-react'
import { useAssetProposalStore } from '../../stores/asset-proposal-store'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import { Button } from '../ui/Button'

/**
 * 拆书产物确认（DR-06）
 *
 * 世界观 / 人物 / 关系需要作者确认后才写入项目；
 * 章节大纲与节拍由流水线自动落库，不在此处确认。
 */
export default function AssetProposalDialog() {
  const { t } = useTranslation('dialogs')
  const proposal = useAssetProposalStore(s => s.proposal)
  const settle = useAssetProposalStore(s => s.settle)

  if (!proposal) return null

  const world = proposal.world?.trim()
  const characters = proposal.characters

  return (
    <Dialog open onOpenChange={(v) => { if (!v) settle('skip') }}>
      <DialogContent className="max-w-[620px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldQuestion size={18} className="text-[var(--color-accent)]" />
            {t('assetProposal.title')}
          </DialogTitle>
          <DialogDescription>{t('assetProposal.description')}</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          <section>
            <h4 className="flex items-center gap-1.5 text-xs font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>
              <Globe2 size={13} /> {t('assetProposal.worldTitle')}
            </h4>
            <p className="text-xs leading-5 whitespace-pre-wrap rounded-lg p-3"
              style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-secondary)' }}>
              {world || t('assetProposal.empty')}
            </p>
          </section>

          <section>
            <h4 className="flex items-center gap-1.5 text-xs font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>
              <Users size={13} /> {t('assetProposal.charactersTitle', { count: characters.length })}
            </h4>
            {characters.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>{t('assetProposal.empty')}</p>
            ) : (
              <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                {characters.slice(0, 12).map((c) => (
                  <div key={c.name} className="px-3 py-2 text-xs flex items-start gap-2"
                    style={{ borderTop: '1px solid var(--color-border)' }}>
                    <span className="font-medium flex-shrink-0" style={{ color: 'var(--color-text)' }}>{c.name}</span>
                    <span className="truncate" style={{ color: 'var(--color-text-muted)' }}>
                      {[c.role, c.personality, c.relationships].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                ))}
                {characters.length > 12 && (
                  <div className="px-3 py-1.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {t('assetProposal.moreCharacters', { count: characters.length - 12 })}
                  </div>
                )}
              </div>
            )}
          </section>

          <p className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
            {t('assetProposal.autoNote')}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => settle('skip')}>
            {t('assetProposal.skip')}
          </Button>
          <Button variant="ai" onClick={() => settle('apply')}>
            {t('assetProposal.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
