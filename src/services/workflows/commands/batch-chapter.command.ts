import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { ipc } from '../../ipc-client'
import { guardChapterWriting } from '../../workflow-guards'
import { isWorkflowCancelled, throwIfCancelled } from '../workflow-errors'
import type { ChapterInfo } from '../chapter-workflow'
import type { BlueprintData } from '../../../../electron/repositories/blueprint-repository'
import { useProjectStore } from '../../../stores/project-store'
import { checkDraftIntegrity, countDraftWords } from '../../text-integrity'
import {
  describeWordGate,
  isImportantChapter,
  judgeWordCount,
  resolveChapterWordTarget,
  resolveWordTiers,
  type WordTier,
} from '../../word-count-gate'
import { toChapterScenes } from '../../blueprint-scenes'
import { recordBatchResult } from '../batch-report'

/**
 * 批量无人值守管线 —— 单章子管线编排（设计文档 #3）
 *
 * 对单章顺序执行：前置校验 → 写稿 →（可选）审校闭环 →（可选）去AI味 → 定稿(含后处理)。
 * 全程复用现有 Command，不重写生成/审稿/定稿逻辑。
 * 由 createBatchGenerateWorkflow 为每章生成一个 step 来驱动。
 *
 * P0 稳定性守卫：
 * - 写稿/审稿/去味三个产出点都校验正文完整性（重复拼接、整段重复、截断）；
 * - 字数分档门禁：过短/超长重生成一次，仍不合档则失败或人工放行；
 * - 单章失败默认不中断整批，结果记入 batch-report 台账并在批次末尾汇总；
 * - 去AI味失败降级为「保留原稿继续定稿」。
 */

export interface BatchOptions {
  /** 是否插入自动审校闭环（质量门） */
  autoReview: boolean
  /** 审校闭环最多轮数（含终审；实际修复次数 = 轮数 - 1） */
  reviewMaxRounds: number
  /** 审校门控：error（默认）| error+warning */
  reviewGate: 'error' | 'error+warning'
  /** 审稿维度侧重点（可选） */
  reviewFocus?: string
  /** 是否插入去AI味 */
  deaify: boolean
  /** 去AI味强度 */
  deaifyIntensity: '轻' | '中' | '重'
  /** 审校未通过时的策略：stop=停止批量；continue=带问题继续定稿 */
  onReviewFail: 'stop' | 'continue'
  /** 断点续跑：跳过已定稿章节 */
  resume: boolean
  /**
   * 滚动蓝图：写稿前依据已定稿正文/角色状态/伏笔自适应刷新本章蓝图。
   * 关闭时沿用开写前规划的静态蓝图（长篇连写会逐章累积偏差）。
   */
  rollingBlueprint?: boolean
  /** 按任务派模型（为空走默认模型）：蓝图刷新/写稿/审校/去AI味 */
  models?: { blueprint?: string; write?: string; review?: string; deaify?: string }
  /** 正文完整性守卫（默认开启） */
  enableIntegrityGuard?: boolean
  /** 字数分档门禁（默认开启） */
  enableWordGate?: boolean
  /** 写稿前场景拆解（默认开启；关闭后只用 keyEvents 写稿） */
  enableScenePlanning?: boolean
  /** 单章失败时的策略：continue（默认，记录后继续下一章）| stop */
  onChapterError?: 'continue' | 'stop'
  /** 重写后仍落在 LONG_HARD 档时的策略：regenerate（默认，判本章失败）| confirm（人工确认放行） */
  onLongHard?: 'regenerate' | 'confirm'
  /** 定稿时是否显式豁免 warning 级审稿问题；默认跟随 onChapterError（带问题继续=豁免） */
  acceptWarnings?: boolean
}

interface DraftOutcome {
  draftPath: string
  draftContent: string
  /** 字数档位（门禁关闭时为 PASS） */
  tier: WordTier
  /** 需要人工留意的说明（偏长/带残留问题） */
  note: string
}

export class BatchChapterCommand extends BaseWorkflowCommand<string> {
  /** 当前所处阶段，用于失败时定位（准备/刷新蓝图/写稿/审稿/去AI味/定稿） */
  private stage = '准备'

  constructor(
    private chapterNumber: number,
    private opts: BatchOptions,
  ) {
    super()
  }

