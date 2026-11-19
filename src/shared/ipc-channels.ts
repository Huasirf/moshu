/**
 * 墨枢 IPC 频道定义 — 渲染进程与主进程的类型安全通信契约
 * 所有 IPC 调用都通过此文件定义频道名和参数/返回值类型
 */
import type {
  RuleItem, RuleSnapshotMeta, RuleSnapshotFull,
  TimelineEvent, TimelineConfig, TimelineIssue,
} from './rule-timeline'

// ===== 全局配置 =====
export interface ConfigChannels {
  'config:get': {
    args: []
    return: GlobalConfig
  }
  'config:set': {
    args: [config: Partial<GlobalConfig>]
    return: { success: boolean; error?: string }
  }
  'config:get-moshu-home': {
    args: []
    return: string
  }
}

export interface GlobalConfig {
  theme: string
  defaultModelId: string | null
  defaultEmbeddingModelId?: string | null
  defaultImageModelId?: string | null
  editorFontSize: number
  editorFontFamily: string
  autoSaveInterval: number
  proxy?: {
    enabled: boolean
    type: 'http' | 'socks5'
    host: string
    port: number
  }
}

// ===== 项目管理 =====
export interface ProjectChannels {
  'project:create': {
    args: [config: { name: string; path: string; genre: string; targetAudience: string }]
    return: { success: boolean; projectId: string; projectPath?: string; error?: string }
  }
  'project:open': {
    args: [projectPath: string]
    return: { success: boolean; project: ProjectData | null; error?: string }
  }
  'project:save': {
    args: [projectId: string, data: Partial<ProjectData>]
    return: { success: boolean; error?: string }
  }
  'project:update-config': {
    args: [projectId: string, data: Partial<ProjectData>]
    return: { success: boolean; error?: string }
  }
  'project:recent-list': {
    args: []
    return: Array<{ name: string; path: string; updatedAt: string }>
  }
  'project:remove-recent': {
    args: [projectPath: string]
    return: { success: boolean; error?: string }
  }
  'project:reveal': {
    args: [projectPath: string]
    return: { success: boolean; error?: string }
  }
  'project:delete': {
    args: [projectPath: string]
    return: { success: boolean; error?: string; missing?: boolean }
  }
  'project:registry-list': {
    args: []
    return: ProjectRegistryEntry[]
  }
  'project:registry-pin': {
    args: [projectPath: string, pinned: boolean]
    return: { success: boolean }
  }
  'project:registry-forget': {
    args: [projectPath: string]
    return: { success: boolean }
  }
  'project:registry-refresh': {
    args: [projectPath: string]
    return: { success: boolean }
  }
  'dialog:select-folder': {
    args: []
    return: string | null
  }
}

// ===== 文件系统 =====
export interface FileChannels {
  'fs:read-file': {
    args: [filePath: string]
    return: { success: boolean; content: string; error?: string }
  }
  'fs:write-file': {
    args: [filePath: string, content: string]
    return: { success: boolean; error?: string }
  }
  'fs:list-dir': {
    args: [dirPath: string]
    return: FileNode[]
  }
  'fs:mkdir': {
    args: [dirPath: string]
    return: { success: boolean; error?: string }
  }
  'fs:check-exists': {
    args: [filePath: string]
    return: boolean
  }
  'fs:read-json': {
    args: [filePath: string]
    return: { success: boolean; data: unknown; error?: string }
  }
  'fs:write-json': {
    args: [filePath: string, data: unknown]
    return: { success: boolean; error?: string }
  }
}

