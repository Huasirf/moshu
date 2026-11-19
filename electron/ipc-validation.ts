/**
 * IPC Input Validation —— 主进程入口的统一校验层
 *
 * 目的：防止：
 *   - DoS via 巨型 string（1GB statement 直接落 SQLite）
 *   - Type confusion（renderer 发错字段类型）
 *   - Data corruption（type 不在 enum 内）
 *
 * 设计：
 *   - 不引入 zod/valibot 依赖（PR 体积敏感），用纯 TS 实现最小校验
 *   - 校验失败抛 ValidationError，主进程 handler 捕获并返回 { success: false, error }
 *   - 校验器都返回 boolean 或 throw，不修改原对象
 */

export class ValidationError extends Error {
  constructor(public readonly path: string, public readonly reason: string) {
    super(`[IPC Validation] ${path}: ${reason}`)
    this.name = 'ValidationError'
  }
}

// ============================================================
// 通用校验
// ============================================================

export function isString(v: unknown): v is string {
  return typeof v === 'string'
}

export function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

export function isInteger(v: unknown): v is number {
  return isNumber(v) && Number.isInteger(v)
}

export function isBoolean(v: unknown): v is boolean {
  return typeof v === 'boolean'
}

export function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v)
}

export function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

// 字符串长度限制
export function checkStringLength(
  v: unknown,
  path: string,
  options: { min?: number; max: number },
): string {
  if (!isString(v)) {
    throw new ValidationError(path, `expected string, got ${typeof v}`)
  }
  if (v.length < (options.min ?? 0)) {
    throw new ValidationError(path, `too short (min ${options.min ?? 0}, got ${v.length})`)
  }
  if (v.length > options.max) {
    throw new ValidationError(path, `too long (max ${options.max}, got ${v.length})`)
  }
  return v
}

// 数字范围
export function checkNumberRange(
  v: unknown,
  path: string,
  options: { min?: number; max?: number; integer?: boolean },
): number {
  const ok = options.integer ? isInteger(v) : isNumber(v)
  if (!ok) {
    throw new ValidationError(path, `expected ${options.integer ? 'integer' : 'number'}, got ${typeof v}`)
  }
  const num = v as number
  if (options.min !== undefined && num < options.min) {
    throw new ValidationError(path, `below min ${options.min} (got ${num})`)
  }
  if (options.max !== undefined && num > options.max) {
    throw new ValidationError(path, `above max ${options.max} (got ${num})`)
  }
  return num
}

// 枚举
export function checkEnum<T extends string>(
  v: unknown,
  path: string,
  allowed: readonly T[],
): T {
  if (!isString(v) || !allowed.includes(v as T)) {
    throw new ValidationError(
      path,
      `expected one of [${allowed.join(', ')}], got ${JSON.stringify(v)}`,
    )
  }
  return v as T
}

// 数组
export function checkArray<T>(
  v: unknown,
  path: string,
  itemCheck: (item: unknown, itemPath: string) => T,
  options: { minLength?: number; maxLength: number },
): T[] {
  if (!isArray(v)) {
    throw new ValidationError(path, `expected array, got ${typeof v}`)
  }
  if (v.length < (options.minLength ?? 0)) {
    throw new ValidationError(path, `array too short (min ${options.minLength ?? 0}, got ${v.length})`)
  }
  if (v.length > options.maxLength) {
    throw new ValidationError(path, `array too long (max ${options.maxLength}, got ${v.length})`)
  }
  return v.map((item, i) => itemCheck(item, `${path}[${i}]`))
}

// 必需字段
export function checkRequired<T>(
  v: unknown,
  path: string,
  check: (v: unknown, path: string) => T,
): T {
  if (v === undefined || v === null) {
    throw new ValidationError(path, `required field missing`)
  }
  return check(v, path)
}

// 可选字段
export function checkOptional<T>(
  v: unknown,
  path: string,
  check: (v: unknown, path: string) => T,
): T | undefined {
  if (v === undefined || v === null) return undefined
  return check(v, path)
}