  async execute(execParams: CommandExecuteParams): Promise<string> {
    const { callbacks, context } = execParams
    const n = this.chapterNumber
    try {
      return await this.runChapter(execParams)
    } catch (e) {
      if (isWorkflowCancelled(e) || context.cancelled) throw e
      const message = e instanceof Error ? e.message : String(e)
      recordBatchResult({ chapter: n, status: 'failed', stage: this.stage, message })
      callbacks.log(`❌ 第${n}章失败（${this.stage}）：${message}`)
      if (this.opts.onChapterError === 'stop') throw e
      callbacks.log('   ↪ 按策略「继续」跳过本章，进入下一章')
      return `第${n}章：失败（${this.stage}｜${message}）`
    }
  }

  private async runChapter(execParams: CommandExecuteParams): Promise<string> {
    const { callbacks, context } = execParams
    const n = this.chapterNumber
    const ensureNotCancelled = () => throwIfCancelled(context)

    ensureNotCancelled()

    // 0. 断点续跑：已定稿则跳过
    if (this.opts.resume) {
      const finalized = await ipc.invoke('db:draft-get-finalized', n)
      if (finalized) {
        callbacks.log(`⏭ 第${n}章已定稿，跳过`)
        recordBatchResult({ chapter: n, status: 'skipped', message: '已定稿' })
        return `第${n}章：跳过（已定稿）`
      }
    }

    // 1. 前置校验（复用护栏：前一章须已定稿且后处理通过，保证上下文不断裂）
    this.stage = '前置校验'
    const guard = await guardChapterWriting(n)
    if (!guard.ok) throw new Error(`第${n}章前置校验失败：${guard.message ?? '未知原因'}`)

    // 2. 加载蓝图 → ChapterInfo
    this.stage = '加载蓝图'
    const bp: BlueprintData | null = await ipc.invoke('db:blueprint-get', n)
    if (!bp) throw new Error(`第${n}章蓝图缺失，请先生成章节蓝图`)
    let chapterInfo: ChapterInfo = {
      chapterNumber: n,
      title: bp.title || `第${n}章`,
      role: bp.role || '',
      purpose: bp.purpose || '',
      characters: Array.isArray(bp.characters) ? bp.characters : [],
      keyEvents: bp.keyEvents || '',
      suspenseHook: bp.suspenseHook || undefined,
      userGuidance: bp.userGuidance || undefined,
      wordsTarget: bp.wordsTarget || undefined,
      scenes: toChapterScenes(bp.scenes),
    }

    // 2.5 滚动蓝图：按已写出来的实际剧情修正本章蓝图（主线定位锚定不变）
    //     蓝图是开写前一次性规划的，长篇连写若照旧图硬写会逐章累积偏差。
    //     刷新失败会在命令内部降级为沿用原蓝图，不阻断批量。
    let blueprintChanged = false
    if (this.opts.rollingBlueprint !== false) {
      ensureNotCancelled()
      this.stage = '刷新蓝图'
      const { RefreshBlueprintCommand } = await import('./refresh-blueprint.command')
      const refresh = new RefreshBlueprintCommand(n, this.opts.models?.blueprint)
      await refresh.execute(execParams)
      if (refresh.result) {
        chapterInfo = { ...refresh.result.chapterInfo, wordsTarget: bp.wordsTarget || undefined }
        blueprintChanged = refresh.result.changed
      }
    }

    // 2.6 场景拆解：把本章拆成「按场推进 + 每场字数预算」，写稿时按预算分配篇幅
    //     蓝图被刷新过、场景缺失、或预算与目标字数偏差过大时重新拆解；失败降级为仅 keyEvents
    if (this.opts.enableScenePlanning !== false) {
      ensureNotCancelled()
      this.stage = '场景拆解'
      chapterInfo = await this.ensureScenePlan(execParams, chapterInfo, bp, blueprintChanged)
    }

    // 3. 写稿（含完整性守卫 + 字数分档门禁；不合规时同 prompt 重生成一次）
    ensureNotCancelled()
    callbacks.log(`\n📝 第${n}章「${chapterInfo.title}」写稿...`)
    const outcome = await this.generateWithGuards(execParams, chapterInfo)
    let draftPath = outcome.draftPath
    let draftContent = outcome.draftContent
    let tier = outcome.tier
    const notes: string[] = outcome.note ? [outcome.note] : []

    // 4. 审校闭环（质量门）
    let reviewPassed = true
    let reviewRounds: number | undefined
    if (this.opts.autoReview) {
      ensureNotCancelled()
      this.stage = '审稿'
      callbacks.log(`🔁 第${n}章审校闭环...`)
      const { AutoReviewLoopCommand } = await import('./auto-review-loop.command')
      const loop = new AutoReviewLoopCommand({
        chapterNumber: n,
        chapterTitle: chapterInfo.title,
        draftPath,
        draftContent,
        maxRounds: this.opts.reviewMaxRounds,
        gate: this.opts.reviewGate,
        reviewFocus: this.opts.reviewFocus,
        reviewModelId: this.opts.models?.review,
        silent: true,
      })
      await loop.execute(execParams)
      if (loop.result) {
        reviewRounds = loop.result.rounds
        reviewPassed = loop.result.passed
        const candidate = loop.result.finalContent
        const report = this.opts.enableIntegrityGuard !== false ? checkDraftIntegrity(candidate) : null
        if (report && !report.ok) {
          // 审稿产出的版本坏了：退回审稿前版本，绝不把拼接稿/截断稿推进定稿
          callbacks.log(
            `⚠️ 第${n}章审稿产出完整性异常（${report.issues.map((i) => i.code).join('/')}），回退到审稿前版本`,
          )
          notes.push('审稿产出异常已回退')
        } else {
          const afterReview = this.classifyWordCount(candidate, chapterInfo)
          if (afterReview && afterReview.tier === 'TOO_SHORT') {
            // 审稿修复允许净删，但删到下限以下就是废稿：保留审稿前版本，避免把短稿推进定稿
            callbacks.log(`⚠️ 第${n}章审稿稿字数不足（${describeWordGate(afterReview)}），保留审稿前版本`)
            notes.push('审稿稿过短已回退')
          } else {
            draftPath = loop.result.finalDraftPath
            draftContent = candidate
            if (afterReview) {
              callbacks.log(`  📏 审稿后${describeWordGate(afterReview)}`)
              tier = afterReview.tier
              if (afterReview.tier === 'REJECT') {
                throw new Error(`第${n}章审稿后篇幅严重超出硬上限：${afterReview.reason}`)
              }
              if (afterReview.action !== 'pass' && !notes.includes(afterReview.reason)) notes.push(afterReview.reason)
            }
          }
        }
      }
    }

    // 5. 质量门判定
    if (this.opts.autoReview && !reviewPassed) {
      if (this.opts.onReviewFail === 'stop') {
        throw new Error(`第${n}章审校未通过（残留阻断级问题），已按策略停止批量`)
      }
      callbacks.log(`⚠️ 第${n}章审校未完全通过，按策略「继续」带问题定稿`)
      notes.push('审稿未完全通过')
    }

    // 6. 去AI味（无人值守：静默生成 + 自动合并为新版本）
    //    失败或产出损坏时降级：保留去味前版本继续定稿，不阻塞本章
    let deaified: boolean | undefined
    if (this.opts.deaify) {
      ensureNotCancelled()
      this.stage = '去AI味'
      callbacks.log(`✨ 第${n}章去AI味（强度：${this.opts.deaifyIntensity}）...`)
      try {
        const { DeaifyCommand } = await import('./deaify.command')
        const deaify = new DeaifyCommand({
          chapterNumber: n,
          draftPath,
          draftContent,
          intensity: this.opts.deaifyIntensity,
          silent: true,
          modelId: this.opts.models?.deaify,
        })
        await deaify.execute(execParams)
        const cleaned = deaify.lastRefinedContent
        const revId = deaify.lastRevisionId
        const report = cleaned && this.opts.enableIntegrityGuard !== false ? checkDraftIntegrity(cleaned) : null
        if (cleaned && revId !== undefined && report && !report.ok) {
          callbacks.log(
            `⚠️ 第${n}章去AI味产出完整性异常（${report.issues.map((i) => i.code).join('/')}），保留去味前版本`,
          )
          deaified = false
          notes.push('未去味（产出异常）')
        } else if (cleaned && revId !== undefined) {
          const afterDeaify = this.classifyWordCount(cleaned, chapterInfo)
          if (afterDeaify && afterDeaify.tier === 'TOO_SHORT') {
            callbacks.log(`⚠️ 第${n}章去AI味稿字数不足（${describeWordGate(afterDeaify)}），保留去味前版本`)
            deaified = false
            notes.push('未去味（字数不足）')
          } else {
            const version = await ipc.invoke('db:draft-next-version', n)
            const created = await ipc.invoke('db:draft-create', {
              chapterNumber: n,
              version,
              source: 'rewrite',
              content: cleaned,
              wordCount: cleaned.length,
            })
            if (created.success && created.id !== undefined) {
              await ipc.invoke('db:revision-mark-merged', revId, created.id)
              draftPath = `moshu://draft/${created.id}`
              draftContent = cleaned
              deaified = true
              callbacks.log(`   已合并去AI味结果为 v${version}`)
            }
          }
        }
      } catch (e) {
        if (isWorkflowCancelled(e) || context.cancelled) throw e
        const message = e instanceof Error ? e.message : String(e)
        callbacks.log(`⚠️ 第${n}章去AI味失败，保留去味前版本继续定稿：${message}`)
        deaified = false
        notes.push('未去味（执行失败）')
      }
    }

    // 6.5 定稿前字数复检：审稿与去味阶段允许净删，必须在这里再卡一道，坏稿不得进入定稿
    ensureNotCancelled()
    const finalGate = this.classifyWordCount(draftContent, chapterInfo)
    if (finalGate) {
      callbacks.log(`  📏 定稿前${describeWordGate(finalGate)}`)
      if (finalGate.tier === 'TOO_SHORT') {
        throw new Error(`第${n}章定稿前字数不足下限：${finalGate.reason}，已阻止定稿`)
      }
      if (finalGate.tier === 'REJECT') {
        throw new Error(`第${n}章定稿前篇幅超出上限：${finalGate.reason}，已阻止定稿`)
      }
      if (finalGate.tier === 'LONG_HARD') {
        throw new Error(`第${n}章定稿前篇幅接近硬上限：${finalGate.reason}，已阻止定稿，建议人工处理`)
      }
      if (finalGate.action !== 'pass' && !notes.includes(finalGate.reason)) notes.push(finalGate.reason)
      tier = finalGate.tier
    }

    // 7. 定稿 + 后处理（复用 FinalizeChapterCommand，含 KB/章节要点/角色卡更新）
    ensureNotCancelled()
    this.stage = '定稿'
    callbacks.log(`✅ 第${n}章定稿...`)
    const { FinalizeChapterCommand } = await import('./finalize-chapter.command')
    // 无人值守时没有人工「确认豁免」弹窗：带问题继续 = 显式豁免 warning 级问题并记入备注；
    // 遇到问题即停 = 保持阻断（与手动定稿一致）。error 级任何模式都不可豁免。
    const acceptWarnings = this.opts.acceptWarnings ?? this.opts.onChapterError !== 'stop'
    if (acceptWarnings) notes.push('已豁免警告级问题')
    await new FinalizeChapterCommand({
      draftPath,
      draftContent,
      chapterNumber: n,
      chapterInfo: { chapterNumber: n, title: chapterInfo.title, role: '', purpose: '', characters: [], keyEvents: '' },
      acceptWarnings,
    }).execute(execParams)

    const words = countDraftWords(draftContent)
    const warn = !reviewPassed || deaified === false || tier === 'WARN' || tier === 'LONG' || tier === 'LONG_HARD'
    recordBatchResult({
      chapter: n,
      status: warn ? 'warn' : 'ok',
      words,
      reviewRounds,
      reviewPassed,
      deaified,
      message: notes.length > 0 ? notes.join('；') : undefined,
    })

    const summary = !reviewPassed
      ? `⚠️ 第${n}章已定稿（带残留问题，建议人工复核）`
      : warn
        ? `⚠️ 第${n}章已定稿（${notes.join('；') || '偏长'}）`
        : `🎉 第${n}章已定稿`
    callbacks.log(summary)
    return summary
  }

