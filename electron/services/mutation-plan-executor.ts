/**
 * MutationPlan 执行层（P2-2，主进程）
 *
 * 把结构化改动计划映射为 Repository 写入，并在**单个数据库事务**内完成：
 * 任一步骤抛错 → 整个事务回滚，数据库保持执行前状态。
 * 每步返回 before / after 快照，供确认卡片展示 diff。
 *
 * 为什么放在主进程：better-sqlite3 只在主进程可用，渲染进程无法开事务；
 * 渲染层只能 type-only 引用 Repository 类型。
 */
import { getProjectDb } from '../database'
import {
  buildStepChanges,
  validateMutationPlan,
  type MutationPlan,
  type MutationPlanExecution,
  type MutationPlanExecutionOptions,
  type MutationPlanPreview,
  type MutationStep,
  type MutationStepResult,
  type ChapterStage,
} from '../../src/shared/mutation-plan'
import {
  AssetRepository,
  type AssetData,
  type AssetEntityType,
  type AssetInput,
} from '../repositories/asset-repository'
import {
  CharacterRepository,
  type CharacterData,
  type CharacterStateData,
} from '../repositories/character-repository'
import { RelationRepository, type EntityRelation, type EntityRelationInput } from '../repositories/relation-repository'
import { AttributeRepository, type AttributePhase, type AttributeValueInput } from '../repositories/attribute-repository'
import { PipelineRepository } from '../repositories/pipeline-repository'
import { BlueprintRepository, type BlueprintData } from '../repositories/blueprint-repository'

type Payload = Record<string, unknown>

