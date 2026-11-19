import { ILLMProvider, LLMGenerateOptions, LLMResponse, LLMStreamOptions } from './provider.interface'
import { ModelProfile, ThinkingLevel } from '../../src/shared/ipc-channels'
import { GEMINI_BUDGETS, mappedThinkingValue } from './thinking'
import {
  createTimeoutController, withRequestTimeout, timeoutMessage, httpErrorMessage,
  CONNECT_TIMEOUT_MS, STREAM_IDLE_TIMEOUT_MS, REQUEST_TIMEOUT_MS,
} from './http'

/**
 * 生成 Gemini 的 thinkingConfig：
 * - Gemini 2.5 用 thinkingBudget（off=0，其余按档位预算）
 * - Gemini 3 用 thinkingLevel（不支持完全关闭，最低 low）
 */
export function geminiThinkingConfig(
  model: ModelProfile,
  level?: ThinkingLevel,
): { config?: Record<string, unknown>; error?: string; reserveTokens?: number } {
  if (!level) return {}
  const mapped = mappedThinkingValue(model, level)
  if (mapped === null) return { error: `该模型不支持所选思考档位（${level}）` }

  // Gemini 3 / 4 用 thinkingLevel（不支持 thinkingBudget，也不支持完全关闭，最低 low）
  if (/gemini-(?:3|4)/i.test(model.modelName)) {
    const value = mapped ?? (level === 'off' || level === 'low' ? 'low' : 'high')
    // 思考 token 计入 maxOutputTokens：预留额度，避免长文请求被思考吃光预算后返回空正文
    return { config: { thinkingLevel: value }, reserveTokens: value === 'low' ? 2048 : 8192 }
  }

  if (level === 'off') return { config: { thinkingBudget: 0 } }
  const parsedMap = mapped !== undefined ? Number(mapped) : NaN
  const budget = Number.isFinite(parsedMap) && parsedMap > 0 ? Math.floor(parsedMap) : GEMINI_BUDGETS[level]
  return { config: { thinkingBudget: budget }, reserveTokens: budget }
}

/**
 * 思考 token 与正文共用 maxOutputTokens：按思考档位预留余量，
 * 否则长文请求（maxTokens 按字数估算）会被思考吃光，正文为空。
 */
function withThinkingHeadroom(baseMax: number, hardCap: number, reserve?: number): number {
  if (!reserve || !Number.isFinite(reserve)) return baseMax
  return Math.min(baseMax + reserve, Math.max(hardCap, baseMax))
}

/** 过滤思考块：部分中转站把 Gemini 的 thought 文本混在 content parts 里返回 */
function joinVisibleText(parts?: Array<{ text?: string; thought?: boolean }>): string {
  if (!parts) return ''
  return parts.filter((p) => !p.thought).map((p) => p.text || '').join('')
}

