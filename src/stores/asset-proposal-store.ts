import { create } from 'zustand'
import type { CharacterData } from '../../electron/repositories/character-repository'

/** 拆书推断出的、需要人工确认的产物（DR-06） */
export interface AssetProposal {
  /** 世界观 / 架构文本 */
  world: string
  premise?: string
  synopsis?: string
  /** 角色卡（含文本关系描述） */
  characters: CharacterData[]
  /** 小说配置中与世界观相关的字段 */
  novelConfig?: Record<string, string>
}

type Decision = 'apply' | 'skip'

interface AssetProposalState {
  proposal: AssetProposal | null
  resolver: ((decision: Decision) => void) | null
  /** 展示确认框并等待用户决定 */
  request: (proposal: AssetProposal) => Promise<Decision>
  /** 由 UI 调用：用户选择后落定 */
  settle: (decision: Decision) => void
}

export const useAssetProposalStore = create<AssetProposalState>()((set, get) => ({
  proposal: null,
  resolver: null,

  request: (proposal) => new Promise<Decision>((resolve) => {
    // 同一时刻只允许一个确认（工作流串行执行）
    get().resolver?.(('skip'))
    set({ proposal, resolver: resolve })
  }),

  settle: (decision) => {
    const { resolver } = get()
    set({ proposal: null, resolver: null })
    resolver?.(decision)
  },
}))
