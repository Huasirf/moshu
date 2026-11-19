/**
 * P7-1 端到端链路冒烟（无模型）
 *
 * 用真实 SQLite 串起「章节蓝图 → 草稿 → 去味 → 审稿台账 → 定稿 → P1 写回」，
 * 再关闭并重新打开项目库，验证阶段 / 台账 / 正文状态都能持久保留。
 * 真实模型冒烟需要用户配置 API，另见 docs/dev-plan.md。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initProjectDatabase, closeProjectDatabase } from '../database'
import { BlueprintRepository } from '../repositories/blueprint-repository'
import { DraftRepository } from '../repositories/draft-repository'
import { PipelineRepository } from '../repositories/pipeline-repository'
import { ReviewFindingRepository } from '../repositories/review-finding-repository'
import { executeFinalizeWriteback } from '../services/finalize-writeback'

const BODY = '林砚推开山门，晨雾漫过石阶。他握紧青锋剑，听见远处钟声。'

describe('P7-1 端到端链路冒烟', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moshu-p7-'))
    initProjectDatabase(projectDir)
  })

  afterEach(() => {
    closeProjectDatabase()
    fs.rmSync(projectDir, { recursive: true, force: true })
  })

  it('蓝图→草稿→去味→审稿→定稿→写回，重启后状态保留', () => {
    // 1. 章节卡
    BlueprintRepository.upsert({
      chapterNumber: 1,
      title: '初入山门',
      role: '开篇',
      purpose: '建立主角目标',
      keyEvents: '林砚抵达青云宗',
      characters: ['林砚'],
      suspenseHook: '钟声来自何处',
      userGuidance: '',
      notes: '',
      notesUpdatedAt: '',
      assetRefs: [{ id: 'lin-yan', type: 'character', expect: 'appear' }],
    })

    // 2. 草稿生成
    const draftId = DraftRepository.create({
      chapterNumber: 1,
      version: 1,
      source: 'write',
      content: BODY,
      wordCount: BODY.length,
    })
    PipelineRepository.setStage(1, 'drafted')

    // 3. 去 AI 味
    PipelineRepository.setStage(1, 'deaiified')

    // 4. 审稿 → 台账
    const findingId = ReviewFindingRepository.add({
      chapterNumber: 1,
      draftId: String(draftId),
      stage: 'review',
      category: 'continuity',
      severity: 'warning',
      message: '钟声来源未交代',
      evidence: '听见远处钟声',
      locationHint: '第 1 段',
    })
    PipelineRepository.setStage(1, 'reviewed')

    // 5. 台账修复
    ReviewFindingRepository.updateStatus(findingId, 'fixed')

    // 6. 定稿 + P1 写回
    PipelineRepository.setStage(1, 'approved')
    PipelineRepository.setStage(1, 'finalized')
    DraftRepository.updateStatus(draftId, 'finalized', BODY.length)
    const writeback = executeFinalizeWriteback({ chapterNumber: 1, characterUpdates: [] })
    expect(writeback.stage).toBe('writeback_done')

    // 7. 重启项目库：阶段 / 台账 / 正文 / 资产引用都要还在
    closeProjectDatabase()
    initProjectDatabase(projectDir)

    expect(PipelineRepository.get(1)!.stage).toBe('writeback_done')
    expect(DraftRepository.getLatestByChapter(1)?.status).toBe('finalized')
    expect(DraftRepository.getFull(draftId)?.content).toBe(BODY)
    expect(ReviewFindingRepository.listByChapter(1).find(f => f.id === findingId)?.status).toBe('fixed')
    expect(BlueprintRepository.getByChapter(1)?.assetRefs?.[0]?.id).toBe('lin-yan')
  })
})