// ============================================================
// 领域校验（Canon Store 相关）
// ============================================================

const MAX_STATEMENT_LEN = 500
const MAX_EVIDENCE_LEN = 500
const MAX_NAME_LEN = 200
const MAX_SUMMARY_LEN = 5000
const MAX_LIST_SIZE = 1000
const MAX_OBJECTS_PER_REQUEST = 1000

export const VALID_CATEGORIES = [
  'world', 'location', 'item', 'event', 'relationship', 'identity',
] as const

export const VALID_TIMEFLOW = ['sequential', 'flashback'] as const

export const VALID_PLOT_STATUS = ['active', 'resolved', 'paused'] as const

export function validateCanonTimelineEventInput(v: unknown, path = 'event') {
  if (!isObject(v)) {
    throw new ValidationError(path, 'expected object')
  }
  return {
    chapterNumber: checkNumberRange(v.chapterNumber, `${path}.chapterNumber`, { min: 1, max: 1e9, integer: true }),
    sequence: checkNumberRange(v.sequence, `${path}.sequence`, { min: 1, max: 1e6, integer: true }),
    characters: checkArray(v.characters, `${path}.characters`, (c, p) => checkStringLength(c, p, { max: 50 }), { maxLength: MAX_LIST_SIZE }),
    location: checkStringLength(v.location, `${path}.location`, { max: 200 }),
    timeFlow: checkEnum(v.timeFlow, `${path}.timeFlow`, VALID_TIMEFLOW),
    summary: checkStringLength(v.summary, `${path}.summary`, { max: 500 }),
    impact: checkOptional(v.impact, `${path}.impact`, (s, p) => checkStringLength(s, p, { max: 500 })) ?? '',
    absoluteTime: checkOptional(v.absoluteTime, `${path}.absoluteTime`, (s, p) => checkStringLength(s, p, { max: 40 })) ?? '',
    duration: checkOptional(v.duration, `${path}.duration`, (s, p) => checkStringLength(s, p, { max: 100 })) ?? '',
    source: checkOptional(v.source, `${path}.source`, (s, p) => checkEnum(s, p, ['canon', 'finalize_extract', 'manual'] as const)) ?? 'canon',
    confidence: checkOptional(v.confidence, `${path}.confidence`, (n, p) => checkNumberRange(n, p, { min: 0, max: 1 })) ?? 1,
    evidence: checkOptional(v.evidence, `${path}.evidence`, (s, p) => checkStringLength(s, p, { max: MAX_EVIDENCE_LEN })) ?? '',
    status: checkOptional(v.status, `${path}.status`, (s, p) => checkEnum(s, p, ['confirmed', 'pending', 'rejected'] as const)) ?? 'confirmed',
  }
}

export function validateCanonFactInput(v: unknown, path = 'fact') {
  if (!isObject(v)) {
    throw new ValidationError(path, 'expected object')
  }
  return {
    category: checkEnum(v.category, `${path}.category`, VALID_CATEGORIES),
    statement: checkStringLength(v.statement, `${path}.statement`, { min: 1, max: MAX_STATEMENT_LEN }),
    introducedAt: checkNumberRange(v.introducedAt, `${path}.introducedAt`, { min: 0, max: 1e9, integer: true }),
    characters: checkArray(v.characters, `${path}.characters`, (c, p) => checkStringLength(c, p, { max: 50 }), { maxLength: MAX_LIST_SIZE }),
    evidence: checkOptional(v.evidence, `${path}.evidence`, (s, p) => checkStringLength(s, p, { max: MAX_EVIDENCE_LEN })) ?? '',
  }
}

