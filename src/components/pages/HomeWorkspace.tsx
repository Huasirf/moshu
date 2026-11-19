import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen, FolderOpen, FileUp, Search, Pin, PinOff, FolderSearch,
  LayoutGrid, List, Clock, Sparkles, MoreHorizontal, Trash2, FolderCog, AlertTriangle,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '../../stores/project-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useLLMStore } from '../../stores/llm-store'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import ProjectManagerDialog from '../dialogs/ProjectManagerDialog'
import type { ProjectRegistryEntry } from '../../shared/ipc-channels'

interface HomeWorkspaceProps {
  onNewProject: () => void
  onOpenFolder: () => void
  onImportNovel?: () => void
}

type SortKey = 'recent' | 'name' | 'progress'

function formatRelativeTime(iso: string, locale: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  const diff = Date.now() - date.getTime()
  if (Number.isNaN(diff)) return ''
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return locale.startsWith('zh') ? '刚刚' : locale.startsWith('ru') ? 'только что' : 'just now'
  if (diff < hour) return `${Math.floor(diff / minute)}${locale.startsWith('zh') ? ' 分钟前' : locale.startsWith('ru') ? ' мин назад' : ' min ago'}`
  if (diff < day) return `${Math.floor(diff / hour)}${locale.startsWith('zh') ? ' 小时前' : locale.startsWith('ru') ? ' ч назад' : ' h ago'}`
  if (diff < 7 * day) return `${Math.floor(diff / day)}${locale.startsWith('zh') ? ' 天前' : locale.startsWith('ru') ? ' дн назад' : ' d ago'}`
  return date.toLocaleDateString()
}

