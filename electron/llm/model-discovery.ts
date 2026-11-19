/**
 * 从绑定的上游接口地址拉取模型列表（只读 GET，不消耗生成额度）。
 *
 * - OpenAI 兼容：GET {base}/v1/models
 * - Gemini 原生：GET {base}/v1beta/models（pageSize=100，按 nextPageToken 翻页）
 * - Anthropic 原生：GET {base}/v1/models（limit=100，按 after_id 翻页）
 * - Ollama：沿用 /api/tags
 *
 * 错误码与 CC Switch 的分类保持一致，便于界面给出可操作的提示：
 * INVALID_URL / AUTH_FAILED(401/403) / NOT_SUPPORTED(404/405) / INVALID_RESPONSE / TIMEOUT / CONNECTION_FAILED / HTTP_x
 */
import { listOllamaModels } from './ollama-models'
import { ANTHROPIC_VERSION } from './anthropic-provider'

export type DiscoverProtocol = 'openai' | 'gemini' | 'anthropic'

export interface ModelDiscoveryInput {
  protocol: DiscoverProtocol
  provider?: string
  baseUrl: string
  apiKey?: string
}

export interface DiscoveredModel {
  id: string
  name?: string
  ownedBy?: string
}

const DISCOVERY_TIMEOUT_MS = 10_000
const MAX_PAGES = 5

/** 校验接口地址：只允许 http/https，且不能带用户名密码、查询串或锚点 */
function validated(raw: string): URL {
  let url: URL
  try {
    url = new URL((raw ?? '').trim())
  } catch {
    throw new Error('INVALID_URL')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('INVALID_URL')
  }
  return url
}

/** OpenAI 兼容的模型地址：兼容填根域名、/v1、/vN 或完整 /models 四种写法 */
export function openAiModelsUrl(raw: string): string {
  const url = validated(raw)
  const path = url.pathname.replace(/\/+$/, '')
  if (/\/models$/.test(path)) return url.toString()
  url.pathname = /\/v\d+$/.test(path) ? `${path}/models` : `${path}/v1/models`
  return url.toString()
}

/** Gemini 原生模型地址：兼容根域名、/v1beta、/v1 等写法 */
export function geminiModelsUrl(raw: string): string {
  const url = validated(raw)
  const path = url.pathname.replace(/\/+$/, '')
  if (/\/models$/.test(path)) return url.toString()
  url.pathname = /\/v\d+(?:beta|alpha)?$/.test(path) ? `${path}/models` : `${path}/v1beta/models`
  return url.toString()
}

/** Anthropic 原生模型地址：兼容根域名、/v1 与完整 /v1/models */
export function anthropicModelsUrl(raw: string): string {
  const url = validated(raw)
  const path = url.pathname.replace(/\/+$/, '')
  if (/\/models$/.test(path)) return url.toString()
  url.pathname = /\/v1$/.test(path) ? `${path}/models` : `${path}/v1/models`
  return url.toString()
}

async function requestJson(url: string, headers: Record<string, string>): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      headers,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') throw new Error('TIMEOUT')
    throw new Error('CONNECTION_FAILED')
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new Error('AUTH_FAILED')
    if (res.status === 404 || res.status === 405) throw new Error('NOT_SUPPORTED')
    throw new Error(`HTTP_${res.status}`)
  }
  try {
    return await res.json()
  } catch {
    throw new Error('INVALID_RESPONSE')
  }
}

/** 取出列表容器：OpenAI 的 data、部分中转的 models、或直接返回数组 */
function listContainer(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    const record = data as { data?: unknown; models?: unknown }
    if (Array.isArray(record.data)) return record.data
    if (Array.isArray(record.models)) return record.models
  }
  throw new Error('INVALID_RESPONSE')
}

