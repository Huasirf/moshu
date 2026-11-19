/**
 * Skill 注册中心
 *
 * 管理所有可用的 Skill（基于 SKILL.md 的模块化知识包）。
 * 支持：
 * - 内置 Skill（随 墨枢 发布的预设 Skill）
 * - 用户 Skill（用户放在 ~/.moshu/skills/ 下的自定义 Skill）
 * - 项目 Skill（放在项目的 .moshu/skills/ 下的项目级 Skill）
 *
 * Skill 格式兼容 Cursor 的 SKILL.md 生态。
 */

import i18n from '../../i18n'
import { ipc } from '../ipc-client'
import { useProjectStore } from '../../stores/project-store'
import { toolRegistry, type AgentTool } from './tool-registry'
import type { MutationOp } from '../../shared/mutation-plan'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

// ===== 类型定义 =====

/** Skill 来源 */
export type SkillSource = 'builtin' | 'user' | 'project'

/** Skill 元数据（从 SKILL.md frontmatter 解析） */
export interface SkillMetadata {
  /** Skill 唯一名称 */
  name: string
  /** 显示名称 */
  displayName?: string
  /** 功能描述 */
  description: string
  /** 使用场景（用于 Agent 自动匹配） */
  whenToUse?: string
  /** 版本 */
  version?: string
  /** 允许的工具列表（白名单） */
  allowedTools?: string[]
  /** 参数提示 */
  argumentHint?: string
  /** 是否可由模型自动调用 */
  userInvocable?: boolean
}

/** 加载后的 Skill */
export interface LoadedSkill {
  /** 元数据 */
  metadata: SkillMetadata
  /** Skill 内容（Markdown 提示词） */
  content: string
  /** 来源 */
  source: SkillSource
  /** 文件所在目录 */
  baseDir: string
  /** SKILL.md 文件路径 */
  filePath: string
}

// ===== Skill Registry =====

class SkillRegistryImpl {
  private skills: Map<string, LoadedSkill> = new Map()

  /** 注册一个 Skill */
  register(skill: LoadedSkill): void {
    this.skills.set(skill.metadata.name, skill)
  }

  /** 查找 Skill */
  get(name: string): LoadedSkill | undefined {
    return this.skills.get(name)
  }

  /** 列出所有 Skill */
  listAll(): LoadedSkill[] {
    return Array.from(this.skills.values())
  }

  /** 按来源列出 */
  listBySource(source: SkillSource): LoadedSkill[] {
    return this.listAll().filter(s => s.source === source)
  }

  /** Skill 数量 */
  get size(): number {
    return this.skills.size
  }

  /** 清空 */
  clear(): void {
    this.skills.clear()
  }

  /**
   * 从目录加载 Skills
   *
   * 扫描指定目录下的 skill-name/SKILL.md 格式
   */
  async loadFromDirectory(dir: string, source: SkillSource): Promise<number> {
    let count = 0
    try {
      const entries = await ipc.invoke('fs:list-dir', dir)
      for (const entry of entries) {
        if (!entry.isDir) continue

        const skillFile = `${entry.path}/SKILL.md`
        try {
          const exists = await ipc.invoke('fs:check-exists', skillFile)
          if (!exists) continue

          const result = await ipc.invoke('fs:read-file', skillFile)
          if (!result.success) continue

          const skill = parseSkillMd(result.content, entry.name, source, entry.path, skillFile)
          if (skill) {
            this.register(skill)
            count++
          }
        } catch {
          // 单个 Skill 加载失败不影响整体
        }
      }
    } catch {
      // 目录不存在等情况，静默处理
    }
    return count
  }

  /**
   * 加载所有 Skill（内置 + 用户 + 项目）
   */
  async loadAll(): Promise<void> {
    this.clear()

    // 注册内置 Skill
    registerBuiltinSkills(this)

    // 加载用户 Skill（~/.moshu/skills/）
    try {
      const moshuHome = await ipc.invoke('config:get-moshu-home')
      const userSkillsDir = `${moshuHome}/skills`
      const userCount = await this.loadFromDirectory(userSkillsDir, 'user')
      if (userCount > 0) {
        console.log(`[Skills] 加载了 ${userCount} 个用户 Skill`)
      }
    } catch {
      // 静默处理
    }

    // 加载项目 Skill（项目/.moshu/skills/）
    const project = useProjectStore.getState().currentProject
    if (project) {
      const projectSkillsDir = `${project.path}/.moshu/skills`
      const projectCount = await this.loadFromDirectory(projectSkillsDir, 'project')
      if (projectCount > 0) {
        console.log(`[Skills] 加载了 ${projectCount} 个项目 Skill`)
      }
    }

    // 将所有 Skill 注册为 Agent Tool
    this.registerToToolRegistry()

    console.log(`[Skills] 共加载 ${this.size} 个 Skill`)
  }

