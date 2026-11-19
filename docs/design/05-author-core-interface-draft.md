# 独立作者核心与墨枢接口草案 v0.1

日期：2026-11-06。状态：设计草案，字段和路由均未实现。目标是允许作者核心独立培养、独立测量，之后由薄适配器接入墨枢原写稿链路。

## 1. 责任边界

墨枢持有作品数据、正式章纲、正文版本、生产审稿与定稿权。作者核心持有作者身份、学习材料、创作经验、实验快照和运行记录。

核心返回正文及可选的剧情提案，不直接写墨枢数据库，不把生成稿当成已发生事实，不推进墨枢章节状态。正式内容采纳仍走平台已有保存、版本检查、审稿和定稿入口。

每次写作固定作者快照、作品版本和输入内容。背景学习可以产生新快照，但不能中途改变正在生成的本章。

## 2. 最小公共类型

以下 TypeScript 是说明性合同，不是已经导出的 SDK。实际落地时由 JSON Schema 校验，避免只依赖 TypeScript 编译期类型。

```ts
type WriterOperation = 'draft_chapter' | 'draft_scene' | 'propose_outline';
type EvidenceKind = 'canon' | 'plan' | 'source_observation' | 'inference';

interface ContextItem {
  id: string;
  kind: EvidenceKind;
  text: string;
  sourceRef?: string;
  chapterNumber?: number;
  revision?: string;
}

interface ContextPackV1 {
  schemaVersion: 'author-context.v1';
  projectId: string;
  projectRevision: string;
  chapterNumber: number;
  chapterRevision: string;
  // 由平台声明可见的前情上界，核心不得读取越界作品记忆。
  canonThroughChapter: number;
  language: string;
  storyFacts: ContextItem[];
  characterStates: ContextItem[];
  previousEnding: string;
  blueprint: {
    title: string;
    purpose: string;
    events: string[];
    scenes?: Array<{
      id: string;
      goal: string;
      events: string[];
      targetCharacters?: number;
    }>;
    requiredEnding?: string;
  };
  // 下列计划仅用于防止提前兑现，不能作为角色已知事实。
  futurePlans?: ContextItem[];
  constraints: Array<{
    id: string;
    strength: 'hard' | 'soft';
    origin: 'project_rule' | 'chapter_contract' | 'current_instruction';
    text: string;
  }>;
  style: {
    revision: string;
    pointOfView: string;
    description: string;
    examples?: ContextItem[];
  };
  userInstruction: string;
  // 固定中文计数口径，禁止把 token、字、词混为一谈。
  length: {
    unit: 'non_whitespace_characters';
    min: number;
    target: number;
    max: number;
  };
  contextManifest: {
    suppliedIds: string[];
    omitted: Array<{ id: string; reason: string }>;
  };
}

interface WriterRequestV1 {
  schemaVersion: 'author-request.v1';
  requestId: string;
  idempotencyKey: string;
  authorId: string;
  snapshotId: string;
  operation: WriterOperation;
  learning: 'frozen' | 'record_after_completion';
  context: ContextPackV1;
  modelProfileId: string;
  budget: {
    maxModelCalls: number;
    maxOutputTokens: number;
    timeoutMs: number;
  };
}

interface WriterResultV1 {
  schemaVersion: 'author-result.v1';
  requestId: string;
  snapshotId: string;
  inputHash: string;
  projectRevision: string;
  chapterRevision: string;
  status: 'completed' | 'cancelled' | 'failed';
  prose?: string;
  proposals?: Array<{ id: string; title: string; content: string }>;
  // 表示实际读入并传给生成流程的项，不声称能证明模型心理上的“用过”。
  contextIdsSent: string[];
  memoryIdsRetrieved: string[];
  warnings: Array<{ code: string; message: string }>;
  artifacts: Array<{ id: string; kind: string }>;
  usage: {
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    modelCalls: number;
    durationMs: number;
  };
}
```

字数合同只是首个对齐方案：正式接入时应与墨枢现有计数口径统一并记录版本，不能让同一“2000 字”在核心和平台两侧得出不同结论。无法满足硬约束或预算时返回明确错误，不通过截断伪装成完整稿。

