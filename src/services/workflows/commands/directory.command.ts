import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { DirectoryPromptBuilder } from '../../prompts/prompt-builder'
import { DirectoryWorkflowParams, ChapterBlueprint, parseTextBlueprints, saveAllBlueprints } from '../directory-workflow'
import i18n from '../../../i18n'
import { globalEventBus } from '../../../shared/event-bus'
import {
  parseAttributeLedger, validateBlueprintLedger, validateBlueprintText, summarizeIssues,
  type AttributeLedger, type BlueprintRuleIssue,
} from '../../narrative-consistency/blueprint-rule-guard'

export class GenerateDirectoryCommand extends BaseWorkflowCommand<ChapterBlueprint[]> {
  constructor(private params: DirectoryWorkflowParams) {
    super()
  }

  async execute({ context, callbacks }: CommandExecuteParams): Promise<ChapterBlueprint[]> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(i18n.t('common.noProject', { ns: 'commands' }))
    const assertCurrent = () => {
      const active = useProjectStore.getState()
      if (context.cancelled) throw new Error(i18n.t('base.workflowCancelled', { ns: 'commands' }))
      if (active.loading || active.currentProject?.id !== project.id || active.currentProject?.path !== project.path ||
          (context.data.directoryProjectPath && context.data.directoryProjectPath !== project.path)) throw new Error('PROJECT_CHANGED')
    }
    assertCurrent()
    context.data.directoryProjectPath = project.path

    const architecture = context.data.architecture as string
    const existingBlueprints = (context.data.existingBlueprints || []) as ChapterBlueprint[]

    const totalChapters = project.novelConfig.totalChapters
    const globalGuidance = project.novelConfig.globalGuidance || ''
    const genre = project.novelConfig.genre || ''

    let startChapter = 1
    let endChapter = totalChapters

    if (this.params.mode === 'append') {
      startChapter = this.params.startChapter || (Math.max(0, ...existingBlueprints.map(bp => bp.chapterNumber)) + 1)
      if (this.params.count && this.params.count > 0) {
        endChapter = startChapter + this.params.count - 1
      }
    } else if (this.params.count && this.params.count > 0) {
      endChapter = Math.min(this.params.count, totalChapters)
    }

    if (!Number.isSafeInteger(startChapter) || !Number.isSafeInteger(endChapter) || startChapter < 1 || endChapter < startChapter) {
      throw new Error(i18n.t('directory.invalidRange', { ns: 'commands' }))
    }

    callbacks.log(i18n.t('directory.generatingBlueprintsRange', { ns: 'commands', from: startChapter, to: endChapter }))

    // 从当前默认模型获取 maxTokens，动态计算每批次章节数
    const llmStore = (await import('../../../stores/llm-store')).useLLMStore.getState()
    const defaultModel = llmStore.models.find(m => m.id === llmStore.defaultModelId)
    const modelMaxTokens = defaultModel?.maxTokens || 4096
    const outputBudget = Math.floor(modelMaxTokens * 0.6)  // 预留 40% 给 prompt + 思考
    const tokensPerChapter = 600
    const batchSize = Math.min(20, Math.max(1, Math.floor(outputBudget / tokensPerChapter)))

    const newBlueprints: ChapterBlueprint[] = []
    // 属性账游标：跨批次传递上一章章末四维，防止模型每批都从零记账。
    const lastExisting = [...existingBlueprints].sort((a, b) => b.chapterNumber - a.chapterNumber)[0]
    let ledgerCursor: AttributeLedger['after'] | null = lastExisting
      ? parseAttributeLedger(lastExisting.userGuidance || '')?.after ?? null
      : (startChapter === 1 ? [10, 1, 1, 1] : null)
    // 使用游标追踪生成进度，支持 AI 超额返回时智能跳过后续批次
    let cursor = startChapter

