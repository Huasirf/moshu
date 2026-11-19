/**
 * ChapterStagePill — 章节流水线阶段指示（P5-2）
 *
 * 七个圆点表示 planned → … → writeback_done 的完成进度，当前阶段用主题色高亮。
 * 阶段顺序唯一来源是 shared/chapter-stage.ts，组件内不复制数组。
 */
import { useTranslation } from 'react-i18next'
import { CHAPTER_STAGES, type ChapterStage } from '../../shared/chapter-stage'
import { cn } from '../../lib/utils'

interface Props {
  stage: ChapterStage | null | undefined
  /** 只显示进度点，不显示阶段名 */
  compact?: boolean
  className?: string
}

export function ChapterStagePill({ stage, compact = false, className }: Props) {
  const { t } = useTranslation('panels')
  const index = stage ? CHAPTER_STAGES.indexOf(stage) : -1
  if (index < 0) return null

  const label = t(`outlineTree.stage.${stage}`, { defaultValue: stage })

  return (
    <span className={cn('inline-flex items-center gap-1 shrink-0', className)} title={label}>
      <span className="flex items-center gap-[3px]" aria-hidden>
        {CHAPTER_STAGES.map((item, i) => (
          <span
            key={item}
            className="rounded-full"
            style={{
              width: i === index ? 6 : 4,
              height: i === index ? 6 : 4,
              backgroundColor: i <= index ? 'var(--color-accent)' : 'var(--color-border)',
              opacity: i < index ? 0.45 : 1,
            }}
          />
        ))}
      </span>
      {!compact && (
        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>
          {label}
        </span>
      )}
    </span>
  )
}
