# 墨枢 MoShu · AI 开发更改计划（执行版）

> 本文件是交给 AI 执行的唯一主计划。设计类问题不在本文件里现编，而是按 §2 的「决策请求包」外送强模型，回流后登记为决策记录（DR）再执行。

---

## 0. 基线事实（写计划时已核实）

| 项 | 值 |
|---|---|
| 工作区 | `F:\MoShu` |
| 上游 | `https://github.com/zhangzhuowei/vela.git`（origin 与 upstream 同源） |
| 基线 commit | `60fbb0c4` · 2026-10-04 · `fix: 开发服务预构建不再扫进单测` |
| 相对旧仓库基线 | 多 13 个提交、211 文件、+11575 / −2193（已快进合并） |
| 包管理器 | pnpm（lockfileVersion 9.0，CI 固定 pnpm 10；本机 pnpm 12 会警告 `electron-winstaller` 构建脚本被忽略，非阻塞） |
| 验证命令 | `pnpm run typecheck` / `pnpm run test` / `pnpm run lint` / `pnpm dev` |
| 旧仓库未合并改动 | 已备份到 `_legacy/local-changes.patch`（58 文件，+2942 / −835）与 `_legacy/status.txt` |
| 未跟踪源码 8 个 | `review-result.ts` 已被上游吸收；其余 7 个仍为独有（见 §4.1） |
| 测试基线（2026-10-21 实测） | 37 个测试文件：36 通过 / 1 失败；412 用例：410 通过 / 1 失败 / 1 跳过。唯一失败为上游自带 `electron/__tests__/rehearsal-provider.test.ts:35`（`done` 回调多传一个 `undefined`），与本仓库改动无关，记入 `docs/plan/test-baseline.md` 待修 |

上游这一版新增的关键能力（计划必须在其上叠加，不要重复造）：

- `src/services/agent/story-revision-service.ts` + `StoryRevisionHistory.tsx`：`revise_story` 版本化修订（已是你需要的「改正文并留痕」）
- `src/services/story-rehearsal.ts`、`rehearsal-stream.ts`、`StoryRehearsalDialog.tsx`：剧情试演
- `src/services/narrative-consistency/arc-summary.ts` + `canon_arc_summaries` 表：跨卷摘要
- `src/services/timeline-view.ts`、`SearchView.tsx`、`TimelineView.tsx`：时间线与检索视图
- `electron/db-backup.ts`、`db-auto-backup.ts`、`path-guard.ts`、`ipc-sender-guard.ts`、`model-store.ts`（safeStorage 加密密钥）、`ollama-models.ts`
- `src/services/workflows/model-chain.ts`、`retry-policy.ts`、`standalone-llm.ts`：LLM 收口已拆分
- `electron/repositories/chapter-search-repository.ts`、`rehearsal-repository.ts`、`story-revision-repository.ts`

数据库现状（`electron/database.ts`，已核实）：`blueprints` 仍只有 `chapter_number/title/role/purpose/key_events/characters/suspense_hook/user_guidance/notes/notes_updated_at`，**没有 `asset_refs`、`scenes_json`、`words_target`、`status`、`beat_tags`**；不存在 `attribute_defs`、`attribute_values`、`entity_relations`、`review_findings`、`chapter_pipeline`、`style_profiles`。

---

## 1. 硬约束（任何阶段都不得违反）

1. **契约只加不改**：IPC channel、`window.velaAPI` 方法名、DB 表名/列名不改；新能力一律新增方法/新增列。
2. **迁移只做加法**：所有 schema 变更走 `migrateSchema()`（补列）或 `migrateProjectDatabase()`（版本号迁移），禁止重建表、禁止删列、禁止在迁移里丢数据；迁移必须幂等（连跑两次不报错）。
3. **LLM 单一收口**：所有模型调用只能走 `BaseWorkflowCommand` / `standalone-llm.ts`（重试、模型链、取消、记账都在那里）；禁止在组件、tool、store 里直接发请求。
4. **分层不倒退**：L0 组件 → L1 store → L2 service → L3 electron；禁止 L2 反向 import L1，主进程不写业务编排。
5. **i18n 三语同步**：新增文案必须同时在 `zh-CN/en/ru` 三份 JSON 里出现，否则 `i18n.test.ts` 会失败。
6. **品牌层已改、数据层不改**：应用名已是「墨枢 MoShu」（`package.json name=moshu`、`appId=com.moshu.ide`、`productName=墨枢`、窗口与 i18n 标题）。`~/.vela`、项目内 `.vela/`、`vela://`、`velaAPI` 一律保留，保证旧项目与已配置的模型 Key 可直接用。

---

## 2. 协作机制：谁设计、谁执行

### 2.1 分工

| 类型 | 归属 | 例子 |
|---|---|---|
| 架构/协议/信息架构/提示词体系设计 | 强模型（Kimi K3 等） | 中控 AI 的 Plan schema 粒度、资产库表结构取舍、审稿维度权重、去味规则体系 |
| 按既定规格写代码、迁移、测试、重构、修 bug | DeepSeek 执行 | 加表加列、加 Repository、加 IPC、写单测、改 UI 组件 |

