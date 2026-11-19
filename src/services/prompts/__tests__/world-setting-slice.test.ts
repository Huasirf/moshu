import { describe, expect, it } from 'vitest'
import { buildWorldSettingSlice } from '../world-setting-slice'

const WORLD = `## 一、世界总览
### 1. 试炼星
体积是蓝星的百倍，重力三倍。
### 5. 试炼颜色与类型总表
| 白色 | 启蒙级 | 死亡率 <10% |
| 黑色 | 死斗 | 99.9% |
---
## 二、等级与属性体系
### 1. 四维属性与等级线
F级最高项≥100，E级≥300。
### 2. 1/4铁律
最低单项不得低于最高单项的25%。
### 3. 心识派生
脑域=心识/10000；精神力上限=心识×10。
---
## 三、闯入规则
### 1. 独立一人队
无组队契约时按一人队结算。
---
## 四、月供
F1/E2/D4。
【人物与势力】
## 一、男主
这是很长的人物势力段，不应该整段进入切片。
【关卡体系】
## 一、关卡命名体系
命名规则。
## 二、10张关卡卡
### 关卡1：零号基准矩阵（开篇）
*   **颜色档次**：黑色 · F级实例
*   **类型**：单人极限机制考核
矩阵走廊按精神力活动系数施压。
### 关卡2：苍穹裁决王座
*   **颜色档次**：黑色
*   **类型**：单人跨族最终死斗
空池时轮空判胜。
### 关卡3：坠星磁暴峡谷
*   **颜色档次**：白色
*   **类型**：单人常规试炼
磁暴落雷与信标争夺。
## 三、试炼副本生成规则
### 4. 结算口径
白色4~6点，黑色100~160点。
### 关卡11：第七侦测星环
*   **颜色档次**：红色
`

describe('世界设定切片', () => {
  it('命中当前关卡卡时只带该卡与全局规则，不带人物势力长段', () => {
    const out = buildWorldSettingSlice(WORLD, {
      title: '禁区',
      keyEvents: '误入零号基准矩阵，末关进入苍穹裁决王座',
      scenes: [{ title: '空场', goal: '走过矩阵走廊', conflict: '', turn: '', props: [] }],
    })
    expect(out).toContain('零号基准矩阵')
    expect(out).toContain('苍穹裁决王座')
    expect(out).toContain('试炼颜色与类型总表')
    expect(out).toContain('1/4铁律')
    expect(out).toContain('结算口径')
    expect(out).not.toContain('很长的人物势力段')
  })

  it('没有命中具体关卡时只给索引，避免误用其他关卡机制', () => {
    const out = buildWorldSettingSlice(WORLD, {
      title: '破碎城',
      keyEvents: '进入废弃扇区地下管网，遭遇清道夫傀儡',
      scenes: [{ title: '管网', goal: '寻找落脚点', conflict: '', turn: '', props: [] }],
    })
    expect(out).toContain('本章未命中具体关卡卡')
    expect(out).toContain('关卡索引')
    expect(out).not.toContain('空池时轮空判胜')
  })

  it('总字数受 maxChars 约束', () => {
    const out = buildWorldSettingSlice(WORLD, { title: '零号基准矩阵' }, { maxChars: 3000 })
    expect(out.length).toBeLessThanOrEqual(3200)
  })
})
