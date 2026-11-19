/**
 * read_review_findings — 读取章节审稿问题台账
 */
import i18n from '../../../i18n'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import type { ReviewFinding, ReviewFindingStatus } from '../../../../electron/repositories/review-finding-repository'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

const STATUSES: ReviewFindingStatus[] = ['open', 'fixed', 'ignored']

export const readReviewFindingsTool = buildAgentTool({
  name: 'read_review_findings',
  description: t('agent.tools.readReviewFindings.desc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      chapter_number: {
        type: 'string',
        description: t('agent.tools.readReviewFindings.chapterNumberDesc'),
      },
      status: {
        type: 'string',
        description: t('agent.tools.readReviewFindings.statusDesc'),
        enum: [...STATUSES],
      },
    },
    required: ['chapter_number'],
  },
  requiresConfirmation: false,
  isReadOnly: true,
  execute: async (args) => {
    const project = useProjectStore.getState().currentProject
    if (!project) return { success: false, content: '', error: t('agent.tools.noProject') }

    const chapterNumber = Number(args.chapter_number)
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) {
      return { success: false, content: '', error: t('agent.tools.readReviewFindings.invalidChapter') }
    }
    const rawStatus = args.status as string | undefined
    if (rawStatus && !STATUSES.includes(rawStatus as ReviewFindingStatus)) {
      return { success: false, content: '', error: t('agent.tools.readReviewFindings.invalidStatus', { status: rawStatus }) }
    }

    try {
      const findings: ReviewFinding[] = await ipc.invoke(
        'db:review-finding-list', chapterNumber, rawStatus as ReviewFindingStatus | undefined,
      )
      if (findings.length === 0) {
        return { success: true, content: t('agent.tools.readReviewFindings.empty', { chapter: chapterNumber }) }
      }
      const lines = findings.map(f => {
        const evidence = f.evidence ? `（证据：${f.evidence}）` : ''
        return `- [#${f.id}][${f.severity}][${f.status}] ${f.category}：${f.message}${evidence}`
      })
      return {
        success: true,
        content: `${t('agent.tools.readReviewFindings.title', { chapter: chapterNumber, count: findings.length })}\n${lines.join('\n')}`,
      }
    } catch (error) {
      return { success: false, content: '', error: t('agent.tools.readReviewFindings.readFailed', { error: String(error) }) }
    }
  },
})
