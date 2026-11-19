import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ChapterPromptBuilder } from '../../prompts/prompt-builder'
import { buildRulebookInjection, fallbackRulebookText } from '../../prompts/rulebook-slice'
import { ipc } from '../../ipc-client'
import {
  DIR_PROMPTS
} from '../../../shared/project-paths'
import type { ChapterInfo } from '../chapter-workflow'
import type { CharacterData } from '../../../../electron/repositories/character-repository'
import type { ProjectCoreData } from '../../../../electron/repositories/project-core-repository'
import {
  buildCanonContext,
  renderCompactCanonContext,
  runConsistencyGate,
} from '../../narrative-consistency'
import { isWorkflowCancelled } from '../workflow-errors'
import { advanceChapterStage } from '../pipeline-stage'
import { normalizeParagraphs } from '../../paragraph-format'
import { renderScenePlan, splitScenesForPipeline } from '../../blueprint-scenes'
import { estimateMaxTokens, isImportantChapter, resolveChapterWordTarget, resolveWordTiers } from '../../word-count-gate'
import { applyReplacements, scanStyle } from '../../style-scan'
import styleGroundingRules from '../../prompts/skills/style-grounding.md?raw'
import { buildWorldSettingSlice } from '../../prompts/world-setting-slice'
import { runNumericRuleGate } from '../../review/rule-compliance'
import i18n from '../../../i18n'

export class GenerateDraftCommand extends BaseWorkflowCommand {

  constructor(private chapterInfo: ChapterInfo, private modelId?: string, private silent = false) {
    super()
  }

  async execute({ context, callbacks }: CommandExecuteParams): Promise<string> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(i18n.t('common.noProject', { ns: 'commands' }))

    callbacks.log(i18n.t('generateDraft.assemblingContext', { ns: 'commands' }))

    // 核心设定与角色卡各读一次，供架构拼装、Canon 构建、状态档案、口癖上下文复用
    //（原实现同一次写稿中 db:project-core-get 与 db:character-get-all 各要往返 2~3 次）
    const core = await ipc.invoke('db:project-core-get')
    // 预算：正史全文（premise+charactersArch+worldbuilding+synopsis 约 1.4 万字）
    // 不再整份注入，只留故事核心摘要；完整人物/世界规则由 Canon 紧凑上下文与世界设定切片承担。
    const architecture = this.assembleArchitectureSummary(core)
    const projectPrompts = await this.readProjectPrompts(project.path)
    const mergedGuidance = [project.novelConfig.globalGuidance || '', projectPrompts].filter(Boolean).join('\n\n')

    const allCharacters: CharacterData[] = await ipc.invoke('db:character-get-all').catch(() => [])
    const characterState = this.formatCharacterStateArchive(allCharacters)

    // P1：本章蓝图引用的资产（asset_refs）。先把 id 解析成名称再注入 prompt，
    // 暂只注入不校验（P3 审稿闸门再检查是否真的出现）。
    let promptChapterInfo = this.chapterInfo
    try {
      const blueprint = await ipc.invoke('db:blueprint-get', this.chapterInfo.chapterNumber)
      // 两种来源：调用方已解析的（带 name），或蓝图里的原始引用（带 id）
      const refs: Array<{ type: string; id?: string; name?: string; expect: string }> =
        this.chapterInfo.assetRefs ?? blueprint?.assetRefs ?? []
      if (refs.length > 0) {
        const assets = await ipc.invoke('db:asset-list').catch(() => [])
        const resolved = refs.map(ref => {
          if (ref.name) return { type: ref.type, name: ref.name, expect: ref.expect }
          const id = ref.id ?? ''
          return {
            type: ref.type,
            name: ref.type === 'character'
              ? id
              : (assets.find(a => String(a.id) === id)?.name ?? id),
            expect: ref.expect,
          }
        })
        promptChapterInfo = { ...this.chapterInfo, assetRefs: resolved }
        callbacks.log(i18n.t('generateDraft.assetRefsInjected', { ns: 'commands', count: resolved.length }))
      }
    } catch {
      // 蓝图缺失或读取失败时保持原样，不阻断写稿
    }
    let futureBlueprintsStr = '（无后续蓝图）'
    try {
      const { loadDirectoryBlueprints } = await import('../directory-workflow')
      const allBlueprints = await loadDirectoryBlueprints()
      const futureBlueprintsArr = allBlueprints.filter(
        b => b.chapterNumber > this.chapterInfo.chapterNumber && b.chapterNumber <= this.chapterInfo.chapterNumber + 3
      )
      if (futureBlueprintsArr.length > 0) {
        futureBlueprintsStr = futureBlueprintsArr.map(b => i18n.t('generateDraft.futureBlueprintLine', { ns: 'commands', chapter: b.chapterNumber, title: b.title, events: b.keyEvents })).join('\n')
      }
    } catch { /* 忽略 */ }

    // ==========================================
    // [Canon] 构造叙事一致性 Canon Context（所有生成路径都强制经过此闸门）
    // ==========================================
    let canonRendered = ''
    let canonForValidation: import('../../narrative-consistency').CanonContext | null = null
    try {
      canonForValidation = await buildCanonContext({
        chapterNumber: this.chapterInfo.chapterNumber,
        architecture: {
          premise: core?.premise ?? '',
          charactersArch: core?.charactersArch ?? '',
          worldbuilding: core?.worldbuilding ?? '',
          synopsis: core?.synopsis ?? '',
        },
        characters: allCharacters.map(c => ({
          name: c.name,
          role: c.role,
          currentState: c.currentState,
        })),
        chapterGoal: typeof this.chapterInfo === 'object' ? JSON.stringify(this.chapterInfo) : String(this.chapterInfo),
        previousEnding: '', // 下面在非首章分支填充
        ragContext: '',     // 下面在非首章分支填充
        writingStyle: project.novelConfig.writingStyle || '',
        globalGuidance: mergedGuidance,
      })
      const protagonistName = allCharacters.find(c => c.role === 'protagonist')?.name || '商临野'
      const focusCharacters = Array.from(new Set([protagonistName, ...(this.chapterInfo.characters || [])]))
      canonRendered = renderCompactCanonContext(canonForValidation, { focusCharacters })
      callbacks.log(i18n.t('generateDraft.canonContextInjected', { ns: 'commands', timeline: canonForValidation.timeline.length, characters: focusCharacters.length, plotLines: canonForValidation.openPlotLines.length }))
    } catch (e) {
      callbacks.log(i18n.t('generateDraft.canonContextFailed', { ns: 'commands', error: String(e) }))
    }
    // 目标字数：优先本章覆盖值，其次全局「每章字数」；卷末/高潮等重点章节在全局目标上上浮
    const explicitTarget = Number(this.chapterInfo.wordsTarget) || 0
    const targetWords = explicitTarget
      || resolveChapterWordTarget(
        Number(project.novelConfig.wordsPerChapter) || 0,
        this.chapterInfo.chapterNumber,
        this.chapterInfo.role,
      )
    const isImportant = !explicitTarget && isImportantChapter(this.chapterInfo.chapterNumber, this.chapterInfo.role)
    callbacks.log(`  📏 本章目标字数：${targetWords || '未设置'}${explicitTarget ? '（本章覆盖）' : isImportant ? '（重点章节上调）' : '（全局配置）'}`)