  /**
   * 写稿 + 两道守卫。
   * 完整性异常或字数不合档时，用同一份蓝图重生成一次；仍不合规则按策略失败/放行。
   */
  private async generateWithGuards(
    execParams: CommandExecuteParams,
    chapterInfo: ChapterInfo,
  ): Promise<DraftOutcome> {
    const { callbacks, context } = execParams
    const n = this.chapterNumber
    const integrityOn = this.opts.enableIntegrityGuard !== false
    this.stage = '写稿'

    let lastProblem = ''
    for (let attempt = 1; attempt <= 2; attempt++) {
      throwIfCancelled(context)
      const { GenerateDraftCommand } = await import('./generate-draft.command')
      await new GenerateDraftCommand(chapterInfo, this.opts.models?.write, true).execute(execParams)
      const draftPath = context.data.draftPath as string | undefined
      const draftContent = context.data.draftContent as string | undefined
      if (!draftPath || !draftContent) throw new Error(`第${n}章写稿未产出有效草稿`)

      // 守卫 1：正文完整性
      if (integrityOn) {
        const report = checkDraftIntegrity(draftContent)
        if (!report.ok) {
          lastProblem = `正文完整性异常（${report.issues.map((i) => i.code).join('/')}）`
          callbacks.log(`⚠️ 第${n}章草稿${lastProblem}：${report.issues.map((i) => i.detail).join('；')}`)
          if (attempt < 2) {
            callbacks.log('   ↻ 用同一份蓝图重新生成一次...')
            continue
          }
          throw new Error(`第${n}章${lastProblem}，重生成后仍未修复`)
        }
      }

      // 守卫 2：字数分档
      const gate = this.classifyWordCount(draftContent, chapterInfo)
      if (!gate) {
        return { draftPath, draftContent, tier: 'PASS', note: '' }
      }
      callbacks.log(`  📏 ${describeWordGate(gate)}`)

      if (gate.action === 'fail') {
        throw new Error(`第${n}章字数门禁未通过：${gate.reason}`)
      }
      if (gate.action === 'regenerate') {
        lastProblem = gate.reason
        if (attempt < 2) {
          callbacks.log('   ↻ 篇幅不合档，重新生成一次...')
          continue
        }
        if (gate.tier === 'LONG_HARD' && this.opts.onLongHard === 'confirm') {
          callbacks.log(`   ⚠️ 重写后仍为 ${gate.tier}（${gate.reason}），按配置放行，请人工确认篇幅`)
          return { draftPath, draftContent, tier: gate.tier, note: `篇幅偏长需人工确认（${gate.reason}）` }
        }
        throw new Error(`第${n}章字数门禁未通过（重生成后仍不合档）：${gate.reason}`)
      }
      return {
        draftPath,
        draftContent,
        tier: gate.tier,
        note: gate.action === 'pass-warn' ? gate.reason : '',
      }
    }
    throw new Error(`第${n}章写稿失败：${lastProblem || '未知原因'}`)
  }

