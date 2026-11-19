/**
 * ConfirmCard — 操作确认卡片
 *
 * 当 Agent 调用需要确认的 Tool 时显示此卡片。
 * 普通 Tool：批准 / 拒绝。
 * apply_mutation_plan：展示改动计划的字段级 diff（前值 → 后值），支持逐条勾选，
 * 未勾选的步骤通过 skipStepIds 传给主进程执行层（P2-8）。
 */
import { useEffect, useMemo, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ToolCallInfo } from '../../../services/agent/agent-engine'
import { useAgentStore } from '../../../stores/agent-store'
import { ipc } from '../../../services/ipc-client'
import {
  validateMutationPlan,
  type MutationPlan,
  type MutationPlanPreview,
  type MutationRisk,
  type MutationStep,
} from '../../../shared/mutation-plan'

interface Props {
  toolCall: ToolCallInfo
}

export default function ConfirmCard({ toolCall }: Props) {
  const { t } = useTranslation('panels')
  const resolveToolConfirmation = useAgentStore(s => s.resolveToolConfirmation)
  const { id, toolName, arguments: args } = toolCall

  const plan = useMemo(() => extractMutationPlan(toolCall), [toolCall])

  if (plan) {
    return <MutationPlanCard toolCall={toolCall} plan={plan} />
  }

  // 生成操作描述
  const description = generateDescription(toolName, args, t)

  return (
    <div className="confirm-card">
      {/* 头部 */}
      <div className="confirm-card-header">
        <ShieldAlert size={14} />
        <span>{t('agent.confirmAction')}</span>
      </div>

      {/* 内容 */}
      <div className="confirm-card-body">
        <div>{description}</div>
        {Object.keys(args).length > 0 && (
          <div
            style={{
              marginTop: 6,
              padding: '4px 8px',
              borderRadius: 4,
              backgroundColor: 'var(--color-hover)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.68rem',
              color: 'var(--color-text-secondary)',
              whiteSpace: 'pre-wrap',
              maxHeight: 120,
              overflowY: 'auto',
            }}
          >
            {JSON.stringify(args, null, 2)}
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="confirm-card-actions">
        <button
          className="confirm-card-btn reject"
          onClick={() => resolveToolConfirmation(id, false)}
        >
          {t('agent.reject')}
        </button>
        <button
          className="confirm-card-btn approve"
          onClick={() => resolveToolConfirmation(id, true)}
        >
          {t('agent.approveExecute')}
        </button>
      </div>
    </div>
  )
}

// ===== 改动计划卡片 =====

const RISK_COLORS: Record<MutationRisk, string> = {
  low: '#30a46c',
  medium: '#f5a623',
  high: '#e5484d',
}

function riskLabel(t: (key: string) => string, risk: MutationRisk): string {
  if (risk === 'high') return t('agent.confirmPlan.riskHigh')
  if (risk === 'medium') return t('agent.confirmPlan.riskMedium')
  return t('agent.confirmPlan.riskLow')
}

function formatValue(value: unknown, emptyText: string): string {
  if (value === null || value === undefined || value === '') return emptyText
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

function MutationPlanCard({ toolCall, plan }: { toolCall: ToolCallInfo; plan: MutationPlan }) {
  const { t } = useTranslation('panels')
  const resolveToolConfirmation = useAgentStore(s => s.resolveToolConfirmation)
  const [preview, setPreview] = useState<MutationPlanPreview | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [checked, setChecked] = useState<Record<string, boolean>>(
    () => Object.fromEntries(plan.steps.map(step => [step.id, true])),
  )

  useEffect(() => {
    let canceled = false
    ipc.invoke('db:mutation-plan-preview', plan)
      .then(result => {
        if (canceled) return
        if (result.success) setPreview(result)
        else setPreviewFailed(true)
      })
      .catch(() => {
        if (!canceled) setPreviewFailed(true)
      })
    return () => { canceled = true }
    // 计划内容在确认卡片生命周期内不变，按 toolCall.id 取一次即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolCall.id])

  const selectedSteps = plan.steps.filter(step => checked[step.id] !== false)
  const allChecked = selectedSteps.length === plan.steps.length

  const toggleAll = () => {
    const next = !allChecked
    setChecked(Object.fromEntries(plan.steps.map(step => [step.id, next])))
  }

  const approve = () => {
    const skipStepIds = plan.steps.filter(step => checked[step.id] === false).map(step => step.id)
    // 与 Tool 执行共用的 arguments 引用，执行层会读取 skipStepIds
    toolCall.arguments.skipStepIds = skipStepIds
    resolveToolConfirmation(toolCall.id, true)
  }

  const changesOf = (step: MutationStep) =>
    preview?.steps.find(item => item.stepId === step.id)?.changes ?? []

  return (
    <div className="confirm-card">
      <div className="confirm-card-header">
        <ShieldAlert size={14} />
        <span>{t('agent.confirmPlan.title')}</span>
        <span
          style={{
            marginLeft: 'auto',
            padding: '1px 6px',
            borderRadius: 8,
            fontSize: '0.66rem',
            color: '#fff',
            backgroundColor: RISK_COLORS[plan.risk],
          }}
        >
          {riskLabel(t, plan.risk)}
        </span>
      </div>

      <div className="confirm-card-body">
        <div style={{ fontWeight: 500 }}>{plan.intent}</div>
        <div style={{ marginTop: 2, fontSize: '0.72rem', color: 'var(--color-text-secondary)' }}>
          {plan.affectedChapters.length > 0
            ? t('agent.confirmPlan.affectedChapters', { chapters: plan.affectedChapters.join(', ') })
            : t('agent.confirmPlan.noAffectedChapters')}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
          <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>
            {t('agent.confirmPlan.stepsTitle', { count: plan.steps.length })}
          </span>
          <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={allChecked} onChange={toggleAll} />
            {t('agent.confirmPlan.selectAll')}
          </label>
        </div>

        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
          {plan.steps.map(step => {
            const enabled = checked[step.id] !== false
            const changes = changesOf(step)
            return (
              <div
                key={step.id}
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  padding: '6px 8px',
                  opacity: enabled ? 1 : 0.5,
                }}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    aria-label={t('agent.confirmPlan.selectStep')}
                    onChange={e => setChecked(prev => ({ ...prev, [step.id]: e.target.checked }))}
                  />
                  <span style={{ fontSize: '0.75rem', fontWeight: 500 }}>{step.title}</span>
                  <span
                    style={{
                      marginLeft: 'auto',
                      padding: '0 5px',
                      borderRadius: 4,
                      fontSize: '0.62rem',
                      backgroundColor: 'var(--color-hover)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    {step.op}
                  </span>
                  <span
                    title={riskLabel(t, step.risk)}
                    style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: RISK_COLORS[step.risk] }}
                  />
                </label>

                {!enabled && (
                  <div style={{ marginTop: 2, fontSize: '0.66rem', color: 'var(--color-text-secondary)' }}>
                    {t('agent.confirmPlan.skipped')}
                  </div>
                )}

                {changes.length > 0 ? (
                  <table style={{ marginTop: 4, width: '100%', fontSize: '0.66rem', borderCollapse: 'collapse' }}>
                    <tbody>
                      {changes.map(change => (
                        <tr key={`${step.id}-${change.field}`}>
                          <td style={{ padding: '1px 4px 1px 0', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                            {change.field}
                          </td>
                          <td style={{ padding: '1px 4px', color: 'var(--color-text-secondary)', textDecoration: 'line-through' }}>
                            {formatValue(change.before, t('agent.confirmPlan.emptyValue'))}
                          </td>
                          <td style={{ padding: '1px 2px', color: 'var(--color-text-secondary)' }}>→</td>
                          <td style={{ padding: '1px 0 1px 4px' }}>
                            {formatValue(change.after, t('agent.confirmPlan.emptyValue'))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : preview ? (
                  <div style={{ marginTop: 2, fontSize: '0.66rem', color: 'var(--color-text-secondary)' }}>
                    {t('agent.confirmPlan.noChange')}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>

        {previewFailed && (
          <div style={{ marginTop: 6, fontSize: '0.68rem', color: 'var(--color-text-secondary)' }}>
            {t('agent.confirmPlan.previewFailed')}
          </div>
        )}
      </div>

      <div className="confirm-card-actions">
        <button
          className="confirm-card-btn reject"
          onClick={() => resolveToolConfirmation(toolCall.id, false)}
        >
          {t('agent.reject')}
        </button>
        <button
          className="confirm-card-btn approve"
          disabled={selectedSteps.length === 0}
          onClick={approve}
        >
          {t('agent.confirmPlan.approveSelected')}
        </button>
      </div>
    </div>
  )
}

/** 从 Tool 调用中解析出合法 MutationPlan；非计划类 Tool 返回 null */
function extractMutationPlan(toolCall: ToolCallInfo): MutationPlan | null {
  if (toolCall.toolName !== 'apply_mutation_plan') return null
  const args = toolCall.arguments ?? {}
  const candidate = args.plan && typeof args.plan === 'object' && !Array.isArray(args.plan)
    ? args.plan
    : args
  const validation = validateMutationPlan(candidate)
  return validation.valid ? candidate as MutationPlan : null
}

/** 根据 Tool 名称生成人类可读的操作描述 */
function generateDescription(toolName: string, args: Record<string, unknown>, t: (key: string, options?: Record<string, unknown>) => string): string {
  switch (toolName) {
    case 'write_file':
      return t('agent.willWriteFile', { path: args.file_path ?? t('agent.unknownPath') })
    case 'open_editor':
      return t('agent.willOpenInEditor', { path: args.file_path ?? t('agent.unknownFile') })
    case 'start_workflow':
      return t('agent.willStartWorkflow', { workflow: args.workflow ?? t('agent.unknownWorkflow') }) + (args.chapter_number ? t('agent.chapterNumber', { chapter: args.chapter_number }) : '')
    case 'update_config':
      return t('agent.willUpdateConfig', { field: args.field ?? t('agent.unknownField') })
    default:
      return t('agent.willExecuteAction', { tool: toolName })
  }
}