export function validateCanonPlotLineInput(v: unknown, path = 'plotLine') {
  if (!isObject(v)) {
    throw new ValidationError(path, 'expected object')
  }
  return {
    name: checkStringLength(v.name, `${path}.name`, { min: 1, max: MAX_NAME_LEN }),
    status: checkEnum(v.status, `${path}.status`, VALID_PLOT_STATUS),
    startedAt: checkNumberRange(v.startedAt, `${path}.startedAt`, { min: 0, max: 1e9, integer: true }),
    lastAdvancedAt: checkNumberRange(v.lastAdvancedAt, `${path}.lastAdvancedAt`, { min: 0, max: 1e9, integer: true }),
    resolvedAt: checkOptional(v.resolvedAt, `${path}.resolvedAt`, (n, p) => checkNumberRange(n, p, { min: 0, max: 1e9, integer: true })),
    characters: checkArray(v.characters, `${path}.characters`, (c, p) => checkStringLength(c, p, { max: 50 }), { maxLength: MAX_LIST_SIZE }),
    currentState: checkStringLength(v.currentState, `${path}.currentState`, { max: 1000 }),
    description: checkOptional(v.description, `${path}.description`, (s, p) => checkStringLength(s, p, { max: 1000 })) ?? '',
  }
}

export function validateCanonCharacterStateSnapshot(v: unknown, path = 'snapshot', opts: { requireCharacter?: boolean } = {}) {
  const { requireCharacter = true } = opts
  if (!isObject(v)) {
    throw new ValidationError(path, 'expected object')
  }
  return {
    // delta.after 是 Partial<CharacterStateSnapshot>（角色名在 delta 顶层的 character），
    // 此时 character 允许缺省；独立快照 upsert 仍要求 character 必填。
    character: requireCharacter
      ? checkStringLength(v.character, `${path}.character`, { min: 1, max: MAX_NAME_LEN })
      : checkStringLength(v.character ?? '', `${path}.character`, { max: MAX_NAME_LEN }),
    location: checkStringLength(v.location ?? '', `${path}.location`, { max: 200 }),
    powerLevel: checkStringLength(v.powerLevel ?? '', `${path}.powerLevel`, { max: 200 }),
    physicalState: checkStringLength(v.physicalState ?? '', `${path}.physicalState`, { max: 500 }),
    mentalState: checkStringLength(v.mentalState ?? '', `${path}.mentalState`, { max: 500 }),
    keyItems: checkStringLength(v.keyItems ?? '', `${path}.keyItems`, { max: 500 }),
    currentGoal: checkStringLength(v.currentGoal ?? '', `${path}.currentGoal`, { max: 1000 }),
    knowledge: checkArray(v.knowledge ?? [], `${path}.knowledge`, (c, p) => checkStringLength(c, p, { max: 500 }), { maxLength: MAX_LIST_SIZE }),
    relationships: isObject(v.relationships) ? v.relationships as Record<string, string> : {},
    recentEvents: checkStringLength(v.recentEvents ?? '', `${path}.recentEvents`, { max: 1000 }),
    updatedAtChapter: checkNumberRange(v.updatedAtChapter ?? 0, `${path}.updatedAtChapter`, { min: 0, max: 1e9, integer: true }),
    updatedAt: checkStringLength(v.updatedAt ?? '', `${path}.updatedAt`, { max: 100 }),
  }
}

export function validateCanonChapterSummary(v: unknown, path = 'summary') {
  if (!isObject(v)) {
    throw new ValidationError(path, 'expected object')
  }
  return {
    chapterNumber: checkNumberRange(v.chapterNumber, `${path}.chapterNumber`, { min: 0, max: 1e9, integer: true }),
    title: checkStringLength(v.title ?? '', `${path}.title`, { max: 500 }),
    summary: checkStringLength(v.summary, `${path}.summary`, { min: 0, max: MAX_SUMMARY_LEN }),
    createdAt: checkStringLength(v.createdAt ?? '', `${path}.createdAt`, { max: 100 }),
  }
}