    const isFirstChapter = this.chapterInfo.chapterNumber === 1
    const templateKey = isFirstChapter ? 'first_chapter_draft' : 'next_chapter_draft'
    const template = getPromptTemplate(templateKey)
    if (!template) throw new Error(i18n.t('common.templateNotFound', { ns: 'commands', key: templateKey }))

    // P4-2：当前生效的风格档案（promptHint）并入文风注入，与文风指纹叠加
    let activeStyleHint = ''
    try {
      const activeStyle = await ipc.invoke('db:style-get-active') as { promptHint?: string } | null
      activeStyleHint = activeStyle?.promptHint?.trim() || ''
    } catch {
      activeStyleHint = ''
    }

    // 预算：只带本章相关的世界设定切片（世界总览/颜色表/等级1/4/闯入匹配/当前关卡卡/副本结算）
    const worldSettingSlice = buildWorldSettingSlice(project.novelConfig.worldSetting || '', this.chapterInfo, { maxChars: 12000 })
    callbacks.log(`  🧭 世界设定切片：${worldSettingSlice.length} 字（原 ${(project.novelConfig.worldSetting || '').length} 字）`)

    // 规则：结构化三层注入（硬规则摘要 + 本章相关全文 + 未展开清单），替代原 9000 字硬截断
    let ruleText = fallbackRulebookText(project.novelConfig.rulebook || '')
    let ruleStatsLine = ''
    try {
      const ruleItems = await ipc.invoke('db:rule-items-list')
      if (ruleItems.length > 0) {
        const injection = buildRulebookInjection(ruleItems, {
          title: this.chapterInfo.title,
          keyEvents: this.chapterInfo.keyEvents,
          characters: this.chapterInfo.characters,
          scenes: this.chapterInfo.scenes as unknown as Array<Record<string, unknown>>,
          knowledgeQueryHint: this.chapterInfo.knowledgeQueryHint,
        })
        ruleText = injection.text
        ruleStatsLine = `，共 ${injection.stats.total} 条（硬规则 ${injection.stats.hard} 条，本章展开 ${injection.stats.injected} 条，未展开 ${injection.stats.omitted} 条）`
      }
    } catch (e) {
      callbacks.log(`  ⚠️ 规则条目读取失败，回退整份规则文本：${String(e)}`)
    }
    callbacks.log(`  📜 规则注入：${ruleText.length} 字${ruleStatsLine}`)

    // 章纲时间线：前情已发生事件 + 本章计划事件 + 紧接后续（不得提前）
    let timelineText = ''
    try {
      timelineText = await ipc.invoke('db:timeline-context', this.chapterInfo.chapterNumber)
    } catch { /* 时间线不可用时不影响生成 */ }
    if (timelineText) callbacks.log(`  ⏳ 时间线参考：${timelineText.length} 字`)

    // ==========================================
    // Prompt 构建——按「稳定前缀 → 可变后缀」排列
    // 以最大化 LLM 上下文缓存命中率
    // ==========================================
    const promptBuilder = new ChapterPromptBuilder(template)
      // ---- 缓存命中区（跨章稳定，前缀对齐）----
      .withArchitecture(architecture)
      .withWorldSetting(worldSettingSlice)
      .withRulebookInjection(ruleText)
      .withGlobalGuidance(mergedGuidance)
      .withWritingStyle([project.novelConfig.writingStyle || '', this.styleGroundingBlock(project.novelConfig)].filter(Boolean).join('\n\n'))
      .withStyleReference([project.novelConfig.styleReference || '', activeStyleHint].filter(Boolean).join('\n\n'))
      .withNovelConfig(project.novelConfig)
      // 单章目标字数优先于全局「每章字数」
      .withWordNumber(targetWords)
      // 本章任务三件套：首章与后续章节模板都引用这三个变量。
      //（此前只在非首章分支注入，首章 prompt 里残留字面 {{chapter_info}} 等占位符，
      // 模型看不到本章任务、后续预告与作者微操）
      .withChapterInfo(
        this.chapterInfo.scenes && this.chapterInfo.scenes.length > 0
          ? `${JSON.stringify(promptChapterInfo, null, 2)}\n\n${renderScenePlan(this.chapterInfo.scenes, targetWords || 2000)}`
          : promptChapterInfo,
      )
      .withFutureBlueprints(futureBlueprintsStr)
      .withUserGuidance(this.chapterInfo.userGuidance?.trim() || '（无微操指导）')

