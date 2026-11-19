/**
 * 角色动态状态的字段白名单与差异比较（纯函数，无数据库依赖，便于单测）
 *
 * 固定档案（外貌/性格/背景/动机/弧光/关系）永远不在白名单里：
 * 定稿自动写回只允许改这些动态字段，避免 AI 把"人设"越写越偏。
 */

export const DYNAMIC_STATE_FIELDS = [
    'location',
    'powerLevel',
    'physicalState',
    'mentalState',
    'keyItems',
    'recentEvents',
    'knownInfo',
    'talents',
    'skills',
] as const

export type DynamicStateField = typeof DYNAMIC_STATE_FIELDS[number]

/** 参与比较的状态对象（结构松散，兼容旧数据缺字段） */
export type DynamicStateLike = Partial<Record<DynamicStateField, string | string[] | undefined>>

/** 把状态字段归一成可比较、可序列化的形式（空串 / 空数组视为「无值」） */
export function normalizeStateValue(field: DynamicStateField, value: unknown): string | string[] {
    if (field === 'talents' || field === 'skills') {
        if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean)
        const text = String(value ?? '').trim()
        return text ? text.split(/[、,，;；/|\n]+/).map((item) => item.trim()).filter(Boolean) : []
    }
    if (value === undefined || value === null) return ''
    return String(value)
}

/** 两个字段值是否实质相同（数组按元素顺序比较；空数组与空串等价） */
export function isSameStateValue(field: DynamicStateField, a: unknown, b: unknown): boolean {
    const left = normalizeStateValue(field, a)
    const right = normalizeStateValue(field, b)
    if (Array.isArray(left) || Array.isArray(right)) {
        return JSON.stringify(left) === JSON.stringify(right)
    }
    return left === right
}

/** 计算一组前后状态里真正发生变化的动态字段 */
export function diffDynamicState(
    before: DynamicStateLike | null | undefined,
    after: DynamicStateLike,
): Array<{ field: DynamicStateField; before: string | string[]; after: string | string[] }> {
    const changes: Array<{ field: DynamicStateField; before: string | string[]; after: string | string[] }> = []
    for (const field of DYNAMIC_STATE_FIELDS) {
        if (!(field in after)) continue
        const oldValue = before ? before[field] : undefined
        const newValue = after[field]
        if (isSameStateValue(field, oldValue, newValue)) continue
        changes.push({
            field,
            before: normalizeStateValue(field, oldValue),
            after: normalizeStateValue(field, newValue),
        })
    }
    return changes
}