**执行方不得自行决定设计问题**：遇到 §5 清单里的问题，先按「默认方案」占位并打 `TODO(DR-编号)` 注释，等 DR 回流后替换。

### 2.2 决策请求包（外送强模型的固定格式）

```
【背景】墨枢是本地优先的 AI 长篇小说 IDE（Electron+React+SQLite+LanceDB），
       代码基线 60fbb0c4，中控 AI 通过工具调用改项目数据。
【已核实事实】<只写能在代码里指出文件/行的事实，不要推测>
【约束】<引用 §1 硬约束中相关的条目；给出不可变接口>
【候选方案】A: …（说清代价） B: …（说清代价） C: 不做
【待决问题】1) … 2) …（最多 3 个，每个必须是可判定的）
【期望输出】按「决定 / 理由 / 影响的文件与函数 / 迁移与回滚 / 验收用例」五段输出
【禁止】不要给出完整代码，只给结构、字段、契约与判定规则
```

回流后立即落盘为 `docs/decisions/DR-<编号>-<短名>.md`，正文五段照抄，末尾附「执行任务卡」链接。

### 2.3 决策台账

- 编号从 `DR-01` 起，`docs/decisions/INDEX.md` 维护一张表：编号 / 主题 / 状态（待决/已决/已实现）/ 影响阶段。
- 一个请求包只含一个决策点；跨决策的合并请求会被退回。

---

## 3. 阶段划分

```
P0 基线归位 ──► P1 数据层（资产库/现状/流水线表） ──► P2 中控 AI（Plan 协议 + 工具收敛）
                                                   └─► P3 章节流水线 + 审稿闸门
                                                   └─► P4 编辑器体验 + 去味规则引擎
```

排序理由：P1 是所有功能的地基（没有 `asset_refs` 就谈不上「大纲引用资产」）；P2 依赖 P1 的表与 Repository；P3 依赖 P2 的写回与 P1 的 `review_findings`；P4 只改视图层，可随时插队。

### 3.0 进度快照（2026-10-21，P6 收口）

| 阶段 | 状态 | 已落地内容 | 与计划的偏差 |
|---|---|---|---|
| P1 数据层 | 已完成 | schema v1→v2（非计划中的 v3）；新增 `attribute_defs`/`attribute_values`/`entity_relations`/`review_findings`/`chapter_pipeline`/`style_profiles` 六表；6 个 Repository；30 个 `db:` 频道；资产库与现状面板；`asset_refs` 注入写作 prompt | ① 版本号实际是 v1→v2；② `canon_items` 在 v0→v1 已建，资产库复用该表并补 `entity_type`/`type_data_json`，未另建 `assets` 表 |
| P2 中控 AI | 已完成 | `MutationPlan` 协议与校验、只读工具 5 个、写入工具收紧、`apply_mutation_plan` 工具、确认卡片 diff+逐条勾选、技能路由 8 项、大纲 stale 联动、单事务执行层 | 执行层放在主进程 `electron/services/mutation-plan-executor.ts`（计划原写 `src/services/agent/`），因为渲染进程无事务能力；工具层只负责透传计划与 `skipStepIds` |
| P3 章节流水线 | 已完成（P3-1~P3-7） | schema v2→v3（新增 `canon_item_events`）；`checkStageTransition` 阶段守卫；规则审稿 5 类检查 + LLM 13 维合并去重；跨章关系审稿；定稿闸门（error 阻断 / warning 显式豁免）；`p1_writeback` 单事务写回；幂等用例 | ① `entity_relations` 写回缺结构化来源，暂 `TODO(DR-08)` 预留；② 阶段回退已在 P7-2 落地（`db:pipeline-rewind`） |
| P4 体验与去味 | 已完成（P4-5 已由 P8-2 补齐） | `src/services/style/rules.ts` 7 类规则 + 自定义规则 + 三档阈值；风格档案 CRUD/注入/抽取沉淀；大纲树视图（ARC_SIZE 分卷 + stale 高亮 + 节拍/场景）；资产详情显示大纲出现章节 | ① 正文实测出现章节已在 P5-3 补齐；② 拆书世界观产物随 P8-2 分层确认落地 |
| P5 功能补齐 | 已完成 | 审稿台账抽屉（`finding-scope` 统一口径、按 draftId 过滤、严重度分组、证据定位、标记 fixed/ignored）；`REVIEW_FINDINGS_UPDATED` 事件；章节阶段胶囊（大纲树 + 编辑器头部，定稿/审稿事件刷新）；资产详情「正文出现」（全文搜索 + 打开正文并定位首次命中） | 大纲/资产蓝图出现点击仍按上游语义打开整本蓝图编辑器（`ChapterCardEditor` 无外部选中入口，见 DR-09） |
| P6 体验收口 | 已完成 | EditorArea 重型编辑器 `React.lazy` + Suspense 骨架屏；Vite 8 / rolldown 函数式 `manualChunks`（react / i18n / CodeMirror 核心 / Radix 四个稳定 chunk，语言包保留动态加载）；全局 `prefers-reduced-motion` 与 `:focus-visible`；`--color-surface-hover` 笔误修正 | CodeMirror 核心仍是编辑器静态依赖；i18n 资源约 403KB 未按语言拆分 |
| P7 初步可用 | 已完成 | 端到端冒烟用例（蓝图→草稿→去味→审稿→定稿→写回→重启校验）；阶段回退一步（二次确认 + 下游 stale）；模型未配置引导条；批量生成/自动审校沿用现有入口与取消能力 | 真实模型冒烟待用户配置 API；生成/审稿失败可直接重新点击入口重试，未新增独立重试按钮 |
| P8 体验增强 | 已完成 | DR-09 `focusChapter` 定位；DR-06 拆书产物分层确认（世界观/人物/关系人工，大纲/节拍自动）；i18n 按语言动态加载（首屏仅中文）；EPUB 导出与备份入口沿用上游能力 | docx 导出未新增（EPUB 已满足「至少一种」）；CodeMirror 仅用 Markdown，无额外语言包可拆 |

