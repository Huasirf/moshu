import { describe, it, expect } from 'vitest'
import { getPromptTemplate } from '../../prompt-templates'
import { ChapterPromptBuilder, truncateRulebook, truncateWorldSetting } from '../../prompts/prompt-builder'

const LONG_WORLD = [
  '## 一、世界总览',
  'A'.repeat(3000),
  '【人物与势力】',
  'B'.repeat(4000),
  '【关卡体系】',
  '### 关卡1：零号基准矩阵',
  'C'.repeat(12000),
  '## 三、试炼副本生成规则',
  'D'.repeat(6000),
].join('\n')

describe('世界设定注入', () => {
  it('两个章节模板都预留了 world_setting 占位符', () => {
    for (const key of ['first_chapter_draft', 'next_chapter_draft']) {
      const tpl = getPromptTemplate(key)
      expect(tpl, key).toBeTruthy()
      expect(tpl?.content || '', key).toContain('{{world_setting}}')
    }
  })

  it('长设定截断后保留关卡卡与副本规则，并省略重复的人物段', () => {
    const out = truncateWorldSetting(LONG_WORLD)
    expect(out).toContain('### 关卡1：零号基准矩阵')
    expect(out).toContain('试炼副本生成规则')
    expect(out).toContain('已省略')
    expect(out).not.toContain('B'.repeat(100))
  })

  it('Builder 会把世界设定真正渲染进最终 prompt', () => {
    const tpl = getPromptTemplate('first_chapter_draft')
    expect(tpl).toBeTruthy()
    const prompt = new ChapterPromptBuilder(tpl!).withWorldSetting(LONG_WORLD).build()
    expect(prompt).toContain('关卡1：零号基准矩阵')
    expect(prompt).not.toContain('{{world_setting}}')
  })
})

describe('规则区与章节命名规则注入', () => {
  it('写作/修稿/蓝图模板预留 rulebook，审稿模板预留 system_rules', () => {
    for (const key of [
      'first_chapter_draft',
      'next_chapter_draft',
      'refine_chapter',
      'refine_from_review',
      'refresh_chapter_blueprint',
    ]) {
      expect(getPromptTemplate(key)?.content || '', key).toContain('{{rulebook}}')
    }
    expect(getPromptTemplate('consistency_check')?.content || '').toContain('{{system_rules}}')
  })

  it('审稿模板包含规则合规与模板化描写维度，去味模板包含数字复读与体感堆叠', () => {
    const review = getPromptTemplate('consistency_check')?.content || ''
    expect(review).toContain('设定规则合规')
    expect(review).toContain('模板化与冗余表达')

    const deaify = getPromptTemplate('deaify_polish')?.content || ''
    expect(deaify).toContain('数字复读')
    expect(deaify).toContain('描写堆叠与套话')
  })

  it('4 个蓝图模板都包含章节命名规则', () => {
    for (const key of [
      'chapter_blueprint',
      'chapter_blueprint_chunk',
      'refresh_chapter_blueprint',
      'infer_single_chapter_blueprint',
    ]) {
      expect(getPromptTemplate(key)?.content || '', key).toContain('【章节命名规则（必须遵守）】')
    }
  })

  it('Builder 会把规则区渲染进最终 prompt，超长时截断', () => {
    const tpl = getPromptTemplate('first_chapter_draft')
    expect(tpl).toBeTruthy()
    const prompt = new ChapterPromptBuilder(tpl!).withRulebook('【规则区】属性只能通过结算增长').build()
    expect(prompt).toContain('属性只能通过结算增长')
    expect(prompt).not.toContain('{{rulebook}}')

    const long = truncateRulebook('A'.repeat(10000))
    expect(long.length).toBeLessThan(10000)
    expect(long).toContain('已省略')
  })
})
