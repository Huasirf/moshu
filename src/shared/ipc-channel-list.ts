/**
 * IPC 通道白名单（运行时值）
 *
 * preload 只放行这里列出的通道：渲染进程拿不到通用的 ipcRenderer，
 * 也就无法向主进程的内部通道或未登记的通道发消息、监听任意事件。
 *
 * 与 ipc-channels.ts 的类型定义双向校验：
 * - satisfies：这里写了类型里不存在的通道名 → 编译报错
 * - _…Complete：类型里新增了通道却没登记到这里 → 编译报错（报错信息里会列出漏掉的通道名）
 */
import type { InvokeChannel, EventChannel } from './ipc-channels'

export const INVOKE_CHANNELS = [
  'agent:state-read', 'agent:state-write',
  // 应用窗口
  'app:close-hold', 'app:close-response', 'app:set-close-guard',
  // 全局配置
  'config:get', 'config:get-moshu-home', 'config:set',
  // 项目库：备份
  'db:backup-now', 'db:backup-open-dir',
  // 项目库：蓝图
  'db:blueprint-commit', 'db:blueprint-get', 'db:blueprint-get-all', 'db:blueprint-mark-stale',
  'db:blueprint-update-notes', 'db:blueprint-upsert', 'db:blueprint-upsert-many',
  // 项目库：Canon
  'db:canon-character-state-get', 'db:canon-character-state-get-all', 'db:canon-character-state-upsert',
  'db:canon-fact-add', 'db:canon-fact-clear-chapter', 'db:canon-fact-list',
  'db:canon-plot-add', 'db:canon-plot-advance', 'db:canon-plot-list', 'db:canon-plot-resolve',
  'db:canon-arc-summary-list', 'db:canon-arc-summary-upsert',
  'db:canon-summary-get', 'db:canon-summary-list-range', 'db:canon-summary-list-recent', 'db:canon-summary-upsert',
  'db:canon-timeline-append', 'db:canon-timeline-clear-chapter', 'db:canon-timeline-get', 'db:canon-timeline-get-chapter',
  'db:canon-timeline-clear-extracted', 'db:canon-timeline-set-status', 'db:canon-timeline-pending',
  'db:canon-writeback-atomic',
  // P2 中控 AI：改动计划预览 / 执行
  'db:mutation-plan-execute', 'db:mutation-plan-preview', 'db:finalize-writeback',
  // P1 数据层：资产 / 属性 / 关系 / 流水线 / 风格 / 审稿台账
  'db:asset-delete', 'db:asset-get', 'db:asset-list', 'db:asset-upsert',
  'db:attribute-def-delete', 'db:attribute-def-list', 'db:attribute-def-upsert',
  'db:attribute-panel-state', 'db:attribute-value-get', 'db:attribute-value-list', 'db:attribute-value-set',
  'db:pipeline-get', 'db:pipeline-list', 'db:pipeline-set-stage', 'db:pipeline-rewind',
  'db:relation-delete', 'db:relation-list', 'db:relation-upsert',
  'db:review-finding-add', 'db:review-finding-add-many', 'db:review-finding-clear-stage',
  'db:review-finding-count-open-errors', 'db:review-finding-delete', 'db:review-finding-list',
  'db:review-finding-update-status',
  'db:style-create', 'db:style-delete', 'db:style-get-active', 'db:style-list', 'db:style-set-active', 'db:style-update',
  // 项目库：章节插图
  'db:chapter-image-add', 'db:chapter-image-delete', 'db:chapter-image-list',
  // 项目库：角色
  'db:character-delete', 'db:character-get-all', 'db:character-rename', 'db:character-save-all',
  'db:character-update-portrait', 'db:character-update-speech', 'db:character-update-state', 'db:character-upsert',
  'db:character-history-list', 'db:character-snapshot-map',
  'db:close',
  // 项目库：草稿
  'db:draft-create', 'db:draft-get-finalized', 'db:draft-get-full', 'db:draft-get-latest',
  'db:draft-get-max-finalized-chapter', 'db:draft-get-meta', 'db:draft-list', 'db:draft-list-all',
  'db:draft-next-version', 'db:draft-update-content', 'db:draft-update-status', 'db:draft-finalize', 'db:chapter-unfinalize',
  // 项目库：伏笔
  'db:foreshadow-create', 'db:foreshadow-delete', 'db:foreshadow-get-all', 'db:foreshadow-get-open',
  'db:foreshadow-mark-paid', 'db:foreshadow-update',
  // 项目库：统计与摘要
  'db:get-latest-summary', 'db:get-llm-history', 'db:get-llm-stats', 'db:log-llm-call', 'db:save-summary-snapshot',
  // 项目库：后处理
  'db:post-process-create-run', 'db:post-process-get-latest-run', 'db:post-process-get-steps',
  'db:post-process-is-all-passed', 'db:post-process-mark-step-failed', 'db:post-process-mark-step-ok',
  // 项目库：核心配置
  'db:project-core-get', 'db:project-core-update',
  'db:rule-items-list', 'db:rule-items-save', 'db:rule-items-seed', 'db:rule-snapshot-list', 'db:rule-snapshot-get', 'db:rule-snapshot-restore',
  'db:timeline-events-get', 'db:timeline-events-all', 'db:timeline-events-save',
  'db:timeline-config-get', 'db:timeline-config-save', 'db:timeline-validate', 'db:timeline-context',
  'db:rehearsal-context',
  // 项目库：审稿与修稿
  'db:review-create', 'db:review-get-full', 'db:review-get-latest', 'db:review-list', 'db:review-next-index',
  'db:revision-create', 'db:revision-get-full', 'db:revision-get-pending', 'db:revision-list',
  'db:revision-mark-discarded', 'db:revision-mark-merged', 'db:revision-next-index',
  // 项目库：全局搜索
  'db:search-chapters',
  // 系统对话框
  'dialog:select-files', 'dialog:select-folder', 'dialog:select-import-folder', 'dialog:select-novel-files',
  // 导出
  'export:epub',
  // 文件系统
  'fs:check-exists', 'fs:list-dir', 'fs:mkdir', 'fs:read-file', 'fs:read-json', 'fs:write-file', 'fs:write-json',
  // 图片
  'image:generate', 'image:import', 'image:read',
  // 导入小说
  'import:split-chapters',
  // 知识库
  'kb:backfill-vectors', 'kb:get-vectorless-count', 'kb:import-document', 'kb:import-folder', 'kb:import-text',
  'kb:list-documents', 'kb:remove-document', 'kb:search', 'kb:search-with-scope', 'kb:stats',
  // 模型
  'llm:cancel', 'llm:delete-model', 'llm:generate', 'llm:generate-stream',
  'llm:get-default-embedding-model', 'llm:get-default-image-model', 'llm:get-default-model', 'llm:list-models',
  'llm:ollama-models', 'llm:discover-models',
  'llm:save-model', 'llm:set-default-embedding-model', 'llm:set-default-image-model', 'llm:set-default-model',
  'llm:test-connection',
  // MCP
  'mcp:call-tool', 'mcp:connect', 'mcp:disconnect', 'mcp:disconnect-all', 'mcp:get-config-path',
  'mcp:get-servers-status', 'mcp:list-resources', 'mcp:list-tools', 'mcp:load-config',
  // 项目
  'project:create', 'project:delete', 'project:open', 'project:recent-list', 'project:remove-recent', 'project:reveal', 'project:save', 'project:update-config',
  'project:registry-list', 'project:registry-pin', 'project:registry-forget', 'project:registry-refresh',
  // 作品修改
  'story:apply', 'story:history', 'story:index', 'story:read', 'story:undo',
] as const satisfies readonly InvokeChannel[]

/** 主进程 → 渲染进程的事件通道 */
export const EVENT_CHANNELS = [
  'app:before-close',
  'llm:stream-chunk',
  'llm:stream-done',
  'llm:stream-error',
] as const satisfies readonly EventChannel[]

/** T 必须为 never：用于把「漏登记的通道」变成编译错误 */
type AssertNever<T extends never> = T

/** 类型里声明、但没登记进 INVOKE_CHANNELS 的通道（必须为空） */
export type _InvokeChannelsComplete = AssertNever<Exclude<InvokeChannel, (typeof INVOKE_CHANNELS)[number]>>
/** 类型里声明、但没登记进 EVENT_CHANNELS 的事件（必须为空） */
export type _EventChannelsComplete = AssertNever<Exclude<EventChannel, (typeof EVENT_CHANNELS)[number]>>
