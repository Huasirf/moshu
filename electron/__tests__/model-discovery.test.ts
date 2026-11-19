import { afterEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import {
  anthropicModelsUrl,
  discoverModels,
  geminiModelsUrl,
  openAiModelsUrl,
  parseAnthropicModels,
  parseGeminiModels,
  parseOpenAiModels,
} from '../llm/model-discovery'
import { ANTHROPIC_VERSION } from '../llm/anthropic-provider'

afterEach(() => vi.unstubAllGlobals())

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json' },
}) as Response

describe('模型列表地址归一化', () => {
  it.each([
    ['https://api.openai.com', 'https://api.openai.com/v1/models'],
    ['https://api.openai.com/', 'https://api.openai.com/v1/models'],
    ['https://proxy.example/v1', 'https://proxy.example/v1/models'],
    ['https://proxy.example/v1/models', 'https://proxy.example/v1/models'],
    ['https://proxy.example/v4', 'https://proxy.example/v4/models'],
    ['https://proxy.example/openai/api', 'https://proxy.example/openai/api/v1/models'],
  ])('OpenAI 兼容 %s → %s', (input, output) => expect(openAiModelsUrl(input)).toBe(output))

  it.each([
    ['https://generativelanguage.googleapis.com', 'https://generativelanguage.googleapis.com/v1beta/models'],
    ['https://proxy.example/v1beta', 'https://proxy.example/v1beta/models'],
    ['https://proxy.example/v1', 'https://proxy.example/v1/models'],
    ['https://proxy.example/v1beta/models', 'https://proxy.example/v1beta/models'],
  ])('Gemini %s → %s', (input, output) => expect(geminiModelsUrl(input)).toBe(output))

  it.each([
    ['https://api.anthropic.com', 'https://api.anthropic.com/v1/models'],
    ['https://api.anthropic.com/v1', 'https://api.anthropic.com/v1/models'],
    ['https://proxy.example/anthropic/v1/models', 'https://proxy.example/anthropic/v1/models'],
  ])('Anthropic %s → %s', (input, output) => expect(anthropicModelsUrl(input)).toBe(output))

  it.each([
    'file:///tmp/models',
    'localhost:1234',
    'https://user:pass@example.com',
    'https://example.com/v1?q=x',
    '',
  ])('拒绝非法地址 %s', (value) => {
    expect(() => openAiModelsUrl(value)).toThrow('INVALID_URL')
  })
})

