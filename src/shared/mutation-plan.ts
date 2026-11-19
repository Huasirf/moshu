/**
 * MutationPlan — 中控 AI 的结构化改动计划（P2）
 *
 * 设计约束：
 * - 步骤按「实体操作」而非「文件操作」描述（DR-01 已定稿：实体级步骤）。
 * - 计划先展示给用户确认，未确认时数据库零改动。
 * - 本文件必须保持纯共享层：不得引入 electron/ 下的运行时代码（避免把 better-sqlite3 打进渲染进程）。
 */
import { CHAPTER_STAGES, type ChapterStage } from './chapter-stage'

/** 改动步骤的操作类型（实体粒度） */
export const MUTATION_OPS = [
  'create_asset',
  'update_asset',
  'delete_asset',
  'update_blueprint',
  'update_character',
  'update_relation',
  'set_attribute',
  'set_pipeline_stage',
] as const
export type MutationOp = (typeof MUTATION_OPS)[number]

/** 风险等级 */
export const MUTATION_RISKS = ['low', 'medium', 'high'] as const
export type MutationRisk = (typeof MUTATION_RISKS)[number]

/**
 * 资产实体类型。与 electron/repositories/asset-repository.ts 的
 * ASSET_ENTITY_TYPES 保持一致（该文件仅可 type-only 引用，运行时常量在此镜像）。
 */
export const MUTATION_ASSET_TYPES = [
  'character', 'item', 'location', 'skill', 'faction', 'secret', 'number',
] as const
export type MutationAssetType = (typeof MUTATION_ASSET_TYPES)[number]

/** 单个改动步骤 */
export interface MutationStep {
  /** 计划内唯一 ID，确认卡片逐条勾选时使用 */
  id: string
  op: MutationOp
  /** 面向作者的一句话说明，例如「把林砚的右臂改为断臂」 */
  title: string
  /** 相关实体标识（资产名/角色名/关系两端），用于展示与去重 */
  entityId?: string
  /** 章号（蓝图/属性/流水线步骤使用） */
  chapterNumber?: number
  /** 操作参数，按 op 决定必需键（见 validateMutationPlan） */
  payload: Record<string, unknown>
  risk: MutationRisk
}

/** 一份完整的改动计划 */
export interface MutationPlan {
  id: string
  /** 作者的自然语言意图 */
  intent: string
  steps: MutationStep[]
  /** 涉及实体标识（由 steps 汇总） */
  touchedEntities: string[]
  /** 受影响的章节号（升序去重） */
  affectedChapters: number[]
  risk: MutationRisk
  /** 是否需要用户确认后才执行；写入型计划恒为 true */
  needsConfirm: boolean
  createdAt: string
}

export interface MutationPlanValidation {
  valid: boolean
  errors: string[]
}

/** 每个 op 的必需 payload 键与校验规则 */
function validateStep(step: MutationStep, index: number, errors: string[]): void {
  const at = `steps[${index}]`
  if (!step.title || typeof step.title !== 'string') errors.push(`${at}.title 必须是非空字符串`)
  if (!MUTATION_RISKS.includes(step.risk)) errors.push(`${at}.risk 必须是 low/medium/high`)
  if (!step.payload || typeof step.payload !== 'object' || Array.isArray(step.payload)) {
    errors.push(`${at}.payload 必须是对象`)
    return
  }
  const payload = step.payload
  const needString = (key: string) => {
    if (typeof payload[key] !== 'string' || !(payload[key] as string).trim()) {
      errors.push(`${at}.payload.${key} 必须是非空字符串`)
    }
  }
  const needPositiveInt = (key: string) => {
    if (!Number.isSafeInteger(payload[key]) || (payload[key] as number) < 1) {
      errors.push(`${at}.payload.${key} 必须是正整数`)
    }
  }

  switch (step.op) {
    case 'create_asset':
      if (!MUTATION_ASSET_TYPES.includes(payload.entityType as MutationAssetType)) {
        errors.push(`${at}.payload.entityType 不是合法的资产类型`)
      }
      needString('name')
      break
    case 'update_asset':
      if (!Number.isSafeInteger(payload.id) && typeof payload.name !== 'string') {
        errors.push(`${at}.payload 必须提供 id 或 name`)
      }
      break
    case 'delete_asset':
      needPositiveInt('id')
      break
    case 'update_blueprint':
      if (!Number.isSafeInteger(step.chapterNumber) && !Number.isSafeInteger(payload.chapterNumber)) {
        errors.push(`${at} 必须提供 chapterNumber`)
      }
      break
    case 'update_character':
      if (!Number.isSafeInteger(payload.id) && typeof payload.name !== 'string') {
        errors.push(`${at}.payload 必须提供 id 或 name`)
      }
      break
    case 'update_relation':
      needString('fromId')
      needString('toId')
      needString('relationType')
      if (payload.fromId === payload.toId) errors.push(`${at}.payload 不允许自关系`)
      break
    case 'set_attribute':
      needString('entityId')
      needString('attrKey')
      needPositiveInt('chapterNumber')
      if (payload.value === undefined) errors.push(`${at}.payload.value 不能为空`)
      break
    case 'set_pipeline_stage':
      if (!Number.isSafeInteger(step.chapterNumber) && !Number.isSafeInteger(payload.chapterNumber)) {
        errors.push(`${at} 必须提供 chapterNumber`)
      }
      if (!(CHAPTER_STAGES as readonly string[]).includes(payload.stage as string)) {
        errors.push(`${at}.payload.stage 不是合法的章节阶段`)
      }
      break
    default:
      errors.push(`${at}.op 不受支持`)
  }
}

