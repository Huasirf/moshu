import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle, FolderCog, FolderOpen, FolderSearch, ListX, Loader2, Trash2,
} from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { Button } from '../ui/Button'
import { confirm } from '../ui/Confirm'
import { toast } from '../ui/Toast'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../ui/Dialog'

interface ProjectManagerDialogProps {
  open: boolean
  onClose: () => void
}

/** 项目管理对话框：打开 / 定位 / 从最近列表移除 / 删除项目（移入回收站） */
export default function ProjectManagerDialog({ open, onClose }: ProjectManagerDialogProps) {
  const { t } = useTranslation('dialogs')
  const recentProjects = useProjectStore((s) => s.recentProjects)
  const currentProject = useProjectStore((s) => s.currentProject)
  const loadRecentProjects = useProjectStore((s) => s.loadRecentProjects)
  const openProject = useProjectStore((s) => s.openProject)
  const revealProject = useProjectStore((s) => s.revealProject)
  const removeRecentProject = useProjectStore((s) => s.removeRecentProject)
  const deleteProject = useProjectStore((s) => s.deleteProject)
  const [busyPath, setBusyPath] = useState<string | null>(null)

  useEffect(() => {
    if (open) void loadRecentProjects()
  }, [open, loadRecentProjects])

  const isCurrent = (projectPath: string) => currentProject?.path === projectPath

  const handleOpen = async (projectPath: string) => {
    setBusyPath(projectPath)
    const opened = await openProject(projectPath)
    setBusyPath(null)
    if (opened) onClose()
  }

  const handleReveal = async (projectPath: string) => {
    const result = await revealProject(projectPath)
    if (!result.success) {
      toast.error(t('projectManager.revealFailed', { error: result.error ?? '' }))
    }
  }

  const handleRemoveRecent = async (projectPath: string, name: string) => {
    const ok = await confirm(
      t('projectManager.removeConfirm', { name }),
      { title: t('projectManager.removeTitle'), confirmText: t('projectManager.removeRecent') },
    )
    if (!ok) return
    setBusyPath(projectPath)
    const result = await removeRecentProject(projectPath)
    setBusyPath(null)
    if (result.success) toast.success(t('projectManager.removeSuccess'))
    else toast.error(result.error ?? t('projectManager.removeFailed'))
  }

  const handleDelete = async (projectPath: string, name: string) => {
    const ok = await confirm(
      t('projectManager.deleteConfirm', { name, path: projectPath }),
      {
        title: t('projectManager.deleteTitle'),
        confirmText: t('projectManager.deleteConfirmButton'),
        danger: true,
      },
    )
    if (!ok) return
    setBusyPath(projectPath)
    const result = await deleteProject(projectPath)
    setBusyPath(null)
    if (result.success) {
      toast.success(result.missing
        ? t('projectManager.deleteMissing')
        : t('projectManager.deleteSuccess'))
    } else {
      toast.error(t('projectManager.deleteFailed', { error: result.error ?? '' }))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-w-[680px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderCog size={18} className="text-[var(--color-accent)]" />
            {t('projectManager.title')}
          </DialogTitle>
          <DialogDescription>{t('projectManager.description')}</DialogDescription>
        </DialogHeader>

        <div className="px-5 py-3 max-h-[55vh] overflow-y-auto space-y-1.5">
          {recentProjects.length === 0 ? (
            <p className="text-xs py-8 text-center" style={{ color: 'var(--color-text-muted)' }}>
              {t('projectManager.empty')}
            </p>
          ) : (
            recentProjects.map((project) => {
              const current = isCurrent(project.path)
              const busy = busyPath === project.path
              return (
                <div
                  key={project.path}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg border"
                  style={{
                    borderColor: 'var(--color-border)',
                    backgroundColor: current ? 'var(--color-hover)' : 'transparent',
                  }}
                >
                  <FolderOpen
                    size={15}
                    style={{ color: current ? 'var(--color-accent)' : 'var(--color-text-muted)', flexShrink: 0 }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm truncate" style={{ color: 'var(--color-text)' }}>
                        {project.name}
                      </span>
                      {current && (
                        <span
                          className="text-[0.65rem] px-1.5 py-0.5 rounded"
                          style={{ color: 'var(--color-accent)', backgroundColor: 'var(--color-hover)' }}
                        >
                          {t('projectManager.current')}
                        </span>
                      )}
                    </div>
                    <p className="text-[0.7rem] truncate mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                      {project.path}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!current && (
                      <button
                        type="button"
                        className="text-xs px-2 py-1 rounded transition-colors hover:bg-[var(--color-hover)]"
                        style={{ color: 'var(--color-accent)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                        disabled={busy}
                        onClick={() => void handleOpen(project.path)}
                      >
                        {busy ? <Loader2 size={13} className="animate-spin" /> : t('projectManager.open')}
                      </button>
                    )}
                    <button
                      type="button"
                      title={t('projectManager.reveal')}
                      className="p-1.5 rounded transition-colors hover:bg-[var(--color-hover)]"
                      style={{ color: 'var(--color-text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                      onClick={() => void handleReveal(project.path)}
                    >
                      <FolderSearch size={14} />
                    </button>
                    {!current && (
                      <button
                        type="button"
                        title={t('projectManager.removeRecent')}
                        className="p-1.5 rounded transition-colors hover:bg-[var(--color-hover)]"
                        style={{ color: 'var(--color-text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                        disabled={busy}
                        onClick={() => void handleRemoveRecent(project.path, project.name)}
                      >
                        <ListX size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      title={t('projectManager.delete')}
                      className="p-1.5 rounded transition-colors hover:bg-[var(--color-hover)]"
                      style={{ color: 'var(--color-danger, #dc2626)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                      disabled={busy}
                      onClick={() => void handleDelete(project.path, project.name)}
                    >
                      {busy ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        <div
          className="mx-5 mb-3 px-3 py-2 rounded-lg flex items-start gap-2"
          style={{ backgroundColor: 'var(--color-hover)' }}
        >
          <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
          <p className="text-[0.7rem] leading-relaxed" style={{ color: 'var(--color-text-muted)' }}>
            {t('projectManager.deleteHint')}
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('projectManager.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