    while (cursor <= endChapter) {
      assertCurrent()

      const batchEnd = Math.min(cursor + batchSize - 1, endChapter)
      callbacks.log(`  ${i18n.t('directory.generatingBatch', { ns: 'commands', from: cursor, to: batchEnd })}`)

      let prompt: string
      if (cursor === 1 && this.params.mode === 'full') {
        const template = getPromptTemplate('chapter_blueprint')
        if (!template) throw new Error(i18n.t('common.templateMissing', { ns: 'commands' }))
        prompt = new DirectoryPromptBuilder(template)
          .withNovelArchitecture(architecture)
          .withNumberOfChapters(batchEnd)
          .withGlobalGuidance(globalGuidance)
          .withGenre(genre)
          .withPacingGuidance((context.data.pacingGuidance as string) || '')
          .build()
      } else {
        const template = getPromptTemplate('chapter_blueprint_chunk')
        if (!template) throw new Error(i18n.t('common.templateMissing', { ns: 'commands' }))

        const prevAll = [...existingBlueprints, ...newBlueprints]
        const chapterList = prevAll.slice(-100).map(c => `${i18n.t('generateDraft.chapterNumberTitle', { ns: 'commands', chapter: c.chapterNumber, title: c.title })}：${c.keyEvents}`).join('\n')

        prompt = new DirectoryPromptBuilder(template)
          .withNovelArchitecture(architecture)
          .withChapterList(chapterList || i18n.t('directory.firstBatchPlaceholder', { ns: 'commands' }))
          .withNumberOfChapters(totalChapters)
          .withN(cursor)
          .withM(batchEnd)
          .withGlobalGuidance(globalGuidance)
          .withGenre(genre)
          .withPacingGuidance((context.data.pacingGuidance as string) || '')
          .build()
      }

      if (ledgerCursor) {
        prompt += `\n\n【本章起始属性账（硬约束，优先级高于一切文风要求）】\n上一章出=${ledgerCursor.join('/')}（顺序：心识/体魄/力量/敏捷）。本轮第${cursor}章的【属性账】“进”必须逐项等于该值；全书第一章的起始值为10/1/1/1。`
      }

      callbacks.setProgress(Math.round(((cursor - startChapter) / (endChapter - startChapter + 1)) * 90))

      // systemRole 由模板定义，不再硬编码
      const systemRole = getPromptTemplate('chapter_blueprint')?.systemRole || i18n.t('directory.systemRoleDefault', { ns: 'commands' })
      const resultText = await this.callLLM(prompt, systemRole, callbacks, { responseFormat: { type: 'json_object' }, thinking: false }, context)
      assertCurrent()

      // ★ 关键修复：接受 AI 返回的从 cursor 到 endChapter 范围内的所有有效章节
      // AI 可能一次性返回超出本批次（batchEnd）的章节，全部保留，避免浪费和重复 LLM 请求
      const parsed = parseTextBlueprints(resultText, cursor, endChapter)
      if (!parsed.length) throw new Error(i18n.t('directory.emptyResult', { ns: 'commands', from: cursor, to: batchEnd }))
      // Do not advance past holes or report an incomplete response as a complete batch.
      if (parsed.some((bp, index) => bp.chapterNumber !== cursor + index)) {
        throw new Error(i18n.t('directory.missingChapters', { ns: 'commands', from: cursor, to: batchEnd }))
      }
      // ==== 规则闸门：属性账断链/1/4铁律/废弃术语 ====
      const batchIssues: BlueprintRuleIssue[] = []
      let probe = ledgerCursor
      for (const bp of parsed) {
        batchIssues.push(...validateBlueprintText(bp.chapterNumber, bp))
        const checked = validateBlueprintLedger(bp.chapterNumber, bp.userGuidance || '', probe, bp.chapterNumber <= 3)
        batchIssues.push(...checked.issues)
        if (checked.ledger) probe = checked.ledger.after
      }
      if (batchIssues.some(issue => issue.level === 'error')) {
        callbacks.log(`规则闸门拦截：\n${summarizeIssues(batchIssues)}`)
        throw new Error(`BLUEPRINT_RULE_VIOLATION:\n${summarizeIssues(batchIssues)}`)
      }
      if (batchIssues.length) callbacks.log(`规则提示：\n${summarizeIssues(batchIssues)}`)
      if (probe) ledgerCursor = probe

      newBlueprints.push(...parsed)

      // ==== 批次入库 ====
      if (parsed.length > 0) {
        await saveAllBlueprints(parsed, project.path)
        assertCurrent()
        globalEventBus.emit('BLUEPRINTS_UPDATED', { projectPath: project.path, count: newBlueprints.length })
        void useProjectStore.getState().refreshFileTree()
      }

      // 计算本次实际生成到的最大章节号，推进游标到已生成的最后一章之后
      const actualMaxChapter = parsed.length > 0
        ? Math.max(...parsed.map(p => p.chapterNumber))
        : batchEnd
      callbacks.log(`  ${i18n.t('directory.batchComplete', { ns: 'commands', from: cursor, max: actualMaxChapter, count: parsed.length })}`)

      cursor = actualMaxChapter + 1
    }

    context.data.newBlueprints = newBlueprints
    context.data.existingBlueprints = existingBlueprints

    callbacks.log(i18n.t('directory.totalGenerated', { ns: 'commands', count: newBlueprints.length }))
    return newBlueprints
  }
}