  /** 按本章目标字数判定档位；门禁关闭或未设置目标字数时返回 null */
  private classifyWordCount(content: string, chapterInfo: ChapterInfo) {
    if (this.opts.enableWordGate === false) return null
    const project = useProjectStore.getState().currentProject
    const explicitTarget = Number(chapterInfo.wordsTarget) || 0
    // 与写稿阶段同源：重点章节（卷末/高潮/收尾）目标字数上调，门禁档位随之放宽
    const target = explicitTarget
      || resolveChapterWordTarget(
        Number(project?.novelConfig.wordsPerChapter) || 0,
        chapterInfo.chapterNumber,
        chapterInfo.role,
      )
    const tiers = resolveWordTiers(target)
    if (!tiers.target) return null
    const scenes = Array.isArray(chapterInfo.scenes) ? chapterInfo.scenes : []
    const sceneBudget = scenes.reduce((sum, scene) => sum + (Number(scene?.words) || 0), 0)
    // 高潮章（或场景预算本身就支持长章）才允许进入 LONG 档；重点章节直接放行
    const hasClimax = isImportantChapter(chapterInfo.chapterNumber, chapterInfo.role)
      || /climax|高潮|决战|关键转折/i.test(chapterInfo.role || '')
    return judgeWordCount({ wordCount: countDraftWords(content), tiers, hasClimax, sceneBudget })
  }

