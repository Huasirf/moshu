import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Clock, Plus, Save, Trash2, TriangleAlert } from 'lucide-react'
import { ipc } from '../../services/ipc-client'
import { useProjectStore } from '../../stores/project-store'
import type { TimelineConfig, TimelineEvent, TimelineIssue } from '../../shared/rule-timeline'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { Label } from '../ui/Label'
import { cn } from '../../lib/utils'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'

interface ChapterOption {
  chapterNumber: number
  title: string
  eventCount: number
}

interface DraftEvent {
  storyTime: string
  absoluteTime: string
  duration: string
  location: string
  participants: string
  ruleRefs: string
  summary: string
}

interface Props {
  open: boolean
  onClose: () => void
  initialChapter?: number
}

function toDraft(event: TimelineEvent): DraftEvent {
  return {
    storyTime: event.storyTime,
    absoluteTime: event.absoluteTime,
    duration: event.duration,
    location: event.location,
    participants: event.participants.join('、'),
    ruleRefs: event.ruleRefs.join('、'),
    summary: event.summary,
  }
}

function emptyDraft(): DraftEvent {
  return { storyTime: '', absoluteTime: '', duration: '', location: '', participants: '', ruleRefs: '', summary: '' }
}

function splitTokens(text: string): string[] {
  return text
    .split(/[、,，;；\s]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * 章纲时间线管理器：
 * - 左侧按章选择，中间编辑本章事件次序（故事时间 / 绝对时间 / 地点 / 参与者 / 关联规则）
 * - 右侧维护全局时间设定（历法、纪元起点、流速、备注），供 Gemini 检索参考
 */
export default function TimelineDialog({ open, onClose, initialChapter }: Props) {
  const projectPath = useProjectStore(s => s.currentProject?.path)
  const [chapters, setChapters] = useState<ChapterOption[]>([])
  const [selectedChapter, setSelectedChapter] = useState<number | null>(null)
  const [events, setEvents] = useState<DraftEvent[]>([])
  const [config, setConfig] = useState<TimelineConfig>({ calendar: '', eraStart: '', timeFlow: '', notes: '' })
  const [issues, setIssues] = useState<TimelineIssue[]>([])
  const [dirty, setDirty] = useState(false)
  const [configDirty, setConfigDirty] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const refreshIssues = useCallback(async () => {
    try {
      setIssues(await ipc.invoke('db:timeline-validate'))
    } catch {
      setIssues([])
    }
  }, [])

  const loadChapterEvents = useCallback(async (chapterNumber: number) => {
    const list = await ipc.invoke('db:timeline-events-get', chapterNumber)
    setEvents(list.map(toDraft))
    setSelectedChapter(chapterNumber)
    setDirty(false)
  }, [])

  const loadAll = useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const [blueprints, allEvents, cfg] = await Promise.all([
        ipc.invoke('db:blueprint-get-all', projectPath).catch(() => []),
        ipc.invoke('db:timeline-events-all').catch(() => []),
        ipc.invoke('db:timeline-config-get').catch(() => ({ calendar: '', eraStart: '', timeFlow: '', notes: '' })),
      ])
      const counts = new Map<number, number>()
      for (const event of allEvents) {
        counts.set(event.chapterNumber, (counts.get(event.chapterNumber) || 0) + 1)
      }
      const options: ChapterOption[] = blueprints
        .map(bp => ({
          chapterNumber: bp.chapterNumber,
          title: bp.title || '',
          eventCount: counts.get(bp.chapterNumber) || 0,
        }))
        .sort((a, b) => a.chapterNumber - b.chapterNumber)
      // 蓝图之外但已有事件的章节也要列出来，避免历史数据看不到
      for (const [chapterNumber, count] of counts) {
        if (!options.some(o => o.chapterNumber === chapterNumber)) {
          options.push({ chapterNumber, title: '', eventCount: count })
        }
      }
      options.sort((a, b) => a.chapterNumber - b.chapterNumber)
      setChapters(options)
      setConfig(cfg)
      setConfigDirty(false)
      await refreshIssues()
      const target = initialChapter && options.some(o => o.chapterNumber === initialChapter)
        ? initialChapter
        : options[0]?.chapterNumber ?? null
      if (target !== null) await loadChapterEvents(target)
      else {
        setSelectedChapter(null)
        setEvents([])
        setDirty(false)
      }
    } catch (error) {
      toast.error(`读取时间线失败：${String(error)}`)
    }
    setLoading(false)
  }, [projectPath, initialChapter, refreshIssues, loadChapterEvents])

  useEffect(() => {
    if (open) void loadAll()
  }, [open, loadAll])

  const guardedSwitch = async (chapterNumber: number) => {
    if (chapterNumber === selectedChapter) return
    if (dirty && !(await confirm('本章时间线有未保存的修改，切换章节会丢弃，是否继续？', { confirmText: '丢弃并切换' }))) return
    try {
      await loadChapterEvents(chapterNumber)
    } catch (error) {
      toast.error(`读取本章时间线失败：${String(error)}`)
    }
  }

  const updateEvent = <K extends keyof DraftEvent>(index: number, key: K, value: DraftEvent[K]) => {
    setEvents(prev => prev.map((event, i) => (i === index ? { ...event, [key]: value } : event)))
    setDirty(true)
  }

  const addEvent = () => {
    setEvents(prev => [...prev, emptyDraft()])
    setDirty(true)
  }

  const removeEvent = async (index: number) => {
    const target = events[index]
    if (target?.summary && !(await confirm('确定删除这条时间线事件？', { confirmText: '删除' }))) return
    setEvents(prev => prev.filter((_, i) => i !== index))
    setDirty(true)
  }

  const moveEvent = (index: number, direction: -1 | 1) => {
    const next = index + direction
    if (next < 0 || next >= events.length) return
    setEvents(prev => {
      const copy = [...prev]
      ;[copy[index], copy[next]] = [copy[next], copy[index]]
      return copy
    })
    setDirty(true)
  }

  const saveChapter = async () => {
    if (selectedChapter === null) return
    const invalid = events.findIndex(event => !event.summary.trim())
    if (invalid >= 0) {
      toast.warning(`第 ${invalid + 1} 条事件缺少摘要，请补充后再保存`)
      return
    }
    setSaving(true)
    try {
      const payload = events.map((event, index) => ({
        sceneIndex: 0,
        seq: index + 1,
        storyTime: event.storyTime.trim(),
        absoluteTime: event.absoluteTime.trim(),
        duration: event.duration.trim(),
        location: event.location.trim(),
        participants: splitTokens(event.participants),
        ruleRefs: splitTokens(event.ruleRefs),
        summary: event.summary.trim(),
      }))
      const result = await ipc.invoke('db:timeline-events-save', selectedChapter, payload)
      if (!result.success) throw new Error(result.error || '保存失败')
      setEvents((result.events || []).map(toDraft))
      setDirty(false)
      setChapters(prev => prev.map(ch => (
        ch.chapterNumber === selectedChapter ? { ...ch, eventCount: payload.length } : ch
      )))
      await refreshIssues()
      toast.success('本章时间线已保存')
    } catch (error) {
      toast.error(`保存失败：${String(error)}`)
    }
    setSaving(false)
  }

  const saveConfig = async () => {
    setSaving(true)
    try {
      const saved = await ipc.invoke('db:timeline-config-save', config)
      setConfig(saved)
      setConfigDirty(false)
      await refreshIssues()
      toast.success('时间设定已保存')
    } catch (error) {
      toast.error(`保存失败：${String(error)}`)
    }
    setSaving(false)
  }

  const chapterIssues = issues.filter(issue => issue.chapterNumber === selectedChapter)
  const currentOption = chapters.find(ch => ch.chapterNumber === selectedChapter)

  return (
    <Dialog open={open} onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent className="max-w-6xl w-[94vw] h-[86vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-4 pb-3 border-b" >
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Clock size={15} /> 章纲时间线管理器
          </DialogTitle>
          <DialogDescription className="text-xs">
            按事件次序记录每章的发生时间与地点，生成与审稿时会作为参考注入给模型。
          </DialogDescription>
        </DialogHeader>

        {issues.length > 0 && (
          <div className="px-5 py-2 text-xs border-b flex items-start gap-2" style={{
            backgroundColor: issues.some(i => i.level === 'error') ? 'rgba(239,68,68,0.10)' : 'rgba(245,158,11,0.10)',
            borderColor: 'var(--color-border)',
          }}>
            <TriangleAlert size={13} className="mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="font-medium">时间线校验：{issues.length} 个问题</span>
              <ul className="mt-1 space-y-0.5 opacity-80">
                {issues.slice(0, 4).map((issue, index) => (
                  <li key={index} className={cn(issue.level === 'error' ? 'text-red-500' : 'text-amber-500')}>
                    {issue.message}
                  </li>
                ))}
                {issues.length > 4 && <li className="opacity-60">… 其余 {issues.length - 4} 条</li>}
              </ul>
            </div>
          </div>
        )}

        <div className="flex-1 min-h-0 flex overflow-hidden">
          {/* 左侧章节列表 */}
          <div className="w-48 shrink-0 border-r overflow-y-auto" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-sidebar)' }}>
            {loading && <div className="p-3 text-xs opacity-60">加载中…</div>}
            {!loading && chapters.length === 0 && (
              <div className="p-3 text-xs opacity-60">还没有章纲，请先生成蓝图。</div>
            )}
            {chapters.map(ch => (
              <button
                key={ch.chapterNumber}
                type="button"
                onClick={() => void guardedSwitch(ch.chapterNumber)}
                className={cn(
                  'w-full text-left px-3 py-2.5 text-xs transition-colors flex items-center gap-2',
                  selectedChapter === ch.chapterNumber
                    ? 'bg-[var(--color-active)] text-[var(--color-text)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
                )}
              >
                <span className="font-mono opacity-50 w-6 shrink-0">{ch.chapterNumber}</span>
                <span className="truncate flex-1">{ch.title || '未命名'}</span>
                {ch.eventCount > 0 && (
                  <span className="text-[0.65rem] px-1.5 py-0.5 rounded-full shrink-0"
                    style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.15)', color: 'var(--color-accent)' }}>
                    {ch.eventCount}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* 中间事件编辑 */}
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="px-4 py-2.5 border-b flex items-center justify-between gap-2" style={{ borderColor: 'var(--color-border)' }}>
              <span className="text-xs font-medium">
                {selectedChapter !== null ? `第 ${selectedChapter} 章 · ${currentOption?.title || '未命名'}` : '未选择章节'}
                <span className="ml-2 opacity-50">共 {events.length} 个事件</span>
              </span>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={addEvent} disabled={selectedChapter === null}>
                  <Plus size={13} /> 添加事件
                </Button>
                <Button size="sm" onClick={() => void saveChapter()} disabled={selectedChapter === null || saving || !dirty}>
                  <Save size={13} /> {saving ? '保存中…' : '保存'}
                </Button>
              </div>
            </div>

            {chapterIssues.length > 0 && (
              <div className="px-4 py-1.5 text-[0.7rem] border-b text-amber-500" style={{ borderColor: 'var(--color-border)' }}>
                {chapterIssues.map(issue => issue.message).join('；')}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {selectedChapter === null && <div className="text-xs opacity-60">请选择左侧章节。</div>}
              {selectedChapter !== null && events.length === 0 && (
                <div className="text-xs opacity-60">本章还没有时间线事件，点击「添加事件」开始记录。</div>
              )}
              {events.map((event, index) => (
                <div key={index} className="rounded-lg border p-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-medium flex items-center gap-1.5">
                      <span className="font-mono opacity-50">#{index + 1}</span> 事件
                    </span>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" title="上移" onClick={() => moveEvent(index, -1)} disabled={index === 0}>
                        <ArrowUp size={13} />
                      </Button>
                      <Button variant="ghost" size="icon" title="下移" onClick={() => moveEvent(index, 1)} disabled={index === events.length - 1}>
                        <ArrowDown size={13} />
                      </Button>
                      <Button variant="ghost" size="icon" title="删除" onClick={() => void removeEvent(index)}>
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 @2xl:grid-cols-4 gap-2 mb-2">
                    <div>
                      <Label className="text-[0.7rem]">设定内时间</Label>
                      <Input value={event.storyTime} placeholder="第三天 · 辰时" onChange={e => updateEvent(index, 'storyTime', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-[0.7rem]">绝对时间（用于校验）</Label>
                      <Input value={event.absoluteTime} placeholder="第3天 / 3 / 2026-03-01" onChange={e => updateEvent(index, 'absoluteTime', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-[0.7rem]">地点</Label>
                      <Input value={event.location} placeholder="试炼塔三层" onChange={e => updateEvent(index, 'location', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-[0.7rem]">持续</Label>
                      <Input value={event.duration} placeholder="约两个时辰" onChange={e => updateEvent(index, 'duration', e.target.value)} />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 @2xl:grid-cols-2 gap-2 mb-2">
                    <div>
                      <Label className="text-[0.7rem]">参与者（逗号分隔）</Label>
                      <Input value={event.participants} placeholder="商临野、试炼官" onChange={e => updateEvent(index, 'participants', e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-[0.7rem]">关联规则编号（逗号分隔）</Label>
                      <Input value={event.ruleRefs} placeholder="R-1-1、R-2-3" onChange={e => updateEvent(index, 'ruleRefs', e.target.value)} />
                    </div>
                  </div>

                  <div>
                    <Label className="text-[0.7rem]">事件摘要</Label>
                    <Textarea
                      value={event.summary}
                      placeholder="用一两句话写清：谁在何时何地做了什么、结果如何"
                      onChange={e => updateEvent(index, 'summary', e.target.value)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 右侧全局时间设定 */}
          <div className="w-72 shrink-0 border-l overflow-y-auto p-4 space-y-3" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">全局时间设定</span>
              <Button size="sm" variant="outline" onClick={() => void saveConfig()} disabled={saving || !configDirty}>
                <Save size={12} /> 保存
              </Button>
            </div>
            <div>
              <Label className="text-[0.7rem]">历法</Label>
              <Textarea
                className="min-h-[52px]"
                value={config.calendar}
                placeholder="如：一年十二月，一月三十日，一日十二时辰"
                onChange={e => { setConfig(prev => ({ ...prev, calendar: e.target.value })); setConfigDirty(true) }}
              />
            </div>
            <div>
              <Label className="text-[0.7rem]">纪元起点</Label>
              <Input
                value={config.eraStart}
                placeholder="如：故事始于天元三年春"
                onChange={e => { setConfig(prev => ({ ...prev, eraStart: e.target.value })); setConfigDirty(true) }}
              />
            </div>
            <div>
              <Label className="text-[0.7rem]">时间流速</Label>
              <Input
                value={config.timeFlow}
                placeholder="如：正常流速，或闭关三年压缩为一章"
                onChange={e => { setConfig(prev => ({ ...prev, timeFlow: e.target.value })); setConfigDirty(true) }}
              />
            </div>
            <div>
              <Label className="text-[0.7rem]">备注</Label>
              <Textarea
                className="min-h-[72px]"
                value={config.notes}
                placeholder="回忆/倒叙的标注约定、禁用的时间设定等"
                onChange={e => { setConfig(prev => ({ ...prev, notes: e.target.value })); setConfigDirty(true) }}
              />
            </div>
            <div className="text-[0.7rem] opacity-60 leading-relaxed pt-2 border-t" style={{ borderColor: 'var(--color-border)' }}>
              校验规则：同章内绝对时间不得倒退（错误）；下一章首事件早于上一章末事件会给出警告，回忆/倒叙请在摘要注明。
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}