/**
 * apply_mutation_plan — 执行作者已确认的结构化改动计划（P2-2 / P2-8）
 *
 * 主进程在单个数据库事务内执行全部步骤，任一步失败整体回滚。
 * 该工具 requiresConfirmation=true：确认卡片展示 diff 并允许逐条取消，
 * 取消的步骤 ID 通过 skipStepIds 传给执行层。
 */
import i18n from '../../../i18n'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { validateMutationPlan, type MutationPlan } from '../../../shared/mutation-plan'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

export const applyMutationPlanTool = buildAgentTool({
  name: 'apply_mutation_plan',
  description: t('agent.tools.applyMutationPlan.desc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      plan: {
        type: 'object',
        description: t('agent.tools.applyMutationPlan.planDesc'),
      },
      skipStepIds: {
        type: 'array',
        description: t('agent.tools.applyMutationPlan.skipDesc'),
      },
    },
    required: ['plan'],
  },
  requiresConfirmation: true,
  isReadOnly: false,
  execute: async (args) => {
    // 兼容模型把计划字段平铺在顶层的情况
    const planInput = args.plan && typeof args.plan === 'object' && !Array.isArray(args.plan)
      ? args.plan
      : args

    const validation = validateMutationPlan(planInput)
    if (!validation.valid) {
      return {
        success: false,
        content: '',
        error: t('agent.tools.applyMutationPlan.invalidPlan', { errors: validation.errors.join('；') }),
      }
    }

    const skipStepIds = Array.isArray(args.skipStepIds)
      ? args.skipStepIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : undefined

    try {
      const result = await ipc.invoke('db:mutation-plan-execute', planInput as MutationPlan, { skipStepIds })
      if (!result.success) {
        const failed = result.results.find(item => item.status === 'failed')
        const failedStep = failed ? ` ${t('agent.tools.applyMutationPlan.failedStep', { step: failed.stepId })}` : ''
        return {
          success: false,
          content: '',
          error: t('agent.tools.applyMutationPlan.reverted', { error: result.error ?? '' }) + failedStep,
        }
      }
      const applied = result.results.filter(item => item.status === 'applied').length
      const skipped = result.results.filter(item => item.status === 'skipped').length
      return {
        success: true,
        content: t('agent.tools.applyMutationPlan.applied', { applied, skipped }),
      }
    } catch (error) {
      return {
        success: false,
        content: '',
        error: t('agent.tools.applyMutationPlan.reverted', { error: String(error) }),
      }
    }
  },
})