  /**
   * 将 Skill 注册为 Agent Tool
   */
  private registerToToolRegistry(): void {
    // 先清理旧的 Skill Tool
    toolRegistry.unregisterBySource('skill')

    for (const skill of this.listAll()) {
      const agentTool: AgentTool = {
        name: `skill__${skill.metadata.name}`,
        description: skill.metadata.description + (skill.metadata.whenToUse ? ` — ${skill.metadata.whenToUse}` : ''),
        source: 'skill',
        inputSchema: {
          type: 'object',
          properties: {
            args: {
              type: 'string',
              description: skill.metadata.argumentHint ?? t('agent.skills.optionalArgs'),
            },
          },
        },
        requiresConfirmation: false,
        isReadOnly: true,
        userFacingName: skill.metadata.displayName ?? skill.metadata.name,
        execute: async (toolArgs) => {
          const userArgs = (toolArgs.args as string) ?? ''
          // 变量替换
          let content = skill.content
          if (userArgs) {
            content = content.replace(/\$\{args\}/g, userArgs)
            content = content.replace(/\$1/g, userArgs)
          }
          content = content.replace(/\$\{SKILL_DIR\}/g, skill.baseDir)

          return {
            success: true,
            content: `[Skill: ${skill.metadata.displayName ?? skill.metadata.name}]\n\n${content}`,
          }
        },
      }
      toolRegistry.register(agentTool)
    }
  }
}

/** 全局 Skill 注册中心 */
export const skillRegistry = new SkillRegistryImpl()

// ===== SKILL.md 解析 =====

/**
 * 解析 SKILL.md 文件内容
 *
 * 格式：
 * ```
 * ---
 * name: skill-name
 * description: 功能描述
 * when_to_use: 什么时候使用
 * allowed-tools: [read_file, search_knowledge]
 * ---
 *
 * # Skill 提示词内容
 * ...
 * ```
 */
function parseSkillMd(
  raw: string,
  fallbackName: string,
  source: SkillSource,
  baseDir: string,
  filePath: string,
): LoadedSkill | null {
  // 解析 frontmatter
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)
  const frontmatter: Record<string, unknown> = {}
  let content = raw

  if (fmMatch) {
    const fmText = fmMatch[1]
    content = raw.slice(fmMatch[0].length)

    // 简单的 YAML 解析（支持 key: value 和 key: [items]）
    for (const line of fmText.split('\n')) {
      const kvMatch = line.match(/^\s*([^:]+):\s*(.*)$/)
      if (!kvMatch) continue
      const key = kvMatch[1].trim()
      let val: unknown = kvMatch[2].trim()

      // 解析数组 [a, b, c]
      if (typeof val === 'string' && val.startsWith('[') && val.endsWith(']')) {
        val = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
      }
      // 解析布尔值
      if (val === 'true') val = true
      if (val === 'false') val = false

      frontmatter[key] = val
    }
  }

  const metadata: SkillMetadata = {
    name: (frontmatter['name'] as string) || fallbackName,
    displayName: frontmatter['display_name'] as string,
    description: (frontmatter['description'] as string) || `Skill: ${fallbackName}`,
    whenToUse: frontmatter['when_to_use'] as string,
    version: frontmatter['version'] as string,
    allowedTools: frontmatter['allowed-tools'] as string[],
    argumentHint: frontmatter['argument-hint'] as string,
    userInvocable: frontmatter['user-invocable'] !== false,
  }

  return {
    metadata,
    content: content.trim(),
    source,
    baseDir,
    filePath,
  }
}

// ===== 技能路由表（P2-7） =====

