import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ModelProfile } from '../../src/shared/ipc-channels'
import {
  GEMINI_BUDGETS,
  mappedThinkingValue,
  resolveThinkingLevel,
  thinkingOutputTokens,
} from '../llm/thinking'
import { geminiThinkingConfig } from '../llm/gemini-provider'
import { buildAnthropicRequest } from '../llm/anthropic-provider'
import { OpenAIProvider } from '../llm/openai-provider'

afterEach(() => vi.unstubAllGlobals())

function model(overrides: Partial<ModelProfile> = {}): ModelProfile {
  return {
    id: 'm1',
    name: 'M',
    provider: 'openai',
    protocol: 'openai',
    modelName: 'gpt-4o',
    apiKey: 'sk-test',
    baseUrl: 'https://proxy.example',
    temperature: 0.7,
    maxTokens: 4096,
    purposes: ['generation'],
    ...overrides,
  }
}

describe('思考档位解析', () => {
  it('模型不支持思考时不发送，即使调用方要求开启', () => {
    const m = model({ thinking: { supports: false } })
    expect(resolveThinkingLevel(m, true)).toBeUndefined()
    expect(resolveThinkingLevel(m, 'high')).toBeUndefined()
  })

  it('单次调用参数优先于模型默认档位', () => {
    const m = model({ thinking: { defaultLevel: 'medium' } })
    expect(resolveThinkingLevel(m, 'low')).toBe('low')
    expect(resolveThinkingLevel(m, 'off')).toBe('off')
    expect(resolveThinkingLevel(m, false)).toBe('off')
    expect(resolveThinkingLevel(m, true)).toBe('medium')
    expect(resolveThinkingLevel(m)).toBe('medium')
  })

  it('未配置档位时默认不发送；调用方要求开启时用 high', () => {
    expect(resolveThinkingLevel(model())).toBeUndefined()
    expect(resolveThinkingLevel(model(), true)).toBe('high')
  })

  it('档位映射：字符串=自定义值，null=明确不支持，缺键=协议默认', () => {
    const m = model({ thinking: { map: { high: 'xhigh', low: null } } })
    expect(mappedThinkingValue(m, 'high')).toBe('xhigh')
    expect(mappedThinkingValue(m, 'low')).toBeNull()
    expect(mappedThinkingValue(m, 'medium')).toBeUndefined()
    expect(mappedThinkingValue(model(), 'high')).toBeUndefined()
  })
})

describe('思考模式的输出预算', () => {
  it('DeepSeek / GLM 开启思考时给思维链预留预算', () => {
    const m = model({ provider: 'deepseek', modelName: 'deepseek-chat', maxTokens: 65536 })
    expect(thinkingOutputTokens(4000, m, 'high')).toBe(12192)
    expect(thinkingOutputTokens(4000, m, 'off')).toBe(4000)
    expect(thinkingOutputTokens(4000, m)).toBe(4000)
  })

  it('预留后不超过模型配置的输出上限', () => {
    const m = model({ provider: 'deepseek', maxTokens: 8192 })
    expect(thinkingOutputTokens(4096, m, 'medium')).toBe(8192)
    expect(thinkingOutputTokens(65536, m, 'high')).toBe(65536)
  })

  it('其它协议不改动 max_tokens', () => {
    const m = model({ provider: 'openai', maxTokens: 65536 })
    expect(thinkingOutputTokens(4000, m, 'high')).toBe(4000)
  })
})

describe('Gemini 思考参数', () => {
  it('2.5 用 thinkingBudget：off=0，其余按档位默认预算', () => {
    const m = model({ provider: 'gemini', protocol: 'gemini', modelName: 'gemini-2.5-pro' })
    expect(geminiThinkingConfig(m)).toEqual({})
    expect(geminiThinkingConfig(m, 'off')).toEqual({ config: { thinkingBudget: 0 } })
    expect(geminiThinkingConfig(m, 'low')).toEqual({ config: { thinkingBudget: GEMINI_BUDGETS.low }, reserveTokens: GEMINI_BUDGETS.low })
    expect(geminiThinkingConfig(m, 'high')).toEqual({ config: { thinkingBudget: GEMINI_BUDGETS.high }, reserveTokens: GEMINI_BUDGETS.high })
  })

  it('3 用 thinkingLevel，最低 low（不支持完全关闭）', () => {
    const m = model({ provider: 'gemini', protocol: 'gemini', modelName: 'gemini-3-pro' })
    expect(geminiThinkingConfig(m, 'off')).toEqual({ config: { thinkingLevel: 'low' }, reserveTokens: 2048 })
    expect(geminiThinkingConfig(m, 'medium')).toEqual({ config: { thinkingLevel: 'high' }, reserveTokens: 8192 })
    expect(geminiThinkingConfig(m, 'high')).toEqual({ config: { thinkingLevel: 'high' }, reserveTokens: 8192 })
  })

  it('明确不支持的档位返回错误而不是静默降级', () => {
    const m = model({ provider: 'gemini', protocol: 'gemini', modelName: 'gemini-2.5-pro', thinking: { map: { high: null } } })
    expect(geminiThinkingConfig(m, 'high').error).toContain('不支持')
  })
})

