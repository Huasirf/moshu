/**
 * asset-store — 资产库与属性定义的共享读缓存
 *
 * 资产库面板与现状面板共用同一份数据；按项目路径判断是否需要重新拉取。
 * 数据来自 P1 数据层 IPC：db:asset-list / db:attribute-def-list。
 */
import { create } from 'zustand'
import { ipc } from '../services/ipc-client'
import type { AssetData } from '../../electron/repositories/asset-repository'
import type { AttributeDef } from '../../electron/repositories/attribute-repository'

interface AssetState {
  assets: AssetData[]
  defs: AttributeDef[]
  loading: boolean
  error: string | null
  /** 已加载数据所属的项目路径，用于切换项目后自动失效 */
  loadedProject: string | null

  /** 加载资产与属性定义（同项目且已加载时跳过，force 强制刷新） */
  load: (projectPath: string, force?: boolean) => Promise<void>
  reset: () => void
}

export const useAssetStore = create<AssetState>()((set, get) => ({
  assets: [],
  defs: [],
  loading: false,
  error: null,
  loadedProject: null,

  load: async (projectPath, force = false) => {
    const state = get()
    if (!force && state.loadedProject === projectPath) return
    set({ loading: true, error: null })
    try {
      const [assets, defs] = await Promise.all([
        ipc.invoke('db:asset-list'),
        ipc.invoke('db:attribute-def-list'),
      ])
      set({ assets, defs, loading: false, loadedProject: projectPath })
    } catch (e) {
      set({ loading: false, error: String(e) })
    }
  },

  reset: () => set({ assets: [], defs: [], loading: false, error: null, loadedProject: null }),
}))
