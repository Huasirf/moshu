/**
 * 思考档位的解析与映射（纯函数，便于单测）
 *
 * 解析顺序：单次调用参数 > 模型 thinking.defaultLevel > 不发送。
 * 档位到上游参数的映射：模型 thinking.map（可覆盖中转站的词表）> 协议内置默认。
 */
import type { ModelProfile, ThinkingLevel } from '../../src/shared/ipc-channels'

/** 只有开/关、没有档位的服务商：请求体用 thinking 对象表达 */
export function usesThinkingObject(provider: ModelProfile['provider']): boolean {
  return provider === 'deepseek' || provider === 'bigmodel'
}

/** 解析最终档位；undefined 表示不发送任何思考参数 */
export function resolveThinkingLevel(
  model: ModelProfile,
  requested?: boolean | ThinkingLevel,
): ThinkingLevel | undefined {
  // 模型明确声明不支持思考时不发送，避免上游 400
  if (model.thinking?.supports === false) return undefined
  if (typeof requested === 'string') return requested
  if (requested === false) return 'off'
  return model.thinking?.defaultLevel ?? (requested === true ? 'high' : undefined)
}

/**
 * 思考开启时为思维链预留的输出预算。
 * DeepSeek / GLM 把思维链计入 max_tokens，而写稿、蓝图等流程按正文长度传了偏紧的
 * max_tokens，开启思考后正文会被挤到截断（finish_reason=length），所以要额外预留。
 */
export const THINKING_OUTPUT_RESERVE = 8192

/** 计算实际发往上游的 max_tokens：思考开启时给思维链留出预算，上限不超过模型配置 */
export function thinkingOutputTokens(
  base: number,
  model: ModelProfile,
  level?: ThinkingLevel,
): number {
  if (!level || level === 'off' || !usesThinkingObject(model.provider)) return base
  const ceiling = Math.max(base, model.maxTokens)
  return Math.min(ceiling, base + THINKING_OUTPUT_RESERVE)
}

/**
 * 查询模型自定义的档位映射：
 * - 字符串：发往上游的实际值
 * - null：该档位明确不支持
 * - undefined：map 未覆盖该档位，使用协议内置默认
 */
export function mappedThinkingValue(model: ModelProfile, level: ThinkingLevel): string | null | undefined {
  const map = model.thinking?.map
  if (!map || !Object.prototype.hasOwnProperty.call(map, level)) return undefined
  return map[level] ?? null
}

/** Gemini / Anthropic 的档位默认预算 */
export const GEMINI_BUDGETS: Record<'low' | 'medium' | 'high', number> = { low: 1024, medium: 8192, high: 24576 }
export const ANTHROPIC_BUDGETS: Record<'low' | 'medium' | 'high', number> = { low: 1024, medium: 8192, high: 16384 }