/** 校验任意输入是否构成合法 MutationPlan */
export function validateMutationPlan(input: unknown): MutationPlanValidation {
  const errors: string[] = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, errors: ['plan 必须是对象'] }
  }
  const plan = input as Partial<MutationPlan>
  if (typeof plan.intent !== 'string' || !plan.intent.trim()) errors.push('intent 必须是非空字符串')
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) {
    errors.push('steps 必须是非空数组')
  } else if (plan.steps.length > 100) {
    errors.push('steps 不能超过 100 条')
  } else {
    const seen = new Set<string>()
    plan.steps.forEach((step, index) => {
      if (!step || typeof step !== 'object') {
        errors.push(`steps[${index}] 必须是对象`)
        return
      }
      if (typeof step.id !== 'string' || !step.id.trim()) errors.push(`steps[${index}].id 必须是非空字符串`)
      else if (seen.has(step.id)) errors.push(`steps[${index}].id 重复：${step.id}`)
      else seen.add(step.id)
      if (!MUTATION_OPS.includes(step.op)) errors.push(`steps[${index}].op 不受支持`)
      else validateStep(step, index, errors)
    })
  }
  if (plan.risk !== undefined && !MUTATION_RISKS.includes(plan.risk)) errors.push('risk 必须是 low/medium/high')
  if (plan.needsConfirm !== undefined && typeof plan.needsConfirm !== 'boolean') errors.push('needsConfirm 必须是布尔值')
  return { valid: errors.length === 0, errors }
}

/** 由步骤推导整体风险 */
export function deriveMutationRisk(steps: MutationStep[]): MutationRisk {
  const chapters = collectAffectedChapters(steps)
  if (steps.some(s => s.op === 'delete_asset')) return 'high'
  if (chapters.length > 3) return 'high'
  if (steps.some(s => s.risk === 'high')) return 'high'
  if (chapters.length > 1) return 'medium'
  if (steps.length > 5) return 'medium'
  if (steps.some(s => s.risk === 'medium')) return 'medium'
  return 'low'
}

/** 汇总受影响章节（升序去重） */
export function collectAffectedChapters(steps: MutationStep[]): number[] {
  const set = new Set<number>()
  for (const step of steps) {
    const fromStep = step.chapterNumber
    const fromPayload = step.payload?.['chapterNumber']
    if (Number.isSafeInteger(fromStep)) set.add(fromStep as number)
    if (Number.isSafeInteger(fromPayload)) set.add(fromPayload as number)
  }
  return Array.from(set).sort((a, b) => a - b)
}

/** 汇总涉及实体（去重，保持出现顺序） */
export function collectTouchedEntities(steps: MutationStep[]): string[] {
  const result: string[] = []
  const seen = new Set<string>()
  const push = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim() || seen.has(value)) return
    seen.add(value)
    result.push(value)
  }
  for (const step of steps) {
    push(step.entityId)
    push(step.payload?.['name'])
    push(step.payload?.['entityId'])
    push(step.payload?.['fromId'])
    push(step.payload?.['toId'])
  }
  return result
}

/**
 * 构建计划：补齐 id / 时间戳 / 汇总字段，并按步骤推导风险。
 * needsConfirm 缺省为 true —— 所有 op 都是写入型。
 */