// ===== LLM 调用 =====
export interface LLMChannels {
  'llm:generate': {
    args: [request: LLMRequest]
    return: LLMResponse
  }
  'llm:generate-stream': {
    args: [requestId: string, request: LLMRequest]
    return: { requestId: string; started: boolean }
  }
  'llm:cancel': {
    args: [requestId: string]
    return: { success: boolean }
  }
  /** apiKey 为打码值（••••••••+末 4 位），真实 Key 只保存在主进程（safeStorage 加密） */
  'llm:list-models': {
    args: []
    return: ModelProfile[]
  }
  'llm:ollama-models': { args: [baseUrl: string, apiKey?: string]; return: { success: boolean; models: string[]; error?: string } }
  /** 从绑定的上游地址拉取模型列表；apiKey 传打码值时用 id 找到已保存的 Key */
  'llm:discover-models': {
    args: [input: {
      id?: string
      protocol: ModelProfile['protocol']
      provider?: ModelProfile['provider']
      baseUrl: string
      apiKey?: string
    }]
    return: {
      success: boolean
      models: Array<{ id: string; name?: string; ownedBy?: string }>
      error?: string
    }
  }
  /** apiKey 传打码值表示沿用已保存的 Key（接口地址改了则失败，需重新填写），传空串表示清除 */
  'llm:save-model': {
    args: [model: ModelProfile]
    return: { success: boolean; error?: string }
  }
  'llm:delete-model': {
    args: [modelId: string]
    return: { success: boolean }
  }
  'llm:set-default-model': {
    args: [modelId: string | null]
    return: { success: boolean; error?: string }
  }
  'llm:get-default-model': {
    args: []
    return: string | null
  }
  'llm:set-default-embedding-model': {
    args: [modelId: string | null]
    return: { success: boolean; error?: string }
  }
  'llm:get-default-embedding-model': {
    args: []
    return: string | null
  }
  'llm:set-default-image-model': {
    args: [modelId: string | null]
    return: { success: boolean; error?: string }
  }
  'llm:get-default-image-model': {
    args: []
    return: string | null
  }
  'export:epub': {
    args: [payload: {
      title: string
      author: string
      language?: string
      outputPath: string
      chapters: Array<{ title: string; content: string }>
    }]
    return: { success: boolean; path?: string; error?: string }
  }
  'image:generate': {
    args: [payload: {
      model: ModelProfile
      prompt: string
      /** 反向提示词：描述不希望出现的元素，比写在正面提示词里的「禁止…」更有效 */
      negativePrompt?: string
      projectPath: string
      size?: string
      filenameHint?: string
    }]
    return: { success: boolean; path?: string; dataUrl?: string; error?: string }
  }
  /** 手动导入外部图片作为人设图 / 配图（弹出文件选择框，复制到项目内） */
  'image:import': {
    args: [payload: { projectPath: string; filenameHint?: string }]
    return: { success: boolean; canceled?: boolean; path?: string; dataUrl?: string; error?: string }
  }
  'image:read': {
    args: [filePath: string]
    return: { success: boolean; dataUrl?: string; error?: string }
  }
  'llm:test-connection': {
    args: [model: ModelProfile]
    return: { success: boolean; error?: string; dimension?: number }
  }
}

export interface LLMStreamEvents {
  'llm:stream-chunk': { requestId: string; chunk: string }
  'llm:stream-done': { requestId: string; fullText: string; usage?: TokenUsage }
  'llm:stream-error': { requestId: string; error: string }
}

// ===== 公共数据类型 =====
export interface ProjectData {
  id: string
  name: string
  path: string
  novelConfig: NovelConfig
  characterStates: string
  createdAt: string
  updatedAt: string
}

export interface NovelConfig {
  genre: string
  subGenre: string
  targetAudience: string
  totalChapters: number
  wordsPerChapter: number
  plotStructure: 'three_act' | 'heros_journey' | 'save_the_cat' | 'kishotenketsu' | 'multi_thread' | 'freeform'
  narrativePOV: 'third_limited' | 'first_person' | 'third_omniscient' | 'multi_pov'
  coreOutline: string
  worldSetting: string
  /** 规则区·判定细则：属性成长、精神力恢复、伤势治疗、试炼结算等硬规则 */
  rulebook?: string
  goldenFinger: string
  protagonistProfile: string
  globalGuidance: string
  writingStyle?: string
  styleReference?: string
  referenceWorks?: string
  /** 项目禁用词表：写稿/去味 prompt 会注入，生成后扫描并给出 warning（style-scan） */
  bannedTerms?: string[]
  /** 禁用词替换表：key=禁用词，value=替换词；生成后做确定性替换，不额外调用 LLM */
  replacements?: Record<string, string>
  /** 全局美术风格：统一注入到人设图与章节配图的文生图提示词末尾，保证全书画风一致 */
  artStyle?: string
  /** 全局反向提示词：统一作为 negative_prompt 发送，排除写实、人形等不希望出现的元素 */
  negativePrompt?: string
}

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

/** 项目登记表条目（~/.moshu/projects.json），供主页工作台展示 */
export interface ProjectRegistryEntry {
  id: string
  name: string
  path: string
  genre: string
  totalChapters: number
  draftedCount: number
  wordCount: number
  lastOpenedAt: string
  createdAt: string
  pinned: boolean
  coverColor: string
  missing?: boolean
}

export interface LLMRequest {
  modelId: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  temperature?: number
  maxTokens?: number
  stream?: boolean
  responseFormat?: { type: 'json_object' | 'text' }
  /** true = 使用模型配置的档位（未配置则 high），false = 关闭，字符串 = 指定档位 */
  thinking?: boolean | ThinkingLevel
}