## 3. 异步任务与反馈

| 接口 | 用途 |
|---|---|
| `GET /v1/capabilities` | 协议版本、支持操作、素材读取能力、模型能力 |
| `POST /v1/author-snapshots` | 固定当前作者状态，返回不可变快照 ID |
| `POST /v1/writer-jobs` | 提交写作请求，返回任务 ID；真实运行前做合同检查 |
| `GET /v1/writer-jobs/{id}` | 查询状态、错误、完成结果 |
| `GET /v1/writer-jobs/{id}/events` | SSE 流式进度与正文片段；事件带递增序号，可重连 |
| `POST /v1/writer-jobs/{id}/cancel` | 幂等取消，禁止取消后再回写完成稿 |
| `POST /v1/feedback` | 接收墨枢审稿结果、用户修订和采纳决定 |
| `POST /v1/sources` | 提交网页/B站/文件素材，返回来源记录及实际读取覆盖 |
| `POST /v1/learning-jobs` | 独立学习、练习与经验提炼；与生产写稿分开预算 |

反馈至少包含 `feedbackId`、`requestId`、`artifactId`、`artifactHash`、来源类型、评价者、原文证据、问题范围、用户采纳/修改结果和时间。自动审稿意见、人类决定、模型自评具有不同身份；模型不能自行宣称“人类已采纳”。

来源类型建议：`human_decision`、`human_edit`、`platform_rule_finding`、`platform_llm_review`、`lab_blind_review`、`self_reflection`。客观规则修复与主观审美学习分开。例如“时间线错误”不推导为“作者应该写得更冷酷”。

## 4. 对齐规则

1. 项目隔离：检索必须带 `authorId`、项目/公共知识作用域及章节时间上界；小说 A 的既成事实不能污染小说 B。
2. 历史隔离：学习可参考其他作品的技法，但不能把未来章节正史泄漏进当前 POV 人物的知识。
3. 冲突先报：本章任务和世界规则冲突时，返回 `CONTEXT_CONFLICT`，列出约束 ID；不擅自选择一个“最高优先级”并暗改作品事实。
4. 单次稳定：所有场景生成、接缝续写、篇幅补足使用同一个快照和任务合同。
5. 幂等：相同幂等键和相同输入哈希返回原任务；相同键不同输入拒绝。重连和重试不能创建重复稿。
6. 并发：项目切换、章纲改变或正文已有新版本时，由墨枢拒绝覆盖；结果仍可保留为未采纳候选。
7. 流与完整稿分离：流式片段用于预览；只有完成结果可进入平台保存流程。截断、超时和取消不能当作完整稿。
8. 低副作用：后台学习不能自行改写平台章纲、正文或定稿状态；草稿生成也不自动使世界事实生效。
9. 模型明确：请求中选定模型配置；失败不暗换另一个模型，结果记录实际模型和版本信息（供应方提供时）。
10. 数据可迁移：事件、快照、素材来源、模型配置标识和训练集导出分开；Cookie/API Key 不进入导出。

独立服务默认只在本机回环地址监听，使用应用级凭证；凭证由连接器保存。MCP 可以在后期包裹这些能力供聊天 Agent 使用，但正文任务、进度、取消、反馈的公共合同不依赖 MCP 或 DSH。

## 5. 接入验收

- 没有启动墨枢时，核心可使用同格式的虚构 ContextPack 完成真实写作实验。
- 相同快照重放具有相同人格/记忆输入；不承诺随机模型输出逐字一致。
- 请求只改模型连接器即可比较不同基础模型，不迁移作品数据库。
- 主写稿、分场景和补足篇幅都使用相同合同；整章改写若尚未接入要明确展示范围。
- 取消、服务断开、输入冲突、超出输出上限、重复提交时旧稿完整。
- 墨枢继续运行已有审稿与定稿流程；反馈引用具体稿件版本。
- 能对比人格原稿与审稿后稿的风格差异，区分作者效果和后处理效果。