  /**
   * 场景拆解：蓝图刷新过、场景缺失、或预算与目标字数偏差 >10% 时重新拆解。
   * 拆解失败降级为「沿用已有 scenes / 仅 keyEvents」，绝不阻断写稿。
   */
  private async ensureScenePlan(
    execParams: CommandExecuteParams,
    chapterInfo: ChapterInfo,
    bp: BlueprintData,
    blueprintChanged: boolean,
  ): Promise<ChapterInfo> {
    const { callbacks } = execParams
    const project = useProjectStore.getState().currentProject
    const target =
      Number(chapterInfo.wordsTarget) || Number(bp.wordsTarget) || Number(project?.novelConfig.wordsPerChapter) || 0
    const scenes = Array.isArray(chapterInfo.scenes) ? chapterInfo.scenes : []
    const budget = scenes.reduce((sum, scene) => sum + (Number(scene?.words) || 0), 0)

    const stale =
      blueprintChanged || scenes.length < 2 || (target > 0 && (budget < target * 0.9 || budget > target * 1.15))
    if (!stale) {
      callbacks.log(`  🗂 沿用已有场景表（${scenes.length} 场 / 预算 ${budget} 字）`)
      return chapterInfo
    }

    const { PlanScenesCommand } = await import('./plan-scenes.command')
    const plan = new PlanScenesCommand(this.chapterNumber, chapterInfo, this.opts.models?.blueprint)
    await plan.execute(execParams)
    if (plan.result && plan.result.scenes.length > 0) {
      return { ...chapterInfo, scenes: plan.result.scenes }
    }
    callbacks.log('  ⚠️ 场景拆解未产出可用结果，本章按 keyEvents 写稿')
    return chapterInfo
  }
}
