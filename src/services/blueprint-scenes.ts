/**
 * 章纲场景拆解（scenes）的解析、归一化与渲染（纯函数，可单测）
 *
 * 设计目标：
 * - 模型输出坏 JSON / 字段缺失时逐条容错，不因一个场景坏掉就丢掉整章；
 * - 字数预算自动对齐本章目标字数（误差超过 10% 时按比例缩放）；
 * - 写稿时把场景表渲染成「按场推进 + 每场预算」的强约束文本。
 */

export interface ChapterScene {
  id?: string
  title: string
  goal?: string
  conflict?: string
  turn?: string
  props?: string[]
  characters?: string[]
  /** 场景字数预算 */
  words?: number
  /** 场景所在地点 */
  location?: string
  /** 大场景编号：同一大场景内的环境描写沿用，不重复 */
  bigSceneId?: string
  /** 相对上一场的变化：none=同一大场景不切换；small=小场景切换；big=大场景切换 */
  change?: 'none' | 'small' | 'big'
  /** 环境描写句数上限：0=不写，1=一句带过，3=最多三句 */
  envQuota?: number
}

/** 蓝图里 scenes 的宽松结构（title 可能缺失，旧数据用 summary 兜底） */
export interface SceneLike {
  id?: string
  title?: string
  summary?: string
  goal?: string
  conflict?: string
  turn?: string
  props?: string[]
  characters?: string[]
  words?: number
  location?: string
  bigSceneId?: string
  change?: string
  envQuota?: number
}

/** 把 blueprints.scenes_json 里的宽松结构转成写稿用的 ChapterScene[] */
export function toChapterScenes(list: SceneLike[] | undefined | null): ChapterScene[] {
  if (!Array.isArray(list)) return []
  return list.map((scene, index) => ({
    id: scene.id || `s${index + 1}`,
    title: scene.title || scene.summary || `场景${index + 1}`,
    goal: scene.goal,
    conflict: scene.conflict,
    turn: scene.turn,
    props: Array.isArray(scene.props) ? scene.props : undefined,
    characters: Array.isArray(scene.characters) ? scene.characters : undefined,
    words: Number(scene.words) > 0 ? Number(scene.words) : undefined,
    location: typeof scene.location === 'string' && scene.location.trim() ? scene.location.trim() : undefined,
    bigSceneId: typeof scene.bigSceneId === 'string' && scene.bigSceneId.trim() ? scene.bigSceneId.trim() : undefined,
    change: scene.change === 'none' || scene.change === 'small' || scene.change === 'big' ? scene.change : undefined,
    envQuota: Number.isFinite(Number(scene.envQuota)) && Number(scene.envQuota) >= 0 ? Math.round(Number(scene.envQuota)) : undefined,
  }))
}

export interface ScenePlanStats {
  scenes: ChapterScene[]
  budget: number
  target: number
  /** 预算与目标的偏差比例（0.1 = 10%） */
  deviation: number
  /** 预算已被缩放到目标附近 */
  adjusted: boolean
  warnings: string[]
}

const MAX_SCENES = 5
const MIN_SCENES = 2
const MIN_SCENE_WORDS = 200
const MAX_TITLE = 40

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : String(v ?? '').trim()))
    .filter(Boolean)
    .slice(0, 12)
}

/** 判断一个数组是否「像场景列表」：元素为对象且带 title/goal/summary */
function looksLikeSceneArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every(
    (item) =>
      !!item &&
      typeof item === 'object' &&
      ('title' in (item as Record<string, unknown>) ||
        'goal' in (item as Record<string, unknown>) ||
        'summary' in (item as Record<string, unknown>)),
  )
}

/**
 * 从模型文本中提取场景数组：兼容代码围栏、前后解释、顶层直接是数组。
 *
 * 注意：不能取「最后一个能解析的括号组」——模型输出里末尾的
 * `"characters": ["墨砚"]` 也是一个合法数组，会被误当成场景列表。
 * 因此从后往前逐组解析，取第一个「形状像场景列表」的候选。
 */
