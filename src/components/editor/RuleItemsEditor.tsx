import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, History, Plus, RotateCcw, Save, Sparkles, Trash2 } from 'lucide-react'
import { ipc } from '../../services/ipc-client'
import type { RuleItem, RuleSnapshotMeta } from '../../shared/rule-timeline'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { NativeSelect } from '../ui/NativeSelect'
import { cn } from '../../lib/utils'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'

interface Props {
  /** 当前 rulebook 原文（用于首次拆分与对照） */
  rulebook: string
  /** 保存/回滚后把编译结果同步回上层表单，保证项目保存时一致 */
  onCompiled: (compiled: string) => void
}

const MAX_INJECT_HINT = 12000

/**
 * 规则条目编辑器：
 * 把原先一整块自由文本换成「分组 + 带稳定编号的条目」，
 * 保存时后端编译回 rulebook 文本并写入快照，注入时按硬/软与相关度分层装配。
 */
export default function RuleItemsEditor({ rulebook, onCompiled }: Props) {
  const [items, setItems] = useState<RuleItem[]>([])
  const [snapshots, setSnapshots] = useState<RuleSnapshotMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [showSnapshots, setShowSnapshots] = useState(false)

  const loadSnapshots = useCallback(async () => {
    try {
      setSnapshots(await ipc.invoke('db:rule-snapshot-list', 12))
    } catch {
      setSnapshots([])
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await ipc.invoke('db:rule-items-list')
      setItems(list)
      setDirty(false)
      await loadSnapshots()
    } catch (error) {
      toast.error(`读取规则条目失败：${String(error)}`)
    }
    setLoading(false)
  }, [loadSnapshots])

  useEffect(() => { void load() }, [load])

  const duplicateBodies = useMemo(() => {
    const seen = new Map<string, number>()
    for (const item of items) {
      const key = item.body.replace(/\s+/g, '').slice(0, 60)
      if (!key) continue
      seen.set(key, (seen.get(key) || 0) + 1)
    }
    return new Set([...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key))
  }, [items])

  const stats = useMemo(() => {
    const hard = items.filter(item => item.severity === 'hard').length
    const chars = items.reduce((sum, item) => sum + item.title.length + item.body.length, 0)
    return { total: items.length, hard, chars }
  }, [items])

  const update = (index: number, patch: Partial<RuleItem>) => {
    setItems(prev => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
    setDirty(true)
  }

  const addItem = (group: string) => {
    setItems(prev => [
      ...prev,
      {
        id: '',
        code: '',
        group: group || '总则',
        title: '',
        body: '',
        severity: 'soft',
        tags: [],
        active: true,
        sort: prev.length,
        updatedAt: '',
      },
    ])
    setDirty(true)
  }

  const removeItem = async (index: number) => {
    const target = items[index]
    if ((target.title || target.body) && !(await confirm('确定删除这条规则？', { confirmText: '删除' }))) return
    setItems(prev => prev.filter((_, i) => i !== index))
    setDirty(true)
  }

  const save = async () => {
    const invalid = items.findIndex(item => !item.title.trim() && !item.body.trim())
    if (invalid >= 0) {
      toast.warning(`第 ${invalid + 1} 条规则缺少标题与正文，请补全或删除`)
      return
    }
    setSaving(true)
    try {
      const result = await ipc.invoke('db:rule-items-save', items.map((item, index) => ({
        id: item.id || undefined,
        code: item.code,
        group: item.group || '总则',
        title: item.title,
        body: item.body,
        severity: item.severity,
        tags: item.tags,
        active: item.active,
        sort: index,
      })))
      if (!result.success) throw new Error(result.error || '保存失败')
      setItems(result.items || [])
      setDirty(false)
      if (result.compiled !== undefined) onCompiled(result.compiled)
      await loadSnapshots()
      toast.success(`规则已保存：${(result.items || []).length} 条`)
    } catch (error) {
      toast.error(`保存失败：${String(error)}`)
    }
    setSaving(false)
  }

  const seed = async () => {
    if (!rulebook.trim()) {
      toast.warning('规则原文为空，请先在原文视图里填写规则')
      return
    }
    if (!(await confirm('把现有规则原文按空行/编号拆分为结构化条目？拆分后仍可逐条修改。', { confirmText: '拆分' }))) return
    setSaving(true)
    try {
      const result = await ipc.invoke('db:rule-items-seed', rulebook)
      if (!result.success) throw new Error(result.error || '拆分失败')
      setItems(result.items || [])
      setDirty(false)
      if (result.compiled !== undefined) onCompiled(result.compiled)
      await loadSnapshots()
      toast.success(`已解析为 ${(result.items || []).length} 条规则`)
    } catch (error) {
      toast.error(`拆分失败：${String(error)}`)
    }
    setSaving(false)
  }

  const restore = async (id: number) => {
    if (!(await confirm('回滚到该快照？当前规则条目会被覆盖（会先自动保存当前版本为新快照）。', { confirmText: '回滚' }))) return
    setSaving(true)
    try {
      const result = await ipc.invoke('db:rule-snapshot-restore', id)
      if (!result.success) throw new Error(result.error || '回滚失败')
      setItems(result.items || [])
      setDirty(false)
      if (result.compiled !== undefined) onCompiled(result.compiled)
      await loadSnapshots()
      toast.success('已回滚规则')
    } catch (error) {
      toast.error(`回滚失败：${String(error)}`)
    }
    setSaving(false)
  }

  // 按分组聚合展示，保持条目原有顺序
  const groups = useMemo(() => {
    const order: string[] = []
    const map = new Map<string, Array<{ item: RuleItem; index: number }>>()
    items.forEach((item, index) => {
      const name = item.group || '总则'
      if (!map.has(name)) {
        map.set(name, [])
        order.push(name)
      }
      map.get(name)!.push({ item, index })
    })
    return order.map(name => ({ name, entries: map.get(name)! }))
  }, [items])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs opacity-70">
          {loading ? '加载中…' : `${stats.total} 条（硬规则 ${stats.hard}）· 约 ${stats.chars} 字`}
          {stats.chars > MAX_INJECT_HINT && (
            <span className="ml-2 text-amber-500">条目总量偏大，注入时将按三层预算装配</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {items.length === 0 && rulebook.trim() && (
            <Button variant="outline" size="sm" onClick={() => void seed()} disabled={saving}>
              <Sparkles size={13} /> 从原文拆分
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowSnapshots(v => !v)} disabled={saving}>
            <History size={13} /> 快照{snapshots.length > 0 ? `(${snapshots.length})` : ''}
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving || loading || !dirty}>
            <Save size={13} /> {saving ? '保存中…' : '保存规则'}
          </Button>
        </div>
      </div>

      {showSnapshots && (
        <div className="rounded-md border p-2 space-y-1 text-xs" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
          {snapshots.length === 0 && <div className="opacity-60">暂无快照，保存规则后会自动生成。</div>}
          {snapshots.map(snap => (
            <div key={snap.id} className="flex items-center gap-2">
              <span className="opacity-60 w-4">{snap.id}</span>
              <span className="flex-1 truncate opacity-70">
                {snap.itemsCount} 条 · {snap.chars} 字 · {new Date(snap.createdAt).toLocaleString()}
              </span>
              <Button variant="ghost" size="sm" onClick={() => void restore(snap.id)} disabled={saving}>
                <RotateCcw size={12} /> 回滚
              </Button>
            </div>
          ))}
        </div>
      )}

      {loading && <div className="text-xs opacity-60">正在读取规则条目…</div>}

      {!loading && items.length === 0 && (
        <div className="rounded-md border border-dashed p-4 text-xs space-y-2" style={{ borderColor: 'var(--color-border)' }}>
          <p className="opacity-70">还没有结构化规则条目。</p>
          <p className="opacity-50">
            可以从现有规则原文自动拆分（推荐，内容不会丢），也可以直接「添加条目」手工录入。
            保存后会编译回规则原文，生成与审稿按条目编号引用。
          </p>
          <div className="flex items-center gap-2">
            {rulebook.trim() && (
              <Button variant="outline" size="sm" onClick={() => void seed()} disabled={saving}>
                <Sparkles size={13} /> 从原文拆分
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => addItem('总则')}>
              <Plus size={13} /> 添加条目
            </Button>
          </div>
        </div>
      )}

      {groups.map(group => (
        <div key={group.name} className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium px-2 py-1 rounded"
              style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.12)', color: 'var(--color-accent)' }}>
              {group.name}
            </span>
            <span className="text-[0.7rem] opacity-50">{group.entries.length} 条</span>
            <Button variant="ghost" size="sm" onClick={() => addItem(group.name)}>
              <Plus size={12} /> 添加
            </Button>
          </div>

          {group.entries.map(({ item, index }) => {
            const duplicate = duplicateBodies.has(item.body.replace(/\s+/g, '').slice(0, 60))
            return (
              <div key={item.id || `new-${index}`} className="rounded-md border p-2.5 space-y-2"
                style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[0.7rem] px-1.5 py-0.5 rounded opacity-80"
                    style={{ backgroundColor: 'var(--color-hover)' }}>
                    {item.code || '自动编号'}
                  </span>
                  <Input
                    className="flex-1 min-w-[12rem]"
                    value={item.title}
                    placeholder="规则标题（一句话）"
                    onChange={e => update(index, { title: e.target.value })}
                  />
                  <NativeSelect
                    value={item.severity}
                    onChange={e => update(index, { severity: e.target.value === 'hard' ? 'hard' : 'soft' })}
                    className="w-28"
                  >
                    <option value="hard">硬规则</option>
                    <option value="soft">软规则</option>
                  </NativeSelect>
                  <Input
                    className="w-32"
                    value={item.group}
                    placeholder="分组"
                    onChange={e => update(index, { group: e.target.value })}
                  />
                  <Button variant="ghost" size="icon" title="删除" onClick={() => void removeItem(index)}>
                    <Trash2 size={13} />
                  </Button>
                </div>
                <Textarea
                  value={item.body}
                  placeholder="规则正文（越具体越好：数值上限、例外条件、判定方式）"
                  onChange={e => update(index, { body: e.target.value })}
                  rows={2}
                />
                {duplicate && (
                  <div className="flex items-center gap-1 text-[0.7rem] text-amber-500">
                    <AlertTriangle size={11} /> 与其它条目内容重复
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ))}

      {!loading && items.length > 0 && (
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={() => addItem('总则')}>
            <Plus size={13} /> 添加条目
          </Button>
        </div>
      )}

      {dirty && (
        <div className={cn('text-[0.7rem] opacity-60')}>有未保存的规则修改，保存后会生成快照。</div>
      )}
    </div>
  )
}
