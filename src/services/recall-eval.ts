/**
 * 召回评估（P2-4）
 *
 * 抽样已规划章节 → 用与正文生成完全相同的检索语句取 top5 → 人工标注每条命中的相关性
 * → 计算 precision@5 与章级 recall@5，为后续检索参数调优提供依据。
 *
 * 为什么 recall@5 用「章级命中」口径：本地没有人工标注的全量语料，
 * 无法知道 top5 之外还有多少本该被召回的内容；因此以「至少 1 条相关命中的章节数 / 已标注章数」
 * 作为可复现的代理指标，UI 与报告中均按此口径说明。
 */
import { ipc } from './ipc-client'

/** 抽样所需的蓝图字段（与 db:blueprint-get-all 的子集对齐） */
export interface RecallBlueprint {
  chapterNumber: number
  title: string
  keyEvents?: string
  characters?: string[]
}

/** 一次检索命中（与 kb:search-with-scope 返回结构一致） */
export interface RecallHit {
  fileName: string
  score: number
  text: string
}

/** 单章评估记录 */
export interface RecallEvalCase {
  chapterNumber: number
  title: string
  query: string
  hits: RecallHit[]
  /** 与 hits 等长；null 表示尚未标注 */
  relevant: Array<boolean | null>
}

/** 持久化的评估结果 */
export interface RecallEvalStore {
  version: 1
  updatedAt: string
  sampleSize: number
  cases: RecallEvalCase[]
}

/** 评估指标 */
export interface RecallEvalMetrics {
  /** 抽样章数 */
  totalCases: number
  /** 至少标注了一条命中的章数 */
  annotatedCases: number
  /** 已标注的命中条数 */
  annotatedHits: number
  /** 标注为相关的命中条数 */
  relevantHits: number
  /** 相关命中 / 已标注命中 */
  precisionAt5: number
  /** 至少 1 条相关命中的章数 / 已标注章数 */
  recallAt5: number
  /** 至少 1 条相关命中的章数 */
  hitChapters: number
}

export const RECALL_EVAL_TOP_K = 5
export const RECALL_EVAL_SAMPLE_SIZE = 20

/** 与 generate-draft 的检索语句保持同一构造方式，保证评估结果能代表实际写稿召回 */
export function buildRecallQuery(bp: RecallBlueprint): string {
  const characters = Array.isArray(bp.characters) ? bp.characters.join(' ') : ''
  return `${bp.title ?? ''} ${bp.keyEvents ?? ''} ${characters}`.trim()
}

/**
 * 确定性抽样：按章节号均匀取点。
 *
 * 只取第 2 章及以后——第 1 章没有「之前章节」可检索，评估结果恒为空。
 * 同一份蓝图重复抽样得到同一组章节，便于前后对比调参效果。
 */
export function sampleRecallChapters(
  blueprints: RecallBlueprint[],
  sampleSize: number = RECALL_EVAL_SAMPLE_SIZE,
): RecallBlueprint[] {
  const usable = blueprints
    .filter((bp) => Number.isFinite(bp.chapterNumber) && bp.chapterNumber >= 2)
    .filter((bp) => Boolean((bp.title ?? '').trim() || (bp.keyEvents ?? '').trim()))
    .sort((a, b) => a.chapterNumber - b.chapterNumber)

  if (usable.length <= sampleSize) return usable

  const picked: RecallBlueprint[] = []
  const used = new Set<number>()
  for (let i = 0; i < sampleSize; i++) {
    const index = Math.round((i * (usable.length - 1)) / (sampleSize - 1))
    if (used.has(index)) continue
    used.add(index)
    picked.push(usable[index])
  }
  return picked
}