/**
 * 8 个核心写作技能的路由条目。
 *
 * 与上面的 SKILL.md 体系互补：SKILL.md 提供可扩展的知识包，
 * 路由表约束「哪类意图能用哪些工具、能产生哪些计划操作」，
 * 让中控 AI 在写库前先落到明确的技能边界内。
 * DR-02 已定稿：资产类技能复用 `canon_items` 作为资产总表。
 */
export type AgentSkillRouteId =
  | 'write-draft'
  | 'revise-draft'
  | 'edit-outline'
  | 'edit-character'
  | 'edit-asset'
  | 'review-chapter'
  | 'book-breakdown'
  | 'worldbuilding'

export interface AgentSkillRoute {
  id: AgentSkillRouteId
  /** 技能中文名（模型路由用，不直接展示给用户） */
  name: string
  /** 触发关键词（中英混合，命中数用于打分） */
  keywords: string[]
  /** 该技能允许调用的工具名（白名单） */
  allowedTools: string[]
  /** 该技能可生成的 MutationPlan 操作 */
  planOps: MutationOp[]
  /** 技能执行要点（命中时注入系统提示词） */
  guidance: string
}

export const AGENT_SKILL_ROUTES: readonly AgentSkillRoute[] = [
  {
    id: 'write-draft',
    name: '写正文',
    keywords: ['写正文', '写这一章', '写一章', '续写', '生成正文', '开始写', '起草', 'write chapter', 'continue writing', 'draft'],
    allowedTools: [
      'read_blueprint', 'read_drafts', 'read_assets', 'read_character_state', 'read_relations',
      'read_architecture', 'search_knowledge', 'story_read', 'story_rewrite_draft', 'open_editor',
    ],
    planOps: ['set_pipeline_stage'],
    guidance: '先读本章蓝图、角色状态与已登记资产；按蓝图的目标、事件和章末钩子写，不凭空发明未登记的关键道具。保存草稿后再把章阶段推进为 drafted。',
  },
  {
    id: 'revise-draft',
    name: '改正文',
    keywords: ['改正文', '修改正文', '重写', '改写', '润色', '调整正文', 'revise draft', 'rewrite'],
    allowedTools: [
      'story_index', 'story_read', 'story_rewrite_draft', 'story_history', 'story_undo', 'read_review_findings',
    ],
    planOps: [],
    guidance: '全文级改写必须逐章完整读取原文再动笔；局部改动用 rewrite_draft 提交 instruction。保留事件、数字、对话与章末钩子，改完读回核对。已定稿/归档章节不可覆盖。',
  },
  {
    id: 'edit-outline',
    name: '改大纲',
    keywords: ['改大纲', '调整大纲', '改蓝图', '修改蓝图', '后续章节', '剧情调整', 'outline', 'blueprint'],
    allowedTools: ['read_blueprint', 'read_architecture', 'read_project_state', 'story_revise'],
    planOps: ['update_blueprint'],
    guidance: '先列出受影响章节；改第 N 章后，N+1 起一段区间的既有蓝图会被标记为 stale，逐章刷新即可，不整卷重写。已定稿正文不因大纲改动自动重写。',
  },
  {
    id: 'edit-character',
    name: '设角色',
    keywords: ['设角色', '改角色', '角色卡', '人物设定', '角色状态', '关系', 'character'],
    allowedTools: ['read_characters', 'read_character_state', 'read_relations', 'story_revise'],
    planOps: ['update_character', 'set_attribute', 'update_relation'],
    guidance: '角色卡改设定，角色状态与属性按章记录。数值变化用 set_attribute（带章号），关系变化用 update_relation。改完检查后续蓝图是否仍与人物动机一致。',
  },
  {
    id: 'edit-asset',
    name: '设资产',
    keywords: ['设资产', '加道具', '新增设定', '资产库', '物品', '道具', '地点', '势力', 'asset', 'item', 'location'],
    allowedTools: ['read_assets', 'read_relations'],
    planOps: ['create_asset', 'update_asset', 'delete_asset'],
    guidance: '新增前先按「同类型 + 同名」查重，能更新就不要新建；删除资产风险最高，必须在计划中单独说明并等待作者确认。关系两端必须是已存在实体。',
  },
  {
    id: 'review-chapter',
    name: '审稿',
    keywords: ['审稿', '审阅', '检查这一章', '找问题', '一致性检查', 'review', 'proofread'],
    allowedTools: [
      'read_drafts', 'read_review_findings', 'read_assets', 'read_character_state', 'read_relations', 'read_pipeline',
    ],
    planOps: [],
    guidance: '审稿阶段只读不写。按严重度输出问题清单（error/warning/info）并给证据；需要改正文时先征得作者同意，再切换到改正文技能。',
  },
  {
    id: 'book-breakdown',
    name: '拆书',
    keywords: ['拆书', '拆解', '分析这本书', '提取设定', 'benchmark', 'breakdown'],
    allowedTools: ['read_file', 'search_knowledge', 'read_architecture', 'read_assets'],
    planOps: ['create_asset', 'update_blueprint'],
    guidance: '拆书产物（人物、设定、节拍）全部以 pending 状态入库，等待作者逐条确认；不要直接覆盖已有资产。拆出的结构先说明来源章节。',
  },
  {
    id: 'worldbuilding',
    name: '世界观',
    keywords: ['世界观', '设定集', '力量体系', '地理', '势力设定', 'worldbuilding', 'lore'],
    allowedTools: ['read_architecture', 'read_assets', 'read_relations', 'search_knowledge'],
    planOps: ['create_asset', 'update_asset', 'update_blueprint'],
    guidance: '世界观条目尽量落成结构化资产（势力/地点/技能/秘密），便于后续按章引用。发现与既有规则冲突时先指出冲突，不擅自改写旧设定。',
  },
]