function str(payload: Payload, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function num(payload: Payload, key: string): number | undefined {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function chapterOf(step: MutationStep): number {
  const fromStep = step.chapterNumber
  if (typeof fromStep === 'number' && Number.isSafeInteger(fromStep) && fromStep > 0) return fromStep
  const fromPayload = num(step.payload, 'chapterNumber')
  if (typeof fromPayload === 'number' && Number.isSafeInteger(fromPayload) && fromPayload > 0) return fromPayload
  throw new Error('INVALID_CHAPTER_NUMBER')
}

/** 资产写入参数：payload 优先，缺省回落到既有数据（更新时不丢字段） */
function assetInputFrom(payload: Payload, base?: AssetData | null): AssetInput {
  const input: AssetInput = {
    entityType: (str(payload, 'entityType') as AssetEntityType | undefined) ?? base?.entityType ?? 'item',
    name: str(payload, 'name') ?? base?.name ?? '',
    summary: str(payload, 'summary') ?? base?.summary,
    description: str(payload, 'description') ?? base?.description,
    status: (str(payload, 'status') as AssetInput['status']) ?? base?.status,
    firstChapter: num(payload, 'firstChapter') ?? base?.firstChapter,
    lastChapter: num(payload, 'lastChapter') ?? base?.lastChapter,
    tags: Array.isArray(payload.tags) ? (payload.tags as string[]) : base?.tags,
    typeData: (payload.typeData as Record<string, unknown> | undefined) ?? base?.typeData,
  }
  if (base) input.id = base.id
  return input
}

function mergeBlueprint(base: BlueprintData | null, payload: Payload, chapterNumber: number): BlueprintData {
  const characters = Array.isArray(payload.characters)
    ? (payload.characters as unknown[]).filter((n): n is string => typeof n === 'string')
    : undefined
  const beatTags = Array.isArray(payload.beatTags)
    ? (payload.beatTags as unknown[]).filter((n): n is string => typeof n === 'string')
    : undefined
  const notes = str(payload, 'notes')
  const data: BlueprintData = {
    chapterNumber,
    title: str(payload, 'title') ?? base?.title ?? `第 ${chapterNumber} 章`,
    role: str(payload, 'role') ?? base?.role ?? '',
    purpose: str(payload, 'purpose') ?? base?.purpose ?? '',
    keyEvents: str(payload, 'keyEvents') ?? base?.keyEvents ?? '',
    characters: characters ?? base?.characters ?? [],
    suspenseHook: str(payload, 'suspenseHook') ?? base?.suspenseHook ?? '',
    userGuidance: str(payload, 'userGuidance') ?? base?.userGuidance ?? '',
    notes: notes ?? base?.notes ?? '',
    notesUpdatedAt: notes !== undefined ? new Date().toISOString() : base?.notesUpdatedAt ?? '',
    assetRefs: Array.isArray(payload.assetRefs)
      ? (payload.assetRefs as BlueprintData['assetRefs'])
      : base?.assetRefs,
    scenes: Array.isArray(payload.scenes) ? (payload.scenes as BlueprintData['scenes']) : base?.scenes,
    wordsTarget: num(payload, 'wordsTarget') ?? base?.wordsTarget,
    status: (str(payload, 'status') as ChapterStage | undefined) ?? base?.status,
    beatTags: beatTags ?? base?.beatTags,
  }
  return data
}

function mergeCharacterState(base: CharacterStateData | undefined, raw: unknown): CharacterStateData | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base
  const patch = raw as Payload
  const fallback: CharacterStateData = base ?? {
    location: '',
    powerLevel: '',
    physicalState: '',
    mentalState: '',
    keyItems: '',
    recentEvents: '',
    updatedAtChapter: 0,
  }
  return {
    location: str(patch, 'location') ?? fallback.location,
    powerLevel: str(patch, 'powerLevel') ?? fallback.powerLevel,
    physicalState: str(patch, 'physicalState') ?? fallback.physicalState,
    mentalState: str(patch, 'mentalState') ?? fallback.mentalState,
    keyItems: str(patch, 'keyItems') ?? fallback.keyItems,
    recentEvents: str(patch, 'recentEvents') ?? fallback.recentEvents,
    knownInfo: str(patch, 'knownInfo') ?? fallback.knownInfo,
    updatedAtChapter: num(patch, 'updatedAtChapter') ?? fallback.updatedAtChapter,
  }
}

function mergeCharacter(base: CharacterData, payload: Payload): CharacterData {
  return {
    name: base.name,
    role: str(payload, 'role') ?? base.role,
    gender: str(payload, 'gender') ?? base.gender,
    age: str(payload, 'age') ?? base.age,
    appearance: str(payload, 'appearance') ?? base.appearance,
    personality: str(payload, 'personality') ?? base.personality,
    background: str(payload, 'background') ?? base.background,
    abilities: str(payload, 'abilities') ?? base.abilities,
    motivation: str(payload, 'motivation') ?? base.motivation,
    relationships: str(payload, 'relationships') ?? base.relationships,
    arc: str(payload, 'arc') ?? base.arc,
    notes: str(payload, 'notes') ?? base.notes,
    speechStyle: str(payload, 'speechStyle') ?? base.speechStyle,
    imagePrompt: str(payload, 'imagePrompt') ?? base.imagePrompt,
    portraitPath: base.portraitPath,
    currentState: mergeCharacterState(base.currentState, payload.currentState),
  }
}

/**
 * 只读解析步骤执行前的快照。预览（P2-8 确认卡片）与执行共用，
 * 保证「卡片上展示的前值」就是执行时用于 diff 的前值。
 */
function readBefore(step: MutationStep): unknown {
  const payload = step.payload ?? {}
  switch (step.op) {
    case 'create_asset': {
      const input = assetInputFrom(payload)
      return AssetRepository.getByName(input.entityType, input.name)
    }
    case 'update_asset': {
      const byId = num(payload, 'id')
      if (byId !== undefined) return AssetRepository.getById(byId)
      const entityType = str(payload, 'entityType')
      const name = str(payload, 'name')
      return entityType && name
        ? AssetRepository.getByName(entityType as AssetEntityType, name)
        : null
    }
    case 'delete_asset': {
      const id = num(payload, 'id')
      return id === undefined ? null : AssetRepository.getById(id)
    }
    case 'update_blueprint':
      return BlueprintRepository.getByChapter(chapterOf(step))
    case 'update_character': {
      const name = str(payload, 'name') ?? str(payload, 'id')
      return name ? CharacterRepository.getByName(name) : null
    }
    case 'update_relation':
      return RelationRepository.get(
        str(payload, 'fromId') as string,
        str(payload, 'toId') as string,
        str(payload, 'relationType') as string,
      )
    case 'set_attribute': {
      const phase: AttributePhase = str(payload, 'phase') === 'before' ? 'before' : 'after'
      return AttributeRepository.getValueAt(
        str(payload, 'entityId') as string,
        str(payload, 'attrKey') as string,
        chapterOf(step),
        phase,
      )
    }
    case 'set_pipeline_stage':
      return PipelineRepository.get(chapterOf(step))
    default:
      return null
  }
}

/** 执行单个步骤；抛错时由外层事务回滚 */
function applyStep(step: MutationStep): { before: unknown; after: unknown } {
  const payload = step.payload ?? {}
  const before = readBefore(step)

  switch (step.op) {
    case 'create_asset': {
      const id = AssetRepository.upsert(assetInputFrom(payload))
      return { before, after: AssetRepository.getById(id) }
    }
    case 'update_asset': {
      if (!before) throw new Error('ASSET_NOT_FOUND')
      const id = AssetRepository.upsert(assetInputFrom(payload, before as AssetData))
      return { before, after: AssetRepository.getById(id) }
    }
    case 'delete_asset': {
      const id = num(payload, 'id')
      if (id === undefined) throw new Error('INVALID_ASSET_ID')
      if (!before) throw new Error('ASSET_NOT_FOUND')
      AssetRepository.delete(id)
      return { before, after: null }
    }
    case 'update_blueprint': {
      const chapterNumber = chapterOf(step)
      BlueprintRepository.upsert(mergeBlueprint(before as BlueprintData | null, payload, chapterNumber))
      return { before, after: BlueprintRepository.getByChapter(chapterNumber) }
    }
    case 'update_character': {
      const name = str(payload, 'name') ?? str(payload, 'id')
      if (!name) throw new Error('INVALID_CHARACTER_TARGET')
      if (!before) throw new Error('CHARACTER_NOT_FOUND')
      CharacterRepository.upsert(mergeCharacter(before as CharacterData, payload))
      return { before, after: CharacterRepository.getByName(name) }
    }
    case 'update_relation': {
      const key = {
        fromId: str(payload, 'fromId') as string,
        toId: str(payload, 'toId') as string,
        relationType: str(payload, 'relationType') as string,
      }
      const base = before as EntityRelation | null
      const input: EntityRelationInput = {
        ...key,
        affection: num(payload, 'affection') ?? base?.affection,
        status: (str(payload, 'status') as EntityRelationInput['status']) ?? base?.status,
        sinceChapter: num(payload, 'sinceChapter') ?? base?.sinceChapter,
        lastChangedChapter: num(payload, 'lastChangedChapter') ?? base?.lastChangedChapter,
        note: str(payload, 'note') ?? base?.note,
      }
      RelationRepository.upsert(input)
      return { before, after: RelationRepository.get(key.fromId, key.toId, key.relationType) }
    }
    case 'set_attribute': {
      const chapterNumber = chapterOf(step)
      const entityId = str(payload, 'entityId') as string
      const attrKey = str(payload, 'attrKey') as string
      const phase: AttributePhase = str(payload, 'phase') === 'before' ? 'before' : 'after'
      const rawValue = payload.value
      const numValue = num(payload, 'numValue')
        ?? (typeof rawValue === 'number' && Number.isFinite(rawValue) ? rawValue : null)
      const textValue = str(payload, 'textValue')
        ?? (typeof rawValue === 'string' ? rawValue : null)
      const input: AttributeValueInput = {
        entityId,
        attrKey,
        chapterNumber,
        phase,
        numValue,
        textValue,
        source: str(payload, 'source') ?? 'agent',
        sourceEventId: num(payload, 'sourceEventId') ?? null,
      }
      return { before, after: AttributeRepository.setValue(input) }
    }
    case 'set_pipeline_stage': {
      const chapterNumber = chapterOf(step)
      const stage = str(payload, 'stage') as ChapterStage
      return { before, after: PipelineRepository.setStage(chapterNumber, stage) }
    }
    default:
      throw new Error(`UNSUPPORTED_OP:${String(step.op)}`)
  }
}

/**
 * 只读预览计划：返回每步执行前快照与字段级 diff，不写库。
 * 供确认卡片在作者勾选前展示「前值 → 后值」。
 */
export function previewMutationPlan(rawPlan: unknown): MutationPlanPreview {
  const validation = validateMutationPlan(rawPlan)
  if (!validation.valid) {
    return { success: false, steps: [], error: validation.errors.join('；') }
  }
  if (!getProjectDb()) return { success: false, steps: [], error: 'PROJECT_CLOSED' }

  const plan = rawPlan as MutationPlan
  const steps = plan.steps.map((step) => {
    let before: unknown = null
    try {
      before = readBefore(step)
    } catch {
      before = null
    }
    return {
      stepId: step.id,
      op: step.op,
      before,
      changes: buildStepChanges(step, before),
    }
  })
  return { success: true, steps }
}

/**
 * 执行改动计划。校验不通过或执行失败时 applied 恒为 false。
 * 失败时 results 保留已执行步骤的 before/after（但事务已回滚，库中未生效）。
 */
export function executeMutationPlan(
  rawPlan: unknown,
  options: MutationPlanExecutionOptions = {},
): MutationPlanExecution {
  const validation = validateMutationPlan(rawPlan)
  if (!validation.valid) {
    return { success: false, applied: false, results: [], error: validation.errors.join('；') }
  }
  const plan = rawPlan as MutationPlan
  const db = getProjectDb()
  if (!db) return { success: false, applied: false, results: [], error: 'PROJECT_CLOSED' }

  const skip = new Set(
    (options.skipStepIds ?? []).filter((id): id is string => typeof id === 'string' && id.length > 0),
  )
  const results: MutationStepResult[] = []

  try {
    db.transaction(() => {
      for (const step of plan.steps) {
        if (skip.has(step.id)) {
          results.push({ stepId: step.id, op: step.op, status: 'skipped', before: null, after: null })
          continue
        }
        try {
          const { before, after } = applyStep(step)
          results.push({ stepId: step.id, op: step.op, status: 'applied', before, after })
        } catch (error) {
          results.push({
            stepId: step.id,
            op: step.op,
            status: 'failed',
            before: null,
            after: null,
            error: errorText(error),
          })
          throw error
        }
      }
    })()
  } catch (error) {
    const failed = results.find((item) => item.status === 'failed')
    return {
      success: false,
      applied: false,
      results,
      failedStepId: failed?.stepId,
      error: errorText(error),
    }
  }

  return {
    success: true,
    applied: results.some((item) => item.status === 'applied'),
    results,
    executedAt: new Date().toISOString(),
  }
}
