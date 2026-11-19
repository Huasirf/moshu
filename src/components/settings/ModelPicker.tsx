import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ipc } from '../../services/ipc-client'
import type { ModelProfile } from '../../shared/ipc-channels'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { NativeSelect } from '../ui/NativeSelect'

type Discovered = { id: string; name?: string; ownedBy?: string }

/** 把后端错误码翻成可操作的提示；非错误码（如改了地址需重填 Key）原样展示 */
function useErrorText() {
  const { t } = useTranslation('settings')
  return (error: string): string => {
    const known: Record<string, string> = {
      INVALID_URL: t('models.discoverInvalidUrl'),
      AUTH_FAILED: t('models.discoverAuthFailed'),
      NOT_SUPPORTED: t('models.discoverNotSupported'),
      INVALID_RESPONSE: t('models.discoverInvalidResponse'),
      TIMEOUT: t('models.discoverTimeout'),
      CONNECTION_FAILED: t('models.discoverConnectionFailed'),
    }
    return known[error] ?? error
  }
}

/**
 * 从绑定的上游接口地址拉取模型列表（四协议通用）。
 *
 * - Ollama 沿用自动刷新：地址变化后 450ms 自动拉取 /api/tags；
 * - 其他协议只在用户点击「获取模型列表」时请求，避免每敲一个字符就打上游。
 * - 选择后只回填 modelName / 空的显示名，不动温度、最大 Token 等其他字段。
 */
export default function ModelPicker({ model, onChange }: { model: ModelProfile; onChange: (model: ModelProfile) => void }) {
  const { t } = useTranslation('settings')
  const describeError = useErrorText()
  const id = useId()
  const sequence = useRef({ value: 0 })
  const [models, setModels] = useState<Discovered[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState('')
  const [source, setSource] = useState('')

  // 地址 / 协议 / Key 任一变化都视为换了上游：旧列表立即失效，避免误导选择
  const serverKey = `${model.protocol}\n${model.provider ?? ''}\n${model.baseUrl}\n${model.apiKey}`
  const stale = source !== serverKey
  const visibleModels = stale ? [] : models
  const visibleStatus = stale ? 'idle' : status
  const selected = visibleModels.some((m) => m.id === model.modelName) ? model.modelName : ''

  const refresh = useCallback(async () => {
    const request = ++sequence.current.value
    setModels([])
    setStatus('loading')
    setError('')
    setSource(serverKey)
    try {
      const result = await ipc.invoke('llm:discover-models', {
        id: model.id,
        protocol: model.protocol,
        provider: model.provider,
        baseUrl: model.baseUrl,
        apiKey: model.apiKey,
      })
      if (request !== sequence.current.value) return
      if (!result.success) throw new Error(result.error || 'CONNECTION_FAILED')
      setModels(result.models)
      setStatus('ready')
    } catch (cause) {
      if (request !== sequence.current.value) return
      setError(cause instanceof Error ? cause.message : 'CONNECTION_FAILED')
      setStatus('error')
    }
  }, [serverKey, model.id, model.protocol, model.provider, model.baseUrl, model.apiKey])

  // Ollama 本地服务无需鉴权、响应快，保持地址变化即自动刷新；其余协议由用户主动触发
  const autoRefresh = model.provider === 'ollama'
  useEffect(() => {
    if (!autoRefresh) return
    const tracker = sequence.current
    const timer = setTimeout(() => { void refresh() }, 450)
    return () => { clearTimeout(timer); ++tracker.value }
  }, [autoRefresh, refresh])

  const choose = (value: string) => onChange({
    ...model,
    modelName: value,
    name: !model.name || model.name === model.modelName ? value : model.name,
  })

  const optionLabel = (m: Discovered) => (m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id)

  return <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Label htmlFor={`${id}-select`}>{t('models.discoverSelect')}</Label>
      <Button size="sm" variant="outline" disabled={visibleStatus === 'loading' || !model.baseUrl.trim()} onClick={() => void refresh()}>
        <RefreshCw size={13} className={visibleStatus === 'loading' ? 'animate-spin' : ''} />{t('models.discoverButton')}
      </Button>
    </div>
    <div className="relative">
      <NativeSelect
        id={`${id}-select`}
        className="pr-9 h-9"
        value={selected}
        disabled={visibleStatus !== 'ready' || !visibleModels.length}
        onChange={(e) => choose(e.target.value)}
      >
        <option value="" disabled>{t('models.discoverSelect')}</option>
        {visibleModels.map((m) => <option key={m.id} value={m.id}>{optionLabel(m)}</option>)}
      </NativeSelect>
      <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
    </div>
    <p role="status" className="text-xs text-[var(--color-text-secondary)] break-words">
      {visibleStatus === 'loading'
        ? t('models.discovering')
        : visibleStatus === 'ready'
          ? t(visibleModels.length ? 'models.discoverCount' : 'models.discoverEmpty', { count: visibleModels.length })
          : t('models.discoverHint')}
    </p>
    {visibleStatus === 'error' && <p role="alert" className="text-xs text-[var(--color-error)] break-words">{t('models.discoverFailed', { error: describeError(error) })}</p>}
    <Label htmlFor={`${id}-manual`}>{t('models.modelIdentifier')}</Label>
    <Input id={`${id}-manual`} value={model.modelName} onChange={(e) => choose(e.target.value)} placeholder="gpt-4o / deepseek-chat" />
  </div>
}