/** 取一个路由条目 */
export function getAgentSkillRoute(id: AgentSkillRouteId): AgentSkillRoute | undefined {
  return AGENT_SKILL_ROUTES.find(route => route.id === id)
}

/**
 * 按用户意图匹配技能。命中关键词越多得分越高；同分取关键词更长的（更具体）。
 * 无命中时返回 null，由 Agent 走通用澄清流程。
 */
export function matchAgentSkill(intent: string): AgentSkillRoute | null {
  const text = (intent ?? '').toLowerCase()
  if (!text.trim()) return null

  let best: AgentSkillRoute | null = null
  let bestScore = 0
  let bestSpecificity = 0
  for (const route of AGENT_SKILL_ROUTES) {
    const hits = route.keywords.filter(keyword => text.includes(keyword.toLowerCase()))
    if (hits.length === 0) continue
    const specificity = Math.max(...hits.map(keyword => keyword.length))
    if (hits.length > bestScore || (hits.length === bestScore && specificity > bestSpecificity)) {
      best = route
      bestScore = hits.length
      bestSpecificity = specificity
    }
  }
  return best
}

/**
 * 生成注入系统提示词的技能路由段。
 * 传入 intent 时会附带该技能的允许工具与执行要点。
 */
export function buildSkillRoutingPrompt(intent?: string): string {
  const matched = intent ? matchAgentSkill(intent) : null
  const rows = AGENT_SKILL_ROUTES.map(route => {
    const ops = route.planOps.length > 0 ? route.planOps.join('/') : '无（只读或走专用工具）'
    return `| ${route.name} | ${route.keywords.slice(0, 4).join('、')} | ${ops} |`
  })

  const lines = [
    '## 技能路由',
    '先判断作者意图属于下表中哪一种技能，再按该技能的边界执行；一句话涉及多个技能时，按「先读后写、先改上游再改下游」的顺序执行。',
    '',
    '| 技能 | 触发示例 | 允许的计划操作 |',
    '|---|---|---|',
    ...rows,
    '',
    '规则：',
    '1. 写入类操作只能使用命中技能「允许的计划操作」；不在表内的修改先向作者说明并等待确认。',
    '2. 任何写入都必须先产出 MutationPlan（intent + steps），确认后才执行；未确认时数据库零改动。',
    '3. 意图无法归类或跨技能冲突时，先用自然语言向作者澄清，不要猜测。',
  ]

  if (matched) {
    lines.push('', `本轮识别技能：${matched.name}`, `允许工具：${matched.allowedTools.join(', ')}`, `执行要点：${matched.guidance}`)
  }
  return lines.join('\n')
}

// ===== 内置 Skills =====