function dedupe(models: DiscoveredModel[]): DiscoveredModel[] {
  const seen = new Set<string>()
  const out: DiscoveredModel[] = []
  for (const model of models) {
    if (!model.id || seen.has(model.id)) continue
    seen.add(model.id)
    out.push(model)
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

export function parseOpenAiModels(data: unknown): DiscoveredModel[] {
  const models: DiscoveredModel[] = []
  for (const item of listContainer(data)) {
    if (!item || typeof item !== 'object') continue
    const record = item as { id?: unknown; name?: unknown; owned_by?: unknown; display_name?: unknown }
    const id = typeof record.id === 'string' ? record.id : typeof record.name === 'string' ? record.name : ''
    if (!id.trim()) continue
    models.push({
      id: id.trim(),
      name: typeof record.display_name === 'string' && record.display_name.trim() ? record.display_name.trim() : undefined,
      ownedBy: typeof record.owned_by === 'string' ? record.owned_by : undefined,
    })
  }
  return dedupe(models)
}

export function parseAnthropicModels(data: unknown): { models: DiscoveredModel[]; hasMore: boolean; lastId?: string } {
  const record = data && typeof data === 'object' ? (data as { has_more?: unknown; last_id?: unknown }) : {}
  const models: DiscoveredModel[] = []
  for (const item of listContainer(data)) {
    if (!item || typeof item !== 'object') continue
    const entry = item as { id?: unknown; display_name?: unknown }
    if (typeof entry.id !== 'string' || !entry.id.trim()) continue
    models.push({
      id: entry.id.trim(),
      name: typeof entry.display_name === 'string' && entry.display_name.trim() ? entry.display_name.trim() : undefined,
    })
  }
  return {
    models,
    hasMore: Boolean(record.has_more),
    lastId: typeof record.last_id === 'string' && record.last_id ? record.last_id : undefined,
  }
}

export function parseGeminiModels(data: unknown): { models: DiscoveredModel[]; nextPageToken?: string } {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { models?: unknown }).models)) {
    throw new Error('INVALID_RESPONSE')
  }
  const record = data as { models: unknown[]; nextPageToken?: unknown }
  const models: DiscoveredModel[] = []
  for (const item of record.models) {
    if (!item || typeof item !== 'object') continue
    const entry = item as { name?: unknown; displayName?: unknown; supportedGenerationMethods?: unknown }
    if (typeof entry.name !== 'string' || !entry.name.trim()) continue
    // Gemini 只列能做文本生成的模型；中转若不返回该字段则不过滤
    const methods = entry.supportedGenerationMethods
    if (Array.isArray(methods) && !methods.includes('generateContent')) continue
    models.push({
      id: entry.name.trim().replace(/^models\//, ''),
      name: typeof entry.displayName === 'string' && entry.displayName.trim() ? entry.displayName.trim() : undefined,
    })
  }
  return {
    models: dedupe(models),
    nextPageToken: typeof record.nextPageToken === 'string' && record.nextPageToken ? record.nextPageToken : undefined,
  }
}

export async function discoverModels(input: ModelDiscoveryInput): Promise<DiscoveredModel[]> {
  const apiKey = input.apiKey ?? ''

  // Ollama 虽然走 OpenAI 兼容协议，但列表接口是 /api/tags
  if (input.provider === 'ollama' && input.protocol === 'openai') {
    return (await listOllamaModels(input.baseUrl, apiKey)).map((id) => ({ id }))
  }

  if (input.protocol === 'openai') {
    const headers: Record<string, string> = apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    return parseOpenAiModels(await requestJson(openAiModelsUrl(input.baseUrl), headers))
  }

  if (input.protocol === 'gemini') {
    const headers: Record<string, string> = apiKey ? { 'x-goog-api-key': apiKey } : {}
    const collected: DiscoveredModel[] = []
    let pageToken: string | undefined
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = new URL(geminiModelsUrl(input.baseUrl))
      url.searchParams.set('pageSize', '100')
      if (pageToken) url.searchParams.set('pageToken', pageToken)
      const parsed = parseGeminiModels(await requestJson(url.toString(), headers))
      collected.push(...parsed.models)
      pageToken = parsed.nextPageToken
      if (!pageToken) break
    }
    return dedupe(collected)
  }

  const headers: Record<string, string> = { 'anthropic-version': ANTHROPIC_VERSION }
  if (apiKey) headers['x-api-key'] = apiKey
  const collected: DiscoveredModel[] = []
  let afterId: string | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(anthropicModelsUrl(input.baseUrl))
    url.searchParams.set('limit', '100')
    if (afterId) url.searchParams.set('after_id', afterId)
    const parsed = parseAnthropicModels(await requestJson(url.toString(), headers))
    collected.push(...parsed.models)
    if (!parsed.hasMore || !parsed.lastId) break
    afterId = parsed.lastId
  }
  return dedupe(collected)
}