export interface LLMResponse {
  success: boolean
  content: string
  usage?: TokenUsage
  error?: string
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** 平台统一的思考档位（各协议自行映射到上游参数） */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high'

/**
 * 模型思考能力声明。整块省略表示「默认不发送任何思考参数」。
 * 参考 CC Switch 的档位映射语义：
 * - map 里字符串 = 该档位发往上游的实际值
 * - map 里 null = 该档位明确不支持（调用时报错，而不是静默降级）
 * - map 缺键 = 使用协议内置默认映射
 */
export interface ThinkingProfile {
  /** false 表示上游不支持思考，界面不提供档位选择 */
  supports?: boolean
  /** false 表示上游只有开/关，没有档位（DeepSeek、GLM 等） */
  supportsLevels?: boolean
  /** 该模型的默认思考档位；省略时由调用方决定 */
  defaultLevel?: ThinkingLevel
  /** 档位 → 上游实际值（主要给 OpenAI 兼容中转站覆盖 reasoning_effort 词表） */
  map?: Partial<Record<ThinkingLevel, string | null>>
}

export interface ModelProfile {
  id: string
  name: string
  provider: 'openai' | 'gemini' | 'anthropic' | 'deepseek' | 'ollama' | 'bigmodel' | 'custom'
  /** 调用协议：OpenAI 兼容 / Gemini 原生 / Anthropic 原生（Messages API，支持提示缓存） */
  protocol: 'openai' | 'gemini' | 'anthropic'
  modelName: string
  apiKey: string
  baseUrl: string
  temperature: number
  maxTokens: number
  purposes: Array<'generation' | 'refinement' | 'summary' | 'embedding' | 'image'>
  /** 思考能力声明；省略时完全不发送思考参数（旧配置零迁移） */
  thinking?: ThinkingProfile
}

// ===== 引入 DB 类型 =====
import type { ProjectCoreData } from '../../electron/repositories/project-core-repository'
import type { BlueprintData } from '../../electron/repositories/blueprint-repository'
import type { CharacterData, CharacterStateData } from '../../electron/repositories/character-repository'
import type { ChapterImageData } from '../../electron/repositories/chapter-image-repository'
import type { DraftMeta, DraftFull } from '../../electron/repositories/draft-repository'
import type { ChapterSearchOptions, ChapterSearchResult } from '../../electron/repositories/chapter-search-repository'
import type { RevisionMeta, RevisionFull } from '../../electron/repositories/revision-repository'
import type { ReviewMeta, ReviewFull } from '../../electron/repositories/review-repository'
import type { RehearsalContext } from './story-rehearsal'
import type { PostProcessRunData, PostProcessStepData } from '../../electron/repositories/post-process-repository'
import type { ForeshadowingData } from '../../electron/repositories/foreshadowing-repository'
import type { AssetData, AssetEntityType, AssetInput } from '../../electron/repositories/asset-repository'
import type {
  AttributeDef,
  AttributePanelEntry,
  AttributePhase,
  AttributeValue,
  AttributeValueInput,
} from '../../electron/repositories/attribute-repository'
import type { EntityRelation, EntityRelationInput } from '../../electron/repositories/relation-repository'
import type { ChapterPipelineState } from '../../electron/repositories/pipeline-repository'
import type {
  FinalizeWritebackInput,
  FinalizeWritebackResult,
} from '../../electron/services/finalize-writeback'
import type { StyleProfile, StyleProfileInput } from '../../electron/repositories/style-repository'
import type {
  ReviewFinding,
  ReviewFindingInput,
  ReviewFindingStatus,
} from '../../electron/repositories/review-finding-repository'
import type { ChapterStage } from './chapter-stage'
import type {
  MutationPlan,
  MutationPlanExecution,
  MutationPlanExecutionOptions,
  MutationPlanPreview,
} from './mutation-plan'

// ===== 数据库操作 =====
export interface DatabaseChannels {
  'agent:state-read': { args: []; return: string | null }
  'agent:state-write': { args: [serialized: string]; return: void }
  'story:index': { args: [projectPath: string, query?: string, offset?: number]; return: import('./story-revision').StoryIndex }
  'story:read': { args: [projectPath: string, request: import('./story-revision').StoryReadRequest]; return: import('./story-revision').StoryReadResult }
  'story:apply': { args: [projectPath: string, request: import('./story-revision').StoryRevisionRequest]; return: import('./story-revision').StoryRevision }
  'story:history': { args: [projectPath: string]; return: import('./story-revision').StoryRevision[] }
  'story:undo': { args: [projectPath: string, id: string]; return: import('./story-revision').StoryRevision }
  'db:rehearsal-context': { args: [projectPath: string, chapterNumber: number]; return: RehearsalContext }
  'db:close': { args: []; return: { success: boolean } }

  // 0. 备份（文件在 {项目}/.moshu/backups/，自动备份见 electron/db-auto-backup.ts）
  'db:backup-now': { args: []; return: { success: boolean; file?: string; error?: string } }
  'db:backup-open-dir': { args: []; return: { success: boolean; error?: string } }

  // 1. project_core
  'db:project-core-get': { args: []; return: ProjectCoreData | null }
  'db:project-core-update': { args: [data: Partial<ProjectCoreData>]; return: { success: boolean; error?: string } }

  // 1.1 rule_items — 结构化规则库
  'db:rule-items-list': { args: []; return: RuleItem[] }
  'db:rule-items-save': {
    args: [items: Array<Partial<RuleItem> & { group: string; title: string; body: string }>]
    return: { success: boolean; items?: RuleItem[]; compiled?: string; error?: string }
  }
  'db:rule-items-seed': {
    args: [rulebook?: string]
    return: { success: boolean; items?: RuleItem[]; compiled?: string; error?: string }
  }
  'db:rule-snapshot-list': { args: [limit?: number]; return: RuleSnapshotMeta[] }
  'db:rule-snapshot-get': { args: [id: number]; return: RuleSnapshotFull | null }
  'db:rule-snapshot-restore': { args: [id: number]; return: { success: boolean; items?: RuleItem[]; compiled?: string; error?: string } }