export class GeminiProvider implements ILLMProvider {
  private toGeminiContents(messages: Array<{ role: string; content: string }>) {
    let systemInstruction: string | undefined
    const contents: Array<{ role: string; parts: Array<{ text: string }> }> = []

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemInstruction = msg.content
        continue
      }
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      })
    }
    return { contents, systemInstruction }
  }
  async generate(model: ModelProfile, messages: Array<{ role: string; content: string }>, opts: LLMGenerateOptions): Promise<LLMResponse> {
    const baseUrl = model.baseUrl.replace(/\/$/, '')
    const url = `${baseUrl}/v1beta/models/${model.modelName}:generateContent`

    const { contents, systemInstruction } = this.toGeminiContents(messages)

    const generationConfig: Record<string, unknown> = {
      temperature: opts.temperature ?? model.temperature,
      maxOutputTokens: opts.maxTokens ?? model.maxTokens,
    }
    const thinking = geminiThinkingConfig(model, opts.thinking)
    if (thinking.error) return { success: false, content: '', error: thinking.error }
    if (thinking.config) {
      generationConfig.thinkingConfig = thinking.config
      generationConfig.maxOutputTokens = withThinkingHeadroom(
        Number(generationConfig.maxOutputTokens) || 0,
        Number(model.maxTokens) || 0,
        thinking.reserveTokens,
      )
    }

    const body: Record<string, unknown> = { contents, generationConfig }
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] }
    }

    type GenerateContentResponse = {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
    }
    let data: GenerateContentResponse
    try {
      // 超时覆盖整个请求（含读完响应体），服务端挂住时不会让 invoke 永远不返回
      const result = await withRequestTimeout(REQUEST_TIMEOUT_MS, async (signal) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': model.apiKey,
          },
          body: JSON.stringify(body),
          signal,
        })
        if (!res.ok) {
          return { ok: false as const, error: httpErrorMessage('Gemini API 调用失败', res, await res.text()) }
        }
        return { ok: true as const, data: await res.json() as GenerateContentResponse }
      })
      if (!result.ok) return { success: false, content: '', error: result.error }
      data = result.data
    } catch (error) {
      return { success: false, content: '', error: error instanceof Error ? error.message : String(error) }
    }

    const text = joinVisibleText(data.candidates?.[0]?.content?.parts)
    const usage = data.usageMetadata ? {
      promptTokens: data.usageMetadata.promptTokenCount ?? 0,
      completionTokens: data.usageMetadata.candidatesTokenCount ?? 0,
      totalTokens: data.usageMetadata.totalTokenCount ?? 0,
    } : undefined

    return { success: true, content: text, usage }
  }

  async generateStream(model: ModelProfile, messages: Array<{ role: string; content: string }>, opts: LLMStreamOptions): Promise<void> {
    // 连接阶段用连接超时；收到响应头后切换为流空闲超时，每收到一段数据重新计时
    const tc = createTimeoutController(CONNECT_TIMEOUT_MS, opts.signal)
    let streaming = false
    try {
      const baseUrl = model.baseUrl.replace(/\/$/, '')
      const url = `${baseUrl}/v1beta/models/${model.modelName}:streamGenerateContent?alt=sse`

      const { contents, systemInstruction } = this.toGeminiContents(messages)

      const generationConfig: Record<string, unknown> = {
        temperature: opts.temperature ?? model.temperature,
        maxOutputTokens: opts.maxTokens ?? model.maxTokens,
      }
      const thinking = geminiThinkingConfig(model, opts.thinking)
      if (thinking.error) {
        opts.onError(thinking.error)
        return
      }
      if (thinking.config) {
        generationConfig.thinkingConfig = thinking.config
        generationConfig.maxOutputTokens = withThinkingHeadroom(
          Number(generationConfig.maxOutputTokens) || 0,
          Number(model.maxTokens) || 0,
          thinking.reserveTokens,
        )
      }

      const body: Record<string, unknown> = { contents, generationConfig }
      if (systemInstruction) {
        body.systemInstruction = { parts: [{ text: systemInstruction }] }
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': model.apiKey,
        },
        body: JSON.stringify(body),
        signal: tc.signal,
      })

      if (!res.ok) {
        const text = await res.text()
        opts.onError(httpErrorMessage('Gemini API 调用失败', res, text))
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        opts.onError('无法读取 Gemini 响应流')
        return
      }

      streaming = true
      tc.reset(STREAM_IDLE_TIMEOUT_MS)

      const decoder = new TextDecoder()
      let fullText = ''
      let usage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined

      const handleData = (json: string) => {
        if (!json) return
        try {
          const parsed = JSON.parse(json) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number }
          }
          const chunk = joinVisibleText(parsed.candidates?.[0]?.content?.parts)
          if (chunk) {
            fullText += chunk
            opts.onChunk(chunk)
          }
          if (parsed.usageMetadata) {
            usage = {
              promptTokens: parsed.usageMetadata.promptTokenCount ?? 0,
              completionTokens: parsed.usageMetadata.candidatesTokenCount ?? 0,
              totalTokens: parsed.usageMetadata.totalTokenCount ?? 0,
            }
          }
        } catch {
          // ignore
        }
      }

      // SSE 事件可能跨越网络分片边界，跨块保留未完整行，避免事件被丢弃
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        // 收到数据：流空闲超时重新计时
        tc.reset()

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim() // 兼容 \r\n 行尾
          if (trimmed.startsWith('data: ')) {
            handleData(trimmed.slice(6).trim())
          }
        }
      }

      // 流末尾最后一条事件可能没有换行结尾
      if (buffer.trim()) {
        const trimmed = buffer.trim()
        if (trimmed.startsWith('data: ')) {
          handleData(trimmed.slice(6).trim())
        }
      }

      opts.onDone(fullText, usage)
    } catch (error) {
      if (tc.timedOut) {
        opts.onError(streaming
          ? timeoutMessage(STREAM_IDLE_TIMEOUT_MS, '流式响应')
          : timeoutMessage(CONNECT_TIMEOUT_MS, '连接'))
      } else if ((error as Error).name === 'AbortError') {
        opts.onError('已取消生成')
      } else {
        const cause = (error as { cause?: { message?: string; code?: string } }).cause
        const causeText = cause && (cause.message || cause.code) ? `（底层原因: ${cause.message || cause.code}）` : ''
        opts.onError(String(error) + causeText)
      }
    } finally {
      tc.dispose()
    }
  }
}