/** 分层摘要（卷 / 全书） */
export function validateCanonArcSummary(v: unknown, path = 'arcSummary') {
  if (!isObject(v)) {
    throw new ValidationError(path, 'expected object')
  }
  if (v.level !== 'arc' && v.level !== 'book') {
    throw new ValidationError(`${path}.level`, `expected 'arc' | 'book', got ${String(v.level)}`)
  }
  const startChapter = checkNumberRange(v.startChapter, `${path}.startChapter`, { min: 1, max: 1e9, integer: true })
  const endChapter = checkNumberRange(v.endChapter, `${path}.endChapter`, { min: 1, max: 1e9, integer: true })
  if (endChapter < startChapter) {
    throw new ValidationError(`${path}.endChapter`, `must be >= startChapter (${startChapter})`)
  }
  return {
    level: v.level as 'arc' | 'book',
    startChapter,
    endChapter,
    title: checkStringLength(v.title ?? '', `${path}.title`, { max: 500 }),
    summary: checkStringLength(v.summary, `${path}.summary`, { min: 0, max: MAX_SUMMARY_LEN }),
    createdAt: checkStringLength(v.createdAt ?? '', `${path}.createdAt`, { max: 100 }),
  }
}

export function validateCanonWritebackPayload(v: unknown, path = 'payload') {
  if (!isObject(v)) {
    throw new ValidationError(path, 'expected object')
  }
  return {
    chapterNumber: checkNumberRange(v.chapterNumber, `${path}.chapterNumber`, { min: 1, max: 1e9, integer: true }),
    newEvents: checkArray(
      v.newEvents,
      `${path}.newEvents`,
      (e, p) => validateCanonTimelineEventInput(e, p),
      { maxLength: MAX_OBJECTS_PER_REQUEST },
    ),
    characterDeltas: checkArray(
      v.characterDeltas,
      `${path}.characterDeltas`,
      (d, p) => {
        if (!isObject(d)) throw new ValidationError(p, 'expected object')
        return {
          character: checkStringLength(d.character, `${p}.character`, { min: 1, max: MAX_NAME_LEN }),
          chapterNumber: checkNumberRange(d.chapterNumber, `${p}.chapterNumber`, { min: 1, max: 1e9, integer: true }),
          after: validateCanonCharacterStateSnapshot(d.after, `${p}.after`, { requireCharacter: false }),
        }
      },
      { maxLength: MAX_OBJECTS_PER_REQUEST },
    ),
    plotLineChanges: checkOptional(v.plotLineChanges, `${path}.plotLineChanges`, (pl, p) => {
      if (!isObject(pl)) throw new ValidationError(p, 'expected object')
      return {
        added: checkOptional(pl.added, `${p}.added`, (a, ap) =>
          checkArray(a, ap, (item, iap) => validateCanonPlotLineInput(item, iap), { maxLength: 500 })),
        advanced: checkOptional(pl.advanced, `${p}.advanced`, (a, ap) =>
          checkArray(a, ap, (item, iap) => {
            if (!isObject(item)) throw new ValidationError(iap, 'expected object')
            return {
              id: checkNumberRange(item.id, `${iap}.id`, { min: 1, max: 1e9, integer: true }),
              currentState: checkStringLength(item.currentState, `${iap}.currentState`, { max: 1000 }),
              lastAdvancedAt: checkNumberRange(item.lastAdvancedAt, `${iap}.lastAdvancedAt`, { min: 0, max: 1e9, integer: true }),
            }
          }, { maxLength: 500 })),
        resolved: checkOptional(pl.resolved, `${p}.resolved`, (a, ap) =>
          checkArray(a, ap, (n, ip) => checkNumberRange(n, ip, { min: 1, max: 1e9, integer: true }), { maxLength: 500 })),
      }
    }),
    newFacts: checkArray(
      v.newFacts,
      `${path}.newFacts`,
      (f, p) => validateCanonFactInput(f, p),
      { maxLength: MAX_OBJECTS_PER_REQUEST },
    ),
  }
}

// ============================================================
// 全局搜索
// ============================================================

