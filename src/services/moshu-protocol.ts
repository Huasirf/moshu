/**
 * moshu-protocol — 统一管理 moshu:// 伪协议路径解析
 *
 * 所有 moshu:// 路径的常量映射和解析逻辑集中在此，
 * 新增架构字段或路径协议时只需修改此文件。
 */

import { ipc } from './ipc-client'

// ===== moshu://core/ 架构字段映射 =====

/** 路径 key → ProjectCoreData 中的驼峰字段名 */
export const CORE_FIELD_MAP: Record<string, string> = {
    premise: 'premise',
    worldbuilding: 'worldbuilding',
    characters: 'charactersArch',
    synopsis: 'synopsis',
}

/** 从 moshu://core/ 路径中解析出 DB 字段名 */
export function parseCoreField(moshuPath: string): string | null {
    if (!moshuPath.startsWith('moshu://core/')) return null
    const key = moshuPath.replace('moshu://core/', '')
    return CORE_FIELD_MAP[key] ?? null
}

/** 从 DB 读取 moshu://core/ 路径对应的内容 */
export async function readCoreContent(moshuPath: string): Promise<string> {
    const key = moshuPath.replace('moshu://core/', '')
    const core = await ipc.invoke('db:project-core-get')
    if (!core) return ''
    const fieldMap: Record<string, string> = {
        premise: core.premise || '',
        worldbuilding: core.worldbuilding || '',
        characters: core.charactersArch || '',
        synopsis: core.synopsis || '',
    }
    return fieldMap[key] || ''
}

/** 将内容写入 moshu://core/ 对应的 DB 字段 */
export async function writeCoreContent(moshuPath: string, content: string): Promise<boolean> {
    const dbField = parseCoreField(moshuPath)
    if (!dbField) return false
    const res = await ipc.invoke('db:project-core-update', { [dbField]: content })
    return res.success !== false
}

// ===== moshu://draft/ | moshu://revision/ | moshu://review/ 内容读取 =====

/** 读取 moshu:// 伪协议路径的内容（统一入口） */
export async function readMoshuContent(filePath: string): Promise<string> {
    if (filePath.startsWith('moshu://draft/') || filePath.startsWith('moshu://manuscript/')) {
        const prefix = filePath.startsWith('moshu://draft/') ? 'moshu://draft/' : 'moshu://manuscript/'
        const draftId = parseInt(filePath.replace(prefix, ''))
        const full = await ipc.invoke('db:draft-get-full', draftId)
        return full?.content ?? ''
    }

    if (filePath.startsWith('moshu://revision/')) {
        const revId = parseInt(filePath.replace('moshu://revision/', ''))
        const full = await ipc.invoke('db:revision-get-full', revId)
        return full?.content ?? ''
    }

    if (filePath.startsWith('moshu://review/')) {
        const revId = parseInt(filePath.replace('moshu://review/', ''))
        const full = await ipc.invoke('db:review-get-full', revId)
        return full?.content ?? ''
    }

    if (filePath.startsWith('moshu://core/')) {
        return readCoreContent(filePath)
    }

    console.warn('[readMoshuContent] 不支持的路径协议:', filePath)
    return ''
}

/** 判断路径是否为 moshu:// 伪协议 */
export function isMoshuProtocol(path: string): boolean {
    return path.startsWith('moshu://')
}