export function parseScenePlan(raw: string): unknown[] {
  if (!raw) return []
  const text = raw
    .replace(/```(?:json)?/gi, '\n')
    .replace(/```/g, '\n')

  for (let start = text.length - 1; start >= 0; start--) {
    const ch = text[start]
    if (ch !== '{' && ch !== '[') continue
    let depth = 0
    let quoted = false
    let escaped = false
    for (let end = start; end < text.length; end++) {
      const c = text[end]
      if (quoted) {
        if (escaped) escaped = false
        else if (c === '\\') escaped = true
        else if (c === '"') quoted = false
        continue
      }
      if (c === '"') quoted = true
      else if (c === '{' || c === '[') depth++
      else if (c === '}' || c === ']') depth--
      if (depth !== 0) continue
      try {
        const parsed = JSON.parse(text.slice(start, end + 1))
        if (looksLikeSceneArray(parsed)) return parsed
        if (parsed && typeof parsed === 'object') {
          const list = (parsed as Record<string, unknown>).scenes
          if (looksLikeSceneArray(list)) return list
        }
      } catch { /* 该起点不是完整 JSON，继续往前找 */ }
      break
    }
  }
  return []
}

/**
 * 归一化场景列表：
 * - 丢弃没有 title/goal 的空条目（其余字段容错补默认值）；
 * - budget 与目标字数偏差 >10% 时按比例缩放；
 * - 场景数不足 2 或预算严重失真时返回 warnings，由调用方决定是否回退 keyEvents。
 */
export function normalizeScenes(rawList: unknown[], target: number): ScenePlanStats {
  const warnings: string[] = []
  const scenes: ChapterScene[] = []

  rawList.slice(0, MAX_SCENES + 2).forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const raw = item as Record<string, unknown>
    const title = String(raw.title ?? '').trim()
    const goal = String(raw.goal ?? raw.summary ?? '').trim()
    if (!title && !goal) return
    const words = Number(raw.words)
    const scene: ChapterScene = {
      id: String(raw.id ?? `s${index + 1}`).trim() || `s${index + 1}`,
      title: (title || goal).slice(0, MAX_TITLE),
      goal: goal || undefined,
      conflict: String(raw.conflict ?? '').trim() || undefined,
      turn: String(raw.turn ?? '').trim() || undefined,
      props: asStringList(raw.props),
      characters: asStringList(raw.characters),
      words: Number.isFinite(words) && words > 0 ? Math.round(words) : undefined,
      location: String(raw.location ?? '').trim() || undefined,
      bigSceneId: String(raw.bigSceneId ?? raw.big_scene_id ?? '').trim() || undefined,
      change: ['none', 'small', 'big'].includes(String(raw.change)) ? (String(raw.change) as ChapterScene['change']) : undefined,
      envQuota: Number.isFinite(Number(raw.envQuota)) && Number(raw.envQuota) >= 0 ? Math.round(Number(raw.envQuota)) : undefined,
    }
    scenes.push(scene)
  })

  if (scenes.length > MAX_SCENES) {
    warnings.push(`场景数 ${scenes.length} 超过上限 ${MAX_SCENES}，已截断`)
    scenes.length = MAX_SCENES
  }
  if (scenes.length < MIN_SCENES) {
    warnings.push(`有效场景只有 ${scenes.length} 个，低于下限 ${MIN_SCENES}`)
  }

  // 缺失预算的场景按剩余额度均分
  const budgeted = scenes.filter((s) => s.words !== undefined)
  const missing = scenes.length - budgeted.length
  if (missing > 0 && target > 0) {
    const used = budgeted.reduce((sum, s) => sum + (s.words || 0), 0)
    const rest = Math.max(MIN_SCENE_WORDS, Math.round((target - used) / missing))
    for (const scene of scenes) {
      if (scene.words === undefined) scene.words = rest
    }
  }

  let budget = scenes.reduce((sum, s) => sum + (s.words || 0), 0)
  const deviation = target > 0 ? Math.abs(budget - target) / target : 0
  let adjusted = false

  // 容差 -10% / +15%：偏长侧多留 15%，避免长章场景预算被强行压回目标
  if (target > 0 && budget > 0 && (budget < target * 0.9 || budget > target * 1.15)) {
    const original = budget
    const ratio = target / budget
    for (const scene of scenes) {
      scene.words = Math.max(MIN_SCENE_WORDS, Math.round((scene.words || 0) * ratio))
    }
    const raw = scenes.reduce((sum, s) => sum + (s.words || 0), 0)
    // 逐项取整后的余量补到最后一个场景，保证合计贴近目标
    const last = scenes[scenes.length - 1]
    if (last) last.words = Math.max(MIN_SCENE_WORDS, (last.words || 0) + (target - raw))
    budget = scenes.reduce((sum, s) => sum + (s.words || 0), 0)
    adjusted = true
    warnings.push(`预算合计 ${original} 字偏离目标 ${target} 字超过容差（-10%~+15%），已按比例缩放到 ${budget} 字`)
  }

  return { scenes, budget, target, deviation, adjusted, warnings }
}

