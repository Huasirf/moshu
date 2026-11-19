/**
 * 旧版目录迁移（Vela → 墨枢 MoShu）
 *
 * 只做「复制不移动」：旧目录原样保留，迁移失败可立刻回退。
 * - 全局：~/.vela → ~/.moshu
 * - 项目：{项目}/.vela → {项目}/.moshu，库文件 vela.db → moshu.db
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const LEGACY_VELA_HOME = path.join(os.homedir(), '.vela')
export const LEGACY_PROJECT_DIR = '.vela'
export const LEGACY_DB_NAME = 'vela.db'
export const DB_NAME = 'moshu.db'

/**
 * 递归复制目录。
 * 注意：不能用 fs.cpSync —— Electron 41 的 native 实现在含中文的项目路径下会
 * 抛 `length_error ... basic_string` 直接把主进程/worker 打崩（已实测）。
 * 这里用 readdir + copyFile 的纯 JS 实现，行为一致且稳定。
 */
function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(from, to)
    } else if (entry.isSymbolicLink()) {
      try { fs.symlinkSync(fs.readlinkSync(from), to) } catch { /* 无法重建链接时跳过 */ }
    } else if (entry.isFile()) {
      fs.copyFileSync(from, to)
    }
  }
}

/**
 * 全局配置目录迁移：把 ~/.vela 中缺失的条目复制到 ~/.moshu。
 *
 * 不能只在「~/.moshu 不存在」时迁移：应用启动早期（或旧版代码）可能已经创建了
 * ~/.moshu/logs 这类空目录，此时整目录复制会被跳过，models.json 等配置就丢了。
 * 因此改为「逐项补齐」：目标已存在的条目一律不动，只复制缺失的。
 */
export function migrateLegacyGlobalHome(): void {
  const target = path.join(os.homedir(), '.moshu')
  if (!fs.existsSync(LEGACY_VELA_HOME)) return
  try {
    fs.mkdirSync(target, { recursive: true })
    let copied = 0
    for (const entry of fs.readdirSync(LEGACY_VELA_HOME, { withFileTypes: true })) {
      const from = path.join(LEGACY_VELA_HOME, entry.name)
      const to = path.join(target, entry.name)
      if (fs.existsSync(to)) continue
      if (entry.isDirectory()) copyDir(from, to)
      else if (entry.isFile()) fs.copyFileSync(from, to)
      copied++
    }
    fs.writeFileSync(path.join(target, '.migrated-from-vela'), new Date().toISOString(), 'utf-8')
    if (copied > 0) console.log(`[MoShu] 已补齐全局配置目录 ${copied} 项: ${LEGACY_VELA_HOME} → ${target}`)
  } catch (e) {
    console.warn('[MoShu] 全局配置目录迁移失败，继续使用旧目录内容:', e)
  }
}

/**
 * 项目内部目录迁移：.moshu 不存在而 .vela 存在时复制，并把库文件改名为 moshu.db。
 * 成功返回 true；失败返回 false（调用方可回退直接用 .vela）。
 */
export function migrateLegacyProjectDir(projectPath: string): boolean {
  const legacyDir = path.join(projectPath, LEGACY_PROJECT_DIR)
  const targetDir = path.join(projectPath, '.moshu')
  if (fs.existsSync(targetDir) || !fs.existsSync(legacyDir)) return true
  try {
    copyDir(legacyDir, targetDir)
    // 主库与 WAL/SHM 一并改名
    for (const suffix of ['', '-wal', '-shm']) {
      const from = path.join(targetDir, LEGACY_DB_NAME + suffix)
      if (fs.existsSync(from)) fs.renameSync(from, path.join(targetDir, DB_NAME + suffix))
    }
    const dbPath = path.join(targetDir, DB_NAME)
    if (fs.existsSync(dbPath) && fs.statSync(dbPath).size === 0) {
      throw new Error('迁移后的数据库文件为空')
    }
    fs.writeFileSync(path.join(targetDir, '.migrated-from-vela'), new Date().toISOString(), 'utf-8')
    console.log(`[MoShu] 已迁移项目目录: ${legacyDir} → ${targetDir}`)
    return true
  } catch (e) {
    try { fs.rmSync(targetDir, { recursive: true, force: true }) } catch { /* 忽略 */ }
    console.warn('[MoShu] 项目目录迁移失败，将回退使用 .vela:', e)
    return false
  }
}