describe('响应解析', () => {
  it('OpenAI 兼容支持 data / models / 直接数组三种容器，去重并排序', () => {
    expect(parseOpenAiModels({ data: [
      { id: 'gpt-4o', owned_by: 'openai' },
      { id: 'gpt-4o' },
      { name: 'deepseek-chat', display_name: 'DeepSeek Chat' },
      { id: '' },
    ] }).map((m) => m.id)).toEqual(['deepseek-chat', 'gpt-4o'])
    expect(parseOpenAiModels({ models: [{ id: 'qwen' }] }).map((m) => m.id)).toEqual(['qwen'])
    expect(parseOpenAiModels([{ id: 'glm-4' }]).map((m) => m.id)).toEqual(['glm-4'])
    expect(() => parseOpenAiModels({ data: 'nope' })).toThrow('INVALID_RESPONSE')
  })

  it('Gemini 去掉 models/ 前缀，并按 supportedGenerationMethods 过滤', () => {
    const parsed = parseGeminiModels({
      models: [
        { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      ],
      nextPageToken: 'next',
    })
    expect(parsed.models.map((m) => m.id)).toEqual(['gemini-2.0-flash', 'gemini-2.5-pro'])
    expect(parsed.nextPageToken).toBe('next')
    expect(() => parseGeminiModels({})).toThrow('INVALID_RESPONSE')
  })

  it('Anthropic 读取 has_more / last_id', () => {
    const parsed = parseAnthropicModels({
      data: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet' }],
      has_more: true,
      last_id: 'claude-sonnet-5-5',
    })
    expect(parsed.models).toEqual([{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet' }])
    expect(parsed.hasMore).toBe(true)
    expect(parsed.lastId).toBe('claude-sonnet-5-5')
  })
})

describe('discoverModels 四协议连通', () => {
  it('OpenAI 兼容：GET /v1/models，带 Bearer，解析并去重', async () => {
    const requests: Array<{ url: string; headers: Record<string, string> }> = []
    const server = http.createServer((req, res) => {
      requests.push({ url: req.url ?? '', headers: req.headers as Record<string, string> })
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }, { id: 'gpt-4o' }] }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address() as { port: number }
      const models = await discoverModels({ protocol: 'openai', baseUrl: `http://127.0.0.1:${address.port}`, apiKey: 'sk-test' })
      expect(models.map((m) => m.id)).toEqual(['gpt-4o', 'gpt-4o-mini'])
      expect(requests[0].url).toBe('/v1/models')
      expect(requests[0].headers.authorization).toBe('Bearer sk-test')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('Ollama 走 /api/tags，而不是 OpenAI 兼容列表', async () => {
    const requests: string[] = []
    const server = http.createServer((req, res) => {
      requests.push(req.url ?? '')
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }, { name: 'qwen3:8b' }] }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address() as { port: number }
      const models = await discoverModels({ protocol: 'openai', provider: 'ollama', baseUrl: `http://127.0.0.1:${address.port}` })
      expect(models.map((m) => m.id)).toEqual(['qwen3:8b'])
      expect(requests).toEqual(['/api/tags'])
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('Gemini 原生：x-goog-api-key、pageSize=100、按 nextPageToken 翻页', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    fetch.mockResolvedValueOnce(json({
      models: [{ name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] }],
      nextPageToken: 'p2',
    }))
    fetch.mockResolvedValueOnce(json({
      models: [{ name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] }],
    }))
    const models = await discoverModels({ protocol: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'goog-key' })
    expect(models.map((m) => m.id)).toEqual(['gemini-2.0-flash', 'gemini-2.5-pro'])

    const first = new URL(String(fetch.mock.calls[0][0]))
    expect(first.pathname).toBe('/v1beta/models')
    expect(first.searchParams.get('pageSize')).toBe('100')
    expect(fetch.mock.calls[0][1].headers['x-goog-api-key']).toBe('goog-key')
    const second = new URL(String(fetch.mock.calls[1][0]))
    expect(second.searchParams.get('pageToken')).toBe('p2')
  })

  it('Anthropic 原生：anthropic-version 头、limit=100、按 has_more / last_id 翻页', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    fetch.mockResolvedValueOnce(json({
      data: [{ id: 'claude-opus-5', display_name: 'Claude Opus' }],
      has_more: true,
      last_id: 'claude-opus-5',
    }))
    fetch.mockResolvedValueOnce(json({
      data: [{ id: 'claude-sonnet-5-5' }],
      has_more: false,
    }))
    const models = await discoverModels({ protocol: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant' })
    expect(models.map((m) => m.id)).toEqual(['claude-opus-5', 'claude-sonnet-5-5'])

    const first = new URL(String(fetch.mock.calls[0][0]))
    expect(first.pathname).toBe('/v1/models')
    expect(first.searchParams.get('limit')).toBe('100')
    expect(fetch.mock.calls[0][1].headers['anthropic-version']).toBe(ANTHROPIC_VERSION)
    expect(fetch.mock.calls[0][1].headers['x-api-key']).toBe('sk-ant')
    const second = new URL(String(fetch.mock.calls[1][0]))
    expect(second.searchParams.get('after_id')).toBe('claude-opus-5')
  })
})

describe('discoverModels 错误分类', () => {
  it('401 / 403 → AUTH_FAILED，404 / 405 → NOT_SUPPORTED，其余 → HTTP_x', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    for (const [status, expected] of [[401, 'AUTH_FAILED'], [403, 'AUTH_FAILED'], [404, 'NOT_SUPPORTED'], [405, 'NOT_SUPPORTED'], [500, 'HTTP_500']] as const) {
      fetch.mockResolvedValueOnce(new Response('', { status }))
      await expect(discoverModels({ protocol: 'openai', baseUrl: 'https://proxy.example' })).rejects.toThrow(expected)
    }
  })

  it('非 JSON → INVALID_RESPONSE；超时 → TIMEOUT；网络拒绝 → CONNECTION_FAILED', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    fetch.mockResolvedValueOnce(new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    await expect(discoverModels({ protocol: 'openai', baseUrl: 'https://proxy.example' })).rejects.toThrow('INVALID_RESPONSE')

    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    fetch.mockRejectedValueOnce(timeout)
    await expect(discoverModels({ protocol: 'openai', baseUrl: 'https://proxy.example' })).rejects.toThrow('TIMEOUT')

    fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(discoverModels({ protocol: 'openai', baseUrl: 'https://proxy.example' })).rejects.toThrow('CONNECTION_FAILED')
  })

  it('非法地址直接报 INVALID_URL，不发请求', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(discoverModels({ protocol: 'openai', baseUrl: 'file:///tmp/x' })).rejects.toThrow('INVALID_URL')
    expect(fetch).not.toHaveBeenCalled()
  })
})