/** 重新抽样时保留旧标注：同章节 + 同文档名的命中继续沿用相关性 */
export function mergeAnnotations(
  nextCases: RecallEvalCase[],
  previous: RecallEvalCase[] | null | undefined,
): RecallEvalCase[] {
  if (!previous || previous.length === 0) return nextCases
  const byChapter = new Map(previous.map((c) => [c.chapterNumber, c]))
  return nextCases.map((item) => {
    const old = byChapter.get(item.chapterNumber)
    if (!old) return item
    return {
      ...item,
      relevant: item.hits.map((hit) => {
        const index = old.hits.findIndex((h) => h.fileName === hit.fileName)
        return index >= 0 ? old.relevant[index] ?? null : null
      }),
    }
  })
}

/** 计算指标；没有标注时各指标为 0，避免除零出现 NaN */
export function computeRecallMetrics(cases: RecallEvalCase[]): RecallEvalMetrics {
  let annotatedCases = 0
  let annotatedHits = 0
  let relevantHits = 0
  let hitChapters = 0

  for (const item of cases) {
    let hasAnnotation = false
    let hasRelevant = false
    item.relevant.forEach((value) => {
      if (value === null || value === undefined) return
      hasAnnotation = true
      annotatedHits++
      if (value) {
        relevantHits++
        hasRelevant = true
      }
    })
    if (hasAnnotation) annotatedCases++
    if (hasRelevant) hitChapters++
  }

  return {
    totalCases: cases.length,
    annotatedCases,
    annotatedHits,
    relevantHits,
    precisionAt5: annotatedHits > 0 ? relevantHits / annotatedHits : 0,
    recallAt5: annotatedCases > 0 ? hitChapters / annotatedCases : 0,
    hitChapters,
  }
}

/** 评估结果落盘位置：项目根目录下的 .moshu/recall-eval.json */
export function recallEvalPath(projectPath: string): string {
  return `${projectPath.replace(/[\\/]+$/, '')}/.moshu/recall-eval.json`
}

function isValidStore(data: unknown): data is RecallEvalStore {
  if (!data || typeof data !== 'object') return false
  const value = data as Partial<RecallEvalStore>
  return value.version === 1 && Array.isArray(value.cases)
}

/** 读取评估结果；不存在或损坏时返回 null（不阻塞面板） */
export async function loadRecallEval(projectPath: string): Promise<RecallEvalStore | null> {
  try {
    const result = await ipc.invoke('fs:read-json', recallEvalPath(projectPath))
    if (!result.success || !isValidStore(result.data)) return null
    return result.data
  } catch {
    return null
  }
}

/** 写入评估结果（先确保目录存在） */
export async function saveRecallEval(projectPath: string, store: RecallEvalStore): Promise<void> {
  const dir = recallEvalPath(projectPath).replace(/[\\/][^\\/]+$/, '')
  await ipc.invoke('fs:mkdir', dir).catch(() => ({ success: false }))
  const result = await ipc.invoke('fs:write-json', recallEvalPath(projectPath), store)
  if (!result.success) throw new Error(result.error || 'write failed')
}

/** 用同一检索链路为抽样章节取 top5；逐章回调进度便于 UI 反馈 */
export async function runRecallSampling(
  blueprints: RecallBlueprint[],
  sampleSize: number = RECALL_EVAL_SAMPLE_SIZE,
  onProgress?: (current: number, total: number, chapterNumber: number) => void,
): Promise<RecallEvalCase[]> {
  const sample = sampleRecallChapters(blueprints, sampleSize)
  const cases: RecallEvalCase[] = []
  for (let i = 0; i < sample.length; i++) {
    const bp = sample[i]
    onProgress?.(i + 1, sample.length, bp.chapterNumber)
    const query = buildRecallQuery(bp)
    let hits: RecallHit[] = []
    try {
      const result = await ipc.invoke('kb:search-with-scope', query, 1, bp.chapterNumber - 1, RECALL_EVAL_TOP_K)
      hits = (result ?? []).slice(0, RECALL_EVAL_TOP_K)
    } catch {
      // 单章检索失败不中断整体抽样，记录为空命中
      hits = []
    }
    cases.push({
      chapterNumber: bp.chapterNumber,
      title: bp.title ?? '',
      query,
      hits,
      relevant: hits.map(() => null),
    })
  }
  return cases
}