  // 1.2 章纲时间线
  'db:timeline-events-get': { args: [chapterNumber: number]; return: TimelineEvent[] }
  'db:timeline-events-all': { args: [limit?: number]; return: TimelineEvent[] }
  'db:timeline-events-save': {
    args: [chapterNumber: number, events: Array<Partial<TimelineEvent> & { summary: string }>]
    return: { success: boolean; events?: TimelineEvent[]; error?: string }
  }
  'db:timeline-config-get': { args: []; return: TimelineConfig }
  'db:timeline-config-save': { args: [config: Partial<TimelineConfig>]; return: TimelineConfig }
  'db:timeline-validate': { args: []; return: TimelineIssue[] }
  'db:timeline-context': { args: [chapterNumber: number]; return: string }

  // 2. blueprints
  'db:blueprint-get-all': { args: [projectPath?: string]; return: BlueprintData[] }
  'db:blueprint-get': { args: [chapterNumber: number]; return: BlueprintData | null }
  'db:blueprint-upsert': { args: [data: BlueprintData, projectPath?: string]; return: { success: boolean; error?: string } }
  'db:blueprint-commit': { args: [items: BlueprintData[], deleted: number[], expected: BlueprintData[], projectPath: string]; return: { success: boolean; error?: string } }
  'db:blueprint-upsert-many': { args: [items: BlueprintData[], projectPath?: string]; return: { success: boolean; error?: string } }
  'db:blueprint-update-notes': { args: [chapterNumber: number, notes: string]; return: { success: boolean; error?: string } }
  /** 把下游章节蓝图标记为 'stale'（上游大纲改动后待刷新，只改 status） */
  'db:blueprint-mark-stale': { args: [chapterNumbers: number[]]; return: { success: boolean; updated?: number; error?: string } }

  // 3. characters
  'db:character-get-all': { args: []; return: CharacterData[] }
  'db:character-upsert': { args: [data: CharacterData]; return: { success: boolean; error?: string } }
  'db:character-save-all': { args: [items: CharacterData[]]; return: { success: boolean; error?: string } }
  'db:character-delete': { args: [name: string]; return: { success: boolean; error?: string } }
  'db:character-rename': { args: [oldName: string, newName: string]; return: { success: boolean; error?: string } }
  'db:character-update-state': { args: [name: string, state: CharacterStateData]; return: { success: boolean; error?: string } }
  'db:character-update-speech': { args: [name: string, speechStyle: string]; return: { success: boolean; error?: string } }
  'db:character-update-portrait': { args: [name: string, portraitPath: string]; return: { success: boolean; error?: string } }
  /** 角色卡 2.0：字段级状态变更流水（最近的在前） */
  'db:character-history-list': { args: [name: string, limit?: number]; return: Array<{ id: number; characterName: string; chapterNumber: number; field: string; before: unknown; after: unknown; source: string; createdAt: string }> | { success: false; error: string } }
  /** 角色卡 2.0：某章末全体角色动态状态快照 */
  'db:character-snapshot-map': { args: [chapterNumber: number]; return: Record<string, CharacterStateData> }
  'db:chapter-image-list': { args: [chapterNumber: number]; return: ChapterImageData[] }
  'db:chapter-image-add': { args: [payload: { chapterNumber: number; kind: 'header' | 'scene'; path: string; prompt: string }]; return: { success: boolean; id?: number; error?: string } }
  'db:chapter-image-delete': { args: [id: number]; return: { success: boolean; error?: string } }

  // 4. drafts
  'db:draft-create': { args: [params: { chapterNumber: number; version: number; source: 'write' | 'rewrite'; content: string; wordCount: number }]; return: { success: boolean; id?: number; error?: string } }
  'db:draft-list': { args: [chapterNumber: number]; return: DraftMeta[] }
  'db:draft-list-all': { args: []; return: DraftMeta[] }
  'db:draft-get-meta': { args: [id: number]; return: DraftMeta | null }
  'db:draft-get-full': { args: [id: number]; return: DraftFull | null }
  'db:draft-get-latest': { args: [chapterNumber: number]; return: DraftMeta | null }
  'db:draft-get-finalized': { args: [chapterNumber: number]; return: DraftMeta | null }
  'db:draft-get-max-finalized-chapter': { args: []; return: number }
  'db:draft-next-version': { args: [chapterNumber: number]; return: number }
  'db:draft-update-status': { args: [id: number, status: string, wordCount?: number]; return: { success: boolean; error?: string } }
  /** 设为该章唯一正式定稿：同章其他 finalized 自动降级为 archived */
  'db:draft-finalize': { args: [chapterNumber: number, id: number, wordCount: number]; return: { success: boolean; error?: string } }
  /** 取消定稿：仅允许当前最新定稿章；先自动备份，再清理本章全部派生数据 */
  'db:chapter-unfinalize': {
    args: [chapterNumber: number]
    return: {
      success: boolean
      error?: string
      result?: {
        chapterNumber: number
        backupFile: string
        removedFiles: string[]
        removedKbDocs: string[]
        warnings: string[]
      }
    }
  }
  'db:draft-update-content': { args: [id: number, content: string, wordCount: number]; return: { success: boolean; error?: string } }
  /** 全局搜索：每章搜一份代表稿（定稿优先，否则最新未归档草稿），query 按字面量匹配 */
  'db:search-chapters': { args: [query: string, options?: ChapterSearchOptions]; return: ChapterSearchResult }

