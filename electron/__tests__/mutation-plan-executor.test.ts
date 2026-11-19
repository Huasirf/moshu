import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initProjectDatabase, closeProjectDatabase } from '../database'
import { executeMutationPlan, previewMutationPlan } from '../services/mutation-plan-executor'
import { createMutationPlan, type MutationStep } from '../../src/shared/mutation-plan'
import { AssetRepository } from '../repositories/asset-repository'
import { PipelineRepository } from '../repositories/pipeline-repository'
import { AttributeRepository } from '../repositories/attribute-repository'
import { BlueprintRepository } from '../repositories/blueprint-repository'

function step(overrides: Partial<MutationStep> & Pick<MutationStep, 'id' | 'op' | 'payload'>): MutationStep {
  return {
    title: '测试步骤',
    risk: 'low',
    ...overrides,
  }
}

function plan(steps: MutationStep[]) {
  return createMutationPlan({ intent: '测试改动', steps })
}

describe('MutationPlan 执行层', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moshu-plan-'))
    initProjectDatabase(projectDir)
  })

  afterEach(() => {
    closeProjectDatabase()
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  it('多步计划在一个事务内执行，并返回 before/after', () => {
    const result = executeMutationPlan(plan([
      step({
        id: 's1',
        op: 'create_asset',
        payload: { entityType: 'item', name: '玄铁令', summary: '信物' },
      }),
      step({
        id: 's2',
        op: 'set_attribute',
        chapterNumber: 3,
        payload: { entityId: '林轩', attrKey: 'constitution', chapterNumber: 3, value: 12 },
      }),
      step({
        id: 's3',
        op: 'set_pipeline_stage',
        chapterNumber: 3,
        payload: { chapterNumber: 3, stage: 'drafted' },
      }),
      step({
        id: 's4',
        op: 'update_blueprint',
        chapterNumber: 3,
        payload: { title: '第三章（改）', keyEvents: '夺令' },
      }),
    ]))

    expect(result.success).toBe(true)
    expect(result.applied).toBe(true)
    expect(result.results.map((r) => r.status)).toEqual(['applied', 'applied', 'applied', 'applied'])

    expect(AssetRepository.getByName('item', '玄铁令')).not.toBeNull()
    expect(AttributeRepository.getValueAt('林轩', 'constitution', 3)!.numValue).toBe(12)
    expect(PipelineRepository.get(3)!.stage).toBe('drafted')
    expect(BlueprintRepository.getByChapter(3)!.title).toBe('第三章（改）')

    const assetResult = result.results[0]
    expect(assetResult.before).toBeNull()
    expect((assetResult.after as { name: string }).name).toBe('玄铁令')
  })

  it('任一步骤失败时整体回滚，数据库零改动', () => {
    const result = executeMutationPlan(plan([
      step({
        id: 's1',
        op: 'create_asset',
        payload: { entityType: 'item', name: '临时道具' },
      }),
      step({
        id: 's2',
        op: 'update_asset',
        payload: { id: 999999, summary: '不存在' },
      }),
    ]))

    expect(result.success).toBe(false)
    expect(result.applied).toBe(false)
    expect(result.failedStepId).toBe('s2')
    expect(result.error).toMatch(/ASSET_NOT_FOUND/)
    expect(AssetRepository.getByName('item', '临时道具')).toBeNull()
  })

  it('跳过未勾选的步骤，其余步骤照常执行', () => {
    const result = executeMutationPlan(
      plan([
        step({ id: 's1', op: 'create_asset', payload: { entityType: 'location', name: '青云宗' } }),
        step({ id: 's2', op: 'set_pipeline_stage', chapterNumber: 1, payload: { chapterNumber: 1, stage: 'planned' } }),
      ]),
      { skipStepIds: ['s2'] },
    )

    expect(result.success).toBe(true)
    expect(result.results.map((r) => r.status)).toEqual(['applied', 'skipped'])
    expect(PipelineRepository.get(1)).toBeNull()
  })

  it('下游蓝图可标记为 stale，且只改状态', () => {
    BlueprintRepository.upsert({
      chapterNumber: 4,
      title: '第四章',
      role: '发展',
      purpose: '推进',
      keyEvents: '赶路',
      characters: [],
      suspenseHook: '',
      userGuidance: '保留用户微操',
      notes: '保留要点',
      notesUpdatedAt: '2026-01-01',
    })

    expect(BlueprintRepository.markStale([4, 4, 0, -1])).toBe(1)
    const saved = BlueprintRepository.getByChapter(4)!
    expect(saved.status).toBe('stale')
    expect(saved.userGuidance).toBe('保留用户微操')
    expect(saved.notes).toBe('保留要点')
  })

  it('预览返回执行前快照与字段 diff，且不写库', () => {
    BlueprintRepository.upsert({
      chapterNumber: 2,
      title: '第二章',
      role: '发展',
      purpose: '推进',
      keyEvents: '旧事件',
      characters: [],
      suspenseHook: '',
      userGuidance: '',
      notes: '',
      notesUpdatedAt: '',
    })

    const preview = previewMutationPlan(plan([
      step({
        id: 's1',
        op: 'update_blueprint',
        chapterNumber: 2,
        payload: { keyEvents: '新事件' },
      }),
    ]))

    expect(preview.success).toBe(true)
    expect(preview.steps[0].changes).toEqual([{ field: 'keyEvents', before: '旧事件', after: '新事件' }])
    expect(BlueprintRepository.getByChapter(2)!.keyEvents).toBe('旧事件')
  })

  it('流水线跳级步骤失败时整单回滚，阶段保持不变', () => {
    PipelineRepository.setStage(2, 'drafted')

    const result = executeMutationPlan(plan([
      step({ id: 's1', op: 'create_asset', payload: { entityType: 'item', name: '越级令' } }),
      step({
        id: 's2',
        op: 'set_pipeline_stage',
        chapterNumber: 2,
        payload: { chapterNumber: 2, stage: 'reviewed' },
      }),
    ]))

    expect(result.success).toBe(false)
    expect(result.failedStepId).toBe('s2')
    expect(result.error).toMatch(/INVALID_STAGE_TRANSITION/)
    expect(AssetRepository.getByName('item', '越级令')).toBeNull()
    expect(PipelineRepository.get(2)!.stage).toBe('drafted')
  })

  it('非法计划不进入事务', () => {
    const result = executeMutationPlan({ intent: '', steps: [] })
    expect(result.success).toBe(false)
    expect(result.applied).toBe(false)
    expect(result.results).toEqual([])
    expect(result.error).toBeTruthy()
  })
})