describe('Anthropic 思考参数', () => {
  it('显式档位才发送 thinking，预算 clamp 到 max_tokens 以内', () => {
    const m = model({ provider: 'anthropic', protocol: 'anthropic', modelName: 'claude-sonnet-5-5' })
    const req = buildAnthropicRequest(m, [{ role: 'user', content: 'hi' }], { maxTokens: 4000, thinkingLevel: 'high' }, false)
    // max_tokens = 4000 + 8000 余量
    expect(req.body.max_tokens).toBe(12000)
    // 默认预算 16384，clamp 到 12000 - 1024
    expect(req.body.thinking).toEqual({ type: 'enabled', budget_tokens: 10976 })
  })

  it('关闭档位 / 未选择档位时不出现 thinking 字段', () => {
    const m = model({ provider: 'anthropic', protocol: 'anthropic', modelName: 'claude-sonnet-5-5' })
    expect(buildAnthropicRequest(m, [{ role: 'user', content: 'hi' }], { maxTokens: 4000, thinkingLevel: 'off' }, false).body)
      .not.toHaveProperty('thinking')
    expect(buildAnthropicRequest(m, [{ role: 'user', content: 'hi' }], { maxTokens: 4000 }, false).body)
      .not.toHaveProperty('thinking')
  })

  it('低档位使用档位预算 1024', () => {
    const m = model({ provider: 'anthropic', protocol: 'anthropic', modelName: 'claude-sonnet-5-5' })
    expect(buildAnthropicRequest(m, [{ role: 'user', content: 'hi' }], { maxTokens: 4000, thinkingLevel: 'low' }, false).body.thinking)
      .toEqual({ type: 'enabled', budget_tokens: 1024 })
  })
})

describe('OpenAI 兼容思考参数', () => {
  const success = () => new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })

  async function callGenerate(m: ModelProfile, thinking?: 'off' | 'low' | 'medium' | 'high') {
    const fetchMock = vi.fn<typeof fetch>(async () => success())
    vi.stubGlobal('fetch', fetchMock)
    await new OpenAIProvider().generate(m, [{ role: 'user', content: 'hi' }], { temperature: 0.7, maxTokens: 10, thinking })
    return fetchMock
  }

  it('DeepSeek / GLM 用 thinking 对象；开启档位时不传 temperature', async () => {
    const fetchMock = await callGenerate(model({ provider: 'deepseek', modelName: 'deepseek-chat' }), 'high')
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.thinking).toEqual({ type: 'enabled' })
    expect(body).not.toHaveProperty('temperature')

    const off = await callGenerate(model({ provider: 'bigmodel', modelName: 'glm-4.5' }), 'off')
    const offBody = JSON.parse(String(off.mock.calls[0][1]?.body))
    expect(offBody.thinking).toEqual({ type: 'disabled' })
    expect(offBody.temperature).toBe(0.7)
  })

  it('Ollama 用 reasoning_effort，off 发 none', async () => {
    const fetchMock = await callGenerate(model({ provider: 'ollama', modelName: 'qwen3:8b' }), 'off')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).reasoning_effort).toBe('none')

    const high = await callGenerate(model({ provider: 'ollama', modelName: 'qwen3:8b' }), 'high')
    expect(JSON.parse(String(high.mock.calls[0][1]?.body)).reasoning_effort).toBe('high')
  })

  it('通用 OpenAI 兼容用 reasoning_effort；off 时不出现思考参数', async () => {
    const high = await callGenerate(model(), 'high')
    expect(JSON.parse(String(high.mock.calls[0][1]?.body)).reasoning_effort).toBe('high')

    const off = await callGenerate(model(), 'off')
    expect(JSON.parse(String(off.mock.calls[0][1]?.body))).not.toHaveProperty('reasoning_effort')
  })

  it('档位映射覆盖中转站词表；null 直接报错且不发请求', async () => {
    const mapped = model({ thinking: { map: { high: 'xhigh' } } })
    const fetchMock = await callGenerate(mapped, 'high')
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).reasoning_effort).toBe('xhigh')

    const blocked = vi.fn()
    vi.stubGlobal('fetch', blocked)
    const res = await new OpenAIProvider().generate(
      model({ thinking: { map: { high: null } } }),
      [{ role: 'user', content: 'hi' }],
      { temperature: 0.7, maxTokens: 10, thinking: 'high' },
    )
    expect(res.success).toBe(false)
    expect(res.error).toContain('不支持')
    expect(blocked).not.toHaveBeenCalled()
  })

  it('网关不认识思考参数（400）时去掉参数重试一次', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    fetch.mockResolvedValueOnce(new Response('{"error":{"message":"reasoning_effort is not supported"}}', { status: 400 }))
    fetch.mockResolvedValueOnce(success())
    const res = await new OpenAIProvider().generate(model(), [{ role: 'user', content: 'hi' }], {
      temperature: 0.7, maxTokens: 10, thinking: 'high',
    })
    expect(res.success).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).not.toHaveProperty('reasoning_effort')
  })
})