  // 5. revisions
  'db:revision-create': { args: [params: { baseDraftId: number; revisionIndex: number; revisionType: 'refine' | 'review-fix'; userPrompt?: string; reviewSourceId?: number; content: string; wordCount: number }]; return: { success: boolean; id?: number; error?: string } }
  'db:revision-list': { args: [baseDraftId: number]; return: RevisionMeta[] }
  'db:revision-get-pending': { args: [baseDraftId: number]; return: RevisionMeta[] }
  'db:revision-get-full': { args: [id: number]; return: RevisionFull | null }
  'db:revision-next-index': { args: [baseDraftId: number]; return: number }
  'db:revision-mark-merged': { args: [id: number, mergedToDraftId: number]; return: { success: boolean; error?: string } }
  'db:revision-mark-discarded': { args: [id: number]; return: { success: boolean; error?: string } }

  // 6. reviews
  'db:review-create': { args: [params: { baseDraftId: number; reviewIndex: number; content: string }]; return: { success: boolean; id?: number; error?: string } }
  'db:review-list': { args: [baseDraftId: number]; return: ReviewMeta[] }
  'db:review-get-latest': { args: [baseDraftId: number]; return: ReviewFull | null }
  'db:review-get-full': { args: [id: number]; return: ReviewFull | null }
  'db:review-next-index': { args: [baseDraftId: number]; return: number }

  // 7. post_process
  'db:post-process-create-run': { args: [params: { triggerSourceType: string; triggerSourceId: string; sourceLabel: string; steps: Array<{ key: string; label: string; critical: boolean }> }]; return: { success: boolean; id?: string; error?: string } }
  'db:post-process-get-latest-run': { args: [sourceType: string, sourceId: string]; return: PostProcessRunData | null }
  'db:post-process-get-steps': { args: [runId: string]; return: PostProcessStepData[] }
  'db:post-process-mark-step-ok': { args: [runId: string, stepKey: string]; return: { success: boolean; error?: string } }
  'db:post-process-mark-step-failed': { args: [runId: string, stepKey: string, errorMsg: string]; return: { success: boolean; error?: string } }
  'db:post-process-is-all-passed': { args: [sourceType: string, sourceId: string]; return: boolean }

  // 10. foreshadowings — 伏笔/线索台账
  'db:foreshadow-get-all': { args: []; return: ForeshadowingData[] }
  'db:foreshadow-get-open': { args: []; return: ForeshadowingData[] }
  'db:foreshadow-create': { args: [data: { content: string; plantedChapter: number; expectedChapter?: number | null; notes?: string }]; return: { success: boolean; id?: number; error?: string } }
  'db:foreshadow-mark-paid': { args: [id: number, paidChapter: number]; return: { success: boolean; error?: string } }
  'db:foreshadow-update': { args: [data: ForeshadowingData]; return: { success: boolean; error?: string } }
  'db:foreshadow-delete': { args: [id: number]; return: { success: boolean; error?: string } }

  // 沿用旧表
  'db:log-llm-call': { args: [call: Record<string, unknown>]; return: { success: boolean } }
  'db:get-llm-stats': { args: []; return: { totalCalls: number; totalTokens: number; totalPromptTokens: number; totalCompletionTokens: number } }
  'db:get-llm-history': { args: [limit?: number]; return: unknown[] }
  'db:save-summary-snapshot': { args: [chapterNumber: number, characterStates: string]; return: { success: boolean } }
  'db:get-latest-summary': { args: []; return: { characterStates: string; chapterNumber: number } | null }

