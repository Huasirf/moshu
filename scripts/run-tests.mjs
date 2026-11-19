/**
 * 用 Electron 充当 Node 来跑 vitest。
 *
 * better-sqlite3 是按 Electron ABI 编译的，直接用本机 Node 加载会报
 * NODE_MODULE_VERSION 不匹配（Electron 41 = 145，Node 24 = 137）。
 * 设置 ELECTRON_RUN_AS_NODE=1 后由 Electron 自带运行时执行 vitest，
 * ABI 与磁盘上的二进制一致，不需要切换/重编原生模块，也不受应用正在运行的影响。
 *
 * 用法：
 *   node scripts/run-tests.mjs                    // 跑全部测试
 *   node scripts/run-tests.mjs electron/__tests__ // 只跑指定目录
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Node 里 require('electron') 返回可执行文件路径；electron 包被裁剪时会退回到 dist 目录
function resolveElectron() {
  try {
    const p = require('electron')
    if (typeof p === 'string' && fs.existsSync(p)) return p
  } catch { /* 忽略，走下面的兜底路径 */ }
  const fallback = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')
  if (!fs.existsSync(fallback)) throw new Error('找不到 Electron 可执行文件，请先安装依赖')
  return fallback
}

const vitest = path.join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs')
if (!fs.existsSync(vitest)) throw new Error('找不到 vitest，请先安装依赖')

const args = [vitest, 'run', ...process.argv.slice(2)]
const child = spawn(resolveElectron(), args, {
  cwd: projectRoot,
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
})
child.on('exit', (code) => process.exit(code ?? 1))
