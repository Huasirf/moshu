# 墨枢 · 时间线与规则模块使用说明（AI 版）

> 读者：在墨枢平台内执行写作/审稿任务的 AI 代理，以及需要按规范录入数据的人类用户。
> 目标：让 AI 明确「时间线与规则数据长什么样、怎么写入、写完后会被怎样注入到提示词」，避免误填与误判。
> 版本：数据库 `user_version=6`（新增 `rule_items` / `rule_snapshots` / `blueprint_timeline_events` / `project_timeline_config`）。

---

## 0. 一句话理解

- **规则条目库**决定「AI 必须遵守什么」，编译成规则原文，按三层预算注入。
- **章纲时间线**决定「事情按什么次序、在什么时间发生」，按「前情 / 本章计划 / 后续三章」注入。
- 两者都**不写进正文**，只作为上下文参考；正文里需要体现时由模型自行遵守。

---

## 1. 快速上手（人类 3 分钟）

1. 打开项目 →「章纲」编辑器 → 顶部工具栏点「时间线」。
2. 左栏选章节 → 中栏「添加事件」→ 填**绝对时间 + 事件摘要**（其余可选）。
3. 用 ↑ ↓ 调整次序 → 点「保存」。
4. 右栏填写全书通用的历法/纪元/流速 → 点右栏「保存」。
5. 生成或审稿时无需额外操作，系统自动注入。

---

## 2. 模块与入口

| 模块 | 界面入口 | 数据表 | 主要用途 |
|---|---|---|---|
| 时间线管理器 | 章纲编辑器工具栏「时间线」 | `blueprint_timeline_events` / `project_timeline_config` | 设计章纲时同步录入事件次序与时间 |
| 结构化规则条目 | 设定页 → 规则区（默认「结构化条目」） | `rule_items` / `rule_snapshots` | 把大段规则拆成可编号、可分层的条目 |
| 规则原文视图 | 设定页 → 规则区「原文视图」 | `project_core.rulebook` | 兼容旧数据的编译结果，可读但**不参与条目更新** |
| 审稿合规 | 审稿报告面板 | `review_findings` | 数值闸 + 逐条勾选结果按规则编号展示 |

---

## 3. 数据模型与字段规范

### 3.1 时间线事件 `TimelineEvent`

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `chapterNumber` | number | 是 | 所属章节，调用时由参数传入 |
| `seq` | number | 是 | 本章内事件次序，从 1 递增；保存时按数组顺序自动重排 |
| `sceneIndex` | number | 否 | 关联的场景序号，默认 0（当前 UI 固定 0，保留给未来场景级拆分） |
| `storyTime` | string | 否 | **设定内时间**，给人/模型读，如「第一日辰时」 |
| `absoluteTime` | string | 建议 | **可比较时间**，仅此字段参与校验，见 3.2 |
| `duration` | string | 否 | 持续时长，如「一个时辰」，防止模型把瞬间写成数日 |
| `location` | string | 否 | 地点，用于空间连续性 |
| `participants` | string[] | 否 | 参与者姓名，应与角色卡姓名完全一致 |
| `summary` | string | **是** | 一句话：谁在何时何地做了什么、结果如何；为空则拒绝保存 |
| `ruleRefs` | string[] | 否 | 涉及的规则编号，如 `["R-1-1","R-2-4"]` |

### 3.2 `absoluteTime` 可解析语法（校验用）

只有以下三类能转成数值参与比较：

```
纯数字     1      1.25       （推荐：第几天 + 小数表示当天先后，1.25 ≈ 第一天下午）
天数       第3天    第12日
日期       2026-03-01       2026年3月1日
```

- 其它写法（「很久以前」「某日黄昏」）**不报错、不参与比较**，只作为展示。
- 推荐全书统一使用「相对天数」，跨章连续时最不容易出错。

### 3.3 全局时间设定 `TimelineConfig`