/** 搜索词上限：侧栏输入框场景足够，也挡住超长串拖慢逐章匹配 */
export const MAX_SEARCH_QUERY_LEN = 200

/** db:search-chapters 入参：{ query, options }（query 去掉首尾空白后不能为空） */
export function validateChapterSearchArgs(v: unknown, path = 'search') {
  if (!isObject(v)) {
    throw new ValidationError(path, 'expected object')
  }
  const query = checkStringLength(v.query, `${path}.query`, { max: MAX_SEARCH_QUERY_LEN }).trim()
  if (!query) {
    throw new ValidationError(`${path}.query`, 'empty query')
  }
  const options = checkOptional(v.options, `${path}.options`, (o, p) => {
    if (!isObject(o)) throw new ValidationError(p, 'expected object')
    const flag = (key: string) => checkOptional(o[key], `${p}.${key}`, (b, bp) => {
      if (!isBoolean(b)) throw new ValidationError(bp, `expected boolean, got ${typeof b}`)
      return b
    }) ?? false
    return { caseSensitive: flag('caseSensitive'), finalizedOnly: flag('finalizedOnly') }
  }) ?? { caseSensitive: false, finalizedOnly: false }
  return { query, options }
}

// ============================================================
// P1 数据层：资产 / 属性 / 关系 / 流水线 / 风格 / 审稿台账
// ============================================================

export const VALID_ASSET_TYPES = [
  'character', 'item', 'location', 'skill', 'faction', 'secret', 'number',
] as const
export const VALID_ASSET_STATUSES = ['active', 'inactive', 'archived'] as const
export const VALID_ATTRIBUTE_VALUE_TYPES = ['number', 'enum', 'text'] as const
export const VALID_ATTRIBUTE_PHASES = ['before', 'after'] as const
export const VALID_RELATION_STATUSES = ['active', 'broken', 'paused', 'ended'] as const
export const VALID_REVIEW_SEVERITIES = ['error', 'warning', 'info'] as const
export const VALID_FINDING_STATUSES = ['open', 'fixed', 'ignored'] as const

const MAX_ASSET_NAME = 200
const MAX_ASSET_TEXT = 20_000
const MAX_TYPE_DATA_LEN = 100_000
const MAX_TAG_LEN = 50
const MAX_TAGS = 50

const checkNonNegativeInteger = (v: unknown, path: string) =>
  checkNumberRange(v, path, { min: 0, max: 1e9, integer: true })

const checkOptionalBoolean = (v: unknown, path: string) =>
  checkOptional(v, path, (b, p) => {
    if (!isBoolean(b)) throw new ValidationError(p, `expected boolean, got ${typeof b}`)
    return b
  })

const checkStringArray = (v: unknown, path: string, maxItemLen: number, maxLength = MAX_TAGS) =>
  checkArray(v, path, (item, p) => checkStringLength(item, p, { min: 0, max: maxItemLen }), { maxLength })

/** db:asset-upsert 入参 */
export function validateAssetInput(v: unknown, path = 'asset') {
  if (!isObject(v)) throw new ValidationError(path, 'expected object')
  const typeData = checkOptional(v.typeData, `${path}.typeData`, (t, p) => {
    if (!isObject(t)) throw new ValidationError(p, 'expected object')
    if (JSON.stringify(t).length > MAX_TYPE_DATA_LEN) throw new ValidationError(p, 'too large')
    return t as Record<string, unknown>
  }) ?? {}
  return {
    id: checkOptional(v.id, `${path}.id`, (n, p) => checkNumberRange(n, p, { min: 1, max: 1e9, integer: true })),
    entityType: checkEnum(v.entityType, `${path}.entityType`, VALID_ASSET_TYPES),
    name: checkStringLength(v.name, `${path}.name`, { min: 1, max: MAX_ASSET_NAME }).trim(),
    summary: checkOptional(v.summary, `${path}.summary`, (s, p) => checkStringLength(s, p, { max: MAX_ASSET_TEXT })) ?? '',
    description: checkOptional(v.description, `${path}.description`, (s, p) => checkStringLength(s, p, { max: MAX_ASSET_TEXT })) ?? '',
    status: checkOptional(v.status, `${path}.status`, (s, p) => checkEnum(s, p, VALID_ASSET_STATUSES)),
    firstChapter: checkOptional(v.firstChapter, `${path}.firstChapter`, checkNonNegativeInteger),
    lastChapter: checkOptional(v.lastChapter, `${path}.lastChapter`, checkNonNegativeInteger),
    tags: checkOptional(v.tags, `${path}.tags`, (t, p) => checkStringArray(t, p, MAX_TAG_LEN)) ?? [],
    typeData,
  }
}