    // 上一章结尾：单段生成与两段式生成都要用，提到分支外声明
    let previousEnding = ''
    // 反雷同 / 开篇查重共用的近章正文，提到分支外声明供生成后体检复用
    let recentContents = new Map<number, string>()
    if (!isFirstChapter) {
      // 从蓝图 JSON 的 notes 字段读取章节要点时间线（一次取回全部蓝图，避免逐章 IPC）
      const { readChapterNotesTimeline } = await import('../workflow-utils')
      const chapterTimelineFull = await readChapterNotesTimeline(this.chapterInfo.chapterNumber)
      const chapterTimeline = chapterTimelineFull.length > 1500 ? chapterTimelineFull.slice(-1500) : chapterTimelineFull
      callbacks.log(`  📋 已加载章节要点时间线（${chapterTimelineFull.length} 字 → ${chapterTimeline.length} 字）`)

      // 近 10 章定稿正文一次并行读回：上一章结尾与反雷同速览共用同一份数据
      //（近 3 章覆盖不足，实测第 2–11 章开场反复出现同一批擦伤句）
      recentContents = await this.readRecentFinalizedContents(this.chapterInfo.chapterNumber, 10)
      previousEnding = (recentContents.get(this.chapterInfo.chapterNumber - 1) || '').slice(-600)

      let filteredContext = ''
      try {
        callbacks.log(i18n.t('generateDraft.searchingKB', { ns: 'commands' }))
        let searchQuery = `${this.chapterInfo.title} ${this.chapterInfo.keyEvents} ${this.chapterInfo.characters.join(' ')}`
        if (this.chapterInfo.knowledgeQueryHint?.trim()) {
          searchQuery += ` ${this.chapterInfo.knowledgeQueryHint.trim()}`
          callbacks.log(i18n.t('generateDraft.addedKeywords', { ns: 'commands', keywords: this.chapterInfo.knowledgeQueryHint.trim() }))
        }
        // [P1-4] 双索引检索：只允许看「本章之前」的正文与章节摘要，避免参考同章草稿或未来剧情
        const scopeEnd = this.chapterInfo.chapterNumber - 1
        const results: Array<{ fileName: string; score: number; text: string }> = scopeEnd >= 1
          ? await ipc.invoke('kb:search-with-scope', searchQuery, 1, scopeEnd, 3) as Array<{ fileName: string; score: number; text: string }>
          : []
        // 同一文档可能命中多个分块，按文档去重（保留最相关的一块），避免 top3 被同一章的摘要包场
        // 预算：每块只带前 400 字，保留事实与因果，不把整章正文搬进 prompt
        const deduped = results.filter((r, i) => results.findIndex(x => x.fileName === r.fileName) === i)
        if (deduped.length > 0) {
          callbacks.log(i18n.t('generateDraft.kbTopHits', {
            ns: 'commands',
            count: deduped.length,
            files: deduped.map(r => r.fileName).join('、'),
          }))
          filteredContext = [
            '【历史正文参考（只可借鉴事实与因果，严禁照抄原句）】',
            ...deduped.map((r, i) => i18n.t('generateDraft.kbResultLine', {
              ns: 'commands', index: i + 1, file: r.fileName, score: (r.score * 100).toFixed(0), text: (r.text || '').slice(0, 400),
            })),
          ].join('\n\n')
        } else {
          filteredContext = i18n.t('generateDraft.kbNoContent', { ns: 'commands' })
        }
      } catch {
        filteredContext = i18n.t('generateDraft.kbUnavailable', { ns: 'commands' })
      }

      const foreshadowText = await this.buildForeshadowingContext(this.chapterInfo.chapterNumber)
      const antiRepText = this.buildAntiRepetitionContext(recentContents)
      const voiceText = this.buildCharacterVoiceContext(this.chapterInfo.characters, allCharacters)

      promptBuilder
        // ---- 缓存命中区续（要点时间线按序追加，前缀对齐）----
        .withGlobalSummary([timelineText, chapterTimeline].filter(Boolean).join('\n\n'))
        // 角色状态已并入 Canon 上下文（canon 合并态是角色卡的超集）；
        // 仅在 Canon 构造失败时回退为角色卡档案，避免同一份状态在 prompt 里出现两遍
        .withCharacterStates([
          canonRendered ? '（完整状态见上方 Canon 上下文 · 当前人物状态）' : characterState,
          this.buildBodyStateLedger(allCharacters),
        ].filter(Boolean).join('\n\n'))
        // ---- 缓存失效区（逐章变化）----
        .withPreviousEnding(previousEnding || '（无前文）')
        .withFilteredContext(filteredContext)
        .withForeshadowing(foreshadowText)
        .withAntiRepetition(antiRepText)
        .withCharacterVoices(voiceText)
        .withShortSummary('')

      // [Canon] RAG 与上一章结尾就绪后回填到 Canon 对象，供生成后一致性 Gate 使用。
      // 渲染文本不再携带这两项（模板已有专属槽位），无需重渲染
      if (canonForValidation) {
        canonForValidation.previousEnding = previousEnding || '（无前文）'
        canonForValidation.ragContext = filteredContext || '（无 RAG 检索结果）'
      }
    }

    // [Canon] 注入叙事一致性上下文（强制最高优先级）
    if (canonRendered) {
      promptBuilder.withCanonContext(canonRendered)
    }

    // Token 预算管控：中文约 1.5 字符/token，预留 4K 给输出
    const prompt = promptBuilder.build()
    const estimatedTokens = Math.ceil(prompt.length / 1.5)
    const TOKEN_BUDGET = 28000
    callbacks.log(`  🧮 Prompt 预估 ${estimatedTokens} tokens（预算 ${TOKEN_BUDGET}）`)
    if (estimatedTokens > TOKEN_BUDGET) {
      callbacks.log(i18n.t('generateDraft.tokenBudgetWarning', { ns: 'commands', tokens: estimatedTokens, budget: TOKEN_BUDGET }))
    }

    callbacks.log(i18n.t('generateDraft.callingAI', { ns: 'commands' }))

    // 两段式生成（A2）：有场景预算时按「前 60% / 剩余」分段生成。
    // 单段一次成稿时模型会系统性写长（实测目标 2000 字常写出 3400+），
    // 分段后每段都有明确的字数上限，第二段从上一段最后一句原句续写，接缝按句级对齐。
    const scenes = Array.isArray(this.chapterInfo.scenes) ? this.chapterInfo.scenes : []
    const useScenePipeline = scenes.length >= 2 && targetWords > 0
    let draftText: string
    if (useScenePipeline) {
      draftText = await this.generateByScenes({
        scenes,
        targetWords,
        chapterInfo: promptChapterInfo,
        baseContext: this.buildStageBaseContext({
          architecture,
          worldSetting: worldSettingSlice,
          rulebook: ruleText,
          canon: canonRendered,
          guidance: mergedGuidance,
          style: project.novelConfig.writingStyle || '',
          styleReference: [project.novelConfig.styleReference || '', activeStyleHint].filter(Boolean).join('\n\n'),
          styleRules: this.styleGroundingBlock(project.novelConfig),
          previousEnding,
        }),
        systemRole: promptBuilder.getSystemRole(),
        callbacks,
        context,
      })
    } else {
      // 传入 context：用户取消时能中断正在进行的流（不传则要等整章写完才停）
      // maxTokens 兜底：模型常常无视 prompt 里的字数上限，单段成稿必须有物理上限
      const singleCap = targetWords > 0 ? estimateMaxTokens(Math.round(targetWords * 1.5)) : undefined
      draftText = await this.callLLMWithBuilder(
        promptBuilder, callbacks, singleCap ? { maxTokens: singleCap } : undefined, context, this.modelId,
      )
    }
    let cleanDraftText = this.stripThinkingTags(draftText)

    // ==========================================
    // 篇幅闸门：字数低于下限时自动续写补足
    // ==========================================
    cleanDraftText = await this.ensureWordCount(
      cleanDraftText,
      targetWords,
      promptBuilder.getSystemRole(),
      callbacks,
      context,
    )

    // ==========================================
    // [段落节奏] 生成即归一：手机竖屏约 4 行 ≈ 70 字
    // 只改换行不改字词；草稿阶段就排好版，避免定稿前一直是大段文字墙
    // ==========================================
    const draftParagraphs = normalizeParagraphs(cleanDraftText)
    if (draftParagraphs.stats.splitParagraphs > 0) {
      cleanDraftText = draftParagraphs.content
      callbacks.log(
        `  🧱 段落排布：拆分 ${draftParagraphs.stats.splitParagraphs} 个长段（最长 ${draftParagraphs.stats.maxBefore} → ${draftParagraphs.stats.maxAfter} 字）`,
      )
    }

    // ==========================================
    // [B] 开篇查重体检：零成本、不调用模型
    // 对比本章首段与近 10 章首段的共享短语，并检测是否又是伤情句起笔
    // ==========================================
    this.auditOpeningDuplicate(
      this.chapterInfo.chapterNumber,
      cleanDraftText,
      recentContents,
      callbacks,
      context,
    )