function ProjectCard({
  project, view, onOpen, onRelocate, onPin, onReveal, onForget,
}: {
  project: ProjectRegistryEntry
  view: 'grid' | 'list'
  onOpen: () => void
  onRelocate: () => void
  onPin: () => void
  onReveal: () => void
  onForget: () => void
}) {
  const { t, i18n } = useTranslation('pages')
  const [menuOpen, setMenuOpen] = useState(false)
  const done = Math.max(0, project.draftedCount)
  const total = Math.max(0, project.totalChapters)
  const percent = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  const missing = Boolean(project.missing)

  const actions = (
    <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        title={project.pinned ? t('workspace.unpin') : t('workspace.pin')}
        onClick={onPin}
        className="flex items-center justify-center rounded-md transition-colors hover:bg-[var(--color-hover)]"
        style={{ width: 30, height: 30, color: project.pinned ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
      >
        {project.pinned ? <Pin size={14} /> : <PinOff size={14} />}
      </button>
      <div className="relative">
        <button
          type="button"
          title={t('workspace.open')}
          onClick={() => setMenuOpen((v) => !v)}
          className="flex items-center justify-center rounded-md transition-colors hover:bg-[var(--color-hover)]"
          style={{ width: 30, height: 30, color: 'var(--color-text-muted)' }}
        >
          <MoreHorizontal size={15} />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={(e) => { e.stopPropagation(); setMenuOpen(false) }} />
            <div
              className="absolute right-0 top-8 z-30 min-w-[168px] rounded-lg py-1 shadow-xl"
              style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}
            >
              <button type="button" className="menu-item" onClick={() => { setMenuOpen(false); onReveal() }}>
                <FolderOpen size={14} /> {t('workspace.reveal')}
              </button>
              <button type="button" className="menu-item" onClick={() => { setMenuOpen(false); onForget() }}>
                <Trash2 size={14} /> {t('workspace.forget')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )

  if (view === 'list') {
    return (
      <div
        className="group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors cursor-pointer"
        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
        onClick={missing ? undefined : onOpen}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--color-accent)' }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
      >
        <div
          className="flex items-center justify-center rounded-md shrink-0 text-sm font-semibold"
          style={{ width: 34, height: 34, backgroundColor: `${project.coverColor}22`, color: project.coverColor, border: `1px solid ${project.coverColor}55` }}
        >
          {project.name.slice(0, 1)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{project.name}</span>
            {project.pinned && <Pin size={12} style={{ color: 'var(--color-accent)' }} />}
            {missing && <span className="text-[0.7rem] px-1.5 py-0.5 rounded" style={{ color: 'var(--color-warning)', backgroundColor: 'color-mix(in srgb, var(--color-warning) 14%, transparent)' }}>{t('workspace.missing')}</span>}
          </div>
          <span className="text-[0.7rem] truncate block mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{project.path}</span>
        </div>
        <div className="hidden md:flex flex-col items-end shrink-0 w-28">
          <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{t('workspace.progress', { done, total })}</span>
          <div className="w-full h-1 rounded-full mt-1 overflow-hidden" style={{ backgroundColor: 'var(--color-hover)' }}>
            <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: project.coverColor }} />
          </div>
        </div>
        <span className="hidden lg:block text-xs shrink-0 w-24 text-right" style={{ color: 'var(--color-text-muted)' }}>
          {t('workspace.words', { count: project.wordCount })}
        </span>
        <span className="hidden xl:block text-xs shrink-0 w-28 text-right" style={{ color: 'var(--color-text-muted)' }}>
          {formatRelativeTime(project.lastOpenedAt, i18n.language)}
        </span>
        {missing ? (
          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); onRelocate() }}>
            <FolderSearch size={13} /> {t('workspace.relocate')}
          </Button>
        ) : actions}
      </div>
    )
  }

  return (
    <div
      className="group relative flex flex-col rounded-xl overflow-hidden transition-all cursor-pointer"
      style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}
      onClick={missing ? undefined : onOpen}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-accent)'
        e.currentTarget.style.transform = 'translateY(-2px)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border)'
        e.currentTarget.style.transform = 'translateY(0)'
      }}
    >
      {/* 封面：项目名首字色块 */}
      <div
        className="relative flex items-end p-3"
        style={{ height: 86, background: `linear-gradient(135deg, ${project.coverColor}33, ${project.coverColor}0d)` }}
      >
        <span className="text-2xl font-bold" style={{ color: project.coverColor }}>{project.name.slice(0, 1)}</span>
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
          {actions}
        </div>
        {project.pinned && (
          <Pin size={13} className="absolute top-2.5 left-2.5" style={{ color: 'var(--color-accent)' }} />
        )}
      </div>

      <div className="p-3 flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate flex-1" style={{ color: 'var(--color-text)' }}>{project.name}</span>
          {missing && <span className="text-[0.7rem] px-1.5 py-0.5 rounded shrink-0" style={{ color: 'var(--color-warning)', backgroundColor: 'color-mix(in srgb, var(--color-warning) 14%, transparent)' }}>{t('workspace.missing')}</span>}
        </div>
        <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {project.genre || '—'} · {t('workspace.words', { count: project.wordCount })}
        </span>
        <div className="mt-1">
          <div className="flex items-center justify-between text-[0.7rem] mb-1" style={{ color: 'var(--color-text-muted)' }}>
            <span>{t('workspace.progress', { done, total })}</span>
            <span>{percent}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-hover)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${percent}%`, backgroundColor: project.coverColor }} />
          </div>
        </div>
        <div className="flex items-center gap-1 mt-1 text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
          <Clock size={11} />
          {t('workspace.lastOpened', { time: formatRelativeTime(project.lastOpenedAt, i18n.language) })}
        </div>
        {missing && (
          <Button size="sm" variant="outline" className="mt-1 w-full" onClick={(e) => { e.stopPropagation(); onRelocate() }}>
            <FolderSearch size={13} /> {t('workspace.relocate')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** 主页工作台 — 无项目时的项目管理视图（列表 / 卡片、搜索、排序、置顶） */
export default function HomeWorkspace({ onNewProject, onOpenFolder, onImportNovel }: HomeWorkspaceProps) {
  const { t } = useTranslation('pages')
  const registry = useProjectStore((s) => s.registry)
  const loadRegistry = useProjectStore((s) => s.loadRegistry)
  const openProject = useProjectStore((s) => s.openProject)
  const setPinned = useProjectStore((s) => s.setProjectPinned)
  const forgetProject = useProjectStore((s) => s.forgetProject)
  const revealProject = useProjectStore((s) => s.revealProject)
  const currentProject = useProjectStore((s) => s.currentProject)
  const models = useLLMStore((s) => s.models)
  const modelsLoaded = useLLMStore((s) => s.loaded)
  const initModels = useLLMStore((s) => s.init)
  const openSettings = useLayoutStore((s) => s.openSettings)
  const [managerOpen, setManagerOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [sort, setSort] = useState<SortKey>('recent')

  useEffect(() => { void initModels() }, [initModels])
  useEffect(() => { void loadRegistry() }, [loadRegistry])

  const needsModel = modelsLoaded && models.length === 0

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = registry.filter((p) => !q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q))
    return [...list].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      if (sort === 'name') return a.name.localeCompare(b.name, 'zh-CN')
      if (sort === 'progress') {
        const pa = a.totalChapters > 0 ? a.draftedCount / a.totalChapters : 0
        const pb = b.totalChapters > 0 ? b.draftedCount / b.totalChapters : 0
        return pb - pa
      }
      return (b.lastOpenedAt || '').localeCompare(a.lastOpenedAt || '')
    })
  }, [registry, query, sort])

  const relocate = async (project: ProjectRegistryEntry) => {
    const folder = await ipcSelectFolder()
    if (!folder) return
    const ok = await openProject(folder)
    if (ok) {
      // 旧条目路径已失效：从工作台移除，新路径由打开流程自动登记
      if (folder !== project.path) await forgetProject(project.path)
      await loadRegistry()
    }
  }

  const forget = async (project: ProjectRegistryEntry) => {
    const ok = await confirm(t('workspace.confirmForget'), { danger: true })
    if (!ok) return
    await forgetProject(project.path)
    toast.success(t('workspace.forget'))
  }

  return (
    <div className="w-full h-full overflow-y-auto" style={{ backgroundColor: 'var(--color-editor-bg)' }}>
      <div className="max-w-5xl w-full mx-auto px-8 py-10">
        {/* 顶部：品牌 + 搜索 + 主操作 */}
        <div className="flex flex-wrap items-center gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center w-12 h-12 rounded-xl"
              style={{ backgroundColor: 'var(--color-sidebar)', border: '1px solid var(--color-border)', color: 'var(--color-accent)' }}
            >
              <BookOpen size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold leading-tight" style={{ color: 'var(--color-text)' }}>
                {t('workspace.title')}
              </h1>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                {currentProject ? currentProject.name : t('workspace.subtitle')}
              </p>
            </div>
          </div>

          <div className="relative flex-1 min-w-[220px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('workspace.searchPlaceholder')}
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-2">
            <Button variant="default" onClick={onNewProject}>
              <Sparkles size={15} /> {t('workspace.newProject')}
            </Button>
            <Button variant="outline" onClick={onOpenFolder}>
              <FolderOpen size={15} /> {t('workspace.openFolder')}
            </Button>
            {onImportNovel && (
              <Button variant="ghost" onClick={onImportNovel}>
                <FileUp size={15} /> {t('workspace.importNovel')}
              </Button>
            )}
          </div>
        </div>

        {needsModel && (
          <div
            role="status"
            className="flex flex-col gap-2.5 p-4 mb-6 rounded-xl"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--color-warning) 35%, transparent)',
            }}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} style={{ color: 'var(--color-warning)' }} />
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t('welcome.noModelTitle')}</span>
            </div>
            <p className="text-xs leading-5" style={{ color: 'var(--color-text-secondary)' }}>{t('welcome.noModelDesc')}</p>
            <div>
              <Button variant="ai" size="sm" onClick={openSettings}>{t('welcome.configureModel')}</Button>
            </div>
          </div>
        )}

        {/* 工具条 */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            {t('workspace.allProjects')}
            <span className="ml-1.5 text-xs font-normal" style={{ color: 'var(--color-text-muted)' }}>({filtered.length})</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="h-8 px-2 rounded-md text-xs"
              style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
            >
              <option value="recent">{t('workspace.sortRecent')}</option>
              <option value="name">{t('workspace.sortName')}</option>
              <option value="progress">{t('workspace.sortProgress')}</option>
            </select>
            <div className="flex items-center rounded-md overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
              <button
                type="button"
                onClick={() => setView('grid')}
                className="flex items-center gap-1 px-2.5 h-8 text-xs"
                style={{ backgroundColor: view === 'grid' ? 'var(--color-hover)' : 'transparent', color: view === 'grid' ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
              >
                <LayoutGrid size={13} /> {t('workspace.grid')}
              </button>
              <button
                type="button"
                onClick={() => setView('list')}
                className="flex items-center gap-1 px-2.5 h-8 text-xs"
                style={{ backgroundColor: view === 'list' ? 'var(--color-hover)' : 'transparent', color: view === 'list' ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
              >
                <List size={13} /> {t('workspace.list')}
              </button>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setManagerOpen(true)}>
              <FolderCog size={14} />
            </Button>
          </div>
        </div>

        {/* 项目区 */}
        {filtered.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center text-center rounded-2xl py-16"
            style={{ border: '1px dashed var(--color-border)', backgroundColor: 'color-mix(in srgb, var(--color-panel) 55%, transparent)' }}
          >
            <BookOpen size={36} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
            <h2 className="text-base font-medium mt-4" style={{ color: 'var(--color-text)' }}>
              {registry.length === 0 ? t('workspace.emptyTitle') : t('workspace.noMatch')}
            </h2>
            <p className="text-xs mt-1.5 max-w-md" style={{ color: 'var(--color-text-muted)' }}>
              {registry.length === 0 ? t('workspace.emptyDesc') : ''}
            </p>
            {registry.length === 0 && (
              <Button variant="ai" className="mt-5" onClick={onNewProject}>
                <Sparkles size={16} /> {t('workspace.newProject')}
              </Button>
            )}
          </div>
        ) : view === 'grid' ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filtered.map((p) => (
              <ProjectCard
                key={p.path}
                project={p}
                view="grid"
                onOpen={() => { void openProject(p.path) }}
                onRelocate={() => { void relocate(p) }}
                onPin={() => { void setPinned(p.path, !p.pinned) }}
                onReveal={() => { void revealProject(p.path) }}
                onForget={() => { void forget(p) }}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {filtered.map((p) => (
              <ProjectCard
                key={p.path}
                project={p}
                view="list"
                onOpen={() => { void openProject(p.path) }}
                onRelocate={() => { void relocate(p) }}
                onPin={() => { void setPinned(p.path, !p.pinned) }}
                onReveal={() => { void revealProject(p.path) }}
                onForget={() => { void forget(p) }}
              />
            ))}
          </div>
        )}

        <p className="text-xs text-center mt-10" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>
          {t('welcome.footer')}
        </p>
      </div>

      <ProjectManagerDialog open={managerOpen} onClose={() => setManagerOpen(false)} />
    </div>
  )
}

/** 打开系统文件夹选择框（与 EditorArea 中一致） */
async function ipcSelectFolder(): Promise<string | null> {
  const { ipc } = await import('../../services/ipc-client')
  return ipc.invoke('dialog:select-folder')
}