/** db:attribute-def-upsert 入参 */
export function validateAttributeDefInput(v: unknown, path = 'def') {
  if (!isObject(v)) throw new ValidationError(path, 'expected object')
  const minValue = checkOptional(v.minValue, `${path}.minValue`, (n, p) => {
    if (!isNumber(n)) throw new ValidationError(p, `expected number, got ${typeof n}`)
    return n
  }) ?? null
  const maxValue = checkOptional(v.maxValue, `${path}.maxValue`, (n, p) => {
    if (!isNumber(n)) throw new ValidationError(p, `expected number, got ${typeof n}`)
    return n
  }) ?? null
  if (minValue !== null && maxValue !== null && minValue > maxValue) {
    throw new ValidationError(`${path}.minValue`, 'must be <= maxValue')
  }
  return {
    key: checkStringLength(v.key, `${path}.key`, { min: 1, max: 100 }).trim(),
    entityType: checkOptional(v.entityType, `${path}.entityType`, (s, p) => checkStringLength(s, p, { min: 1, max: 100 })) ?? 'character',
    label: checkStringLength(v.label, `${path}.label`, { min: 1, max: 100 }).trim(),
    valueType: checkEnum(v.valueType, `${path}.valueType`, VALID_ATTRIBUTE_VALUE_TYPES),
    enumValues: checkOptional(v.enumValues, `${path}.enumValues`, (a, p) => checkStringArray(a, p, 100, 200)) ?? [],
    unit: checkOptional(v.unit, `${path}.unit`, (s, p) => checkStringLength(s, p, { max: 50 })) ?? '',
    minValue,
    maxValue,
    showInPanel: checkOptionalBoolean(v.showInPanel, `${path}.showInPanel`) ?? true,
    sortOrder: checkOptional(v.sortOrder, `${path}.sortOrder`, (n, p) => checkNumberRange(n, p, { min: -1e6, max: 1e6, integer: true })) ?? 0,
  }
}

/** db:attribute-value-set 入参 */
export function validateAttributeValueInput(v: unknown, path = 'value') {
  if (!isObject(v)) throw new ValidationError(path, 'expected object')
  return {
    entityId: checkStringLength(v.entityId, `${path}.entityId`, { min: 1, max: 200 }).trim(),
    attrKey: checkStringLength(v.attrKey, `${path}.attrKey`, { min: 1, max: 100 }).trim(),
    chapterNumber: checkNumberRange(v.chapterNumber, `${path}.chapterNumber`, { min: 1, max: 1e9, integer: true }),
    phase: checkOptional(v.phase, `${path}.phase`, (s, p) => checkEnum(s, p, VALID_ATTRIBUTE_PHASES)),
    numValue: checkOptional(v.numValue, `${path}.numValue`, (n, p) => {
      if (!isNumber(n)) throw new ValidationError(p, `expected number, got ${typeof n}`)
      return n
    }) ?? null,
    textValue: checkOptional(v.textValue, `${path}.textValue`, (s, p) => checkStringLength(s, p, { max: 5000 })) ?? null,
    source: checkOptional(v.source, `${path}.source`, (s, p) => checkStringLength(s, p, { max: 200 })) ?? '',
    sourceEventId: checkOptional(v.sourceEventId, `${path}.sourceEventId`, (n, p) => checkNumberRange(n, p, { min: 1, max: 1e9, integer: true })) ?? null,
  }
}