  // ===== Canon Store (叙事一致性) =====
  'db:canon-timeline-get': { args: [maxChapter: number, includeFlashback?: boolean]; return: CanonTimelineEvent[] }
  'db:canon-timeline-get-chapter': { args: [chapterNumber: number]; return: CanonTimelineEvent[] }
  'db:canon-timeline-append': { args: [event: CanonTimelineEventInput]; return: { success: boolean; id?: number; error?: string } }
  'db:canon-timeline-clear-chapter': { args: [chapterNumber: number]; return: { success: boolean } }
  'db:canon-timeline-clear-extracted': { args: [chapterNumber: number]; return: { success: boolean } }
  'db:canon-timeline-set-status': { args: [id: number, status: 'confirmed' | 'pending' | 'rejected']; return: { success: boolean } }
  'db:canon-timeline-pending': { args: []; return: CanonTimelineEvent[] }
  'db:canon-character-state-get-all': { args: []; return: CanonCharacterStateSnapshot[] }
  'db:canon-character-state-get': { args: [character: string]; return: CanonCharacterStateSnapshot | null }
  'db:canon-character-state-upsert': { args: [snapshot: CanonCharacterStateSnapshot]; return: { success: boolean; error?: string } }
  'db:canon-plot-list': { args: [status?: 'active' | 'resolved' | 'paused']; return: CanonPlotLine[] }
  'db:canon-plot-add': { args: [line: CanonPlotLineInput]; return: { success: boolean; id?: number; error?: string } }
  'db:canon-plot-advance': { args: [id: number, currentState: string, lastAdvancedAt: number]; return: { success: boolean } }
  'db:canon-plot-resolve': { args: [id: number, chapterNumber: number]; return: { success: boolean } }
  'db:canon-fact-list': { args: []; return: CanonFact[] }
  'db:canon-fact-add': { args: [fact: CanonFactInput]; return: { success: boolean; id?: number; error?: string } }
  'db:canon-fact-clear-chapter': { args: [chapterNumber: number]; return: { success: boolean } }
  'db:canon-summary-get': { args: [chapterNumber: number]; return: CanonChapterSummary | null }
  'db:canon-summary-list-recent': { args: [limit?: number]; return: CanonChapterSummary[] }
  'db:canon-summary-upsert': { args: [summary: CanonChapterSummary]; return: { success: boolean; error?: string } }
  /** 指定章节范围（含两端）的章节摘要，按章节号升序 */
  'db:canon-summary-list-range': { args: [fromChapter: number, toChapter: number]; return: CanonChapterSummary[] }
  /** 分层摘要：卷摘要（按起始章升序）在前，全书摘要在后 */
  'db:canon-arc-summary-list': { args: []; return: CanonArcSummary[] }
  'db:canon-arc-summary-upsert': { args: [summary: CanonArcSummary]; return: { success: boolean; error?: string } }

  // 原子写回（推荐路径：单次事务）
  'db:canon-writeback-atomic': {
    args: [payload: CanonWritebackPayload]
    return: { success: boolean; error?: string; timelineIds?: number[]; characterStatesWritten?: number; plotIds?: number[]; factIds?: number[] }
  }

  // ===== P1 数据层：资产库 =====
  'db:asset-list': { args: [entityType?: AssetEntityType]; return: AssetData[] }
  'db:asset-get': { args: [id: number]; return: AssetData | null }
  'db:asset-upsert': { args: [data: AssetInput]; return: { success: boolean; id?: number; error?: string } }
  'db:asset-delete': { args: [id: number]; return: { success: boolean; error?: string } }

  // ===== P1 数据层：属性系统（现状面板底座） =====
  'db:attribute-def-list': { args: [entityType?: string]; return: AttributeDef[] }
  'db:attribute-def-upsert': { args: [def: AttributeDef]; return: { success: boolean; error?: string } }
  'db:attribute-def-delete': { args: [key: string]; return: { success: boolean; error?: string } }
  'db:attribute-value-get': {
    args: [entityId: string, attrKey: string, chapterNumber: number, phase?: AttributePhase]
    return: AttributeValue | null
  }
  'db:attribute-value-list': { args: [entityId: string, attrKey?: string]; return: AttributeValue[] }
  'db:attribute-value-set': {
    args: [value: AttributeValueInput]
    return: { success: boolean; value?: AttributeValue; error?: string }
  }
  'db:attribute-panel-state': {
    args: [entityId: string, chapterNumber: number, phase?: AttributePhase, entityType?: string]
    return: AttributePanelEntry[]
  }

  // ===== P1 数据层：关系网 =====
  'db:relation-list': { args: [fromId?: string]; return: EntityRelation[] }
  'db:relation-upsert': {
    args: [data: EntityRelationInput]
    return: { success: boolean; relation?: EntityRelation; error?: string }
  }
  'db:relation-delete': {
    args: [fromId: string, toId: string, relationType: string]
    return: { success: boolean; error?: string }
  }

  // ===== P1 数据层：章节流水线 =====
  'db:pipeline-get': { args: [chapterNumber: number]; return: ChapterPipelineState | null }
  'db:pipeline-list': { args: []; return: ChapterPipelineState[] }
  'db:pipeline-set-stage': {
    args: [chapterNumber: number, stage: ChapterStage]
    return: { success: boolean; state?: ChapterPipelineState; error?: string }
  }
  /** 回退一步（DR-03）：expectedStage 为确认弹窗展示的旧阶段，用于乐观校验 */
  'db:pipeline-rewind': {
    args: [chapterNumber: number, expectedStage: ChapterStage]
    return: { success: boolean; state?: ChapterPipelineState; error?: string }
  }