已定稿决策：DR-01（实体级步骤）、DR-02（复用 `canon_items`）、DR-03（保留 7 段；允许回退一步 + N+1..N+5 标 stale）、DR-04（仅 3 类 error）、DR-05（内置规则 + 风格档案 + LLM 兜底）、DR-06（分层确认：世界观/人物/关系人工，章节大纲/节拍自动）、DR-07（N+1..N+5 区间）、DR-08（仅写显式结构化关系）、DR-09（P8 增加 `focusChapter`）。

**验证基线（2026-10-21 P6 收口）**：`typecheck` / `lint` 零错误；`test` 453 通过、1 跳过、1 失败为上游既存用例 `electron/__tests__/rehearsal-provider.test.ts`（`strips an orphan thinking prefix split across streamed chunks`，与墨枢改动无关）；`vite build` 通过，CodeMirror 核心 chunk 444KB（gzip 143KB）、React 212KB、i18n 404KB，编辑器均按需加载。

**验证基线（2026-10-21 P8 收口）**：`typecheck` / `lint` 零错误；`test` 455 通过、1 跳过、1 失败仍为上述上游既存用例；`vite build` 通过，i18n 主 chunk 降至 112KB（gzip 41KB），en / ru 各自成动态 chunk（`editors/pages/panels/commands/...`）。注意：`pnpm run build` 末尾的 electron-builder 会为 Electron ABI 重编 `better-sqlite3`，之后再跑 vitest 会报 `NODE_MODULE_VERSION` 不匹配；验证顺序应先 `pnpm run test`，或重编后再测试（`pnpm rebuild better-sqlite3`）。真实模型冒烟需要用户配置 API 后进行。

### 3.3 P7 / P8 落地说明（2026-10-21）

| 编号 | 落地内容 | 关键文件 |
|---|---|---|
| P7-1 | 新增无模型端到端冒烟用例，覆盖蓝图、草稿、去味、审稿台账、定稿、P1 写回与重启持久化 | `electron/__tests__/p7-e2e-smoke.test.ts` |
| P7-2 | `PipelineRepository.rewind` + `db:pipeline-rewind`（旧阶段乐观校验、只退一步）；DraftEditor 阶段胶囊旁新增「回退一步」二次确认，成功后把 N+1..N+5 标 stale；warning 豁免沿用定稿确认框 | `pipeline-repository.ts`、`DraftEditor.tsx`、`ipc-channels.ts` |
| P7-3 | 批量生成、自动审校沿用 `BatchGenerateDialog` / BottomPanel 的进度与取消；失败策略可选停止或继续 | 既有组件，无契约变更 |
| P7-4 | 欢迎页新增「尚未配置模型」提示与「去配置模型」主行动；新建/导入/最近项目保持 | `WelcomePage.tsx` |
| P8-1 | `editor-store.pendingChapterFocus` + `focusChapter/clearChapterFocus`；大纲树与资产详情点击蓝图章节时定位到对应章 | `editor-store.ts`、`ChapterCardEditor.tsx`、`OutlineTreeView.tsx`、`AssetDetailDialog.tsx` |
| P8-2 | 导入拆书在世角色卡/世界观写入前弹出确认框；跳过时仅保留章节大纲与节拍；关系仍只随角色卡文本保存（DR-08） | `asset-proposal-store.ts`、`AssetProposalDialog.tsx`、`import-novel.command.ts` |
| P8-3 | i18n 重构为中文同步 + en/ru 动态加载，首屏不再加载其余语言；语言切换自动补载 | `src/i18n/index.ts`、`src/main.tsx` |
| P8-4 | EPUB 导出与数据库备份沿用上游入口，已验证可用；未新增 docx | 既有能力 |

### 3.1 P7 · 初步可用（已批准，按序执行）