export function createMutationPlan(input: {
  intent: string
  steps: MutationStep[]
  needsConfirm?: boolean
  id?: string
}): MutationPlan {
  const steps = input.steps.map(step => ({ ...step, risk: step.risk ?? 'low' }))
  return {
    id: input.id ?? `plan_${Date.now().toString(36)}`,
    intent: input.intent,
    steps,
    touchedEntities: collectTouchedEntities(steps),
    affectedChapters: collectAffectedChapters(steps),
    risk: deriveMutationRisk(steps),
    needsConfirm: input.needsConfirm ?? true,
    createdAt: new Date().toISOString(),
  }
}

/** 单步执行结果（确认卡片展示 before → after 用） */
export interface MutationStepResult {
  stepId: string
  op: MutationOp
  status: 'applied' | 'skipped' | 'failed'
  /** 执行前快照；无既有数据时为 null */
  before: unknown
  /** 执行后快照；失败/跳过时为 null */
  after: unknown
  error?: string
}

/** 计划执行选项：确认卡片上被取消勾选的步骤 */
export interface MutationPlanExecutionOptions {
  /** 跳过执行的步骤 ID（用户逐条勾选后未选中的项） */
  skipStepIds?: string[]
}

/** 计划执行结果 */
export interface MutationPlanExecution {
  success: boolean
  /** 是否真正发生写入；失败回滚时为 false */
  applied: boolean
  results: MutationStepResult[]
  failedStepId?: string
  error?: string
  executedAt?: string
}

// ===== 确认卡片的字段级 diff（P2-8） =====

/** 单个字段的前后变化 */
export interface MutationFieldChange {
  field: string
  before: unknown
  after: unknown
}

/** 单步预览：执行前快照 + 字段级变化 */
export interface MutationStepPreview {
  stepId: string
  op: MutationOp
  before: unknown
  changes: MutationFieldChange[]
}

/** 改动计划预览结果 */
export interface MutationPlanPreview {
  success: boolean
  steps: MutationStepPreview[]
  error?: string
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || a === undefined) return b === null || b === undefined
  if (b === null || b === undefined) return false
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return false
}

/** 各 op 的标识字段：比对 diff 时不作为「被改字段」展示 */
const IDENTITY_KEYS: Partial<Record<MutationOp, string[]>> = {
  create_asset: ['id'],
  update_asset: ['id'],
  update_blueprint: ['chapterNumber'],
  update_character: ['id'],
  update_relation: ['fromId', 'toId', 'relationType'],
}

/**
 * 由步骤参数与执行前快照生成字段级 diff。
 * before 为 null（新建/未命中）时，展示 payload 里将写入的值。
 */
export function buildStepChanges(step: MutationStep, before: unknown): MutationFieldChange[] {
  const payload = step.payload ?? {}
  const snapshot = before && typeof before === 'object' ? before as Record<string, unknown> : null
  const changes: MutationFieldChange[] = []

  if (step.op === 'set_attribute') {
    const beforeValue = snapshot ? (snapshot.numValue ?? snapshot.textValue ?? null) : null
    const afterValue = payload.numValue ?? payload.textValue ?? payload.value ?? null
    if (!sameValue(beforeValue, afterValue)) {
      changes.push({ field: String(payload.attrKey ?? 'value'), before: beforeValue, after: afterValue })
    }
    return changes
  }

  if (step.op === 'set_pipeline_stage') {
    const beforeStage = snapshot?.stage ?? null
    if (!sameValue(beforeStage, payload.stage ?? null)) {
      changes.push({ field: 'stage', before: beforeStage, after: payload.stage ?? null })
    }
    return changes
  }

  if (step.op === 'delete_asset') {
    if (!snapshot) return changes
    for (const [field, value] of Object.entries(snapshot)) {
      if (['id', 'createdAt', 'updatedAt', 'typeData'].includes(field)) continue
      if (value === null || value === undefined || value === '' || value === false) continue
      changes.push({ field, before: value, after: null })
    }
    return changes
  }

  const skip = new Set(IDENTITY_KEYS[step.op] ?? ['id'])
  for (const [field, after] of Object.entries(payload)) {
    if (skip.has(field) || after === undefined) continue
    const beforeValue = snapshot ? snapshot[field] ?? null : null
    if (!sameValue(beforeValue, after)) {
      changes.push({ field, before: beforeValue, after })
    }
  }
  return changes
}

/** 章节阶段类型在此再导出，便于执行层与 UI 共用 */
export type { ChapterStage }
