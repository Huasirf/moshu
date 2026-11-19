import { useEffect, useState } from 'react'
import { Sparkles, FolderOpen, Clock, BookOpen, FileUp, Settings, TriangleAlert, FolderCog } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '../../stores/project-store'
import { useLLMStore } from '../../stores/llm-store'
import { useLayoutStore } from '../../stores/layout-store'
import { Button } from '../ui/Button'
import ProjectManagerDialog from '../dialogs/ProjectManagerDialog'

interface WelcomePageProps {
  onNewProject: () => void
  onOpenProject: () => void
  onImportNovel?: () => void
}

/** 欢迎页面 — 无项目打开时显示 */
export default function WelcomePage({ onNewProject, onOpenProject, onImportNovel }: WelcomePageProps) {
  const { t } = useTranslation('pages')
  const recentProjects = useProjectStore(s => s.recentProjects)
  const openProject = useProjectStore(s => s.openProject)
  const currentProject = useProjectStore(s => s.currentProject)
  const models = useLLMStore(s => s.models)
  const modelsLoaded = useLLMStore(s => s.loaded)
  const initModels = useLLMStore(s => s.init)
  const openSettings = useLayoutStore(s => s.openSettings)
  const [managerOpen, setManagerOpen] = useState(false)

  useEffect(() => { void initModels() }, [initModels])

  const needsModel = modelsLoaded && models.length === 0

  return (
    <div
      className="w-full h-full overflow-y-auto"
      style={{ backgroundColor: 'var(--color-editor-bg)' }}
    >
      <div className="max-w-lg w-full mx-auto px-8 py-16">
        {/* Logo 区域 — 平实品牌标识 */}
        <div className="text-center mb-12">
          <div
            className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-5"
            style={{
              backgroundColor: 'var(--color-sidebar)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-accent)',
            }}
          >
            <BookOpen size={28} />
          </div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text)' }}>
            {currentProject ? currentProject.name : t('welcome.title')}
          </h1>
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {currentProject ? currentProject.path : t('welcome.subtitle')}
          </p>
        </div>

        {/* 首次使用引导：尚未配置任何模型时，把「去配置」作为主行动 */}
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
              <TriangleAlert size={16} style={{ color: 'var(--color-warning)' }} />
              <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                {t('welcome.noModelTitle')}
              </span>
            </div>
            <p className="text-xs leading-5" style={{ color: 'var(--color-text-secondary)' }}>
              {t('welcome.noModelDesc')}
            </p>
            <div>
              <Button variant="ai" size="sm" onClick={openSettings}>
                <Settings size={13} />
                {t('welcome.configureModel')}
              </Button>
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="grid grid-cols-3 gap-3 mb-10">
          <button
            onClick={onNewProject}
            className="group flex flex-col items-center gap-2.5 p-5 rounded-xl transition-colors"
            style={{
              backgroundColor: 'var(--color-sidebar)',
              border: '1px solid var(--color-border)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--color-accent)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)'
            }}
          >
            <div
              className="flex items-center justify-center w-10 h-10 rounded-xl"
              style={{ backgroundColor: 'rgba(var(--color-accent-rgb), 0.12)', color: 'var(--color-accent)' }}
            >
              <Sparkles size={20} />
            </div>
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {t('welcome.newProject')}
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('welcome.newProjectDesc')}
            </span>
          </button>

          <button
            onClick={onOpenProject}
            className="group flex flex-col items-center gap-2.5 p-5 rounded-xl transition-colors"
            style={{
              backgroundColor: 'var(--color-sidebar)',
              border: '1px solid var(--color-border)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--color-accent)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)'
            }}
          >
            <div
              className="flex items-center justify-center w-10 h-10 rounded-xl"
              style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text)' }}
            >
              <FolderOpen size={20} />
            </div>
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {t('welcome.openProject')}
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('welcome.openProjectDesc')}
            </span>
          </button>

          <button
            onClick={onImportNovel}
            className="group flex flex-col items-center gap-2.5 p-5 rounded-xl transition-colors"
            style={{
              backgroundColor: 'var(--color-sidebar)',
              border: '1px solid var(--color-border)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = 'var(--color-accent)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = 'var(--color-border)'
            }}
          >
            <div
              className="flex items-center justify-center w-10 h-10 rounded-xl"
              style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text)' }}
            >
              <FileUp size={20} />
            </div>
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {t('welcome.importNovel')}
            </span>
            <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              {t('welcome.importNovelDesc')}
            </span>
          </button>
        </div>

        {/* 最近项目 */}
        {recentProjects.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-3">
              <Clock size={14} style={{ color: 'var(--color-text-muted)' }} />
              <span className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                {t('welcome.recentProjects')}
              </span>
              <button
                type="button"
                className="ml-auto flex items-center gap-1 text-[0.7rem] px-2 py-1 rounded transition-colors hover:bg-[var(--color-hover)]"
                style={{ color: 'var(--color-text-muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
                onClick={() => setManagerOpen(true)}
              >
                <FolderCog size={12} />
                {t('projectManager.title', { ns: 'dialogs' })}
              </button>
            </div>
            <div className="space-y-1">
              {recentProjects.map((p, i) => (
                <div
                  key={i}
                  className="group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all"
                  style={{ backgroundColor: 'transparent', borderLeft: '2px solid transparent' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--color-hover)'
                    e.currentTarget.style.borderLeftColor = 'var(--color-accent)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent'
                    e.currentTarget.style.borderLeftColor = 'transparent'
                  }}
                  onClick={() => openProject(p.path)}
                >
                  <BookOpen size={14} style={{ color: 'var(--color-accent)', opacity: 0.6 }} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm block truncate" style={{ color: 'var(--color-text)' }}>
                      {p.name}
                    </span>
                    <span className="text-xs block truncate" style={{ color: 'var(--color-text-muted)' }}>
                      {p.path}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="text-center mt-12">
          <p className="text-xs" style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}>
            {t('welcome.footer')}
          </p>
        </div>
      </div>

      <ProjectManagerDialog open={managerOpen} onClose={() => setManagerOpen(false)} />
    </div>
  )
}