| 编号 | 任务 | 涉及文件 | 验收 |
|---|---|---|---|
| P7-1 | 端到端冒烟：新建项目→配模型→章节卡→生成→去味→审稿→台账修复→定稿写回→导出；逐段修断点 | 现有命令/组件；必要时补事件与错误态 | 一条链路无报错，重启后阶段/台账/正文状态保留 |
| P7-2 | 流程兜底：阶段回退一步（二次确认 + 下游 stale）、warning 显式豁免入口、生成/审稿失败重试 | `pipeline-repository`、`finalize-writeback`、`DraftEditor`、`ChapterCardEditor` | 失败有提示可重试；可回退一步；warning 可在定稿弹窗豁免 |
| P7-3 | 批量与自动审校入口回归：多章生成、自动审校循环、进度与取消 | `batch-chapter.command`、`auto-review-loop.command`、工作流面板 | 多章可跑、进度可见、可停止、失败不阻塞其余章 |
| P7-4 | 首次使用引导：空项目引导、模型未配置提示、示例项目入口 | `WelcomePage`、`HomeSidebarPanel`、设置页 | 未配模型有可点击引导；空书架有「新建/导入」主行动 |

### 3.2 P8 · 体验增强（P7 完成后）

| 编号 | 任务 | 验收 |
|---|---|---|
| P8-1 | DR-09：`editor-store.focusChapter` + `ChapterCardEditor` 选中章节；大纲/资产点击直达 | 点击章节打开并定位到对应章 |
| P8-2 | DR-06：拆书产物分层确认，补 P4-5 世界观产物 | 世界观/人物/关系需确认；大纲/节拍自动入大纲 |
| P8-3 | i18n 按语言拆分、CodeMirror 语言包按需加载 | 首屏不再加载其余语言资源 |
| P8-4 | 导出与备份：docx/epub 至少一种可用，备份策略可见 | 能导出完整书稿；备份目录可见 |

### 3.4 上游 Vela API 配置复用验证（2026-10-22）

结论：**可直接复用，无需重新配置**。

| 验证项 | 结果 |
|---|---|
| 配置目录 | `electron/utils/config-utils.ts` 的 `VELA_HOME` 固定为 `~/.vela`，与 `app.getPath('userData')`、应用名无关；改名后仍读取原目录 |
| 文件与字段 | `~/.vela/models.json`、`config.json` 的 `ModelProfile` / `defaultModelId` / `embeddingModelId` 结构未变；旧字段（如 `purposes`）原样保留 |
| 现有配置 | 已读取到 3 条：DeepSeek、Gemini（中转）、Ollama；默认模型与嵌入模型均指向有效项 |
| 密钥形态 | 两条在线 Key 为明文 `apiKey`（无 `apiKeyEnc`），无需 safeStorage 解密；首次读取会按上游逻辑迁移为密文并保留 `.bak` |
| 连通性 | 实际请求 `GET /models`：DeepSeek 返回 `deepseek-flash / deepseek-v4-pro`；Gemini 中转返回模型列表，均 HTTP 200 |
| 加密存储场景 | 若历史配置是 `apiKeyEnc`，Windows 下 safeStorage 走 DPAPI（按用户而非按应用隔离），同用户仍可解密 |

因此 P7-1 的「真实模型冒烟待用户配置」已解除阻塞：直接启动应用即可沿用原 Key。
未纳入现有计划的可选项（非阻塞）：批量流水线的「暂停待人工」策略、docx 导出。

### 3.5 桌面启动入口（2026-10-22）

