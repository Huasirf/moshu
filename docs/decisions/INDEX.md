# 决策记录索引

设计类问题由强模型（Kimi K3 等）裁决，回流后在此登记；执行方按记录落地。
请求包格式见 `docs/dev-plan.md` §2.2。

| 编号 | 主题 | 关联阶段 | 状态 | 默认方案（未决时按此执行） |
|---|---|---|---|---|
| DR-01 | `MutationPlan` 步骤粒度 | P2 | 已定稿 | 按实体操作 |
| DR-02 | 资产库复用 `canon_items` vs 新表 | P1 | 已定稿 | 复用 + `entity_type` |
| DR-03 | 章节状态机阶段是否合并 | P3 | 已定稿 | 保留 7 段；允许回退一步（二次确认）并把 N+1..N+5 标 stale |
| DR-04 | 审稿维度权重与 error/warning 阈值 | P3 | 已定稿 | 仅 3 类记 error，其余 warning/info |
| DR-05 | 去味规则引擎形态 | P4 | 已定稿 | 内置规则先行 + 风格档案自定义规则 + LLM 兜底 |
| DR-06 | 拆书产物自动确认等级 | P4 | 已实现（P8-2） | 分层：世界观/人物/关系人工确认；章节大纲/节拍自动 |
| DR-07 | 大纲改动影响范围计算 | P2 | 已定稿 | N+1..N+5 stale + 人工确认 |
| DR-08 | 定稿写回时 `entity_relations` 的变更来源 | P3 | 已定稿 | 仅写显式结构化关系，不从正文猜测 |
| DR-09 | 点击大纲章节是否需要精确定位到该章 | P5 | 已实现（P8-1） | `editor-store` 增加 `focusChapter`，`ChapterCardEditor` 选中对应章 |
| DR-10 | UI 改版：主题策略与首页布局 | UI-1 | 已定稿 | dark 重做纯黑（#0A0A0B 系）并设默认，保留 galaxy/paper/light；AI/底部面板默认收起，任务 0→N 时自动打开底部任务页；布局经 zustand persist 持久化 |
| DR-11 | UI 改版：视觉风格 | UI-1 | 已定稿 | 对标 Trae/Codex：冷蓝单色强调（#4A9EFF），删除渐变/发光/玻璃拟态/缩放位移动效，按钮扁平化（hover 仅 brightness 变化） |
| DR-12 | 去 Vela 化范围 | UI-1 | 已定稿 | 用户可见品牌全部改墨枢/MoShu（标题栏、状态栏、AI 欢迎页、三语 i18n、Storybook）；删除打赏入口、About 区与 public/buyme；~/.vela、vela://、window.velaAPI、localStorage vela-* 等契约保留不动 |
