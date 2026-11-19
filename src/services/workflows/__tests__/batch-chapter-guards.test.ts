import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * 批量单章编排列的守卫与隔离行为（不触网、不落库，全部依赖 mock）
 *
 * 覆盖 P0-1/P0-2/P0-3/P0-4：
 * - 单章失败不抛出，记入台账后继续
 * - onChapterError='stop' 时仍向上抛
 * - 正文重复拼接 → 重生成一次；重生成后正常则继续定稿
 * - 字数超过硬上限 → 本章失败且不调定稿
 * - 去AI味抛错 → 保留原稿继续定稿
 */

const invoke = vi.fn()
const guardChapterWriting = vi.fn()
const generateExecute = vi.fn()
const finalizeExecute = vi.fn()
const deaifyExecute = vi.fn()
const holder = vi.hoisted(() => ({ chapterInfo: null as any, finalizeParams: null as any }))

vi.mock('../../ipc-client', () => ({ ipc: { invoke: (...args: unknown[]) => invoke(...args) } }))
vi.mock('../../workflow-guards', () => ({
  guardChapterWriting: (...args: unknown[]) => guardChapterWriting(...args),
}))

vi.mock('../commands/generate-draft.command', () => ({
  GenerateDraftCommand: class {
    constructor(info: unknown, _model?: string, _silent?: boolean) { holder.chapterInfo = info }
    execute(params: any) { return generateExecute(params) }
  },
}))
vi.mock('../commands/finalize-chapter.command', () => ({
  FinalizeChapterCommand: class {
    constructor(params: unknown) { holder.finalizeParams = params as any }
    execute(params: any) { return finalizeExecute(params) }
  },
}))
vi.mock('../commands/deaify.command', () => ({
  DeaifyCommand: class {
    lastRefinedContent?: string
    lastRevisionId?: number
    constructor(_params: unknown) { /* noop */ }
    execute(params: any) { return deaifyExecute(params, this) }
  },
}))
vi.mock('../commands/refresh-blueprint.command', () => ({
  RefreshBlueprintCommand: class {
    result = null
    constructor(_n: number, _m?: string) { /* noop */ }
    execute() { return Promise.resolve() }
  },
}))
// 审稿闭环本用例不启用；留空实现避免意外加载
vi.mock('../commands/auto-review-loop.command', () => ({
  AutoReviewLoopCommand: class {
    result = null
    constructor(_p: unknown) { /* noop */ }
    execute() { return Promise.resolve() }
  },
}))

// batch-chapter 依赖 workflow-errors 的取消判断：沿用真实实现
import { BatchChapterCommand } from '../commands/batch-chapter.command'
import { resetBatchReport, getBatchResults } from '../batch-report'

const ctx = () => ({
  context: { cancelled: false, data: {} as Record<string, unknown> },
  callbacks: {
    log: vi.fn(),
    setProgress: vi.fn(),
    appendText: vi.fn(),
  },
})

const baseBp = {
  chapterNumber: 16,
  title: '测试章',
  role: '',
  purpose: '',
  keyEvents: '',
  characters: [],
  suspenseHook: '',
  userGuidance: '',
  notes: '',
  notesUpdatedAt: '',
  assetRefs: [],
  scenes: [],
  wordsTarget: 2000,
  status: 'planned' as const,
  beatTags: [],
}

/** 造一段 2,300 字左右的正常正文（须稳定高于 2,000 字绝对下限） */
function normalDraft(seed = '他走进盐滩，风把盐粒吹进衣领。'): string {
  return Array.from({ length: 80 }, (_, i) => `${seed}第${i}步，脚下发出细碎的响声。`).join('')
}

function opts(over: Record<string, unknown> = {}) {
  return {
    autoReview: false,
    reviewMaxRounds: 3,
    reviewGate: 'error' as const,
    deaify: false,
    deaifyIntensity: '中' as const,
    onReviewFail: 'continue' as const,
    resume: false,
    rollingBlueprint: false,
    enableScenePlanning: false,
    ...over,
  }
}

