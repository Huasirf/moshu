/**
 * 规则条目与章纲时间线的共享类型（主进程 / 渲染进程共用）
 */

export type RuleSeverity = 'hard' | 'soft'

export interface RuleItem {
  id: string
  /** 稳定编号，如 R-2-3；正文与审稿按编号引用 */
  code: string
  group: string
  title: string
  body: string
  severity: RuleSeverity
  tags: string[]
  active: boolean
  sort: number
  updatedAt: string
}

export interface RuleSnapshotMeta {
  id: number
  hash: string
  chars: number
  itemsCount: number
  createdAt: string
}

export interface RuleSnapshotFull extends RuleSnapshotMeta {
  content: string
}

export interface TimelineEvent {
  id: number
  chapterNumber: number
  sceneIndex: number
  seq: number
  /** 设定内时间，如「第三天·辰时」 */
  storyTime: string
  /** 归一化绝对时间（纯数字 / 第N天 / 日期），用于跨章比较 */
  absoluteTime: string
  duration: string
  location: string
  participants: string[]
  summary: string
  /** 本条事件涉及的规则编号 */
  ruleRefs: string[]
}

export interface TimelineConfig {
  calendar: string
  eraStart: string
  timeFlow: string
  notes: string
}

export interface TimelineIssue {
  level: 'error' | 'warning'
  chapterNumber: number
  eventId?: number
  message: string
}