  // ===== P1 数据层：风格档案 =====
  'db:style-list': { args: []; return: StyleProfile[] }
  'db:style-get-active': { args: []; return: StyleProfile | null }
  'db:style-create': { args: [data: StyleProfileInput]; return: { success: boolean; id?: number; error?: string } }
  'db:style-update': { args: [id: number, data: StyleProfileInput]; return: { success: boolean; error?: string } }
  'db:style-set-active': { args: [id: number]; return: { success: boolean; error?: string } }
  'db:style-delete': { args: [id: number]; return: { success: boolean; error?: string } }

  // ===== P1 数据层：审稿台账 =====
  'db:review-finding-add': {
    args: [data: ReviewFindingInput]
    return: { success: boolean; id?: number; error?: string }
  }
  'db:review-finding-add-many': {
    args: [items: ReviewFindingInput[]]
    return: { success: boolean; ids?: number[]; error?: string }
  }
  'db:review-finding-list': {
    args: [chapterNumber: number, status?: ReviewFindingStatus]
    return: ReviewFinding[]
  }
  'db:review-finding-update-status': {
    args: [id: number, status: ReviewFindingStatus]
    return: { success: boolean; error?: string }
  }
  'db:review-finding-delete': { args: [id: number]; return: { success: boolean; error?: string } }
  /** 重跑某一审稿阶段前清空该阶段的 findings（按 chapter + stage） */
  'db:review-finding-clear-stage': {
    args: [chapterNumber: number, stage: string]
    return: { success: boolean; error?: string }
  }
  'db:review-finding-count-open-errors': { args: [chapterNumber: number]; return: number }

  // ===== P3 章节流水线：定稿写回（单事务） =====
  'db:finalize-writeback': {
    args: [input: FinalizeWritebackInput]
    return: FinalizeWritebackResult
  }