| 字段 | 示例 | 注入位置 |
|---|---|---|
| `calendar` | `一年十二月，一月三十日，一日十二时辰` | 时间线参考首段 |
| `eraStart` | `天元三年春` | 渲染为「纪元起点：…」 |
| `timeFlow` | `闭关三年压缩为一章` | 渲染为「流速：…」 |
| `notes` | `回忆段落须在摘要标注「回忆」` | 直接拼接 |

四个字段任一非空才会输出 `【时间设定】` 段落。

### 3.4 规则条目 `RuleItem`

| 字段 | 说明 |
|---|---|
| `code` | **稳定编号** `R-组序-组内序`（如 `R-2-4`=第2组第4条），正文与审稿按它引用。新建时留空，后端自动分配 |
| `group` | 分组名，如「力量体系」「禁忌」「行文」 |
| `title` | 一句话标题，进入硬规则摘要 |
| `body` | 规则正文，越具体越好（数值、例外条件、判定方式） |
| `severity` | `hard`（必须遵守，永远注入） / `soft`（风格建议，按相关度注入） |
| `tags` | 关键词标签，用于提高 L2 命中率 |
| `active` | 是否启用；停用条目不参与注入与校验 |
| `sort` | 排序，保存时按数组顺序写入 |

快照 `RuleSnapshotMeta`：`{ id, hash, chars, itemsCount, createdAt }`，每次保存自动生成，最多保留 30 份。

---

## 4. 保存与校验语义

### 4.1 时间线保存

- **按章覆盖**：`db:timeline-events-save(chapter, events)` 会先删除该章旧事件，再按数组顺序写入并重排 `seq`。
- 数组顺序即事件顺序，前端用 ↑ ↓ 调整。
- 切换章节时若有未保存修改，UI 提示「丢弃并切换」。
- 事件 `summary` 为空时前端拒绝保存并提示具体第几条。

### 4.2 校验规则 `db:timeline-validate()`

| 级别 | 条件 | 建议处理 |
|---|---|---|
| `error` | **同章内**后一事件 `absoluteTime` < 前一事件 | 调整次序或修正绝对时间 |
| `warning` | **跨章**：本章首事件 < 上一章末事件 | 若为回忆/倒叙，请在 `summary` 明确写「回忆」「倒叙」；否则修正 |

- `absoluteTime` 为空或不可解析 → 跳过比较，不产生问题。
- 警告不阻断保存，仅提示；错误也不会阻断保存，但会在顶部红色横幅持续显示。

### 4.3 规则保存

- `db:rule-items-save(items)`：覆盖式保存全部条目 → 自动编译为 `rulebook` 文本写回 `project_core` → 生成快照。
- 保存后返回 `compiled`，前端用它同步「原文视图」，保证项目保存时一致。
- `db:rule-items-seed(rulebook)`：仅在条目库为空时可用，按空行分组 + 编号解析把旧规则拆成条目；已有条目时不会重复解析。
- `db:rule-snapshot-restore(id)`：恢复条目并重新编译，返回 `items` 与 `compiled`。
- 「原文视图」的手工修改**不会同步条目库**；生成/审稿只认条目库。AI 应始终通过条目接口写入。

---

## 5. 注入契约（AI 实际会收到什么）

### 5.1 时间线参考块（`db:timeline-context(chapter)` 原样注入）

```
【时间设定】历法；纪元起点：…；流速：…；备注…

【前情时间线（已发生）】
  [第N章]设定内时间 地点·事件摘要
  ……（最多取本章之前 12 个事件）

【本章时间线（计划，必须按此次序与时间发生）】
  1. [设定内时间] 地点·事件摘要
  2. ……

【后续章节计划（不得提前发生）】
  [第N章]设定内时间 事件摘要
```

- 三个段落都可能为空；第 1 章没有「前情」属正常。
- 生成（`generate-draft`）与审稿（`review-chapter`）都会调用；日志分别打印 `⏳ 时间线参考：N 字`。
- 模型应据此：**保持事件次序、不得把后续章节事件提前、回忆段落显式标注**。

### 5.2 规则三层注入（`buildRulebookInjection`）

