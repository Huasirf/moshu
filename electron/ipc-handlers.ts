import { ensureMoshuHome, MOSHU_HOME } from './utils/config-utils'
import { migrateLegacyGlobalHome } from './utils/legacy-migration'

import { registerConfigController } from './controllers/config-controller'
import { registerProjectController } from './controllers/project-controller'
import { registerFSController } from './controllers/fs-controller'
import { registerLLMController } from './controllers/llm-controller'
import { registerDatabaseController } from './controllers/db-controller'
import { registerKBController } from './controllers/kb-controller'
import { registerImportController } from './controllers/import-controller'
import { registerImageController } from './controllers/image-controller'

/**
 * 注册所有 IPC 通道 — 在主进程启动时调用
 * (采用多控制器路由模式，解耦各个模块的庞大逻辑)
 */
export function registerIPCHandlers() {
  // 存量全局配置：~/.vela → ~/.moshu（复制不移动，必须在 ensureMoshuHome 之前）
  migrateLegacyGlobalHome()
  // 确保全局配置目录结构存在
  ensureMoshuHome()

  // 挂载控制器路由
  registerConfigController()
  registerProjectController()
  registerFSController()
  registerLLMController()
  registerDatabaseController()
  registerKBController()
  registerImportController()
  registerImageController()

  console.log(`[MoShu IPC] 所有 Controller 已注册完成 | 全局工作区: ${MOSHU_HOME}`)
}
