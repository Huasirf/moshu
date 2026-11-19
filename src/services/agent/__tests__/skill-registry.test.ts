import { describe, it, expect } from 'vitest'
import {
  AGENT_SKILL_ROUTES,
  buildSkillRoutingPrompt,
  getAgentSkillRoute,
  matchAgentSkill,
} from '../skill-registry'

describe('技能路由表', () => {
  it('包含 8 个互不重复的技能', () => {
    expect(AGENT_SKILL_ROUTES).toHaveLength(8)
    expect(new Set(AGENT_SKILL_ROUTES.map(route => route.id)).size).toBe(8)
    expect(getAgentSkillRoute('edit-outline')?.name).toBe('改大纲')
  })

  it('按意图匹配到正确技能', () => {
    expect(matchAgentSkill('把第 3 章正文重写一下')?.id).toBe('revise-draft')
    expect(matchAgentSkill('给主角加一个道具：玄铁令')?.id).toBe('edit-asset')
    expect(matchAgentSkill('检查这一章有没有问题')?.id).toBe('review-chapter')
    expect(matchAgentSkill('世界观里的势力设定补一下')?.id).toBe('worldbuilding')
    expect(matchAgentSkill('帮我拆书，提取设定')?.id).toBe('book-breakdown')
    expect(matchAgentSkill('把后面的剧情调整一下')?.id).toBe('edit-outline')
    expect(matchAgentSkill('')).toBeNull()
    expect(matchAgentSkill('今天天气怎么样')).toBeNull()
  })

  it('命中技能时提示词带上允许工具与执行要点', () => {
    const prompt = buildSkillRoutingPrompt('续写第 5 章')
    expect(prompt).toContain('技能路由')
    expect(prompt).toContain('本轮识别技能：写正文')
    expect(prompt).toContain('set_pipeline_stage')
    expect(prompt).toContain('允许工具：')
  })

  it('只读技能不产生计划操作', () => {
    expect(getAgentSkillRoute('review-chapter')?.planOps).toEqual([])
    expect(getAgentSkillRoute('revise-draft')?.planOps).toEqual([])
  })
})
