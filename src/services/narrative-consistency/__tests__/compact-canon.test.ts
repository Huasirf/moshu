import { describe, expect, it } from 'vitest'
import { renderCompactCanonContext } from '../context-builder'
import type { CanonContext } from '../types'

function makeCanon(): CanonContext {
  return {
    worldRules: '世界规则'.repeat(600),
    characterArch: '人物图谱'.repeat(600),
    characterStates: [
      {
        character: '商临野', location: '地下管网', powerLevel: 'F级', physicalState: '轻伤', mentalState: '冷静',
        keyItems: '识幔臂甲', currentGoal: '找落脚点', knowledge: [], relationships: {}, recentEvents: '进入破碎城', updatedAtChapter: 5, updatedAt: '',
      },
      {
        character: '苏清寒', location: '北境', powerLevel: 'D级', physicalState: '健康', mentalState: '平静',
        keyItems: '剑', currentGoal: '修炼', knowledge: [], relationships: {}, recentEvents: '未登场', updatedAtChapter: 0, updatedAt: '',
      },
    ],
    timeline: Array.from({ length: 12 }, (_, i) => ({
      chapterNumber: i + 1, sequence: 1, characters: ['商临野'], location: `地点${i + 1}`,
      timeFlow: 'sequential' as const, summary: `事件${i + 1}`, impact: '',
    })),
    recentChapterSummaries: '【第1章 禁区】\n摘要1\n\n【第2章 弱者的特权】\n摘要2\n\n【第3章 破局】\n摘要3',
    longTermSummary: '远期记忆'.repeat(200),
    openPlotLines: [
      { name: '破界之瞳', status: 'active', startedAt: 1, lastAdvancedAt: 4, characters: ['商临野'], currentState: '缺碎晶', description: '' },
      { name: '已解决线', status: 'resolved', startedAt: 1, lastAdvancedAt: 2, characters: [], currentState: '', description: '' },
    ],
    chapterGoal: '第6章',
    knownFacts: Array.from({ length: 15 }, (_, i) => ({ category: 'world' as const, statement: `事实${i + 1}`, introducedAt: i + 1, characters: [] })),
    previousEnding: '',
    ragContext: '',
    writingStyle: '',
    globalGuidance: '',
    hardConstraints: '硬性约束',
    meta: { chapterNumber: 6, builtAt: '', ragSources: 0 },
  }
}

describe('Compact Canon', () => {
  it('只保留出场角色、最近时间线与最近摘要，并受总字数约束', () => {
    const out = renderCompactCanonContext(makeCanon(), { focusCharacters: ['商临野'] })
    expect(out).toContain('商临野')
    expect(out).not.toContain('苏清寒')
    expect(out).not.toContain('事件1（地点1）')
    expect(out).toContain('事件12')
    expect(out).not.toContain('摘要1')
    expect(out).toContain('摘要3')
    expect(out).not.toContain('已解决线')
    expect(out).toContain('事实15')
    expect(out.length).toBeLessThanOrEqual(7100)
  })

  it('焦点角色为空时保留全部角色状态', () => {
    const out = renderCompactCanonContext(makeCanon())
    expect(out).toContain('商临野')
    expect(out).toContain('苏清寒')
  })
})