| 层 | 内容 | 预算 | 说明 |
|---|---|---|---|
| L1 | 所有 `hard` 条目：编号 + 标题 + 正文首句 | ≤ 2500 字 | **全部链路必注入**，超出时按顺序截断并在末尾注明 |
| L2 | 与本章关键词命中的条目全文 | ≤ 5000 字 | 命中数排序；无命中且空间不足时不展开 |
| L3 | 未展开条目：编号 + 标题 | ≤ 1200 字 | 让模型知道规则边界，避免编造 |

- 关键词来源：本章蓝图标题、`keyEvents`、出场角色、场景文本。
- 统计信息会写入日志：`📜 规则注入：x/y 条（硬规则 h 条，未展开 o 条）`。
- 取消旧的「9000 字硬截断」；超预算只影响 L2/L3，L1 硬规则优先。

### 5.3 审稿逐条勾选（`buildRuleComplianceSection`）

审稿时在规则区追加要求，模型必须在 JSON 顶层输出：

```json
{
  "rule_verdicts": [
    { "rule_code": "R-1-1", "verdict": "pass", "quote": "", "reason": "未越界" },
    { "rule_code": "R-2-1", "verdict": "violation", "quote": "他到了 12 级", "reason": "突破上限" },
    { "rule_code": "R-3-1", "verdict": "unclear", "quote": "", "reason": "正文未提及其代价" }
  ]
}
```

- 每条硬规则必须出现一条记录，不得省略。
- `violation` → 台账 `error`，`unclear` → `warning`，`pass` 不落台账。
- 类别格式 `规则合规 · R-x-y`，审稿面板按类别排序时优先展示。
- 兼容中文判定词：`通过` / `违规` / `fail`。

### 5.4 数值闸（程序化，零模型成本）

从硬规则正文解析上下限，直接在正文里比对：

- 上限关键词：`不得超过 / 不能超过 / 不超过 / 不得高于 / 不得多于 / 至多 / 最多 / 上限(为|是|值) / 封顶`
- 下限关键词：`不得少于 / 不低于 / 至少 / 最少 / 下限(为|是) / 保底`
- **必须带计量单位**才参与比较（级/层/阶/个/人/次/年/月/天/岁/% 等），无单位不判断，避免误报。
- 生成后自动跑一次轻量审计，仅打印日志不阻断；审稿时结果直接落台账（`stage=rule-compliance`）。

---

## 6. AI 操作协议（IPC 契约）

所有调用经 `window.moshuAPI.invoke(channel, ...args)`；参数个数必须与下表一致。

| Channel | 参数 | 返回 |
|---|---|---|
| `db:timeline-events-get` | `[chapterNumber]` | `TimelineEvent[]`（按 seq 升序） |
| `db:timeline-events-all` | `[limit?=500]` | `TimelineEvent[]`（按章、seq 升序） |
| `db:timeline-events-save` | `[chapterNumber, events[]]` | `{ success, events?, error? }` |
| `db:timeline-config-get` | `[]` | `TimelineConfig` |
| `db:timeline-config-save` | `[config]` | `TimelineConfig`（增量合并，未传字段保持原值） |
| `db:timeline-validate` | `[]` | `TimelineIssue[]` |
| `db:timeline-context` | `[chapterNumber]` | `string`（即 5.1 的参考块） |
| `db:rule-items-list` | `[]` | `RuleItem[]` |
| `db:rule-items-save` | `[items[]]` | `{ success, items?, compiled?, error? }` |
| `db:rule-items-seed` | `[rulebook?]` | `{ success, items?, compiled?, error? }` |
| `db:rule-snapshot-list` | `[limit?]` | `RuleSnapshotMeta[]` |
| `db:rule-snapshot-get` | `[id]` | `RuleSnapshotFull \| null` |
| `db:rule-snapshot-restore` | `[id]` | `{ success, items?, compiled?, error? }` |

**AI 写时间线的标准顺序**

1. `db:timeline-events-get(chapter)` 读取现状；
2. 按新顺序组装完整数组（不要只发增量；该接口是覆盖式）；
3. `db:timeline-events-save(chapter, events)`；
4. `db:timeline-validate()` 复查；
5. 若日志出现 `⏳ 时间线参考`，说明注入已生效。

