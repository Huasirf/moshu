/**
 * 项目登记表（~/.moshu/projects.json）
 *
 * 与「最近项目」的区别：
 * - recent-projects.json 只记录最近打开过的路径，用于快速回访；
 * - 本表是项目管理的主数据源，保存题材、章数、进度、字数、置顶、封面色等元信息。
 *
 * 只由主进程在创建 / 打开 / 保存 / 定稿时增量刷新，渲染进程不能直接写文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import { MOSHU_HOME, readJsonFile, writeJsonFile } from './config-utils'
import type { ProjectRegistryEntry } from '../../src/shared/ipc-channels'

export type { ProjectRegistryEntry } from '../../src/shared/ipc-channels'

export const PROJECT_REGISTRY_PATH = path.join(MOSHU_HOME, 'projects.json')

const COVER_COLORS = [
  '#7EC8E3', '#9B8EC8', '#C9A76C', '#6FBF8E',
  '#D98C8C', '#8CA9D9', '#B48CC9', '#7FA6A0',
]

function coverColorFor(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return COVER_COLORS[hash % COVER_COLORS.length]
}

function normalizePath(p: string): string {
  return process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p)
}

export function loadRegistry(): ProjectRegistryEntry[] {
  const list = readJsonFile<ProjectRegistryEntry[]>(PROJECT_REGISTRY_PATH, [])
  if (!Array.isArray(list)) return []
  return list.filter((e): e is ProjectRegistryEntry => typeof e?.path === 'string' && e.path.length > 0)
}

function saveRegistry(list: ProjectRegistryEntry[]): void {
  writeJsonFile(PROJECT_REGISTRY_PATH, list)
}

/** 读接口：给每条补 missing 标记，并把置顶 / 最近打开排在前面 */
export function listRegistry(): ProjectRegistryEntry[] {
  return loadRegistry()
    .map((e) => ({ ...e, missing: !fs.existsSync(e.path) }))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return (b.lastOpenedAt || '').localeCompare(a.lastOpenedAt || '')
    })
}

/** 新增或更新一条（按路径匹配），未提供的字段保留原值 */
export function upsertRegistryEntry(input: Partial<ProjectRegistryEntry> & { path: string }): ProjectRegistryEntry {
  const target = normalizePath(input.path)
  const list = loadRegistry()
  const index = list.findIndex((e) => normalizePath(e.path) === target)
  const now = new Date().toISOString()
  const prev = index >= 0 ? list[index] : null
  const name = input.name ?? prev?.name ?? path.basename(input.path)
  const entry: ProjectRegistryEntry = {
    id: prev?.id ?? input.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    path: input.path,
    genre: input.genre ?? prev?.genre ?? '',
    totalChapters: input.totalChapters ?? prev?.totalChapters ?? 0,
    draftedCount: input.draftedCount ?? prev?.draftedCount ?? 0,
    wordCount: input.wordCount ?? prev?.wordCount ?? 0,
    lastOpenedAt: input.lastOpenedAt ?? prev?.lastOpenedAt ?? now,
    createdAt: prev?.createdAt ?? input.createdAt ?? now,
    pinned: input.pinned ?? prev?.pinned ?? false,
    coverColor: prev?.coverColor ?? input.coverColor ?? coverColorFor(name),
  }
  if (index >= 0) list[index] = entry
  else list.unshift(entry)
  saveRegistry(list)
  return entry
}

export function removeRegistryEntry(projectPath: string): boolean {
  const target = normalizePath(projectPath)
  const list = loadRegistry()
  const next = list.filter((e) => normalizePath(e.path) !== target)
  if (next.length === list.length) return false
  saveRegistry(next)
  return true
}

export function setRegistryPinned(projectPath: string, pinned: boolean): boolean {
  const target = normalizePath(projectPath)
  const list = loadRegistry()
  const entry = list.find((e) => normalizePath(e.path) === target)
  if (!entry) return false
  entry.pinned = pinned
  saveRegistry(list)
  return true
}
