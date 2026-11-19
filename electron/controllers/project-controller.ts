import { ipcMain, dialog, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { readJsonFile, writeJsonFile, RECENT_PROJECTS_PATH } from '../utils/config-utils'
import { ProjectData } from '../../src/shared/ipc-channels'
import { DIR_MOSHU_INTERNAL, DIR_PROMPTS, DIR_LEGACY_VELA_INTERNAL } from '../../src/shared/project-paths'
import { initProjectDatabase, getCurrentProjectPath, closeProjectDatabase, getProjectDb } from '../database'
import { ProjectCoreRepository } from '../repositories/project-core-repository'
import { seedRuleItemsFromRulebook } from '../repositories/rule-repository'
import { PipelineRepository } from '../repositories/pipeline-repository'
import { CHAPTER_STAGES } from '../../src/shared/chapter-stage'
import { listRegistry, upsertRegistryEntry, removeRegistryEntry, setRegistryPinned } from '../utils/project-registry'
import {
  checkProjectCreateAccess, checkProjectOpenAccess, grantPathAccess, toSafeFolderName,
  canonicalizePath, isSamePath, isKnownProjectPath,
} from '../path-guard'

interface RecentProject {
  name: string
  path: string
  updatedAt: string
}

function loadRecentProjects(): RecentProject[] {
  return readJsonFile<RecentProject[]>(RECENT_PROJECTS_PATH, [])
}

function addRecentProject(project: RecentProject) {
  const list = loadRecentProjects()
  const filtered = list.filter((p) => p.path !== project.path)
  filtered.unshift(project)
  const trimmed = filtered.slice(0, 20)
  writeJsonFile(RECENT_PROJECTS_PATH, trimmed)
}

/** 从最近项目列表移除指定路径（不删除磁盘目录） */
function removeRecentProjectByPath(projectPath: string) {
  const list = loadRecentProjects()
  const target = canonicalizePath(projectPath)
  const filtered = list.filter((p) => !isSamePath(canonicalizePath(p.path), target))
  if (filtered.length !== list.length) {
    writeJsonFile(RECENT_PROJECTS_PATH, filtered)
  }
}

/**
 * 刷新项目登记表（工作台数据源）：从当前已打开的项目库读取题材、总章数、进度与字数。
 * 只在主进程内部调用，失败不影响项目本身的打开/保存。
 */
function refreshRegistryEntry(projectPath: string, fallbackName?: string) {
  try {
    const core = ProjectCoreRepository.get()
    const db = getProjectDb()
    const drafted = PipelineRepository.getAll()
      .filter((s) => CHAPTER_STAGES.indexOf(s.stage) >= 1).length
    let wordCount = 0
    if (db) {
      const row = db.prepare(`
        SELECT COALESCE(SUM(word_count), 0) AS total FROM (
          SELECT chapter_number, MAX(word_count) AS word_count
          FROM drafts WHERE status != 'archived' GROUP BY chapter_number
        )
      `).get() as { total?: number } | undefined
      wordCount = row?.total ?? 0
    }
    upsertRegistryEntry({
      path: projectPath,
      name: core?.projectName ?? fallbackName,
      genre: core?.genre,
      totalChapters: core?.totalChapters ?? 0,
      draftedCount: drafted,
      wordCount,
      lastOpenedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.warn('[MoShu] 项目登记表刷新失败:', e)
  }
}

export function registerProjectController() {
  // 创建新项目
  ipcMain.handle('project:create', async (_event, config: {
    name: string; path: string; genre: string; targetAudience: string
  }) => {
    try {
      const projectId = randomUUID()
      // 项目名只作为单段文件夹名使用：去掉路径分隔符等字符，避免 "../x" 之类的名称把项目建到别处
      const folderName = toSafeFolderName(config?.name)
      if (!folderName) return { success: false, projectId: '', error: '项目名称无效' }
      const location = typeof config.path === 'string' ? config.path.trim() : ''
      if (!location || !path.isAbsolute(location)) {
        return { success: false, projectId: '', error: '请填写或选择项目保存位置（需为完整路径）' }
      }
      const access = checkProjectCreateAccess(path.join(location, folderName))
      if (!access.ok) return { success: false, projectId: '', error: access.error }
      const projectDir = access.path

      // 仅创建必要的系统目录
      fs.mkdirSync(path.join(projectDir, DIR_MOSHU_INTERNAL), { recursive: true })
      fs.mkdirSync(path.join(projectDir, DIR_PROMPTS), { recursive: true })

      // 初始化 DB 底座
      initProjectDatabase(projectDir)

      // 初始化 project_core 记录
      ProjectCoreRepository.init(config.name)
      ProjectCoreRepository.update({
        genre: config.genre,
        targetAudience: config.targetAudience,
      })

      // 补充缺失在 DB 初始化时生成所需的数据
      const projectData: ProjectData = {
        id: projectId,
        name: config.name,
        path: projectDir,
        novelConfig: {
          genre: config.genre,
          subGenre: '',
          targetAudience: config.targetAudience,
          totalChapters: 100,
          wordsPerChapter: 3000,
          plotStructure: 'three_act',
          narrativePOV: 'third_limited',
          coreOutline: '',
          worldSetting: '',
          rulebook: '',
          goldenFinger: '',
          protagonistProfile: '',
          globalGuidance: '',
        },
        characterStates: '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      // 添加到最近项目列表
      addRecentProject({ name: config.name, path: projectDir, updatedAt: projectData.updatedAt })
      refreshRegistryEntry(projectDir, config.name)

      return { success: true, projectId, projectPath: projectDir }
    } catch (error) {
      return { success: false, projectId: '', error: String(error) }
    }
  })

  // 打开现有项目
  ipcMain.handle('project:open', async (_event, projectPath: string) => {
    try {
      // 打开后整个目录对渲染进程可读写，所以只接受最近项目或用户刚经对话框选中的目录
      const access = checkProjectOpenAccess(projectPath)
      if (!access.ok) return { success: false, project: null, error: access.error }
      if (!fs.existsSync(projectPath)) {
        return { success: false, project: null, error: '目录不存在' }
      }

      // TODO: 这里可以加入一个检测旧版项目的逻辑（如果有 旧的 01_novel_config.json 等），提示不支持旧格式。
      // 因为新架构不兼容旧项目，这里我们只要初始化 DB 即可
      initProjectDatabase(projectPath)

      // 从 DB 读取配置
      const coreData = ProjectCoreRepository.get()
      if (!coreData) {
        // 如果是从空目录新建并打开，尝试初始化
        const folderName = path.basename(projectPath)
        ProjectCoreRepository.init(folderName)
      }

      // 组装返回给前端的数据结构
      const updatedCoreData = ProjectCoreRepository.get()!
      // 存量项目首次打开：把平铺规则文本自动解析为结构化条目（零手工迁移）
      seedRuleItemsFromRulebook(updatedCoreData.rulebook)
      const projectData: ProjectData = {
        id: 'main',
        name: updatedCoreData.projectName,
        path: projectPath,
        novelConfig: {
          genre: updatedCoreData.genre,
          subGenre: updatedCoreData.subGenre,
          targetAudience: updatedCoreData.targetAudience,
          totalChapters: updatedCoreData.totalChapters,
          wordsPerChapter: updatedCoreData.wordsPerChapter,
          plotStructure: updatedCoreData.plotStructure as 'three_act' | 'heros_journey' | 'save_the_cat' | 'kishotenketsu' | 'multi_thread' | 'freeform',
          narrativePOV: updatedCoreData.narrativePov as 'third_limited' | 'first_person' | 'third_omniscient' | 'multi_pov',
          coreOutline: updatedCoreData.coreOutline,
          worldSetting: updatedCoreData.worldSetting,
          rulebook: updatedCoreData.rulebook,
          goldenFinger: updatedCoreData.goldenFinger,
          protagonistProfile: updatedCoreData.protagonistProfile,
          globalGuidance: updatedCoreData.globalGuidance,
          writingStyle: updatedCoreData.writingStyle,
          styleReference: updatedCoreData.styleReference,
          referenceWorks: updatedCoreData.referenceWorks,
          artStyle: updatedCoreData.artStyle,
          negativePrompt: updatedCoreData.negativePrompt,
        },
        characterStates: updatedCoreData.characterStates,
        createdAt: new Date().toISOString(), // db 中实际上有，但这里先 mock 一下时间避免前端报错
        updatedAt: new Date().toISOString(),
      }

      addRecentProject({ name: projectData.name, path: projectPath, updatedAt: projectData.updatedAt })
      refreshRegistryEntry(projectPath, projectData.name)

      return { success: true, project: projectData }
    } catch (error) {
      return { success: false, project: null, error: String(error) }
    }
  })

  // 保存/更新项目配置
  // 注意：这个接口前端可能还传了很多 novelConfig 中的字段，我们需要 mapping 给 DB。
  ipcMain.handle('project:save', async (_event, _projectId: string, data: Partial<ProjectData>) => {
    try {
      if (!data.path) return { success: false, error: '缺少项目路径' }

      if (data.novelConfig) {
        ProjectCoreRepository.update({
          genre: data.novelConfig.genre,
          subGenre: data.novelConfig.subGenre,
          targetAudience: data.novelConfig.targetAudience,
          totalChapters: data.novelConfig.totalChapters,
          wordsPerChapter: data.novelConfig.wordsPerChapter,
          plotStructure: data.novelConfig.plotStructure,
          narrativePov: data.novelConfig.narrativePOV,
          goldenFinger: data.novelConfig.goldenFinger,
          coreOutline: data.novelConfig.coreOutline,
          worldSetting: data.novelConfig.worldSetting,
          protagonistProfile: data.novelConfig.protagonistProfile,
          rulebook: data.novelConfig.rulebook ?? '',
          globalGuidance: data.novelConfig.globalGuidance,
          writingStyle: data.novelConfig.writingStyle ?? '',
          styleReference: data.novelConfig.styleReference ?? '',
          referenceWorks: data.novelConfig.referenceWorks ?? '',
          artStyle: data.novelConfig.artStyle ?? '',
          negativePrompt: data.novelConfig.negativePrompt ?? '',
        })
      }

      if (data.name) {
        ProjectCoreRepository.update({ projectName: data.name })
      }

      if (data.characterStates !== undefined) {
        ProjectCoreRepository.update({ characterStates: data.characterStates })
      }

      // 以上写的都是当前项目的库；最近项目列表也只记当前项目的真实路径，
      // 不采信渲染进程传来的 path（最近列表中的目录之后可免对话框直接打开）
      const currentPath = getCurrentProjectPath()
      if (currentPath) {
        addRecentProject({
          name: data.name ?? 'Unknown',
          path: currentPath,
          updatedAt: new Date().toISOString(),
        })
        refreshRegistryEntry(currentPath, data.name)
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // project:update-config 同理
  ipcMain.handle('project:update-config', async (_event, _projectId: string, data: Partial<ProjectData>) => {
    try {
      if (data.novelConfig) {
        ProjectCoreRepository.update({
          genre: data.novelConfig.genre,
          subGenre: data.novelConfig.subGenre,
          targetAudience: data.novelConfig.targetAudience,
          totalChapters: data.novelConfig.totalChapters,
          wordsPerChapter: data.novelConfig.wordsPerChapter,
          plotStructure: data.novelConfig.plotStructure,
          narrativePov: data.novelConfig.narrativePOV,
          goldenFinger: data.novelConfig.goldenFinger,
          coreOutline: data.novelConfig.coreOutline,
          worldSetting: data.novelConfig.worldSetting,
          protagonistProfile: data.novelConfig.protagonistProfile,
          rulebook: data.novelConfig.rulebook ?? '',
          globalGuidance: data.novelConfig.globalGuidance,
          writingStyle: data.novelConfig.writingStyle ?? '',
          styleReference: data.novelConfig.styleReference ?? '',
          referenceWorks: data.novelConfig.referenceWorks ?? '',
          artStyle: data.novelConfig.artStyle ?? '',
          negativePrompt: data.novelConfig.negativePrompt ?? '',
        })
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('project:recent-list', async () => {
    return loadRecentProjects()
  })

  // 仅从最近项目列表移除，不碰磁盘目录
  ipcMain.handle('project:remove-recent', async (_event, projectPath: string) => {
    try {
      if (!isKnownProjectPath(projectPath)) {
        return { success: false, error: '只能操作最近项目列表中的项目' }
      }
      const currentPath = getCurrentProjectPath()
      if (currentPath && isSamePath(canonicalizePath(currentPath), canonicalizePath(projectPath))) {
        return { success: false, error: '当前打开的项目不能从最近列表移除' }
      }
      removeRecentProjectByPath(projectPath)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // 在系统文件管理器中打开项目目录
  ipcMain.handle('project:reveal', async (_event, projectPath: string) => {
    try {
      if (!isKnownProjectPath(projectPath)) {
        return { success: false, error: '只能操作最近项目列表中的项目' }
      }
      const target = canonicalizePath(projectPath)
      if (!fs.existsSync(target)) {
        return { success: false, error: '目录不存在' }
      }
      const error = await shell.openPath(target)
      return error ? { success: false, error } : { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // 删除项目：关闭数据库后把整个项目目录移入系统回收站
  ipcMain.handle('project:delete', async (_event, projectPath: string) => {
    try {
      if (!isKnownProjectPath(projectPath)) {
        return { success: false, error: '只能删除最近项目列表中的项目' }
      }
      const target = canonicalizePath(projectPath)
      if (isSamePath(target, path.parse(target).root)) {
        return { success: false, error: '不能删除磁盘根目录' }
      }
      if (!fs.existsSync(target)) {
        removeRecentProjectByPath(target)
        removeRegistryEntry(target)
        return { success: true, missing: true }
      }
      if (!fs.existsSync(path.join(target, DIR_MOSHU_INTERNAL))
        && !fs.existsSync(path.join(target, DIR_LEGACY_VELA_INTERNAL))) {
        return { success: false, error: '该目录不是墨枢项目（缺少 .moshu 目录），已拒绝删除' }
      }

      // Windows 下数据库连接会锁住文件，删除前必须先释放
      const currentPath = getCurrentProjectPath()
      if (currentPath && isSamePath(canonicalizePath(currentPath), target)) {
        closeProjectDatabase()
      }

      await shell.trashItem(target)
      removeRecentProjectByPath(target)
      removeRegistryEntry(target)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('dialog:select-folder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: '选择项目保存位置',
    })
    if (result.canceled || result.filePaths.length === 0) return null
    // 用户亲手选中的文件夹（新建项目位置 / 打开项目 / 导出目录）：本次运行内允许读写
    grantPathAccess(result.filePaths[0], 'write')
    return result.filePaths[0]
  })

  // ===== 项目登记表（主页工作台） =====

  ipcMain.handle('project:registry-list', async () => {
    try {
      // 登记表为空时，用最近项目列表做一次兜底导入，避免升级后工作台是空白
      const entries = listRegistry()
      if (entries.length === 0) {
        for (const p of loadRecentProjects()) {
          upsertRegistryEntry({ path: p.path, name: p.name, lastOpenedAt: p.updatedAt })
        }
        return listRegistry()
      }
      return entries
    } catch (error) {
      console.warn('[MoShu] 读取项目登记表失败:', error)
      return []
    }
  })

  ipcMain.handle('project:registry-pin', async (_event, projectPath: string, pinned: boolean) => {
    try {
      return { success: setRegistryPinned(projectPath, Boolean(pinned)) }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('project:registry-forget', async (_event, projectPath: string) => {
    try {
      const removed = removeRegistryEntry(projectPath)
      // 同步清理最近项目记录，避免两处列表不一致
      removeRecentProjectByPath(projectPath)
      return { success: removed }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('project:registry-refresh', async (_event, projectPath: string) => {
    try {
      // 只有当前打开的项目能读到库统计；其他项目仅刷新路径有效性
      const current = getCurrentProjectPath()
      if (current && isSamePath(canonicalizePath(current), canonicalizePath(projectPath))) {
        refreshRegistryEntry(current)
      }
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
}