  // ===== P2 中控 AI：改动计划执行（单事务，失败整体回滚） =====
  'db:mutation-plan-execute': {
    args: [plan: MutationPlan, options?: MutationPlanExecutionOptions]
    return: MutationPlanExecution
  }
  /** 只读预览：返回每步执行前快照与字段级 diff（确认卡片使用） */
  'db:mutation-plan-preview': {
    args: [plan: MutationPlan]
    return: MutationPlanPreview
  }
}

// CanonWritebackPayload 与主进程 CanonRepository.writebackAtomically 入参兼容
export interface CanonWritebackPayload {
  chapterNumber: number
  newEvents: Array<{
    chapterNumber: number
    sequence: number
    characters: string[]
    location: string
    timeFlow: 'sequential' | 'flashback'
    summary: string
    impact: string
  }>
  characterDeltas: Array<{
    character: string
    chapterNumber: number
    after: {
      location?: string
      powerLevel?: string
      physicalState?: string
      mentalState?: string
      keyItems?: string
      currentGoal?: string
      knowledge?: string[]
      relationships?: Record<string, string>
      recentEvents?: string
    }
  }>
  plotLineChanges?: {
    added?: Array<{
      name: string
      status: 'active' | 'resolved' | 'paused'
      startedAt: number
      lastAdvancedAt: number
      resolvedAt?: number
      characters: string[]
      currentState: string
      description: string
    }>
    advanced?: Array<{ id: number; currentState: string; lastAdvancedAt: number }>
    resolved?: number[]
  }
  newFacts: Array<{
    category: 'world' | 'location' | 'item' | 'event' | 'relationship' | 'identity'
    statement: string
    introducedAt: number
    characters: string[]
    evidence?: string
  }>
}

// ===== Canon Store 类型别名（避免 ipc-channels.ts 直接依赖 narrative-consistency） =====
export interface CanonTimelineEvent {
  id?: number
  chapterNumber: number
  sequence: number
  characters: string[]
  location: string
  timeFlow: 'sequential' | 'flashback'
  summary: string
  impact: string
  absoluteTime?: string
  duration?: string
  source?: 'canon' | 'finalize_extract' | 'manual'
  confidence?: number
  evidence?: string
  status?: 'confirmed' | 'pending' | 'rejected'
  createdAt?: string
}
export interface CanonTimelineEventInput {
  chapterNumber: number
  sequence: number
  characters: string[]
  location: string
  timeFlow: 'sequential' | 'flashback'
  summary: string
  impact: string
  absoluteTime?: string
  duration?: string
  source?: 'canon' | 'finalize_extract' | 'manual'
  confidence?: number
  evidence?: string
  status?: 'confirmed' | 'pending' | 'rejected'
}
export interface CanonCharacterStateSnapshot {
  character: string
  location: string
  powerLevel: string
  physicalState: string
  mentalState: string
  keyItems: string
  currentGoal: string
  knowledge: string[]
  relationships: Record<string, string>
  recentEvents: string
  updatedAtChapter: number
  updatedAt: string
}
export interface CanonPlotLine {
  id?: number
  name: string
  status: 'active' | 'resolved' | 'paused'
  startedAt: number
  lastAdvancedAt: number
  resolvedAt?: number
  characters: string[]
  currentState: string
  description: string
}
export interface CanonPlotLineInput {
  name: string
  status: 'active' | 'resolved' | 'paused'
  startedAt: number
  lastAdvancedAt: number
  resolvedAt?: number
  characters: string[]
  currentState: string
  description: string
}
export interface CanonFact {
  id?: number
  category: 'world' | 'location' | 'item' | 'event' | 'relationship' | 'identity'
  statement: string
  introducedAt: number
  characters: string[]
  evidence?: string
}
export interface CanonFactInput {
  category: 'world' | 'location' | 'item' | 'event' | 'relationship' | 'identity'
  statement: string
  introducedAt: number
  characters: string[]
  evidence?: string
}
export interface CanonChapterSummary {
  chapterNumber: number
  title: string
  summary: string
  createdAt: string
}
export interface CanonArcSummary {
  level: 'arc' | 'book'
  startChapter: number
  endChapter: number
  title: string
  summary: string
  createdAt: string
}


// ===== 知识库频道 =====
export interface KnowledgeBaseChannels {
  'kb:import-document': { args: [filePath: string]; return: { success: boolean; docId?: string; chunkCount?: number; error?: string } }
  'kb:import-folder': { args: [folderPath: string]; return: { success: boolean; importedCount: number; failedFiles: string[]; error?: string } }
  'kb:import-text': { args: [text: string, fileName: string, projectPath: string]; return: { success: boolean; docId?: string; chunkCount?: number; error?: string } }
  'kb:search': { args: [query: string, topK?: number]; return: Array<{ text: string; score: number; fileName: string }> }
  'kb:search-with-scope': { args: [query: string, fromChapter: number, toChapter: number, topK?: number]; return: Array<{ text: string; score: number; fileName: string }> }
  /** preview：首块第一行非空文本（标题预览），没有则为空串 */
  'kb:list-documents': { args: []; return: Array<{ id: string; fileName: string; importedAt: string; chunkCount: number; filePath: string; preview?: string }> }
  'kb:remove-document': { args: [docId: string]; return: { success: boolean } }
  'kb:stats': { args: []; return: { documentCount: number; totalChunks: number; vectorDimension: number; lastUpdatedAt?: string | null } }
  'dialog:select-files': { args: []; return: string[] | null }
  'dialog:select-import-folder': { args: []; return: string | null }
  'kb:get-vectorless-count': { args: []; return: { count: number } }
  'kb:backfill-vectors': { args: []; return: { success: boolean; processed: number; failed: number; error?: string } }
}

// ===== 导入小说 =====
export interface ImportChannels {
  'dialog:select-novel-files': { args: []; return: string[] | null }
  'import:split-chapters': {
    args: [filePaths: string[], options?: { separator?: string }]
    return: {
      success: boolean
      chapters: Array<{ number: number; title: string; content: string; wordCount: number }>
      totalWords: number
      error?: string
    }
  }
}

// ===== MCP =====
export interface MCPChannels {
  'mcp:load-config': { args: [configPath?: string]; return: { success: boolean; configs: unknown[]; error?: string } }
  'mcp:connect': { args: [config: Record<string, unknown>]; return: { success: boolean; error?: string } }
  'mcp:disconnect': { args: [serverId: string]; return: { success: boolean; error?: string } }
  'mcp:disconnect-all': { args: []; return: { success: boolean; error?: string } }
  'mcp:list-tools': { args: []; return: unknown[] }
  'mcp:list-resources': { args: []; return: unknown[] }
  'mcp:call-tool': { args: [serverId: string, toolName: string, args: Record<string, unknown>]; return: { success: boolean; content: string; error?: string } }
  'mcp:get-servers-status': { args: []; return: unknown[] }
  'mcp:get-config-path': { args: []; return: string }
}

// ===== 应用窗口生命周期 =====
export interface AppChannels {
  /** 渲染进程声明已接管「关窗前刷盘」（页面重载后需重新声明） */
  'app:set-close-guard': { args: [enabled: boolean]; return: { success: boolean } }
  /** 刷盘需要用户决定（如保存失败待确认）：暂停主进程的强制关闭倒计时 */
  'app:close-hold': { args: []; return: { success: boolean } }
  /** 关窗前刷盘结束：proceed=true 继续关闭/退出，false 取消本次关闭 */
  'app:close-response': { args: [proceed: boolean]; return: { success: boolean } }
}

export interface AppEvents {
  /** 主进程拦截到窗口关闭，请渲染进程先保存未保存的编辑 */
  'app:before-close': undefined
}

// ===== 合并所有频道 =====
export type AllInvokeChannels = ConfigChannels & ProjectChannels & FileChannels & LLMChannels & DatabaseChannels & KnowledgeBaseChannels & ImportChannels & MCPChannels & AppChannels
export type AllEventChannels = LLMStreamEvents & AppEvents

/** 提取 invoke 频道名 */
export type InvokeChannel = keyof AllInvokeChannels

/** 提取 event 频道名 */
export type EventChannel = keyof AllEventChannels