    // ==========================================
    // [Canon] 生成后一致性 Gate + 自动修复
    // ==========================================
    let finalDraft = cleanDraftText
    if (canonForValidation) {
      try {
        const gateResult = await runConsistencyGate({
          chapterNumber: this.chapterInfo.chapterNumber,
          chapterContent: cleanDraftText,
          canon: canonForValidation,
        })
        callbacks.log(`  🛡️ [Gate] ${gateResult.verdict}: ${gateResult.report}`)
        if (gateResult.verdict === 'BLOCK') {
          throw new Error(i18n.t('generateDraft.gateBlocked', { ns: 'commands', reasons: gateResult.blockingReasons.join('；') }))
        }
        if (gateResult.verdict === 'REPAIR' && gateResult.repairedContent) {
          finalDraft = gateResult.repairedContent
          callbacks.log(i18n.t('generateDraft.canonAutoRepair', { ns: 'commands', attempts: gateResult.repairAttempts }))
        }
        if (gateResult.issues.length === 0) {
          callbacks.log(i18n.t('generateDraft.canonCheckPassed', { ns: 'commands' }))
        }
        const remaining = gateResult.issues.map(i => i.issue)
        if (remaining.length > 0) context.data.consistencyWarnings = remaining
        context.data.consistencyReport = {
          verdict: gateResult.verdict,
          totalIssues: gateResult.issues.length,
          repairAttempts: gateResult.repairAttempts,
          remaining: gateResult.issues.length,
        }
      } catch (e) {
        callbacks.log(i18n.t('generateDraft.canonGateError', { ns: 'commands', error: String(e) }))
        throw e
      }
    }

    // ==========================================
    // [P1-3] 接地气扫描 + 项目词表确定性替换
    // ==========================================
    finalDraft = this.applyStyleGrounding(finalDraft, project.novelConfig, callbacks, context)

    // 落于数据库
    const nextVersion: number = await ipc.invoke('db:draft-next-version', this.chapterInfo.chapterNumber)
    const createResult = await ipc.invoke('db:draft-create', {
      chapterNumber: this.chapterInfo.chapterNumber,
      version: nextVersion,
      source: 'write',
      content: finalDraft,
      wordCount: this.countWords(finalDraft),
    })

    const pseudoPath = createResult.id ? `moshu://draft/${createResult.id}` : `moshu://draft/ch${this.chapterInfo.chapterNumber}/v${nextVersion}`

    // [P3-1] 流水线推进：草稿落库即进入 drafted（失败不阻断主流程）
    await advanceChapterStage(this.chapterInfo.chapterNumber, 'drafted')

    // [P8] 生成后轻量审计：硬规则数值闸（零成本，不调用模型；失败不阻断写稿）
    try {
      const gateItems = await ipc.invoke('db:rule-items-list')
      if (gateItems.length > 0) {
        const gateFindings = runNumericRuleGate(gateItems, finalDraft, this.chapterInfo.chapterNumber)
        if (gateFindings.length > 0) {
          callbacks.log(`⚠️ 规则数值闸：草稿疑似违反 ${gateFindings.length} 处硬规则，建议审稿时重点核对`)
          gateFindings.slice(0, 3).forEach(finding => callbacks.log(`   - ${finding.message}`))
        }
      }
    } catch { /* 忽略 */ }

    context.data.draft = finalDraft
    context.data.draftContent = finalDraft
    context.data.draftPath = pseudoPath
    context.data.chapterNumber = this.chapterInfo.chapterNumber
    context.data.chapterInfo = this.chapterInfo
    context.data.mergedGuidance = mergedGuidance
    context.data.shortSummary = ''

    // 新草稿只影响本章：只刷新本章草稿列表，不做全库重载。
    // 批量静默连写时原实现每章都要全量 loadAllDrafts + refreshFileTree，
    // IPC 次数随章节数平方级增长
    try {
      const { useDraftStore } = await import('../../../stores/draft-store')
      await useDraftStore.getState().loadChapterDrafts(this.chapterInfo.chapterNumber)
    } catch { /* 忽略 */ }
    if (!this.silent) {
      useProjectStore.getState().refreshFileTree()
    }

    if (!this.silent) {
      try {
        const { useEditorStore } = await import('../../../stores/editor-store')
        useEditorStore.getState().openFile({
          id: pseudoPath,
          name: `第${this.chapterInfo.chapterNumber}章 ${this.chapterInfo.title} v${nextVersion}`,
          type: 'chapter',
          filePath: pseudoPath,
          content: finalDraft,
        })
      } catch { /* 忽略 */ }
    }