function registerBuiltinSkills(registry: SkillRegistryImpl): void {
  const builtins: Array<{ metadata: SkillMetadata; content: string }> = [
    {
      metadata: {
        name: 'review-chapter',
        displayName: t('agent.skills.reviewChapter.name'),
        description: t('agent.skills.reviewChapter.desc'),
        whenToUse: t('agent.skills.reviewChapter.when'),
      },
      content: `# 章节审阅

请对目标章节进行专业的小说审阅。依次检查以下维度：

## 1. 剧情逻辑
- 情节是否连贯，有无逻辑矛盾
- 因果关系是否成立

## 2. 角色一致性
- 角色行为是否符合既定性格
- 对话风格是否一致

## 3. 节奏感
- 张弛是否有度
- 是否有不必要的拖沓或过于仓促的转折

## 4. 伏笔与呼应
- 已有伏笔是否得到了回应
- 新埋的伏笔是否自然

## 5. 文笔与风格
- 描写是否生动
- 是否符合整体文风设定

请先使用 read_drafts 工具读取目标章节，再使用 read_architecture 读取故事架构进行对比评估。
输出格式：每个维度评分（1-5星）+ 详细说明 + 修改建议。`,
    },
    {
      metadata: {
        name: 'brainstorm',
        displayName: t('agent.skills.brainstorm.name'),
        description: t('agent.skills.brainstorm.desc'),
        whenToUse: t('agent.skills.brainstorm.when'),
      },
      content: `# 创意脑暴

请围绕用户给出的话题进行专业的创意脑暴。

## 输出格式
为每个创意方向提供：
1. **创意概念**（一句话）
2. **详细展开**（100-200 字）
3. **可行性评估**（高/中/低）
4. **与已有剧情的融合度**

请先使用 read_architecture 和 read_project_state 了解项目背景，确保创意与现有设定不矛盾。
至少提供 5 个不同方向的创意。`,
    },
    {
      metadata: {
        name: 'character-analysis',
        displayName: t('agent.skills.characterAnalysis.name'),
        description: t('agent.skills.characterAnalysis.desc'),
        whenToUse: t('agent.skills.characterAnalysis.when'),
      },
      content: `# 角色深度分析

请对目标角色进行全方位的深度分析。

## 分析维度
1. **核心性格特质** — MBTI、大五人格倾向
2. **深层动机** — 驱动角色行动的核心诉求
3. **角色弧预测** — 基于当前设定推演角色成长轨迹
4. **关系网络** — 与其他角色的关系图谱
5. **冲突点** — 角色面临的核心矛盾和困境
6. **独特标识** — 口头禅、习惯动作、标志性特征

请先使用 read_characters 读取角色卡，以及 read_architecture 了解故事结构。`,
    },
    {
      metadata: {
        name: 'continuity-check',
        displayName: t('agent.skills.continuityCheck.name'),
        description: t('agent.skills.continuityCheck.desc'),
        whenToUse: t('agent.skills.continuityCheck.when'),
      },
      content: `# 连续性与一致性检查

请对项目进行全面的连续性检查。

## 检查项
1. **时间线一致性** — 事件发生顺序是否合理
2. **地理一致性** — 地点描述是否前后一致
3. **角色状态** — 角色的伤病、装备、能力等是否正确追踪
4. **设定遵守** — 是否与世界观设定产生矛盾
5. **伏笔追踪** — 哪些伏笔已回收，哪些待回收

请使用 list_chapters 了解进度，使用 read_architecture 获取设定，逐章检查关键节点。
输出为表格形式，标注问题严重程度（🔴严重 / 🟡注意 / 🟢正常）。`,
    },
    {
      metadata: {
        name: 'writing-coach',
        displayName: t('agent.skills.writingCoach.name'),
        description: t('agent.skills.writingCoach.desc'),
        whenToUse: t('agent.skills.writingCoach.when'),
      },
      content: `# 写作教练

作为专业的写作教练，为用户提供针对性的指导。

## 指导范围
- 叙述技巧（视角运用、时间线处理）
- 描写技法（环境渲染、人物刻画）
- 对话写作（个性化对话、潜台词运用）
- 节奏控制（场景切换、留白技巧）
- 悬念设置（钩子、反转、暗线）

请先使用 read_project_state 了解项目的写作风格设定，
再根据用户的具体问题提供定制化建议，并附上示例对比。`,
    },
  ]

  for (const { metadata, content } of builtins) {
    registry.register({
      metadata,
      content,
      source: 'builtin',
      baseDir: '',
      filePath: `builtin://${metadata.name}`,
    })
  }
}
