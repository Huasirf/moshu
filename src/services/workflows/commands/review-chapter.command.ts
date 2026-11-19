import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ReviewPromptBuilder } from '../../prompts/prompt-builder'
import { buildRulebookInjection, fallbackRulebookText } from '../../prompts/rulebook-slice'
import { buildWorldSettingSlice } from '../../prompts/world-setting-slice'
import { ipc } from '../../ipc-client'
import { buildCanonContext, renderCompactCanonContext } from '../../narrative-consistency'
import { reviewChapterRules, type RuleReviewCharacter, type RuleReviewItem } from '../../review/rule-review'
import { checkSceneEnvQuota } from '../../review/sensory-review'
import {
  buildRuleComplianceSection, parseRuleVerdicts, ruleVerdictFindings, runNumericRuleGate,
} from '../../review/rule-compliance'
import type { RuleItem } from '../../../shared/rule-timeline'
import {
  RULE_REVIEW_STAGE,
  LLM_REVIEW_STAGE,
  RULE_COMPLIANCE_STAGE,
  mergeWithRuleFindings,
  reviewResultToFindings,
} from '../../review/finding-mapper'
import { normalizeReviewResult } from '../review-result'
import { advanceChapterStage } from '../pipeline-stage'
import {
  calibrateChapterTime, decodeAbsolute, extractTimeCandidatesFromText,
} from '../../timeline/time-calibrator'
import type { ReviewFindingInput } from '../../../../electron/repositories/review-finding-repository'
import { globalEventBus } from '../../../shared/event-bus'
import i18n from '../../../i18n'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'commands', ...opts })


export interface ReviewChapterParams {
  draftPath: string
  draftContent: string
  chapterNumber: number
  /** 审稿维度侧重点（可选） */
  reviewFocus?: string
  /** 静默模式：为 true 时不打开审稿报告 Tab（供自动审校闭环批量调用） */
  silent?: boolean
  /** 指定本次调用使用的模型（按任务派模型）；为空走默认模型 */
  modelId?: string
}

export class ReviewChapterCommand extends BaseWorkflowCommand<string> {
  constructor(private params: ReviewChapterParams) {
    super()
  }