/** db:relation-upsert 入参 */
export function validateEntityRelationInput(v: unknown, path = 'relation') {
  if (!isObject(v)) throw new ValidationError(path, 'expected object')
  return {
    fromId: checkStringLength(v.fromId, `${path}.fromId`, { min: 1, max: 200 }).trim(),
    toId: checkStringLength(v.toId, `${path}.toId`, { min: 1, max: 200 }).trim(),
    relationType: checkStringLength(v.relationType, `${path}.relationType`, { min: 1, max: 100 }).trim(),
    affection: checkOptional(v.affection, `${path}.affection`, (n, p) => checkNumberRange(n, p, { min: -1e9, max: 1e9, integer: true })) ?? 0,
    status: checkOptional(v.status, `${path}.status`, (s, p) => checkEnum(s, p, VALID_RELATION_STATUSES)),
    sinceChapter: checkOptional(v.sinceChapter, `${path}.sinceChapter`, checkNonNegativeInteger) ?? 0,
    lastChangedChapter: checkOptional(v.lastChangedChapter, `${path}.lastChangedChapter`, checkNonNegativeInteger),
    note: checkOptional(v.note, `${path}.note`, (s, p) => checkStringLength(s, p, { max: 2000 })) ?? '',
  }
}

/** db:style-create / db:style-update 入参 */
export function validateStyleProfileInput(v: unknown, path = 'style') {
  if (!isObject(v)) throw new ValidationError(path, 'expected object')
  return {
    name: checkStringLength(v.name, `${path}.name`, { min: 1, max: 100 }).trim(),
    rules: checkOptional(v.rules, `${path}.rules`, (a, p) => checkStringArray(a, p, 1000, 300)) ?? [],
    promptHint: checkOptional(v.promptHint, `${path}.promptHint`, (s, p) => checkStringLength(s, p, { max: 4000 })) ?? '',
    isActive: checkOptionalBoolean(v.isActive, `${path}.isActive`) ?? false,
  }
}

/** db:review-finding-add / add-many 入参 */
export function validateReviewFindingInput(v: unknown, path = 'finding') {
  if (!isObject(v)) throw new ValidationError(path, 'expected object')
  return {
    chapterNumber: checkNumberRange(v.chapterNumber, `${path}.chapterNumber`, { min: 1, max: 1e9, integer: true }),
    draftId: checkOptional(v.draftId, `${path}.draftId`, (s, p) => checkStringLength(s, p, { max: 100 })) ?? '',
    stage: checkStringLength(v.stage, `${path}.stage`, { min: 1, max: 100 }),
    category: checkStringLength(v.category, `${path}.category`, { min: 1, max: 100 }),
    severity: checkEnum(v.severity, `${path}.severity`, VALID_REVIEW_SEVERITIES),
    message: checkStringLength(v.message, `${path}.message`, { min: 1, max: 5000 }),
    evidence: checkOptional(v.evidence, `${path}.evidence`, (s, p) => checkStringLength(s, p, { max: 5000 })) ?? '',
    locationHint: checkOptional(v.locationHint, `${path}.locationHint`, (s, p) => checkStringLength(s, p, { max: 5000 })) ?? '',
  }
}

/**
 * 安全调用 validator 包装器：捕获 ValidationError 并返回 { success, error }
 * 用于 ipcMain.handle 内部
 */
export function safeValidate<T>(validator: (v: unknown) => T, raw: unknown): { ok: true; data: T } | { ok: false; error: string } {
  try {
    return { ok: true, data: validator(raw) }
  } catch (e) {
    if (e instanceof ValidationError) {
      return { ok: false, error: e.message }
    }
    throw e
  }
}