- 桌面快捷方式：`启动 墨枢（含本地向量服务）.lnk`，图标取 `build/icon.ico`。
- 启动脚本：[scripts/start-moshu.ps1](file:///f:/VelaPro/scripts/start-moshu.ps1)，流程：
  1. 检查 `node_modules`，缺失时自动 `pnpm install`
  2. 若 `better-sqlite3` 能在 Node 下加载（Node ABI），自动 `pnpm run rebuild` 切到 Electron ABI
  3. 启动或复用 `F:\ollama` 的 Ollama（127.0.0.1:11434），检查 `bge-m3`
  4. `pnpm dev` 启动 Vite + Electron；关闭墨枢窗口后 Vite 退出、脚本收尾并停掉自己拉起的 Ollama
- 可选参数：`-VerifyOnly`（只自检服务与 1024 维向量）、`-SkipRebuild`（跳过 ABI 检查）、`-KeepOllama`（退出后保留 Ollama）。
- 已验证：窗口标题 `墨枢 MoShu — AI 小说创作 IDE` 正常打开；`bge-m3` 向量维度 1024；关闭窗口后 Ollama 与 Electron 进程均已清理。
- 注意：启动器会把 `better-sqlite3` 编成 Electron ABI；随后跑 `pnpm run test` 前需执行 `pnpm rebuild better-sqlite3` 切回 Node ABI（启动器下次会再切回 Electron）。

### P0 · 基线归位（必须先做）

| 编号 | 任务 | 类型 | 涉及文件 | 验收 |
|---|---|---|---|---|
| P0-1 | 建立 `docs/decisions/`、`docs/plan/`，写 `docs/decisions/INDEX.md` 空表 | 执行 | 新建 | 目录存在 |
| P0-2 | 修掉 `ERR_PNPM_IGNORED_BUILDS`（pnpm 12 不读 `package.json` 的 `pnpm.onlyBuiltDependencies`，改放 `pnpm-workspace.yaml` 或 `.npmrc`） | 执行 | `pnpm-workspace.yaml` / `.npmrc` | `pnpm install` 退出码 0 |
| P0-3 | 全量测试基线：跑 `pnpm run test`，把失败用例记成 `docs/plan/test-baseline.md` | 执行 | 新建 | 有清单，知道哪些失败是上游自带 |
| P0-4 | 旧改动分诊（§4.1）：7 个独有文件逐个比对上游实现，判定「移植 / 丢弃 / 已被替代」 | 执行+判断 | `_legacy/local-changes.patch` | `docs/plan/legacy-triage.md` 完成 |
| P0-5 | 确认自动备份生效：`finalize` 前是否触发 `db-auto-backup`，没触发就补 | 执行 | `electron/db-auto-backup.ts`、`finalize-chapter.command.ts` | 定稿后 `.vela/backups/` 有新文件 |

**P0 完成定义（DoD）**：typecheck / lint / test 三条命令全部通过（或有明确的上游既存失败清单）；`pnpm dev` 能启动到欢迎页；分诊表完成。

### P1 · 数据层：资产库 + 现状 + 流水线表

**迁移 v3（幂等、加法）**，落在 `migrateProjectDatabase()` 的 `currentVersion < 3` 分支：

```sql
-- 1) 蓝图层补字段
ALTER TABLE blueprints ADD COLUMN asset_refs    TEXT NOT NULL DEFAULT '[]';
ALTER TABLE blueprints ADD COLUMN scenes_json   TEXT NOT NULL DEFAULT '[]';
ALTER TABLE blueprints ADD COLUMN words_target  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE blueprints ADD COLUMN status        TEXT NOT NULL DEFAULT 'planned';
ALTER TABLE blueprints ADD COLUMN beat_tags     TEXT NOT NULL DEFAULT '';

-- 2) 资产库：复用 canon_items 做「资产总表」，用 entity_type 区分类型
ALTER TABLE canon_items ADD COLUMN entity_type    TEXT NOT NULL DEFAULT 'item';
ALTER TABLE canon_items ADD COLUMN type_data_json TEXT NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_canon_items_type ON canon_items(entity_type, status);

-- 3) 属性系统（现状面板的存储底座）
CREATE TABLE IF NOT EXISTS attribute_defs (
  key TEXT PRIMARY KEY, entity_type TEXT NOT NULL DEFAULT 'character',
  label TEXT NOT NULL, value_type TEXT NOT NULL CHECK (value_type IN ('number','enum','text')),
  enum_values_json TEXT NOT NULL DEFAULT '[]', unit TEXT NOT NULL DEFAULT '',
  min_value REAL, max_value REAL, show_in_panel INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS attribute_values (
  entity_id TEXT NOT NULL, attr_key TEXT NOT NULL, chapter_number INTEGER NOT NULL,
  phase TEXT NOT NULL DEFAULT 'after' CHECK (phase IN ('before','after')),
  num_value REAL, text_value TEXT, delta_num REAL,
  source TEXT NOT NULL DEFAULT '', source_event_id INTEGER,
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (entity_id, attr_key, chapter_number, phase)
);

-- 4) 关系网
CREATE TABLE IF NOT EXISTS entity_relations (
  from_id TEXT NOT NULL, to_id TEXT NOT NULL, relation_type TEXT NOT NULL,
  affection INTEGER DEFAULT 0, status TEXT DEFAULT 'active',
  since_chapter INTEGER DEFAULT 0, last_changed_chapter INTEGER DEFAULT 0,
  note TEXT DEFAULT '', updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (from_id, to_id, relation_type)
);

-- 5) 审稿台账
CREATE TABLE IF NOT EXISTS review_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT, chapter_number INTEGER NOT NULL,
  draft_id TEXT DEFAULT '', stage TEXT NOT NULL, category TEXT NOT NULL,
  severity TEXT NOT NULL, message TEXT NOT NULL, evidence TEXT DEFAULT '',
  location_hint TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_review_findings_ch ON review_findings(chapter_number, status);

-- 6) 章节流水线状态机
CREATE TABLE IF NOT EXISTS chapter_pipeline (
  chapter_number INTEGER PRIMARY KEY,
  stage TEXT NOT NULL DEFAULT 'planned',
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 7) 风格档案
CREATE TABLE IF NOT EXISTS style_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 0, rules_json TEXT NOT NULL DEFAULT '[]',
  prompt_hint TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT (datetime('now'))
);
```

`stage` 全值：`planned | drafted | deaiified | reviewed | approved | finalized | writeback_done`。
`asset_refs` 结构：`[{ "type":"character|item|location|skill|faction|secret|number", "id":"12", "expect":"appear|enter|acquire|lose|use|consume|conflict|resolve|mention" }]`。

| 编号 | 任务 | 类型 | 涉及文件 | 验收 |
|---|---|---|---|---|
| P1-1 | 迁移 v3 | 执行 | `electron/database.ts` | 新旧库连跑两次无错；单测 `database-migration.test.ts` 增用例 |
| P1-2 | `asset-repository.ts`：按 entity_type 读写，带 type_data 校验 | 执行 | `electron/repositories/` | CRUD 单测 |
| P1-3 | `attribute-repository.ts`：defs/values 的按章读写与 delta 累加 | 执行 | 同上 | 「第 5 章体质 +2，第 6 章读回」用例通过 |
| P1-4 | `relation-repository.ts`、`pipeline-repository.ts`、`style-repository.ts` | 执行 | 同上 | 各 1 组单测 |
| P1-5 | Controller + IPC + preload 类型（全部新增 channel） | 执行 | `electron/controllers/`、`src/shared/ipc-channels.ts`、`electron/preload.ts` | `pnpm run typecheck` 通过 |
| P1-6 | 现状面板（只读先行）：按 `attribute_defs.show_in_panel` 渲染，点击跳资产详情 | 执行 | `src/components/panels/`、新 store | 手工冒烟：改一条属性值，面板刷新 |
| P1-7 | 资产库列表页：8 分类筛选 + 详情抽屉 | 执行 | `src/components/panels/` | 手工冒烟 |

**P1 DoD**：旧项目库（`f:\Vela` 下的真实小说）能被新版本打开且数据不丢；新表全部有读写路径；`asset_refs` 能从 blueprint 读出并在生成时注入 prompt（先只注入不校验）。

### P2 · 中控 AI：Plan → Preview → Confirm → Act（已完成 2026-10-21）

目标：让「一个全局 AI」能听懂「把第 3 章主角改成断臂，后面的设定跟着改」，生成结构化改动计划，用户确认后一次事务落库。

| 编号 | 任务 | 类型 | 涉及 |
|---|---|---|---|
| P2-1 | 定义 `MutationPlan`（`src/shared/mutation-plan.ts`）：`intent / steps[] / touched_entities / affected_chapters / risk / needs_confirm` | 需 DR-01 定稿 | shared |
| P2-2 | `plan-executor.service.ts`：把 plan steps 映射为已有 tool 调用序列，单事务执行，失败整体回滚 | 执行 | `src/services/agent/` |
| P2-3 | Agent 系统提示词加「先出 Plan 再动手」段；写入类动作强制走 Plan | 执行 | `src/services/agent/context-builder.ts` |
| P2-4 | 新增只读工具：`read_assets`、`read_character_state`、`read_relations`、`read_pipeline`、`read_review_findings` | 执行 | `src/services/agent/tools/` |
| P2-5 | 收紧现有写入工具：`write_file` 对 `.vela/` 与 DB 路径拒绝；`update_config` 限定白名单键 | 执行 | 同上 |
| P2-6 | 大纲联动修改：改第 N 章 → 把 N+1..M 的 blueprint `status='stale'` → 单章刷新（复用 `refresh-blueprint.command.ts`），不整卷重写 | 需 DR-07 | `src/services/workflows/` |
| P2-7 | Skill 路由表（8 个）：写正文/改正文/改大纲/设角色/设资产/审稿/拆书/世界观 | 需 DR-02 | `src/services/agent/skill-registry.ts` |
| P2-8 | 确认卡片：Plan 以 diff 形式展示（改哪个文件哪个字段，前值→后值），可逐条勾选 | 执行 | `src/components/panels/agent/ConfirmCard.tsx` |

**P2 DoD**：一句自然语言要求 → 出 Plan（含受影响章节列表）→ 用户确认 → 数据按预期变化 → 再问「现在主角什么状态」能读回新值；未确认时数据库零改动。

### P2.5 · 收口验证（进入 P3 之前，必做）

P2 各模块单测已绿，但计划生成 → 卡片确认 → 事务执行是一条跨进程链路，尚缺端到端证据。

| 编号 | 任务 | 执行方式 | 验收 |
|---|---|---|---|
| P2.5-1 | 端到端冒烟：自然语言 → Plan → 卡片 diff → 取消部分步骤 → 执行 → 读回 | `pnpm dev` 手工 + 现有 `apply_mutation_plan` 工具 | 只写入勾选步骤；未勾选步骤零改动；拒绝时数据库零改动 |
| P2.5-2 | `skipStepIds` 透传回归 | 已完成：`src/services/agent/__tests__/apply-mutation-plan.test.ts` 5 用例 | 断言 `db:mutation-plan-execute` 收到 `skipStepIds`；代码走查已确认 `toolCallInfo.arguments` 与 `tc.arguments` 同一引用 |
| P2.5-3 | 流水线阶段推进守卫 | 并入 P3-1 | 未 `deaiified` 不允许 `reviewed`；`set_pipeline_stage` 走同一守卫 |

### P3 · 章节流水线 + 审稿闸门

| 编号 | 任务 | 状态 | 涉及 |
|---|---|---|---|
| P3-1 | `chapter_pipeline` 状态机与推进守卫（未 `deaiified` 不允许 `reviewed`） | 已完成：`checkStageTransition` + `PipelineRepository.setStage` 守卫 + 工作流 `advanceChapterStage` 逐步推进 | `src/shared/chapter-stage.ts`、`electron/repositories/pipeline-repository.ts`、`src/services/workflows/pipeline-stage.ts` |
| P3-2 | 规则审稿本地先行：禁用词表、视角越界（非 POV 角色内心）、道具未持有、地点冲突、时间倒流 | 已完成：5 类检查，纯函数无 DB 依赖 | `src/services/review/rule-review.ts` |
| P3-3 | LLM 审稿：13 维 → 生成 `review_findings`（严重度分级） | 已完成：规则发现 + LLM 发现证据级去重合并 | `src/services/review/finding-mapper.ts`、`review-chapter.command.ts` |
| P3-4 | 跨章审稿：对照 `canon_character_state` / `canon_items` / `entity_relations` | 已完成：关系 ID→名称解析后做同句敌对/正面词检查 | `consistency-gate.service.ts` |
| P3-5 | 闸门策略：`error` 阻断定稿，`warning` 需显式豁免 | 已完成：定稿前查 `review_findings(status='open')`，error 不可豁免 | `finalize-chapter.command.ts`、`DraftEditor.tsx` |
| P3-6 | 定稿写回：单事务写 `attribute_values` + `entity_relations` + `canon_item_events` + `chapter_pipeline='writeback_done'` | 已完成（按 DR-08 仅写显式结构化关系，抽取结果无关系变更时不写）：`p1_writeback` 步骤，失败整体回滚 | `electron/services/finalize-writeback.ts`、`item-event-repository.ts` |
| P3-7 | 幂等：同一章重复定稿不重复累加属性 | 已完成：属性值同键覆盖、道具事件按章先删后插 | `electron/__tests__/finalize-writeback.test.ts` |

**执行顺序（依赖）**：P3-1 →（P3-2 ∥ P3-3）→ P3-4 → P3-5 → P3-6 → P3-7。

- P3-1 同时承担 P2.5-3：在 `PipelineRepository.setStage`（或调用它的执行层）加入 `CHAPTER_STAGES` 顺序守卫，`mutation-plan-executor` 的 `set_pipeline_stage` 与工作流推进共用同一守卫。
- P3-2 / P3-3 先按 DR-04 默认方案推进：仅「道具未持有 / 视角越界 / 时间倒流」记 `error`，其余维度先记 `warning`。
- P3-6 定稿写回复用 P2-2 已建立的「主进程单事务 + Repository 收口」模式，不另起一套事务机制；写回失败必须整体回滚，阶段不得停在 `writeback_done`。
- P3-7 的幂等用例覆盖：同一章连续定稿两次，`attribute_values` 不重复累加。

**P3 DoD**：从「开写第 1 章」到「第 2 章开写」全流程跑通；第 2 章生成时 prompt 里能读到第 1 章写回的状态；故意写一个「用了没拿到的道具」，规则审稿必须拦住。

### P4 · 写作体验与去 AI 味

| 编号 | 任务 | 类型 | 涉及 |
|---|---|---|---|
| P4-1 | 去味规则引擎（本地可编辑规则 + 三档强度），复用 `deaify.command.ts` 的 `intensity` | 已完成：7 类规则 + 自定义规则 + 清洗前后预检 + `rule_findings` 提示词；规则编辑入口复用风格档案 `rules` | `src/services/style/rules.ts` |
| P4-2 | 风格档案 UI：从范文抽取（`analyze-style.command.ts`）→ 存 `style_profiles` → 写作时注入 | 已完成：设置页 CRUD/启用；抽取后同步档案；写稿与去味均注入 `promptHint` | `NovelConfigEditor.tsx`、`style-repository.ts` |
| P4-3 | 大纲树视图：卷/章/节拍三层，stale 节点高亮 | 已完成：按 `ARC_SIZE=10` 分卷，章节下展开节拍标签与场景 | `src/components/panels/sidebar/OutlineTreeView.tsx` |
| P4-4 | 资产详情 ↔ 正文双向跳转（当前持有物 → 资产详情 → 出现章节） | 已完成：资产详情显示大纲引用章节与正文实测出现章节，均可跳转定位 | `AssetDetailDialog.tsx` |
| P4-5 | 拆书导入管线补世界观产物（`import-novel.command.ts` → 世界观/势力/境界体系） | 已完成（P8-2）：世界观/人物写入前人工确认；势力/境界体系仍由导入 prompt 输出到架构文本 | workflows |

**P4 DoD**：去味前后差异可对比、可回滚；改一条风格规则立刻影响下一次生成。

---

## 4. 旧改动分诊（P0-4 的输入）

`_legacy/local-changes.patch` 里 58 个文件、+2942/−835。分诊规则：

1. 先看该文件在上游是否已被同名能力替代（如 `review-result.ts` 已存在）→ 丢弃本地版本。
2. 再看改动是否属于「修 bug / 数据安全」→ 优先移植（上游同类修复已合并的除外）。
3. 最后看是否属于「新功能」→ 进入对应阶段任务，不单独移植。

7 个仍独有、需要逐个判定的文件：

| 文件 | 初判 |
|---|---|
| `src/services/agent/tools/update-architecture.tool.ts` | 与 P2 写入工具收敛重叠，判定「改造后并入」 |
| `src/services/agent/tools/update-blueprint.tool.ts` | 同上，并入 P2-6 |
| `src/services/prompts/optional-sections.ts` | 提示词可选段落，P4 风格档案时评估 |
| `src/services/workflows/chapter-editing-context.ts` | 正文编辑上下文，与 P2-6 相关 |
| `src/services/workflows/generated-text.ts` | 生成文本清洗，与 P4 去味规则相关 |
| `src/services/workflows/__tests__/editing-workflows.test.ts` | 测试，随实现一起移植 |
| `src/services/prompts/__tests__/` | 测试，随实现一起移植 |

---

## 5. 待外送决策的问题清单（不阻塞执行）

每条都有「默认方案」，DR 未回流时按默认方案推进并打 `TODO(DR-xx)`。

| 编号 | 问题 | 默认方案 |
|---|---|---|
| DR-01 | `MutationPlan` 的步骤粒度：按「实体操作」还是按「文件操作」？ | 按实体操作（create_asset / update_asset / update_blueprint / update_relation），执行层再翻译成文件/DB |
| DR-02 | 资产库是复用 `canon_items` 加 `entity_type`，还是独立新表？ | 复用（迁移成本最低，历史事件链可直接用） |
| DR-03 | 章节状态机的阶段是否要合并（`deaiified` 可否与 `drafted` 合一）？ | 保留 7 段，方便断点续跑 |
| DR-04 | 审稿 13 维的权重与 `error/warning` 判定阈值 | 先全 `warning`，仅「道具未持有 / 视角越界 / 时间倒流」记 `error` |
| DR-05 | 去味规则是「正则黑名单」还是「LLM 判定 + 规则兜底」？ | 规则先行（可解释、零成本），LLM 兜底长句 |
| DR-06 | 拆书产物落到资产库的自动确认等级 | 一律 `pending` 待确认 |
| DR-07 | 大纲改动的影响范围：按「章节号区间」还是按「依赖图」？ | 先按区间 + 人工确认，依赖图留到有真实数据后再评估 |

---

## 6. 质量门禁与提交规范

每个阶段收尾必须依次通过：

```
pnpm run typecheck   # 0 error
pnpm run lint        # 0 warning（仓库配置 --max-warnings 0）
pnpm run test        # 全绿，或与 docs/plan/test-baseline.md 一致
pnpm dev             # 手工冒烟该阶段 DoD 里的两条路径
```

提交信息沿用仓库风格：`feat(scope): 中文描述` / `fix(scope): …` / `refactor(scope): …` / `chore(scope): …`。
一次提交只做一件事；迁移与代码分开提交（先迁移后可回滚）。

---

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| 上游继续更新，改动漂移 | 保留 `upstream` 远程；每阶段开始先 `git fetch upstream && git rebase upstream/master`，冲突按 §4 分诊规则处理 |
| 数据迁移不可逆 | 已有 `electron/db-auto-backup.ts`；迁移前强制备份，迁移后跑 `PRAGMA integrity_check` |
| 中控 AI 误改数据 | 写入必须 Plan + 确认；DB 写操作全部在主进程 Repository 收口，渲染进程无直连 |
| 大改动把可运行状态搞坏 | 每个阶段一个可运行里程碑；不做跨阶段的大爆炸式重构 |
| GPL-3.0 | 自用不分发，无额外义务；若将来分发，需开源或走 §GPL 决策树（见旧 Wiki `11-platform-strategy.md`） |

---

## 8. 下一步（按顺序，2026-10-21 修订）

1. **P2.5-1 端到端冒烟**：用 `pnpm dev` 走一遍「自然语言 → Plan → diff → 取消部分步骤 → 执行 → 读回」，确认 P2 DoD 的两条路径；同时补 P2.5-2 的 `skipStepIds` 透传单测。
2. **P3-1 状态机守卫**：先给 `PipelineRepository.setStage` 加阶段顺序校验（未 `deaiified` 不允许 `reviewed`），并把 `set_pipeline_stage` 执行分支接入同一守卫。
3. **P3-2 本地规则审稿**：禁用词表、视角越界、道具未持有、地点冲突、时间倒流，产出 `review_findings`（先按 DR-04 默认阈值）。
4. **P3-3 LLM 审稿**：13 维审稿接入 `review-chapter.command.ts`，与 P3-2 的规则发现合并去重。
5. **P3-4 → P3-5 → P3-6 → P3-7**：跨章一致性 → 闸门策略 → 单事务写回 → 幂等用例。
6. **P4** 可在 P3 任一里程碑后插队：优先 P4-3 大纲树（stale 高亮已就绪）与 P4-2 风格档案。
7. **外送 DR-03 / DR-04 / DR-05 / DR-06**：不阻塞执行，回流后替换默认方案并更新 `docs/decisions/INDEX.md`。