    callbacks.log(`✅ 草稿已自动入库保存为版本 v${nextVersion}（${this.countWords(finalDraft)} 字）`)
    return finalDraft
  }

  /** 正文字数统计：忽略空白字符，与"中文字数"的直观认知对齐 */
  private countWords(text: string): number {
    return (text || '').replace(/\s/g, '').length
  }

  /**
   * 两段式生成：前半段按场景预算写到约 60% 处即停，第二段从最后一句原句续写。
   *
   * 为什么分段：写稿模板对字数只有区间约束，模型单次成稿会系统性写长
   * （目标 2000 字实测常出 3400+），字数门禁连续两次判 LONG 只能判本章失败。
   * 分段后每段都有明确的「写哪几场 + 多少字 + 停在哪」，控制篇幅的同时不牺牲文笔连续性。
   */
  private async generateByScenes(args: {
    scenes: NonNullable<ChapterInfo['scenes']>
    targetWords: number
    chapterInfo: ChapterInfo
    baseContext: string
    systemRole: string
    callbacks: CommandExecuteParams['callbacks']
    context: CommandExecuteParams['context']
  }): Promise<string> {
    const { scenes, targetWords, chapterInfo, baseContext, systemRole, callbacks, context } = args
    const n = this.chapterInfo.chapterNumber
    const totalBudget = scenes.reduce((sum, s) => sum + (Number(s.words) || 0), 0) || targetWords

    // 前半段 ≈60%，至少 1 场，且必须留至少 1 场给第二段
    const { first: firstScenes, rest: restScenes } = splitScenesForPipeline(scenes, 0.6)
    const cut = firstScenes.length
    const firstBudget = firstScenes.reduce((sum, s) => sum + (Number(s.words) || 0), 0)
    const restBudget = totalBudget - firstBudget
    const firstCap = Math.round(firstBudget * 1.1)

    callbacks.log(
      `  🧩 两段式生成：第1段 场景1–${cut}（约 ${firstBudget} 字）→ 第2段 场景${cut + 1}–${scenes.length}（约 ${restBudget} 字）`,
    )

    // max_tokens 物理上限：段预算的宽松倍率。
    // 只按预算卡死在实测中会把第二段截断在场景中途（正文没写完、钩子没落下），
    // 所以给第二段留足收尾空间，超长部分交给后面的压缩兜底。
    const firstTokenCap = estimateMaxTokens(Math.round(firstBudget * 1.4))
    const restTokenCap = estimateMaxTokens(Math.round(restBudget * 1.6))

    // ---- 第一段：专用 prompt，不用章节模板。
    //      章节模板自带「写完整一章 + 结尾留钩子」的强指令，会把半章写成整章（实测两段各写一遍）；
    //      这里只给前半段场景与硬上限，明确禁止写后续场景。----
    const stage1Prompt = `${baseContext}

【本章定位】第${n}章《${chapterInfo.title}》·${chapterInfo.role || '推进'}（本段只写前半部分）
【本段出场人物】${(chapterInfo.characters || []).join('、') || '（见场景安排）'}
${chapterInfo.userGuidance?.trim() ? `【作者微操（最高优先级）】\n${chapterInfo.userGuidance.trim()}\n` : ''}
${renderScenePlan(firstScenes, firstBudget)}

【硬性要求（务必遵守）】
1. 这一段是本章的前半部分，不是完整章节。只写上面 ${firstScenes.length} 个场景，写到「${firstScenes[firstScenes.length - 1].title}」这一场的最后一句就停笔。
2. 绝对不要写场景 ${cut + 1} 及之后的情节，不要提前写本章的决战、结局或悬念钩子，也不要写任何"总结全章"式的收束句；本段可以在一个小动作/一句对白处自然断开。
3. 篇幅：本段合计 ${Math.round(firstBudget * 0.9)}–${firstCap} 字，以 ${firstBudget} 字为准；写成 ${Math.max(6, Math.round(firstBudget / 65))} 个自然段左右，每段 40–70 字（手机竖屏 3–4 行），最多不超过 90 字；段落之间必须空一行。写满预算立即收手，不要靠堆细节硬撑。
4. 与前后文保持同一人称、视角与语感；对话用中文双引号，段落之间空一行。
5. 只输出正文纯文本，不要标题、不要 Markdown、不要任何解释。`

    const part1 = this.stripThinkingTags(
      await this.callLLM(stage1Prompt, systemRole, callbacks, { maxTokens: firstTokenCap }, context, this.modelId),
    )
    const part1Words = this.countWords(part1)
    callbacks.log(`  🧩 第1段完成：${part1Words} 字（预算 ${firstBudget}）`)
    if (part1Words < 200) throw new Error(`第${n}章分段生成异常：第1段仅 ${part1Words} 字`)

    // ---- 第二段：给剩余场景 + 第一段结尾原句，要求句级续写并收束全章 ----
    const tail = part1.trimEnd().slice(-1000)
    const stage2Info = {
      title: chapterInfo.title,
      role: chapterInfo.role,
      purpose: chapterInfo.purpose,
      keyEvents: chapterInfo.keyEvents,
      suspenseHook: chapterInfo.suspenseHook,
      userGuidance: chapterInfo.userGuidance,
    }
    const stage2Prompt = `${baseContext}

【本章后半段的结尾原句】（你将从这里往下接着写）
${tail}

【本章完整任务】
${JSON.stringify(stage2Info, null, 2)}

${renderScenePlan(restScenes, restBudget)}

【续写要求】
1. 严格从上面【结尾原句】的最后一句往下接着写，衔接要像同一支笔一口气写下来的；不要重写、不要复述、不要总结前文，不要加"（续）"之类的标记。
2. 只写上面的剩余场景（场景 ${cut + 1}–${scenes.length}），按顺序推进到本章结尾。
3. 篇幅：本段以 ${restBudget} 字为参照，绝对不得超过 ${Math.round(restBudget * 1.6)} 字；但必须在本段内写完剩余场景并把悬念钩子落下来，绝不允许写到一半停笔。若场景内容偏多，压缩环境铺陈与动作分解，优先把情节推完。
4. 保持与前半段一致的人称、叙事视角、语感与段落节奏；每段 40–70 字（手机竖屏 3–4 行），最多不超过 90 字；对话用中文双引号，段落之间空一行。
5. 结尾把本章的悬念钩子落下来，自然结束全章。
6. 只输出续写的正文纯文本，不要 Markdown、不要任何解释。`

    const part2 = this.stripThinkingTags(
      await this.callLLM(stage2Prompt, systemRole, callbacks, { maxTokens: restTokenCap }, context, this.modelId),
    )
    const part2Words = this.countWords(part2)
    callbacks.log(`  🧩 第2段完成：${part2Words} 字（合计 ${part1Words + part2Words} 字）`)
    if (part2Words < 200) throw new Error(`第${n}章分段生成异常：第2段仅 ${part2Words} 字`)

    const merged = `${part1.trimEnd()}\n\n${part2.trim()}`

    // 硬截断兜底：模型撞到 max_tokens 时会停在一句话中间，
    // 这里补一次短续写把句子收完并落下钩子，避免定稿里出现半截正文。
    const ended = /[。！？…”』」.!?]$/.test(merged.trimEnd())
    let completed = merged
    if (!ended) {
      callbacks.log('  ✂️ 检测到第2段结尾不完整，补写结尾...')
      const hook = chapterInfo.suspenseHook?.trim()
      try {
        const tailText = merged.trimEnd().slice(-600)
        const finish = this.stripThinkingTags(
          await this.callLLM(
            `下面是一章小说正文的最后部分，结尾停在了句子中间。请从断句处接着写，补完这一句，并把本章收束到自然结尾${hook ? `，最后落下这个悬念钩子：${hook}` : ''}。

【结尾原文】
${tailText}

【要求】
1. 只输出补充的正文纯文本（从断句处开始），不要重复上文，不要 Markdown。
2. 补写控制在 200 字以内，优先收束，不要新开情节。`,
            systemRole,
            callbacks,
            { maxTokens: estimateMaxTokens(260) },
            context,
            this.modelId,
          ),
        )
        if (finish.trim()) completed = `${merged.trimEnd()}${finish.trimStart()}`
      } catch (e) {
        if (isWorkflowCancelled(e)) throw e
        callbacks.log(`  ⚠️ 补写结尾失败，保留原稿：${String(e)}`)
      }
    }

    // 两道保险：两段都超预算时先做一次压缩，避免整批因单章超长被门禁判失败
    const mergedWords = this.countWords(completed)
    if (mergedWords > Math.round(targetWords * 1.3)) {
      callbacks.log(`  📏 两段合计 ${mergedWords} 字超出目标 ${targetWords} 字，执行一次压缩...`)
      try {
        const compressed = await this.compressDraft(completed, targetWords, systemRole, callbacks, context)
        if (compressed) return compressed
      } catch (e) {
        if (isWorkflowCancelled(e)) throw e
        callbacks.log(`  ⚠️ 压缩失败，保留原稿：${String(e)}`)
      }
    }
    return completed
  }

  /**
   * 把超长正文压缩到目标区间（保情节、删冗余），用于两段合计仍超长的兜底。
   * 压缩结果明显短于下限时放弃压缩，交回原稿由字数门禁判定。
   */
  private async compressDraft(
    draft: string,
    targetWords: number,
    systemRole: string,
    callbacks: CommandExecuteParams['callbacks'],
    context: CommandExecuteParams['context'],
  ): Promise<string | null> {
    // 压缩一次往往只降到 1.4 倍（模型会"润色式"删句），最多压两轮逼到目标区间
    let current = draft
    const tiers = resolveWordTiers(targetWords)
    const floor = tiers.shortFloor
    const ceiling = tiers.normalMax
    for (let pass = 1; pass <= 2; pass++) {
      const currentWords = this.countWords(current)
      if (currentWords <= ceiling) {
        return currentWords >= floor ? current : null
      }
      const mustDelete = currentWords - Math.round(targetWords * 1.05)
      const prompt = `下面是一章小说正文，篇幅超出目标字数 ${currentWords - targetWords} 字，需要你删减。这不是润色，是"砍字"。

【当前】${currentWords} 字
【目标】压到 ${Math.round(targetWords * 0.95)}–${Math.round(targetWords * 1.1)} 字，不得超过 ${ceiling} 字（必须至少删掉 ${mustDelete} 字）

【删减方式】
1. 优先整段删除：过场过渡段、重复的动作分解、同义的环境铺陈、两次以上表达同一情绪的内心独白，可直接删掉整段，不要逐句改写。
2. 合并同类段落：同一场景内的连续短段可合并为一到两段，去掉冗余的重复交代。
3. 保留硬要求：全部情节点与因果链、关键转折、伏笔、结尾悬念钩子、有辨识度的对白，一处都不能少；不要新增情节，不要改变叙事视角与文风。
4. 若删到目标字数仍有余量，宁可让段落更紧凑，也不要重新扩写。

【输出】压缩后的完整正文纯文本，不要解释、不要标注删改之处、不要 Markdown。

【正文】
${current}`

      const result = this.stripThinkingTags(
        await this.callLLM(prompt, systemRole, callbacks, { maxTokens: estimateMaxTokens(ceiling) }, context, this.modelId),
      )
      const words = this.countWords(result)
      callbacks.log(`  📏 第${pass}轮压缩：${currentWords} → ${words} 字（目标 ${targetWords}）`)
      if (words < floor) {
        callbacks.log('  ⚠️ 压缩过度（低于下限 85%），放弃压缩结果')
        return null
      }
      current = result
    }
    const finalWords = this.countWords(current)
    // 压不到 1.2 倍也接受：只要明显短于原稿且落在偏长档以内，就比原稿更接近目标
    if (finalWords > Math.round(targetWords * 1.5)) {
      callbacks.log(`  ⚠️ 两轮压缩后仍为 ${finalWords} 字，放弃压缩结果`)
      return null
    }
    return current
  }

  /** 两段式生成的公共上下文档（设定/一致性/文风/微操/前文结尾） */
  private buildStageBaseContext(ctx: {
    architecture: string
    worldSetting?: string
    rulebook?: string
    canon: string
    guidance: string
    style: string
    styleReference: string
    styleRules?: string
    previousEnding: string
  }): string {
    const blocks: string[] = []
    if (ctx.architecture) blocks.push(`【本书架构摘要】\n${ctx.architecture.slice(0, 3000)}`)
    if (ctx.worldSetting) blocks.push(`【本书世界设定（含关卡卡与试炼规则 · 必须遵循）】\n${ctx.worldSetting}`)
    if (ctx.rulebook) blocks.push(`【本书规则区（属性成长/精神力/伤势/结算判定 · 必须逐条遵循）】\n${ctx.rulebook}`)
    if (ctx.canon) blocks.push(`【一致性上下文（最高优先级）】\n${ctx.canon}`)
    if (ctx.guidance) blocks.push(`【作者全局要求】\n${ctx.guidance.slice(0, 2500)}`)
    if (ctx.style) blocks.push(`【文风要求】\n${ctx.style}`)
    if (ctx.styleRules) blocks.push(`【接地气写作规则（必须遵守）】\n${ctx.styleRules}`)
    if (ctx.styleReference) blocks.push(`【文风参考（模仿其语感，不要照抄句子）】\n${ctx.styleReference.slice(0, 1000)}`)
    if (ctx.previousEnding) blocks.push(`【上一章结尾（用于衔接，不要照抄）】\n${ctx.previousEnding}`)
    return blocks.join('\n\n')
  }

  /**
   * 接地气规则 + 项目词表拼装。
   * 规则文件是通用约束（术语分级、冗余修饰、名词化改写），词表是本书的个性化禁用词。
   */
  private styleGroundingBlock(config: { bannedTerms?: string[]; replacements?: Record<string, string> }): string {
    const lines: string[] = [styleGroundingRules.trim()]
    const banned = (config.bannedTerms ?? []).map(x => x.trim()).filter(Boolean)
    if (banned.length > 0) {
      lines.push(`【本书禁用词（正文不得出现）】${banned.join('、')}`)
      const pairs = Object.entries(config.replacements ?? {}).filter(([k, v]) => k.trim() && v)
      if (pairs.length > 0) {
        lines.push(`【替换约定】${pairs.map(([k, v]) => `${k}→${v}`).join('；')}`)
      }
    }
    return lines.join('\n\n')
  }

  /**
   * 生成后的接地气后处理：
   * 1. 按项目词表做确定性替换（不额外调用 LLM）；
   * 2. 扫描禁用词/冗余修饰/名词化/专名密度/抽象高频词，命中写入日志与 context.data，供 UI 与后续审稿参考。
   */
  private applyStyleGrounding(
    draft: string,
    config: { bannedTerms?: string[]; replacements?: Record<string, string> },
    callbacks: CommandExecuteParams['callbacks'],
    context: CommandExecuteParams['context'],
  ): string {
    let text = draft
    const replacements = config.replacements ?? {}
    if (Object.keys(replacements).length > 0) {
      const replaced = applyReplacements(text, replacements)
      if (replaced !== text) {
        const diff = this.countWords(text) - this.countWords(replaced)
        text = replaced
        callbacks.log(`  🧹 已按项目词表替换禁用词（字数变化 ${diff >= 0 ? '-' : '+'}${Math.abs(diff)}）`)
      }
    }
    const report = scanStyle(text, { bannedTerms: config.bannedTerms, replacements })
    context.data.styleScan = report
    if (report.totalHits > 0) {
      const top = [...report.hits]
        .sort((a, b) => b.count - a.count)
        .slice(0, 5)
        .map(h => `${h.term}×${h.count}`)
        .join('、')
      callbacks.log(`  🔍 接地气扫描：${report.totalHits} 处命中（${top}）`)
    } else {
      callbacks.log('  🔍 接地气扫描：未发现明显 AI 腔命中')
    }
    return text
  }

  /**
   * 篇幅闸门：草稿字数低于目标下限时，自动发起续写补足（最多 2 轮）。
   *
   * 背景：写稿模板对字数只有"大约 N 字左右"的弱约束，且紧邻多条反注水指令，
   * 模型会系统性写短；而原链路对字数不做任何校验，短稿会直接入库。
   * 走"续写补足"而非"整篇重写"，是为了保住第一轮已经写好的文笔与细节。
   */
  private async ensureWordCount(
    draft: string,
    targetWords: number,
    systemRole: string,
    callbacks: CommandExecuteParams['callbacks'],
    context: CommandExecuteParams['context'],
  ): Promise<string> {
    if (!targetWords || targetWords <= 0) return draft

    const floor = resolveWordTiers(targetWords).shortFloor
    const MAX_ROUNDS = 2
    let result = draft

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const current = this.countWords(result)
      if (current >= floor) {
        if (round === 1) callbacks.log(`  📏 篇幅校验通过：${current} 字（目标 ${targetWords} / 下限 ${floor}）`)
        return result
      }

      const gap = targetWords - current
      callbacks.log(`  📏 篇幅不足：${current} 字 < 下限 ${floor} 字，自动续写补足约 ${gap} 字（第 ${round}/${MAX_ROUNDS} 轮）...`)

      const continuePrompt = `你正在完成一章尚未写完的小说正文。下面是本章已经写好的部分，它的篇幅不足，需要你直接续写下去。

【本章写作方向】
${typeof this.chapterInfo === 'object' ? JSON.stringify(this.chapterInfo, null, 2) : String(this.chapterInfo)}

【本章已写好的部分（全文）】
${result}

【续写要求】
1. 直接从上文的最后一句往下接着写，不要重写开头，不要复述或改写上文已有的任何段落，不要写"（续）"之类的标记。
2. 需要补足约 ${gap} 字，使本章总字数达到 ${targetWords} 字左右。
3. 补足篇幅的方式是把本章既定情节的每个节拍写足：补足场景的五感细节、角色的动作与微表情、对白的来回交锋与言外之意、主角的即时心理判断。严禁靠设定科普、无关寒暄、重复同一信息点来凑字数，更不许把后续章节的情节提前写进来。
4. 如果上文末尾已经像是一个收尾，请把它当作本章中途的一个小高潮，继续往下推进剧情。
5. 在你续写内容的最后一段留下一个强力的悬念钩子，作为整章的断章点。
6. 只输出续写的正文纯文本，不要 Markdown 符号，对话用中文双引号，段落之间保留一个空行。`

      let added = ''
      try {
        added = this.stripThinkingTags(
          await this.callLLM(
            continuePrompt,
            systemRole,
            callbacks,
            { maxTokens: estimateMaxTokens(Math.min(gap + 200, targetWords)) },
            context,
            this.modelId,
          )
        )
      } catch (e) {
        // 用户取消必须向上传播：吞掉的话，被取消的草稿仍会继续走 Gate 并入库
        if (isWorkflowCancelled(e)) throw e
        callbacks.log(`  ⚠️ 续写补足失败，保留当前篇幅：${String(e)}`)
        return result
      }

      if (this.countWords(added) < 50) {
        callbacks.log('  ⚠️ 续写返回内容过少，停止补足')
        return result
      }

      result = `${result.trimEnd()}\n\n${added.trim()}`
      const after = this.countWords(result)
      callbacks.log(`  📏 补足后 ${after} 字${after >= floor ? '，已达标' : ''}`)
      if (after >= floor) return result
    }

    callbacks.log(`  ⚠️ 已达最大补足轮次，最终 ${this.countWords(result)} 字（目标 ${targetWords}）`)
    return result
  }

  /** 加载未回收伏笔，格式化为写稿上下文（到期伏笔会标注提醒本章回收） */
  private async buildForeshadowingContext(currentChapter: number): Promise<string> {
    try {
      const { formatOpenForeshadowings } = await import('../workflow-utils')
      const open = await ipc.invoke('db:foreshadow-get-open')
      return formatOpenForeshadowings(open, currentChapter)
    } catch {
      return '（暂无未回收伏笔）'
    }
  }

  /**
   * 一次并行读回最近 windowSize 章的定稿正文。
   * 上一章结尾与反雷同速览共用这份数据，避免同一章正文经 IPC 读两遍。
   */
  private async readRecentFinalizedContents(currentChapter: number, windowSize: number): Promise<Map<number, string>> {
    const result = new Map<number, string>()
    const nums: number[] = []
    for (let i = Math.max(1, currentChapter - windowSize); i < currentChapter; i++) nums.push(i)
    await Promise.all(nums.map(async (n) => {
      try {
        const meta = await ipc.invoke('db:draft-get-finalized', n)
        if (!meta) return
        const full = await ipc.invoke('db:draft-get-full', meta.id)
        const content = full?.content?.trim()
        if (content) result.set(n, content)
      } catch { /* 忽略单章读取失败 */ }
    }))
    return result
  }

  /**
   * 跨章反雷同：提炼近 10 章的首段（前 120 字）与断章句，并把已写过的伤情句单列，
   * 供本章规避雷同的起笔/转场/断章。
   */
  private buildAntiRepetitionContext(recentContents: Map<number, string>): string {
    const keys = Array.from(recentContents.keys()).sort((a, b) => a - b) // 由早到近
    if (keys.length === 0) return '（暂无往期章节可参考）'
    const injuryPattern = /(?:擦破|蹭破|划破|划伤|擦伤|伤口|刺痛|渗血|血珠|划痕|淤青)/g
    const lines: string[] = []
    const injuryLines: string[] = []
    for (const i of keys) {
      const content = recentContents.get(i) as string
      const firstPara = content.split(/\n+/).map((s) => s.trim()).filter(Boolean)[0] || ''
      const opening = firstPara.replace(/\s+/g, ' ').slice(0, 120)
      const closing = content.slice(-60).replace(/\s+/g, ' ')
      lines.push(`- 第${i}章 首段：「${opening}」｜断章：「…${closing}」`)
      const injuries = firstPara.match(injuryPattern)
      if (injuries && injuries.length > 0) {
        injuryLines.push(`第${i}章：${Array.from(new Set(injuries)).slice(0, 3).join('、')}`)
      }
    }
    const parts: string[] = [
      '【近 10 章首段（本章开场必须与之明显不同：不得复用相同起笔句式、相同意象或相同伤情句）】',
      ...lines,
    ]
    if (injuryLines.length > 0) {
      parts.push('', '【往期已在开篇写过的伤情句——本章禁止复用，旧伤未变化不得再写】', injuryLines.join('\n'))
    }
    parts.push('', '【开场硬规则】本章第一段必须承接上一章结尾的动作/事件/对话往下写，禁止以伤情、天气、汗味、气味等环境句作固定起手。')
    return parts.join('\n')
  }

  /**
   * 身体状态账本（D）：把角色卡里的位置/身体/装备/最近事件结构化注入，
   * 并附「未变化不复述」规则，避免每章开头都重写同一处擦伤。
   */
  private buildBodyStateLedger(allChars: CharacterData[]): string {
    const lines: string[] = []
    for (const card of allChars) {
      if (!card.name || !card.currentState) continue
      const cs = card.currentState
      lines.push(
        `- ${card.name}：位置=${cs.location || '未知'}；身体=${cs.physicalState || '正常'}；` +
        `装备=${cs.keyItems || '无'}；最近=第${cs.updatedAtChapter || 0}章 ${cs.recentEvents || '—'}`,
      )
    }
    if (lines.length === 0) return ''
    return [
      '【身体状态账本（未变化不得复述）】',
      ...lines,
      '规则：以上状态在本章没有明确变化时，禁止再次描写；尤其不得每章开头重复同一处擦伤/伤口刺痛。只有出现新的受伤、伤势加重、换部位或疲劳显著变化时，才允许用一句写出「部位+程度+体感」，且全章仅此一次。',
    ].join('\n')
  }

  /**
   * 开篇查重体检（B）：纯本地、零成本。
   * - 用二元组相似度比较本章首段与近 10 章首段，命中高度雷同提醒改开场；
   * - 若本章仍以伤情句起笔，且往期已有 ≥2 章同样以伤情开场，提醒改为动作承接。
   * 结果写入 context.data.openingAudit 供 UI / 报告使用，不阻断写稿。
   */
  private auditOpeningDuplicate(
    chapterNumber: number,
    content: string,
    recentContents: Map<number, string>,
    callbacks: CommandExecuteParams['callbacks'],
    context: CommandExecuteParams['context'],
  ): void {
    if (recentContents.size === 0) return
    const firstParagraph = content.split(/\n+/).map((s) => s.trim()).filter(Boolean)[0] || ''
    if (!firstParagraph) return
    const opening = firstParagraph.replace(/\s+/g, ' ').slice(0, 140)
    const injuryPattern = /(?:擦破|蹭破|划破|划伤|擦伤|伤口|刺痛|渗血|血珠|划痕|淤青)/g
    const injuryTest = /(?:擦破|蹭破|划破|划伤|擦伤|伤口|刺痛|渗血|血珠|划痕|淤青)/
    const openingInjury = Array.from(new Set(firstParagraph.match(injuryPattern) || []))
    const bigrams = (text: string): Set<string> => {
      const clean = text.replace(/[^\u4e00-\u9fa5]/g, '')
      const out = new Set<string>()
      for (let i = 0; i < clean.length - 1; i++) out.add(clean.slice(i, i + 2))
      return out
    }
    const openSet = bigrams(firstParagraph.slice(0, 120))
    let maxSim = 0
    let matchedChapter = 0
    const injuryRepeatChapters: number[] = []
    for (const [n, other] of recentContents) {
      const otherFirst = (other.split(/\n+/).map((s) => s.trim()).filter(Boolean)[0] || '').replace(/\s+/g, ' ')
      const otherSet = bigrams(otherFirst.slice(0, 120))
      if (openSet.size > 0 && otherSet.size > 0) {
        let inter = 0
        for (const g of openSet) if (otherSet.has(g)) inter++
        const sim = inter / Math.min(openSet.size, otherSet.size)
        if (sim > maxSim) {
          maxSim = sim
          matchedChapter = n
        }
      }
      if (openingInjury.length > 0 && injuryTest.test(otherFirst)) injuryRepeatChapters.push(n)
    }
    const similarity = Math.round(maxSim * 100) / 100
    context.data.openingAudit = {
      chapterNumber,
      opening,
      maxSimilarity: similarity,
      matchedChapter: similarity >= 0.35 ? matchedChapter : 0,
      injuryWords: openingInjury,
      injuryRepeatChapters,
    }
    if (similarity >= 0.5) {
      callbacks.log(`  ⚠️ 开篇查重：本章首段与第${matchedChapter}章首段高度相似（${Math.round(similarity * 100)}%），建议改开场`)
    } else if (openingInjury.length > 0 && injuryRepeatChapters.length >= 2) {
      callbacks.log(`  ⚠️ 开篇查重：本章仍以伤情起笔（${openingInjury.join('、')}），且第${injuryRepeatChapters.join('、')}章首段也写过伤情，建议改为承接动作起笔`)
    } else {
      callbacks.log(`  ✅ 开篇查重：与近章首段最高相似度 ${Math.round(similarity * 100)}%，未发现伤情复述`)
    }
  }

  /** 出场角色说话风格：从角色卡取本章出场角色中已填写口癖的，注入以保对白辨识度 */
  private buildCharacterVoiceContext(names: string[], allChars: CharacterData[]): string {
    if (!names || names.length === 0) return '（未指定出场角色）'
    const nameSet = new Set(names.map((n) => n.trim()).filter(Boolean))
    const lines = allChars
      .filter((c) => nameSet.has(c.name) && (c.speechStyle || '').trim())
      .map((c) => `- ${c.name}：${(c.speechStyle || '').trim()}`)
    return lines.length > 0
      ? lines.join('\n')
      : '（出场角色暂无说话风格档案，请自行赋予各角色有辨识度、彼此区分的对白）'
  }

  /**
   * 故事核心摘要（预算版）：只带故事前提 + 大纲前段 + 人物图谱前段。
   * 完整的 worldbuilding/charactersArch/synopsis 不再整份注入：
   * - 世界规则由「世界设定切片」承担；
   * - 人物动态与最近剧情由「Canon 紧凑上下文」承担。
   */
  private assembleArchitectureSummary(core: ProjectCoreData | null): string {
    const parts: string[] = []
    if (core?.premise) parts.push(`【故事前提】\n${core.premise.trim()}`)
    if (core?.synopsis) parts.push(`【情节大纲（前段摘要）】\n${core.synopsis.trim().slice(0, 900)}`)
    if (core?.charactersArch) parts.push(`【人物关系（前段摘要，完整状态见 Canon）】\n${core.charactersArch.trim().slice(0, 600)}`)
    return parts.join('\n\n')
  }

  private async readProjectPrompts(projectPath: string): Promise<string> {
    try {
      const files = await ipc.invoke('fs:list-dir', `${projectPath}/${DIR_PROMPTS}`)
      const mdFiles = files.filter((f: { isDir: boolean; name: string }) => !f.isDir && f.name.endsWith('.md'))
      if (mdFiles.length === 0) return ''
      const parts: string[] = []
      for (const f of mdFiles) {
        const result = await ipc.invoke('fs:read-file', f.path)
        if (result.success && result.content.trim()) {
          parts.push(`${i18n.t('generateDraft.projectGuidanceHeading', { ns: 'commands', name: f.name.replace(/\.md$/, '') })}\n${result.content.trim()}`)
        }
      }
      return parts.join('\n\n')
    } catch { return '' }
  }

  /** 把角色卡格式化为角色状态档案文本（Canon 构造失败时的回退注入源） */
  private formatCharacterStateArchive(allChars: CharacterData[]): string {
    const states: string[] = []
    for (const card of allChars) {
      if (card.name && card.currentState) {
        const cs = card.currentState
        states.push(
          `${card.name}（${card.role || '未知'}）| ` +
          `境界：${cs.powerLevel || '未知'} | ` +
          `位置：${cs.location || '未知'} | ` +
          `身体：${cs.physicalState || '正常'} | ` +
          `心理：${cs.mentalState || '正常'} | ` +
          `道具：${cs.keyItems || '无'} | ` +
          `已知：${cs.knownInfo || '—'} | ` +
          `最近：第${cs.updatedAtChapter || 0}章 ${cs.recentEvents || ''}`
        )
      }
    }
    return states.length > 0 ? `【角色状态档案】\n${states.join('\n')}` : '（暂无角色状态档案）'
  }
}