**AI 写规则的标准顺序**

1. `db:rule-items-list()`；
2. 修改目标条目（新增条目 `code` 留空，`sort` 用数组下标）；
3. `db:rule-items-save(items)`；
4. 用返回的 `compiled` 校验原文视图；需要回滚时先 `db:rule-snapshot-list` 再 `db:rule-snapshot-restore(id)`。

---

## 7. 填写范式

### 7.1 好例子

```
#1 storyTime=第一日辰时  absoluteTime=1      location=试炼塔一层
   duration=一个时辰     participants=[商临野]
   ruleRefs=[R-1-1]     summary=商临野误入试炼塔，被迫接受初阶考核。

#2 storyTime=第一日午时  absoluteTime=1.25   location=试炼塔二层
   duration=半日         participants=[商临野,试炼官]
   ruleRefs=[R-2-4]     summary=试炼官宣布隐藏规则，商临野选择硬闯。
```

### 7.2 坏例子与后果

| 写法 | 后果 |
|---|---|
| `absoluteTime=很久以前` | 不参与校验，跨章时间漂移无法被发现 |
| 同章两条都是 `absoluteTime=1` | 不报错（相等不算倒退），但先后关系模糊，模型可能写乱序 |
| `summary` 为空 | 前端拒绝保存 |
| 参与者写昵称「小商」 | 与角色卡不一致，模型可能当成另一个角色 |
| 规则正文写「寿命不能太长」 | 无数值无数值闸，也无法逐条判定是否违规 |
| 回忆段落未标注 | 触发跨章 `warning`，且模型可能误解为时间线错误 |

---

## 8. 常见问题

**Q：不填 `absoluteTime` 可以吗？**
可以。但该事件不参与校验，且跨章提示失效；推荐至少填相对天数。

**Q：一章多个场景怎么拆？**
当前 UI 按章录入事件，`sceneIndex` 固定 0。多场景请拆成多条事件并用 ↑ ↓ 排序；后续若开放场景级拆分，可写 `sceneIndex`。

**Q：修改章纲后时间线会变吗？**
不会自动同步，两者独立存储；章纲改动后需手动回到「时间线」调整。

**Q：规则条目删了，旧正文会怎样？**
正文不受影响；后续生成/审稿不再注入该条。历史快照仍保留，可回滚。

**Q：为什么 `db:rule-items-seed` 没反应？**
条目库已有数据时该接口直接返回，不会覆盖；需要重新拆分请先手工删除条目或回滚快照。

**Q：审稿提示「硬规则无法判定」？**
说明正文缺少可核对信息。按 `reason` 补齐场景细节，或把该规则降为 `soft`。

---

## 9. 变更与兼容

- 项目内部目录由 `.vela` 迁移为 `.moshu`，数据库由 `vela.db` 改为 `moshu.db`；**复制不移动**，原目录保留可回退。
- 全局配置目录 `~/.vela` → `~/.moshu`，采用「逐项补齐缺失文件」，不会覆盖 `~/.moshu` 已存在的配置。
- 旧项目的规则原文在打开项目时自动解析为结构化条目；原文仍完整保存在 `rulebook` 字段。
- 迁移失败（目标库为空或复制异常）会自动回退到旧目录与旧库，不影响打开。

---

## 10. AI 自检清单

生成前：
- [ ] 本章事件是否有 `summary`，且顺序符合章纲？
- [ ] 本章事件 `absoluteTime` 是否单调不减？
- [ ] 跨章首事件是否早于上章末（若有，摘要是否标注回忆/倒叙）？
- [ ] 规则区是否存在 `severity=hard` 但正文没有数值/判定方式的条目？

生成后：
- [ ] 日志是否出现 `📜 规则注入`、`⏳ 时间线参考`、`🧭 世界观切片`？
- [ ] 是否出现 `⚠️ 规则数值闸` 提示？

审稿后：
- [ ] `rule_verdicts` 是否覆盖全部硬规则？
- [ ] `violation` 是否同时产生 `items` 中的 `error`？
- [ ] `unclear` 的 `reason` 是否写明缺失信息？
