/**
 * P2.5-2：apply_mutation_plan 的 skipStepIds 透传回归。
 *
 * 确认卡片把用户未勾选的步骤 ID 写回 tool 参数，工具层必须原样
 * 转给主进程 `db:mutation-plan-execute`，否则「取消的步骤」仍会落库。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ipc } from '../../ipc-client'
import { applyMutationPlanTool } from '../tools/apply-mutation-plan.tool'

vi.mock('../../ipc-client', () => ({ ipc: { invoke: vi.fn(), on: vi.fn() } }))

const plan = {
  id: 'plan_test',
  intent: '把第 3 章主角改成断臂',
  steps: [
    {
      id: 's1',
      op: 'update_character',
      title: '林砚右臂改为断臂',
      entityId: '林砚',
      payload: { name: '林砚', physicalState: '右臂已断' },
      risk: 'low',
    },
    {
      id: 's2',
      op: 'set_pipeline_stage',
      title: '第 3 章推进到已审稿',
      chapterNumber: 3,
      payload: { chapterNumber: 3, stage: 'reviewed' },
      risk: 'low',
    },
  ],
  touchedEntities: ['林砚'],
  affectedChapters: [3],
  risk: 'low',
  needsConfirm: true,
  createdAt: '2026-10-21T00:00:00.000Z',
}

function mockExecute(overrides: Record<string, unknown> = {}) {
  vi.mocked(ipc.invoke).mockResolvedValue({
    success: true,
    applied: true,
    results: [
      { stepId: 's1', op: 'update_character', status: 'applied', before: null, after: null },
      { stepId: 's2', op: 'set_pipeline_stage', status: 'skipped', before: null, after: null },
    ],
    ...overrides,
  } as never)
}

afterEach(() => vi.clearAllMocks())

describe('apply_mutation_plan 工具', () => {
  it('把确认卡片取消的步骤 ID 原样透传给执行层', async () => {
    mockExecute()
    const result = await applyMutationPlanTool.execute({ plan, skipStepIds: ['s2'] })

    expect(result.success).toBe(true)
    expect(ipc.invoke).toHaveBeenCalledWith('db:mutation-plan-execute', plan, { skipStepIds: ['s2'] })
    expect(result.content).toContain('1')
  })

  it('过滤非字符串与空串，不把脏值传给执行层', async () => {
    mockExecute()
    await applyMutationPlanTool.execute({ plan, skipStepIds: ['s2', '', 42, null, 's1'] })

    expect(ipc.invoke).toHaveBeenCalledWith('db:mutation-plan-execute', plan, { skipStepIds: ['s2', 's1'] })
  })

  it('未提供 skipStepIds 时传 undefined（保持旧调用行为）', async () => {
    mockExecute()
    await applyMutationPlanTool.execute({ plan })

    expect(ipc.invoke).toHaveBeenCalledWith('db:mutation-plan-execute', plan, { skipStepIds: undefined })
  })

  it('计划非法时不发起执行调用', async () => {
    const result = await applyMutationPlanTool.execute({ plan: { intent: '', steps: [] } })

    expect(result.success).toBe(false)
    expect(ipc.invoke).not.toHaveBeenCalled()
  })

  it('执行层回滚时把失败步骤反馈给模型', async () => {
    mockExecute({
      success: false,
      applied: false,
      error: 'boom',
      results: [
        { stepId: 's1', op: 'update_character', status: 'failed', before: null, after: null, error: 'FAILED' },
      ],
    })
    const result = await applyMutationPlanTool.execute({ plan })

    expect(result.success).toBe(false)
    expect(result.error).toContain('s1')
  })
})