  async execute({ callbacks, context }: CommandExecuteParams): Promise<string> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('common.noProject'))

    const draft = this.params.draftContent
    if (!draft) throw new Error(t('common.noDraftContent'))

    callbacks.log(t('reviewChapter.preparingReview'))

    const { parseDraftMeta } = await import('../chapter-workflow')
    const baseDraft = await parseDraftMeta(this.params.draftPath)
    if (!baseDraft) throw new Error(t('common.baseDraftNotFound'))
    const baseVersion = baseDraft.version
    const draftId = String(baseDraft.id)

    // ==========================================
    // [P3-2] 本地规则审稿先行：零成本、可解释，先落台账；
    // 即便后续 LLM 审稿失败，规则问题也不会丢。
    // ==========================================
    // 结构化规则条目：规则审稿的数值闸与 LLM 逐条勾选清单共用
    let ruleItems: RuleItem[] = []
    try {
      ruleItems = await ipc.invoke('db:rule-items-list')
    } catch { /* 旧项目可能还没有结构化条目 */ }

    callbacks.log(t('reviewChapter.ruleReviewing'))
    const localFindings = await this.buildRuleFindings(draft, draftId)
    // [P8] 数值闸：硬规则里写明的上限/下限直接在正文里核对（不依赖模型）
    const numericFindings = ruleItems.length > 0
      ? runNumericRuleGate(ruleItems, draft, this.params.chapterNumber, draftId)
      : []
    // [N2] 时间校准：把正文里的时间表达与已确认时间轴/章纲窗口比对（纯本地，不调模型）
    const timelineFindings = await this.buildTimelineFindings(draft, draftId)
    const ruleFindings = [...localFindings, ...numericFindings, ...timelineFindings]
    await this.replaceFindings(ruleFindings)
    if (numericFindings.length > 0) callbacks.log(`  ⚖️ 规则数值闸命中 ${numericFindings.length} 处`)
    if (timelineFindings.length > 0) callbacks.log(`  ⏱️ 时间校准命中 ${timelineFindings.length} 处`)
    callbacks.log(t('reviewChapter.ruleReviewDone', {
      count: ruleFindings.length,
      errors: ruleFindings.filter((f) => f.severity === 'error').length,
    }))

    callbacks.log(t('reviewChapter.searchingArchives'))

    // 审稿预算：不再做 KB 全文检索，只带最近 2 章结构化摘要。
    // 既避免未来章节/旧稿污染，也避免审稿 prompt 过长导致 JSON 解析失败。
    let contextSummary = t('reviewChapter.noContextReference')
    try {
      const recent = await ipc.invoke('db:canon-summary-list-recent', 2) as Array<{
        chapterNumber?: number
        title?: string
        summary?: string
      }>
      if (recent.length > 0) {
        contextSummary = recent
          .map((s) => `【第${s.chapterNumber}章${s.title ? ` ${s.title}` : ''}】\n${s.summary || ''}`)
          .join('\n\n')
      }
    } catch {
      contextSummary = t('reviewChapter.noContextReference')
    }

    const template = getPromptTemplate('consistency_check')
    if (!template) throw new Error(t('reviewChapter.templateNotFound'))

    const foreshadowText = await this.buildForeshadowingContext(this.params.chapterNumber)

    // 本章蓝图（同时供世界观切片与规则匹配使用；取不到时降级为空信息）
    const blueprintForSlice = await ipc.invoke('db:blueprint-get', this.params.chapterNumber).catch(() => null)

    // 世界设定切片：审稿员需要看到关卡卡字段/奖励上限/准入表这些结构化事实，
    // 而不是只靠 Canon 摘要推断。
    const worldSlice = buildWorldSettingSlice(
      project.novelConfig.worldSetting || '',
      {
        chapterNumber: this.params.chapterNumber,
        title: blueprintForSlice?.title || '',
        keyEvents: blueprintForSlice?.keyEvents || '',
        characters: (blueprintForSlice?.characters as string[]) || [],
        scenes: (blueprintForSlice?.scenes as unknown as Array<Record<string, unknown>>) || [],
        knowledgeQueryHint: '',
      } as unknown as Parameters<typeof buildWorldSettingSlice>[1],
      { maxChars: 12000 },
    )
    if (worldSlice) callbacks.log(`  🧭 世界观切片：${worldSlice.length} 字`)

    // 规则：结构化三层注入（审稿必须看到全部硬规则）
    let ruleInjectionText = fallbackRulebookText(project.novelConfig.rulebook || '')
    try {
      if (ruleItems.length > 0) {
        const injection = buildRulebookInjection(ruleItems, {
          title: blueprintForSlice?.title,
          keyEvents: blueprintForSlice?.keyEvents,
          characters: (blueprintForSlice?.characters as string[]) || [],
          scenes: (blueprintForSlice?.scenes as unknown as Array<Record<string, unknown>>),
        })
        // [P8] 追加逐条勾选要求：模型必须对每条硬规则给出 pass/violation/unclear
        const compliance = buildRuleComplianceSection(ruleItems)
        ruleInjectionText = compliance ? `${injection.text}\n\n${compliance}` : injection.text
        callbacks.log(`  📜 规则注入：${injection.stats.injected}/${injection.stats.total} 条（硬规则 ${injection.stats.hard} 条，未展开 ${injection.stats.omitted} 条）`)
      }
    } catch { /* 回退整份规则文本 */ }

    // 章纲时间线：审稿需要核对正文事件次序与设定时间
    let timelineText = ''
    try {
      timelineText = await ipc.invoke('db:timeline-context', this.params.chapterNumber)
    } catch { /* 忽略 */ }
    if (timelineText) callbacks.log(`  ⏳ 时间线参考：${timelineText.length} 字`)

    // ==========================================
    // [Canon] 注入叙事一致性上下文 — 审稿员交叉验证事实基线
    // Canon 的合并人物状态与正史设定是角色卡/世界观的超集，注入成功时
    // 模板槽位只留指引文本，不再把同一份内容在 prompt 里重复一遍；
    // 仅在 Canon 构造失败时回退为直读角色卡与世界观（各多一次 IPC）。
    // ==========================================
    const promptBuilder = new ReviewPromptBuilder(template)
    let characterState = '（见上方 Canon 上下文 · 当前人物状态）'
    let worldBuilding = '（见上方正史摘要与规则区）'
    try {
      // 按章快照：审稿看的是「上一章末」的状态。角色卡 when 已被本章写回时会超前，
      // 用 N-1 快照覆盖 currentState，避免"用未来状态审过去的稿"。
      const snapshotChapter = this.params.chapterNumber - 1
      const [core, allCharacters, prevSnapshots] = await Promise.all([
        ipc.invoke("db:project-core-get").catch(() => null),
        ipc.invoke("db:character-get-all").catch(() => []),
        snapshotChapter >= 1
          ? ipc.invoke("db:character-snapshot-map", snapshotChapter).catch(() => ({}))
          : Promise.resolve({} as Record<string, unknown>),
      ]);
      const blueprint = blueprintForSlice
      if (prevSnapshots && Object.keys(prevSnapshots).length > 0) {
        callbacks.log(t('canon.reviewSnapshotUsed', {
          chapter: snapshotChapter,
          count: Object.keys(prevSnapshots).length,
        }))
      }
      const canon = await buildCanonContext({
        chapterNumber: this.params.chapterNumber,
        architecture: {
          premise: core?.premise || "",
          charactersArch: core?.charactersArch || "",
          worldbuilding: core?.worldbuilding || "",
          synopsis: core?.synopsis || "",
        },
        characters: (allCharacters || []).map(c => ({
          name: c.name,
          role: c.role,
          currentState: (prevSnapshots as Record<string, any>)?.[c.name] ?? c.currentState,
        })),
        chapterGoal: `第${this.params.chapterNumber}章审稿`,
        previousEnding: "",
        ragContext: "",
        writingStyle: project.novelConfig.writingStyle || "",
        globalGuidance: project.novelConfig.globalGuidance || "",
      });
      const protagonistName = (allCharacters || []).find(c => c.role === 'protagonist')?.name || '商临野'
      const focusCharacters = Array.from(new Set([protagonistName, ...((blueprint?.characters as string[]) || [])]))
      promptBuilder.withCanonContext(renderCompactCanonContext(canon, { focusCharacters }));
      callbacks.log(t('canon.reviewContextInjected', { timeline: canon.timeline.length, characters: focusCharacters.length }));
    } catch (e) {
      characterState = await this.readCharacterStates()
      worldBuilding = await this.readWorldBuilding()
      callbacks.log(`  ⚠️ [Canon] 审稿上下文构造失败，已回退为直读角色卡/世界观：${String(e)}`);
    }

    promptBuilder
      .withChapterContent(draft)
      .withCharacterStates(characterState)
      .withGlobalSummary([contextSummary, timelineText].filter(Boolean).join('\n\n'))
      .withWorldBuilding(worldSlice || worldBuilding)
      .withSystemRules(ruleInjectionText)
      .withReviewFocus(this.params.reviewFocus || '')
      .withForeshadowing(foreshadowText)

    callbacks.log(t('reviewChapter.callingReviewer'))

    // 期望 JSON 格式返回
    const reviewResultRaw = await this.callLLMWithBuilder(
      promptBuilder,
      callbacks,
      { responseFormat: { type: 'json_object' } },
      // 传入 context：用户取消时能中断正在进行的流
      context,
      this.params.modelId
    )

    const reviewResultClean = this.stripThinkingTags(reviewResultRaw)

    const revIndex = await ipc.invoke('db:review-next-index', baseDraft.id)

    let parsedResult
    try {
      parsedResult = this.parseJSON(reviewResultClean)
    } catch {
      callbacks.log(t('reviewChapter.parseFailed'))
      parsedResult = { summary: t('reviewChapter.parseFallback'), items: [] }
    }

    // ==========================================
    // [P3-3] LLM 审稿结果映射为 review_findings，
    // 与规则审稿按原文证据去重；同一处问题取更高严重度。
    // ==========================================
    const normalizedReview = normalizeReviewResult(parsedResult)
    const llmFindings = normalizedReview
      ? reviewResultToFindings(normalizedReview, this.params.chapterNumber, draftId)
      : []
    // [P8] 逐条勾选结果：violation → error，unclear → warning
    const verdicts = parseRuleVerdicts(parsedResult)
    const verdictFindings = verdicts.length > 0
      ? ruleVerdictFindings(verdicts, ruleItems, this.params.chapterNumber, draftId)
      : []
    if (verdicts.length > 0) {
      callbacks.log(`  ✅ 规则勾选：${verdicts.length} 条（违规 ${verdicts.filter(v => v.verdict === 'violation').length}，无法判定 ${verdicts.filter(v => v.verdict === 'unclear').length}）`)
    }
    const mergedFindings = mergeWithRuleFindings(ruleFindings, [...llmFindings, ...verdictFindings])
    await this.replaceFindings(mergedFindings)
    callbacks.log(t('reviewChapter.findingsPersisted', { count: mergedFindings.length }))

    // [P3-1] 审稿完成即推进到 reviewed（不影响审稿结论本身的落库）
    await advanceChapterStage(this.params.chapterNumber, 'reviewed')

    await ipc.invoke('db:review-create', {
      baseDraftId: baseDraft.id,
      reviewIndex: revIndex,
      content: JSON.stringify(parsedResult, null, 2),
    })

    // 将审稿报告 JSON 序列化为字符串，作为 content 传给 Tab
    // EditorArea 渲染 ReviewReport 的条件：activeTab.content 存在
    const reportContent = JSON.stringify(parsedResult, null, 2)

    if (!this.params.silent) {
      const { useEditorStore } = await import('../../../stores/editor-store')
      const pseudoReviewPath = `moshu://draft/ch${this.params.chapterNumber}/v${baseVersion}/review${revIndex}`
      useEditorStore.getState().openFile({
        id: `review-${this.params.draftPath}-${revIndex}`,
        name: `审稿报告：第${this.params.chapterNumber}章`,
        type: 'review-report',
        content: reportContent,
        filePath: this.params.draftPath,
        reportPath: pseudoReviewPath,
        reviewReport: reportContent,
        chapterNumber: this.params.chapterNumber,
      })
    }

    callbacks.log(t('reviewChapter.completed', { version: revIndex }))
    return reviewResultClean
  }

  /**
   * 读取角色卡 / 本章蓝图 / 道具资产，构造并执行本地规则审稿。
   * 读不到上下文时返回空数组：规则审稿是增强项，不能阻断 LLM 审稿。
   */
  private async buildRuleFindings(content: string, draftId: string): Promise<ReviewFindingInput[]> {
    try {
      const snapshotChapter = this.params.chapterNumber - 1
      const [characters, blueprint, itemAssets, prevSnapshots] = await Promise.all([
        ipc.invoke('db:character-get-all').catch(() => []),
        ipc.invoke('db:blueprint-get', this.params.chapterNumber).catch(() => null),
        ipc.invoke('db:asset-list', 'item').catch(() => []),
        snapshotChapter >= 1
          ? ipc.invoke('db:character-snapshot-map', snapshotChapter).catch(() => ({}))
          : Promise.resolve({} as Record<string, any>),
      ])

      // 与 LLM 审稿一致：规则校验也以「上一章末」的状态为准
      const snapshotOf = (c: any) => (prevSnapshots as Record<string, any>)?.[c.name] ?? c.currentState ?? {}

      const povCharacter = (blueprint?.characters ?? []).find((name) => !!name)
      const ruleCharacters: RuleReviewCharacter[] = (characters || [])
        .filter((c) => !!c.name)
        .map((c) => ({
          name: c.name,
          isPov: c.name === povCharacter,
          location: snapshotOf(c).location || undefined,
          keyItems: snapshotOf(c).keyItems || undefined,
        }))

      // 道具归属：角色卡 keyItems 优先，其次用资产库登记的主人（typeData.owner）；
      // 两者都没有才记「无人持有」——否则主角天天拿在手里的本命道具会被误判为偷来的。
      const owners = new Map<string, string>()
      for (const character of characters || []) {
        for (const raw of (snapshotOf(character).keyItems ?? '').split(/[、,，;；/|\s]+/)) {
          const name = raw.trim()
          if (name.length >= 2 && !owners.has(name)) owners.set(name, character.name)
        }
      }
      const items: RuleReviewItem[] = [...owners].map(([name, owner]) => ({ name, owner }))
      const known = new Set(items.map((item) => item.name))
      for (const asset of itemAssets || []) {
        if (!asset?.name) continue
        const assetOwner = (asset.typeData?.owner as string | undefined)?.trim() || null
        if (!known.has(asset.name)) {
          known.add(asset.name)
          items.push({ name: asset.name, owner: assetOwner })
        } else if (assetOwner) {
          const existing = items.find((item) => item.name === asset.name)
          if (existing && !existing.owner) existing.owner = assetOwner
        }
      }

      return [
        ...reviewChapterRules({
          chapterNumber: this.params.chapterNumber,
          content,
          povCharacter,
          characters: ruleCharacters,
          items,
        }),
        ...this.buildSceneQuotaFindings(content, blueprint),
      ].map((item) => ({ ...item, draftId }))
    } catch {
      return []
    }
  }

  /**
   * 场景环境配额检查：从本章蓝图的 scenes 汇总 envQuota，
   * 交给纯函数统计环境句数是否超配额 / 是否以环境句开篇。
   */
  private buildSceneQuotaFindings(
    content: string,
    blueprint: { scenes?: Array<{ envQuota?: number }> } | null,
  ): ReviewFindingInput[] {
    const scenes = Array.isArray(blueprint?.scenes) ? blueprint!.scenes! : []
    if (scenes.length === 0) return []
    const withQuota = scenes.filter((s) => typeof s.envQuota === 'number')
    const envBudget = withQuota.length > 0
      ? scenes.reduce((sum, s) => sum + (typeof s.envQuota === 'number' ? s.envQuota : 0), 0)
      : undefined
    const firstSceneBudget = typeof scenes[0]?.envQuota === 'number' ? scenes[0].envQuota : undefined
    return checkSceneEnvQuota(this.params.chapterNumber, content, envBudget, firstSceneBudget)
  }

  /**
   * 时间校准审稿：正文时间表达 vs 已确认时间轴 / 章纲窗口。
   * 只发 warning/error；pass 不入台账，避免审稿清单被"没问题"刷屏。
   */
  private async buildTimelineFindings(content: string, draftId: string): Promise<ReviewFindingInput[]> {
    try {
      const chapterNumber = this.params.chapterNumber
      const [prevEvents, existingEvents, prevPlanEvents, nextPlanEvents] = await Promise.all([
        ipc.invoke('db:canon-timeline-get', Math.max(1, chapterNumber - 1)).catch(() => []),
        ipc.invoke('db:canon-timeline-get-chapter', chapterNumber).catch(() => []),
        ipc.invoke('db:timeline-events-get', Math.max(1, chapterNumber - 1)).catch(() => []),
        ipc.invoke('db:timeline-events-get', chapterNumber + 1).catch(() => []),
      ])

      // 前情锚点：优先已定稿 canon，其次上一章章纲计划的最后一条
      const lastPrev = prevEvents.length > 0 ? prevEvents[prevEvents.length - 1] : null
      let previousAnchor = lastPrev?.absoluteTime
        ? decodeAbsolute(lastPrev.absoluteTime)
        : undefined
      if (!previousAnchor) {
        const lastPlan = [...prevPlanEvents]
          .filter((e) => !!e.absoluteTime)
          .sort((a, b) => a.seq - b.seq)
          .pop()
        if (lastPlan) {
          const decoded = decodeAbsolute(String(lastPlan.absoluteTime))
          if (decoded.offsetDay !== null) previousAnchor = decoded
        }
      }

      const firstNext = nextPlanEvents.find((e) => !!e.absoluteTime)
      const nextDecoded = firstNext ? decodeAbsolute(String(firstNext.absoluteTime)) : null
      const nextChapterFirstOffset = nextDecoded?.offsetDay ?? null

      const candidates = extractTimeCandidatesFromText(content)
      if (candidates.length === 0) return []

      const result = calibrateChapterTime({
        chapterNumber,
        events: candidates,
        previousAnchor,
        existingChapterEvents: existingEvents.map((e) => ({
          chapterNumber: e.chapterNumber,
          sequence: e.sequence,
          absoluteTime: e.absoluteTime,
          duration: e.duration,
          location: e.location,
          summary: e.summary,
          timeFlow: e.timeFlow,
          status: e.status,
        })),
        nextChapterFirstOffset,
      })

      return result.issues
        .filter((i) => i.severity !== 'pass')
        .map((i) => ({
          chapterNumber,
          stage: RULE_REVIEW_STAGE,
          draftId,
          category: i.type === 'range_violation' || i.type === 'new_node_conflict' ? '时间校准·冲突' : '时间校准·提示',
          severity: i.severity === 'error' ? 'error' : 'warning',
          message: `${i.reason}${i.fix ? ` 修法：${i.fix}` : ''}`,
          evidence: i.quote,
          locationHint: '',
        }))
    } catch {
      return []
    }
  }

  /** 用最新一轮审稿结果替换本阶段的 findings（规则 + LLM 一起重写） */
  private async replaceFindings(findings: ReviewFindingInput[]): Promise<void> {
    try {
      await ipc.invoke('db:review-finding-clear-stage', this.params.chapterNumber, RULE_REVIEW_STAGE)
      await ipc.invoke('db:review-finding-clear-stage', this.params.chapterNumber, LLM_REVIEW_STAGE)
      // 逐条规则勾选也随本轮重写：不清会留下上一轮的陈旧违规条目阻断定稿
      await ipc.invoke('db:review-finding-clear-stage', this.params.chapterNumber, RULE_COMPLIANCE_STAGE)
      if (findings.length > 0) {
        await ipc.invoke('db:review-finding-add-many', findings)
      }
      // 台账已更新：驱动编辑器内的审稿抽屉与大纲阶段刷新
      globalEventBus.emit('REVIEW_FINDINGS_UPDATED', { chapterNumber: this.params.chapterNumber })
    } catch {
      // 台账写入失败不阻断审稿主流程
    }
  }

  private async readCharacterStates(): Promise<string> {
    try {
      const allChars = await ipc.invoke('db:character-get-all')
      const states: string[] = []
      for (const card of allChars) {
        if (card.name && card.currentState) {
          const cs = card.currentState
          states.push(`${card.name}（${card.role || '未知'}）: ${cs.powerLevel || ''}, ${cs.location || ''}, ${cs.physicalState || ''}, ${cs.mentalState || ''}, 已知：${cs.knownInfo || '—'}, 最近：${cs.recentEvents || ''}`)
        }
      }
      return states.length > 0 ? states.join('\n') : t('reviewChapter.noData')
    } catch { return t('reviewChapter.readFailed') }
  }

  private async readWorldBuilding(): Promise<string> {
    const core = await ipc.invoke('db:project-core-get')
    return core?.worldbuilding || t('reviewChapter.noData')
  }

  /** 加载未回收伏笔，供审稿核对"伏笔完整性"（带注入上限） */
  private async buildForeshadowingContext(currentChapter: number): Promise<string> {
    try {
      const { formatOpenForeshadowings } = await import('../workflow-utils')
      const open = await ipc.invoke('db:foreshadow-get-open')
      return formatOpenForeshadowings(open, currentChapter)
    } catch {
      return '（暂无未回收伏笔）'
    }
  }
}