beforeEach(() => {
  resetBatchReport(16, 20)
  invoke.mockReset()
  guardChapterWriting.mockReset().mockResolvedValue({ ok: true })
  generateExecute.mockReset()
  finalizeExecute.mockReset().mockResolvedValue('ok')
  deaifyExecute.mockReset()
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'db:draft-get-finalized') return null
    if (channel === 'db:blueprint-get') return baseBp
    if (channel === 'db:draft-next-version') return 2
    if (channel === 'db:draft-create') return { success: true, id: 99 }
    return undefined
  })
})

describe('BatchChapterCommand 单章隔离', () => {
  it('蓝图缺失时记录失败并继续，不向上抛', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:blueprint-get') return null
      return undefined
    })
    const p = ctx()
    const cmd = new BatchChapterCommand(16, opts())
    const result = await cmd.execute(p as never)

    expect(result).toContain('失败')
    expect(result).toContain('蓝图缺失')
    const recorded = getBatchResults()
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ chapter: 16, status: 'failed', stage: '加载蓝图' })
  })

  it('onChapterError=stop 时仍抛出，交给工作流停止', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:blueprint-get') return null
      return undefined
    })
    const cmd = new BatchChapterCommand(16, opts({ onChapterError: 'stop' }))
    await expect(cmd.execute(ctx() as never)).rejects.toThrow('蓝图缺失')
  })

  it('已定稿章节按断点续跑跳过并记入台账', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:draft-get-finalized') return { id: 1 }
      return undefined
    })
    const cmd = new BatchChapterCommand(16, opts({ resume: true }))
    const result = await cmd.execute(ctx() as never)
    expect(result).toContain('跳过')
    expect(getBatchResults()[0]).toMatchObject({ chapter: 16, status: 'skipped' })
  })
})

describe('BatchChapterCommand 场景表', () => {
  it('蓝图已有可用场景表时直接注入写稿，不重复拆解', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'db:blueprint-get') {
        return {
          ...baseBp,
          scenes: [
            { id: 's1', title: '当铺门口', goal: '换钱', words: 1200 },
            { id: 's2', title: '巷口断章', goal: '决定夜探', words: 800 },
          ],
        }
      }
      return undefined
    })
    generateExecute.mockImplementation(async (params: any) => {
      const good = normalDraft()
      params.context.data.draftPath = 'moshu://draft/1'
      params.context.data.draftContent = good
      return good
    })

    const cmd = new BatchChapterCommand(16, opts({ enableScenePlanning: true }))
    await cmd.execute(ctx() as never)

    expect(holder.chapterInfo.scenes).toHaveLength(2)
    expect(holder.chapterInfo.scenes[0].title).toBe('当铺门口')
    expect(generateExecute).toHaveBeenCalledTimes(1)
  })
})

describe('BatchChapterCommand 正文完整性守卫', () => {
  it('重复拼接稿触发重生成，第二次正常则继续定稿', async () => {
    const bad = normalDraft() + normalDraft()
    generateExecute
      .mockImplementationOnce(async (params: any) => {
        params.context.data.draftPath = 'moshu://draft/1'
        params.context.data.draftContent = bad
        return bad
      })
      .mockImplementationOnce(async (params: any) => {
        const good = normalDraft('阿箬把灯递给他，风停了。')
        params.context.data.draftPath = 'moshu://draft/2'
        params.context.data.draftContent = good
        return good
      })

    const cmd = new BatchChapterCommand(16, opts())
    const result = await cmd.execute(ctx() as never)

    expect(generateExecute).toHaveBeenCalledTimes(2)
    expect(result).toContain('已定稿')
    expect(finalizeExecute).toHaveBeenCalledTimes(1)
  })

  it('两次都重复拼接则判本章失败，且不再定稿', async () => {
    const bad = normalDraft() + normalDraft()
    generateExecute.mockImplementation(async (params: any) => {
      params.context.data.draftPath = 'moshu://draft/1'
      params.context.data.draftContent = bad
      return bad
    })

    const cmd = new BatchChapterCommand(16, opts())
    const result = await cmd.execute(ctx() as never)

    expect(generateExecute).toHaveBeenCalledTimes(2)
    expect(result).toContain('失败')
    expect(result).toContain('完整性')
    expect(finalizeExecute).not.toHaveBeenCalled()
  })
})