/** 场景表是否足够可用：场景数达标且有预算 */
export function isScenePlanUsable(stats: ScenePlanStats): boolean {
  return stats.scenes.length >= MIN_SCENES && stats.scenes.every((s) => (s.words || 0) >= MIN_SCENE_WORDS)
}

/**
 * 两段式生成的分段切分：按累计预算找约 ratio 处的切分点。
 * 至少给第一段留 1 场，且必须留至少 1 场给第二段（否则退化为单段生成）。
 */
export function splitScenesForPipeline(
  scenes: ChapterScene[],
  ratio = 0.6,
): { first: ChapterScene[]; rest: ChapterScene[] } {
  if (!Array.isArray(scenes) || scenes.length < 2) {
    return { first: Array.isArray(scenes) ? scenes : [], rest: [] }
  }
  const total = scenes.reduce((sum, s) => sum + (Number(s.words) || 0), 0)
  if (total <= 0) {
    const cut = Math.max(1, Math.min(scenes.length - 1, Math.round(scenes.length * ratio)))
    return { first: scenes.slice(0, cut), rest: scenes.slice(cut) }
  }
  let acc = 0
  let cut = 1
  for (let i = 0; i < scenes.length - 1; i++) {
    acc += Number(scenes[i].words) || 0
    cut = i + 1
    if (acc / total >= ratio) break
  }
  return { first: scenes.slice(0, cut), rest: scenes.slice(cut) }
}

/**
 * 渲染成写稿 prompt 使用的「场景预算表」。
 * 没有 scenes 时返回空串，调用方按旧路径（仅 keyEvents）走。
 */
export function renderScenePlan(scenes: ChapterScene[], target: number): string {
  if (!scenes || scenes.length === 0) return ''
  const budget = scenes.reduce((sum, s) => sum + (s.words || 0), 0)
  const normalMax = Math.round(target * 1.2)
  const lines: string[] = []
  lines.push(`【本章场景预算（共 ${scenes.length} 场，合计约 ${budget} 字）】`)
  scenes.forEach((scene, i) => {
    const parts: string[] = [`场景${i + 1}（约 ${scene.words || 0} 字）｜${scene.title}`]
    if (scene.goal) parts.push(`目标：${scene.goal}`)
    if (scene.conflict) parts.push(`冲突：${scene.conflict}`)
    if (scene.turn) parts.push(`反转：${scene.turn}`)
    if (scene.props?.length) parts.push(`道具：${scene.props.join('、')}`)
    if (scene.characters?.length) parts.push(`出场：${scene.characters.join('、')}`)
    const lockParts: string[] = []
    if (scene.location) lockParts.push(`地点=${scene.location}`)
    if (scene.bigSceneId) lockParts.push(`大场景=${scene.bigSceneId}`)
    if (scene.change === 'none') lockParts.push('切换=不切换（沿用上一场的环境，禁止重复描写）')
    else if (scene.change === 'small') lockParts.push('切换=小场景切换（只用一句带过，如「整间屋子里安静得只能听见自己的呼吸声」）')
    else if (scene.change === 'big') lockParts.push('切换=大场景切换（可写环境，但不得超过配额）')
    if (scene.envQuota !== undefined) lockParts.push(`环境配额=${scene.envQuota} 句`)
    if (lockParts.length) parts.push(`场景锁定：${lockParts.join('；')}`)
    lines.push(`- ${parts.join('｜')}`)
  })
  lines.push(
    `写作要求：严格按场景顺序推进，每场写足其预算后立即进入下一场；全章合计落在 ${Math.round(target * 0.95)}–${normalMax} 字（不得低于 ${Math.round(target * 0.9)}，不得超过 ${Math.round(target * 1.3)}）。场景之间用空行分场，不要写「场景一」之类的小标题。`,
  )
  lines.push(
    '环境描写按每场「场景锁定」执行：同一大场景连续时环境不重复描写，沿用已写过的空间/气味/声音；小场景切换只用一句带过；配额为 0 时该场不写任何环境句。',
  )
  return lines.join('\n')
}