describe('BatchChapterCommand 字数门禁', () => {
  it('超硬上限直接判失败（不重试）', async () => {
    // 唯一内容的长稿：避免触发「重复拼接」而走入完整性重试分支
    const huge = Array.from({ length: 260 }, (_, i) => `第${i}次潮汐退去，盐壳裂开一道缝，他把碎片收进布袋里编号 ${i}。`).join('')
    generateExecute.mockImplementation(async (params: any) => {
      params.context.data.draftPath = 'moshu://draft/1'
      params.context.data.draftContent = huge
      return huge
    })

    const cmd = new BatchChapterCommand(16, opts())
    const result = await cmd.execute(ctx() as never)

    expect(generateExecute).toHaveBeenCalledTimes(1)
    expect(result).toContain('失败')
    expect(finalizeExecute).not.toHaveBeenCalled()
    expect(getBatchResults()[0].status).toBe('failed')
  })

  it('过短时重生成一次', async () => {
    generateExecute
      .mockImplementationOnce(async (params: any) => {
        params.context.data.draftPath = 'moshu://draft/1'
        params.context.data.draftContent = '太短了。'
        return '太短了。'
      })
      .mockImplementationOnce(async (params: any) => {
        const good = normalDraft()
        params.context.data.draftPath = 'moshu://draft/2'
        params.context.data.draftContent = good
        return good
      })

    const cmd = new BatchChapterCommand(16, opts())
    await cmd.execute(ctx() as never)
    expect(generateExecute).toHaveBeenCalledTimes(2)
    expect(finalizeExecute).toHaveBeenCalledTimes(1)
  })
})

describe('BatchChapterCommand 定稿豁免策略', () => {
  const setupGeneration = () => {
    generateExecute.mockImplementation(async (params: any) => {
      const good = normalDraft()
      params.context.data.draftPath = 'moshu://draft/1'
      params.context.data.draftContent = good
      return good
    })
  }

  it('带问题继续 = 显式豁免 warning 级问题', async () => {
    setupGeneration()
    const cmd = new BatchChapterCommand(16, opts({ onChapterError: 'continue' }))
    await cmd.execute(ctx() as never)
    expect(holder.finalizeParams?.acceptWarnings).toBe(true)
  })

  it('遇到问题即停 = 不豁免，保持阻断', async () => {
    setupGeneration()
    const cmd = new BatchChapterCommand(16, opts({ onChapterError: 'stop' }))
    await cmd.execute(ctx() as never)
    expect(holder.finalizeParams?.acceptWarnings).toBe(false)
  })
})

describe('BatchChapterCommand 去AI味降级', () => {
  it('去AI味抛错时保留原稿继续定稿，并标注未去味', async () => {
    generateExecute.mockImplementation(async (params: any) => {
      const good = normalDraft()
      params.context.data.draftPath = 'moshu://draft/1'
      params.context.data.draftContent = good
      return good
    })
    deaifyExecute.mockRejectedValue(new Error('502 bad gateway'))

    const cmd = new BatchChapterCommand(16, opts({ deaify: true }))
    const result = await cmd.execute(ctx() as never)

    expect(finalizeExecute).toHaveBeenCalledTimes(1)
    expect(result).toContain('已定稿')
    expect(getBatchResults()[0]).toMatchObject({ chapter: 16, status: 'warn', deaified: false })
    expect(getBatchResults()[0].message).toContain('未去味')
  })
})
