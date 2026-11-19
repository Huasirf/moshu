/**
 * 墨枢 内置 Prompt 模板库
 *
 * 包含全流程创作所需的全部提示词模板
 * 支持三级覆盖：内置 → 全局自定义 → 项目级覆盖
 *
 * 架构生成 Prompt 来源于 AI_NovelGenerator 项目（经专业优化）
 */

import i18n from '../i18n'

export interface PromptTemplate {
  /** 模板唯一标识 */
  key: string
  /** 显示名称（i18n key: promptTemplates.{key}.name） */
  name: string
  /** 用途说明（i18n key: promptTemplates.{key}.description） */
  description: string
  /** 模板内容（支持 {{变量}} 插值）— 中文默认 */
  content: string
  /** 不可编辑的系统约束（输出格式、JSON schema 等），渲染时自动追加到 content 末尾 */
  systemSuffix?: string
  /** LLM system message 角色定位（由模板统一定义，command 不再硬编码） */
  systemRole?: string
  /** 可用变量列表 */
  variables: Record<string, string>
  /** Localized content overrides keyed by locale */
  contentLocalized?: Record<string, string>
  /** Localized systemRole overrides */
  systemRoleLocalized?: Record<string, string>
  /** Localized systemSuffix overrides */
  systemSuffixLocalized?: Record<string, string>
}

/** 获取翻译后的模板名称 */
export function getPromptName(key: string): string {
  return i18n.t(`promptTemplates.${key}.name`, { ns: 'settings' })
}

/** 获取翻译后的模板描述 */
export function getPromptDescription(key: string): string {
  return i18n.t(`promptTemplates.${key}.description`, { ns: 'settings' })
}

/** Получить локализованное содержимое промпта */
export function getLocalizedContent(template: PromptTemplate): string {
  const lang = i18n.language
  return template.contentLocalized?.[lang] || template.contentLocalized?.[lang.split('-')[0]] || template.content
}

/** Получить локализованную системную роль */
export function getLocalizedSystemRole(template: PromptTemplate): string {
  const lang = i18n.language
  return template.systemRoleLocalized?.[lang] || template.systemRoleLocalized?.[lang.split('-')[0]] || template.systemRole || ''
}

/** Получить локализованный системный суффикс */
export function getLocalizedSystemSuffix(template: PromptTemplate): string {
  const lang = i18n.language
  return template.systemSuffixLocalized?.[lang] || template.systemSuffixLocalized?.[lang.split('-')[0]] || template.systemSuffix || ''
}

/** 章节标题命名规范 — 蓝图/滚动刷新/逆向推演共用，保证全书标题风格统一 */
const CHAPTER_TITLE_RULES = `【章节命名规则（必须遵守）】
- 长度 2-5 个汉字，优先 2-4 字。
- 优先具体意象：地点、物件、动作、状态、事件（如：禁区、破碎城、破界瞳、破局）。
- 主题式标题（如：弱者的特权）全卷最多 3 次，且不超过 5 字。
- 禁止：副标题、标点符号、疑问句、剧透结局、四字以上成语、"XX之路/XX之始/XX的XX"模板。
- 同一卷内不得重复使用同一个核心词；连续两章不得使用同一结构。
- 只返回标题本身，不要引号，不要"第X章"前缀。`

/** 允许用户自定义编辑的模板 Key 列表（其余为系统模板，不可编辑） */
export const EDITABLE_PROMPT_KEYS: string[] = [
  'generate_global_config',
  'premise',
  'character_dynamics',
  'world_building',
  'synopsis',
  'first_chapter_draft',
  'next_chapter_draft',
  'refine_chapter',
  'consistency_check',
  'analyze_writing_style',
  'refine_from_review',
  'deaify_polish',
  'foreshadow_extract',
]

/** 全部内置 Prompt 模板 */
export const BUILTIN_PROMPTS: PromptTemplate[] = [

  // ================================================================
  // AI 一键配置生成
  // ================================================================
  {
    key: 'generate_global_config',
    name: '全文配置生成',
    description: '根据用户一句话灵感，生成完整的小说配置 JSON',
    systemRole: '你是一位入行十年的顶尖网文主编与白金大神作家，擅长从一句话灵感中提炼完整的商业小说配置。',
    variables: {
      user_idea: '用户输入的灵感/想法',
      number_of_chapters: '计划总章数',
      word_number: '每章计划字数',
    },
    content: `基于作者提供的一句话点子或初步脑洞，请按照当今最成熟、最具商业霸榜潜力的网文核心结构，扩展并补全一部小说的全局爆款设定。

作者初步脑洞：
{{user_idea}}

小说规模（重要！请严格根据此参数设计节奏）：
- 计划总章数：{{number_of_chapters}} 章
- 每章字数：{{word_number}} 字
- 全书总字数约：{{number_of_chapters}} × {{word_number}} 字

【核心任务要求】
1. 深度挖掘商业价值：提取强烈的"爽点"、"情绪痛点"，构建极具张力的起承转合。
2. 专业化设定：应用"角色图谱"和"三维世界观"理念，杜绝假大空，所有设定必须为推动情节和产生直接冲突服务。
3. 契合市场：如果作者未指定基础类型，请推断一个最契合的爆火类型。
4. 节奏定制：globalGuidance 中的前/中/后期章节区间、小/中/大高潮频率，必须严格基于【{{number_of_chapters}} 章】的实际规模推算，禁止使用与实际章数不符的数字。
5. 智能推荐：根据类型和题材推荐最合适的故事结构和叙事视角。`,
    systemSuffix: `【输出格式限制】
- 必须以标准的 JSON 格式返回，确保匹配以下结构。

【JSON 字段结构】
{
    "genre": "主类型（玄幻/仙侠/都市/科幻/历史/悬疑/游戏/军事/奇幻/武侠/现实/其他）",
    "targetAudience": "受众目标（男频/女频/通用/短篇）",
    "subGenre": "细分子类型及核心标签（如：末日废土、苟道流、权谋、大女主逆袭）",
    "plotStructure": "故事结构（three_act=三幕结构 / heros_journey=英雄之旅 / save_the_cat=节拍表 / kishotenketsu=起承转合 / multi_thread=多线叙事 / freeform=自由结构，根据类型推荐最合适的）",
    "narrativePOV": "叙事视角（third_limited=第三人称有限视角 / first_person=第一人称 / third_omniscient=第三人称全知视角 / multi_pov=多视角轮换，根据类型推荐最合适的）",
    "coreOutline": "核心大纲（不少于150字，含：主角的致命危机/开局困境、必须完成的核心目标、终极大危机、主要爽点起伏）",
    "worldSetting": "独特的背景设定（物理维度、权力断层、核心资源争夺机制）",
    "goldenFinger": "核心卖点与金手指体系（获取方式、具体功能、进阶成长路径、副作用/限制）",
    "protagonistProfile": "主角人设档案（极具反差的性格弱点、表面伪装标签、核心驱动力：物质目标+深层灵魂渴望）",
    "globalGuidance": "全局写作指导与核心禁忌（严格基于{{number_of_chapters}}章规模：前/中/后期各占多少章、小/中/大高潮的具体章节频率、严禁触碰的毒点）",
    "writingStyle": "文风配置（不少于100字，涵盖：叙述节奏快慢与场景切换频率、描写密度偏好、对话风格与口语化程度、用词偏好古风/现代/专业术语、情感基调热血/冷峻/诙谐/沉重、标志性修辞手法与过渡技巧。请根据类型和受众推荐最匹配的写作风格）"
}`,
    contentLocalized: {
      en: `Based on the author's one-line idea or initial concept, please expand and complete a novel's global bestseller configuration following the most mature and commercially dominant web novel core structure.

Author's initial concept:
{{user_idea}}

Novel scale (IMPORTANT! Design pacing strictly according to these parameters):
- Planned total chapters: {{number_of_chapters}}
- Words per chapter: {{word_number}}
- Approximate total word count: {{number_of_chapters}} × {{word_number}} words

【Core Requirements】
1. Deep commercial value mining: Extract powerful "satisfaction points" and "emotional pain points" to build a compelling setup-development-twist-resolution arc.
2. Professional-grade settings: Apply "character graph" and "3D worldbuilding" principles. All settings must serve plot progression and direct conflict — no empty filler.
3. Market fit: If the author hasn't specified a base genre, infer the most commercially explosive type.
4. Pacing customization: The early/mid/late chapter ranges and minor/medium/major climax frequencies in globalGuidance must be strictly calculated based on the actual scale of [{{number_of_chapters}} chapters]. Do not use numbers that contradict the actual chapter count.
5. Smart recommendations: Recommend the most suitable story structure and narrative POV based on the genre and theme.`,
      ru: `Основываясь на одной идее или начальном наброске автора, пожалуйста, расширьте и дополньте глобальную конфигурацию романа-бестселлера, следуя самой зрелой и коммерчески доминирующей структуре веб-романа.

Начальная идея автора:
{{user_idea}}

Масштаб романа (ВАЖНО! Пacing проектируйте строго по этим параметрам):
- Плановое количество глав: {{number_of_chapters}}
- Слов в главе: {{word_number}}
- Примерная общая длина: {{number_of_chapters}} × {{word_number}} слов

【Основные требования】
1. Глубокая挖掘 коммерческой ценности: извлекайте мощные «точки удовлетворения» и «эмоциональные болевые точки» для построения захватывающей арки завязки-развития-кульминации-развязки.
2. Профессиональные настройки: применяйте принципы «карты персонажей» и «3D-мировоззрения». Все настройки должны служить продвижению сюжета и созданию прямых конфликтов — никакой пустой воды.
3. Соответствие рынку: если автор не указал базовый жанр, угадайте самый коммерчески взрывной тип.
4. Кастомизация темпа: диапазоны глав начальной/средней/финальной частей и частота малых/средних/крупных кульминаций в globalGuidance должны быть строго рассчитаны по фактическому масштабу [{{number_of_chapters}} глав]. Не используйте цифры, противорящие реальному количеству глав.
5. Умные рекомендации: рекомендуйте наиболее подходящую структуру故事 и повествовательную точку зрения на основе жанра и темы.`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel editor and platinum-selling author with ten years of industry experience, skilled at distilling a one-line idea into a complete commercial novel configuration.',
      ru: 'Вы — ведущий редактор веб-романов и платиновый автор с десятилетним опытом, искусно превращающий одну идею в полную коммерческую конфигурацию романа.'
    },
  },


  // ================================================================
  // 架构生成 — 四步流水线
  // ================================================================

  {
    key: 'premise',
    name: '故事前提',
    description: '故事架构第一步：提炼故事前提（Story Premise），浓缩全书的核心卖点与冲突链',
    systemRole: '你是一位顶尖的网络小说策划专家与故事架构师。',
    variables: {
      genre: '小说类型',
      sub_genre: '细分类型',
      topic: '核心主题/故事简介',
      target_audience: '目标受众',
      number_of_chapters: '总章数',
      word_number: '每章字数',
      core_setting: '世界观基盘设定',
      golden_finger: '核心金手指/卖点',
      protagonist_profile: '主角人设',
      global_guidance: '全局写作要求',
      step_guidance: '作者对本步骤的补充指导（可选）',
      reference_works: '参考作品（可选）',
    },
    content: `请提炼本书的故事前提（Story Premise）。这是一本【{{genre}}】（细分类别：{{sub_genre}}）小说。

【核心设定参数】
- 核心大纲：{{topic}}
- 目标受众：{{target_audience}}
- 预期篇幅：约{{number_of_chapters}}章（每章{{word_number}}字）
- 世界观基盘：{{core_setting}}
- 核心金手指/系统：{{golden_finger}}
- 主角核心人设：{{protagonist_profile}}
- 全局写作要求与禁忌：{{global_guidance}}

【生成任务】
请生成一份 300-500 字的结构化故事前提，严格按以下四个小节输出：

## 一句话前提（Logline）
用 30-50 字极度浓缩全书核心："当 [主角身份] 遭遇 [触发事件]，必须 [核心行动] 否则 [灾难后果]。"

## 核心冲突链
展开描述：主角的初始困境 → 打破平衡的触发事件 → 核心主线目标 → 主要阻碍势力。（约 100 字）

## 金手指定位
详细说明：金手指的获取方式 → 核心机制与功能 → 与世界观规则的交互点 → 进阶路线与限制/代价。（约 100-150 字）

## 悬念骨架
描述：显性冲突线（当前最大威胁）+ 隐藏主线暗示（终极悬念/深层真相）。（约 100 字）

【要求】
1. 金手指必须是推动情节的核心手段，要具体描述其独特机制，不要泛泛而谈。
2. 必须体现主角基于设定的核心欲望或执念。
3. 冲突链必须包含显性敌人与深层危机两个层次。
4. 严格避开全局写作要求与禁忌中的毒点。
5. 使用上述 Markdown 小节标题分隔，不要添加额外解释。

【参考作品风格（如有，调性与节奏可参考以下作品）】
{{reference_works}}`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{step_guidance}}`,
    contentLocalized: {
      en: `Please distill the story premise for this novel. This is a [{{genre}}] novel (sub-genre: {{sub_genre}}).

【Core Setting Parameters】
- Core outline: {{topic}}
- Target audience: {{target_audience}}
- Expected length: approximately {{number_of_chapters}} chapters ({{word_number}} words each)
- Worldbuilding foundation: {{core_setting}}
- Golden finger / core selling point: {{golden_finger}}
- Protagonist profile: {{protagonist_profile}}
- Global writing requirements and prohibitions: {{global_guidance}}

【Generation Task】
Generate a 300–500 word structured story premise, strictly following these four sections:

## One-Line Premise (Logline)
Condense the entire novel's core in 30–50 words: "When [protagonist identity] encounters [triggering event], they must [core action] or else [catastrophic consequence]."

## Core Conflict Chain
Elaborate: protagonist's initial dilemma → the event that shatters equilibrium → core main-line objective → primary antagonistic forces. (~100 words)

## Golden Finger Positioning
Detail: how the golden finger is obtained → core mechanics and functions → interaction points with world rules → progression paths and limitations/costs. (~100–150 words)

## Suspense Skeleton
Describe: the overt conflict line (current biggest threat) + hidden main-line hints (ultimate mystery / deep truth). (~100 words)

【Requirements】
1. The golden finger must be a core plot-driving mechanism — describe its unique mechanics in detail, no vague hand-waving.
2. Must embody the protagonist's core desire or obsession derived from their setting.
3. The conflict chain must include both an overt enemy and a deeper crisis.
4. Strictly avoid any prohibited elements listed in global writing requirements.
5. Use the Markdown section headings above as separators; do not add extra commentary.

【Reference Works (if any — match tone and pacing)】
{{reference_works}}`,
      ru: `Пожалуйста, сформулируйте сюжетную посылку для этого романа. Это роман жанра [{{genre}}] (поджанр: {{sub_genre}}).

【Параметры основных настроек】
- Основной конспект: {{topic}}
- Целевая аудитория: {{target_audience}}
- Ожидаемый объём: примерно {{number_of_chapters}} глав (по {{word_number}} слов в каждой)
- Фундамент мироздания: {{core_setting}}
- Золотой палец / ключевая фишка: {{golden_finger}}
- Профиль главного героя: {{protagonist_profile}}
- Глобальные требования и запреты на написание: {{global_guidance}}

【Задание по генерации】
Создайте структурированную сюжетную посылку из 300–500 слов, строго следуя четырём разделам:

## Однострочная посылка (Логлайн)
Уместите ядро всего романа в 30–50 слов: «Когда [идентичность героя] сталкивается с [триггерным событием], он должен [ключевое действие], иначе [катастрофическое последствие].»

## Цепь основных конфликтов
Разверните: начальная дилемма героя → событие, разрушающее равновесие → основная главная цель → главные противостоящие силы. (~100 слов)

## Позиционирование золотого пальца
Детализируйте: способ получения золотого пальца → основные механики и функции → точки взаимодействия с правилами мира → пути развития и ограничения/цена. (~100–150 слов)

## Каркас интриги
Опишите: линия явного конфликта (текущая главная угроза) + скрытые подсказки основной линии (тайна финала / глубинная правда). (~100 слов)

【Требования】
1. Золотой палец должен быть ключевым двигателем сюжета — опишите его уникальные механики подробно, без абстрактных общих фраз.
2. Должно отражаться основное желание или одержимость героя, вытекающие из его сеттинга.
3. Цепь конфликтов должна включать как явного врага, так и более глубокую угрозу.
4. Строго избегайте любых запрещённых элементов из глобальных требований.
5. Используйте заголовки разделов выше как разделители; не добавляйте лишних комментариев.

【Эталонные произведения (если есть — ориентируйтесь на тон и ритм)】
{{reference_works}}`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel planning expert and story architect.',
      ru: 'Вы — ведущий эксперт по планированию веб-романов и архитектор сюжетов.'
    },
  },

  {
    key: 'character_dynamics',
    name: '角色图谱',
    description: '故事架构第二步：构建核心角色关系网与角色弧光',
    systemRole: '你是一位顶尖的网络小说策划专家与故事架构师。',
    variables: {
      premise: '故事前提',
      genre: '小说类型',
      protagonist_profile: '主角人设',
      golden_finger: '金手指体系',
      world_building: '世界观设定',
      number_of_chapters: '总章数',
      global_guidance: '全局写作要求',
      step_guidance: '作者对本步骤的补充指导（可选）',
      reference_works: '参考作品（可选）',
    },
    content: `请基于故事前提为本书塑造一个极具戏剧张力的核心角色图谱。

【参考参数】
- 小说类型：{{genre}}
- 故事前提：{{premise}}
- 主角预设档案：{{protagonist_profile}}
- 金手指体系：{{golden_finger}}
- 世界观背景：{{world_building}}
- 预期篇幅：约{{number_of_chapters}}章
- 全局写作要求与禁忌：{{global_guidance}}

【生成任务】
围绕主角，根据小说篇幅（{{number_of_chapters}}章）设计合理数量的核心角色（短篇3-4人，中长篇4-6人）。角色切忌脸谱化。请生成包含以下结构的角色图谱：

1. 【第一核心：主角】
- 表面追求与终极渴望（根据档案补全性格的明暗两面）
- 标志性外貌特征（衣着、气质、独特标志等）
- 金手指使用风格（基于「{{golden_finger}}」的具体机制，设计独特的使用习惯或战斗/升级策略）
- 灵魂软肋与蜕变预期（角色弧光起始点 → 终点）

2. 【核心角色阵营】
为每位角色提供：姓名/代号、身份背景、标志性外貌特征、与主角的关系张力、暗藏秘密。
角色设计原则（非固定模板，根据故事需要灵活配置）：
- 至少 1 位与主角有深度羁绊的盟友/伙伴（互补而非附庸）
- 至少 1 位与主角理念对立的竞争者/对手（有自己的正当动机）
- 可选：1 位隐藏变数/灰色角色（立场不定，可能带来反转）
- 可选：根据故事需要增加导师、阴谋家、势力代言人等

3. 【核心矛盾交织网】
简述所有角色如何因为世界观下的生存压力、资源争夺或信念冲突产生不可避免的碰撞。

【要求】
1. 主角必须严格符合主角档案基调，不可偏离。
2. 所有角色的设计必须贴合「{{genre}}」类型的读者期待。
3. 默认避免圣母、降智反派或纯工具人（除非作者明确要求）。
4. 仅返回角色图谱文本，不要任何客套话。

【参考作品风格（如有，调性与节奏可参考以下作品）】
{{reference_works}}`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{step_guidance}}`,
    contentLocalized: {
      en: `Based on the story premise, create a highly dramatic core character map for this novel.

【Reference Parameters】
- Novel genre: {{genre}}
- Story premise: {{premise}}
- Protagonist profile: {{protagonist_profile}}
- Golden finger system: {{golden_finger}}
- Worldbuilding: {{world_building}}
- Expected length: approximately {{number_of_chapters}} chapters
- Global writing requirements: {{global_guidance}}

【Generation Task】
Design a reasonable number of core characters around the protagonist, proportional to the novel's length (3–4 for short stories, 4–6 for medium/long works). Characters must avoid being one-dimensional. Generate a character map with the following structure:

1. 【The Core: Protagonist】
- Surface desires vs. ultimate yearning (flesh out both light and dark sides of the personality)
- Signature physical traits (clothing, aura, distinctive marks, etc.)
- Golden finger usage style (based on the specific mechanics of "{{golden_finger}}", design unique usage habits or combat/leveling strategies)
- Soul vulnerability and transformation arc (starting point → endpoint)

2. 【Core Character Camp】
For each character provide: name/code, background, signature physical traits, tension in their relationship with the protagonist, hidden secrets.
Character design principles (flexible, not a rigid template — configure based on story needs):
- At least 1 ally/partner with deep bonds to the protagonist (complementary, not subordinate)
- At least 1 rival/opponent with opposing ideologies (who has their own legitimate motivations)
- Optional: 1 hidden wild card / morally grey character (unpredictable allegiance, potential for twists)
- Optional: add mentor, mastermind, faction spokesperson, etc. as the story requires

3. 【Core Conflict Web】
Briefly describe how all characters inevitably clash due to survival pressures, resource competition, or ideological conflict within the world.

【Requirements】
1. Protagonist must strictly match the protagonist profile's tone — no deviations.
2. All character designs must fit reader expectations for the "{{genre}}" genre.
3. By default avoid saintly sages, idiotic villains, or pure utility characters (unless the author explicitly requests them).
4. Return only the character map text — no pleasantries.

【Reference Works (if any)】
{{reference_works}}`,
      ru: `На основе сюжетной посылки создайте максимально драматичную карту ключевых персонажей для этого романа.

【Параметры для справки】
- Жанр романа: {{genre}}
- Сюжетная посылка: {{premise}}
- Профиль главного героя: {{protagonist_profile}}
- Система золотого пальца: {{golden_finger}}
- Мироздание: {{world_building}}
- Ожидаемый объём: примерно {{number_of_chapters}} глав
- Глобальные требования к написанию: {{global_guidance}}

【Задание по генерации】
Спроектируйте разумное количество ключевых персонажей вокруг героя, пропорциональное объёму романа (3–4 для коротких историй, 4–6 для средних/длинных). Персонажи должны избегать шаблонности. Создайте карту персонажей со следующей структурой:

1. 【Ядро: Главный герой】
- Поверхностные желания vs. глубинная тоска (раскройте обе стороны личности — светлую и тёмную)
- Характерные внешние черты (одежда, аура, уникальные приметы и т.д.)
- Стиль использования золотого пальца (на основе конкретных механик «{{golden_finger}}» придумайте уникальные привычки использования или боевую/прогрессирующую стратегию)
- Душевная уязвимость и арка трансформации (начальная точка → конечная)

2. 【Лагерь ключевых персонажей】
Для каждого персонажа укажите: имя/код, предысторию, характерные внешние черты, напряжённость в отношениях с героем, скрытые тайны.
Принципы проектирования (гибкие, а не шаблон — настраивайте по потребностям истории):
- Как минимум 1 союзник/партнёр с глубокой связью с героем (дополняющий, а не подчинённый)
- Как минимум 1 соперник/противник с противоположными идеологиями (имеющий свои обоснованные мотивы)
- По желанию: 1 скрытый wild card / морально серый персонаж (непредсказуемая позиция, потенциал для переворотов)
- По желанию: добавьте наставника, интригана, представителя фракции и т.д. по необходимости

3. 【Сеть основных конфликтов】
Кратко опишите, как все персонажи неизбежно сталкиваются из-за давления выживания, конкуренции за ресурсы или идеологических противоречий в мире.

【Требования】
1. Главный герой должен строго соответствовать тону профиля — никаких отклонений.
2. Все персонажи должны соответствовать ожиданиям читателей жанра «{{genre}}».
3. По умолчанию избегайте безоговорочно святых, тупых злодеев или чисто функциональных персонажей (если автор явно не попросил).
4. Возвращайте только текст карты персонажей — никаких вступлений.

【Эталонные произведения (если есть)】
{{reference_works}}`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel planning expert and story architect.',
      ru: 'Вы — ведущий эксперт по планированию веб-романов и архитектор сюжетов.'
    },
  },

  {
    key: 'world_building',
    name: '世界观构建',
    description: '故事架构第三步：构建自带冲突引擎的世界观矩阵',
    systemRole: '你是一位顶尖的网络小说策划专家与故事架构师。',
    variables: {
      premise: '故事前提',
      genre: '小说类型',
      core_setting: '世界观基盘',
      golden_finger: '金手指体系',
      protagonist_profile: '主角人设',
      global_guidance: '全局写作要求',
      step_guidance: '作者对本步骤的补充指导（可选）',
    },
    content: `请将基础设定转化为能直接引发冲突的"剧情游乐场"。

【参考参数】
- 小说类型：{{genre}}
- 故事前提：{{premise}}
- 核心世界观设定：{{core_setting}}
- 金手指体系：{{golden_finger}}
- 主角定位：{{protagonist_profile}}
- 全局写作要求与禁忌：{{global_guidance}}

【生成任务】
请基于核心世界观，根据「{{genre}}」类型的特点，构建以下三个维度的世界观设定。每个设定都必须"自带冲突点"，能直接驱动情节。

1. 【核心规则与体系漏洞】
- 本世界运转的核心规则是什么？（根据类型可以是：修炼体系、科技等级、社会制度、超自然法则等）
- 规则中的绝对优势是什么？主角的金手指「{{golden_finger}}」如何在这套规则下占据独特的非对称优势？

2. 【阶层断层与资源战场】
- 这个世界里存在哪些不可调和的势力/阶层/阵营对立？
- 最稀缺的核心资源是什么？它是如何分配的？主角处于什么位置，需要向谁争夺？

3. 【隐喻与深层危机】
- 世界背后的终极灾变或最大谜团是什么？
- 有什么流传的禁忌、历史谎言或被掩盖的真相，恰好与主角的命运产生交汇？

【要求】
1. 所有设定必须围绕「{{genre}}」题材的核心看点，不要写无法融入正文的废话设定。
2. 金手指与世界规则的交互必须具体、可操作，避免泛泛而谈。
3. 严格遵循全局写作要求与禁忌，禁止崩坏。
4. 仅返回世界观设定文本，不要生成任何无关代码或解释。

`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{step_guidance}}`,
    contentLocalized: {
      en: `Transform the base settings into a "plot playground" that directly generates conflict.

【Reference Parameters】
- Novel genre: {{genre}}
- Story premise: {{premise}}
- Core worldbuilding: {{core_setting}}
- Golden finger system: {{golden_finger}}
- Protagonist positioning: {{protagonist_profile}}
- Global writing requirements: {{global_guidance}}

【Generation Task】
Based on the core worldbuilding and the characteristics of the "{{genre}}" genre, construct world settings across the following three dimensions. Every element must "carry built-in conflict points" that directly drive the plot.

1. 【Core Rules & System Exploits】
- What are the fundamental rules governing this world? (Depending on genre: cultivation system, technology tiers, social structure, supernatural laws, etc.)
- What is the absolute advantage within these rules? How does the protagonist's golden finger "{{golden_finger}}" create a unique asymmetric edge within this system?

2. 【Class Fractures & Resource Battlegrounds】
- What irreconcilable faction/class/factional oppositions exist in this world?
- What is the scarcest core resource? How is it distributed? Where does the protagonist stand, and who must they compete against?

3. 【Metaphor & Hidden Crisis】
- What is the ultimate catastrophe or greatest mystery behind this world?
- Are there forbidden knowledge, historical lies, or suppressed truths that happen to intersect with the protagonist's destiny?

【Requirements】
1. All settings must revolve around the core appeal of the "{{genre}}" genre — no empty settings that can't be woven into the narrative.
2. The interaction between golden finger and world rules must be specific and actionable — no vague generalities.
3. Strictly follow global writing requirements and prohibitions.
4. Return only the worldbuilding text — no irrelevant code or explanations.`,
      ru: `Преобразуйте базовые настройки в «сюжетную площадку», непосредственно порождающую конфликты.

【Параметры для справки】
- Жанр романа: {{genre}}
- Сюжетная посылка: {{premise}}
- Основное мироздание: {{core_setting}}
- Система золотого пальца: {{golden_finger}}
- Позиционирование героя: {{protagonist_profile}}
- Глобальные требования к написанию: {{global_guidance}}

【Задание по генерации】
На основе основного мироздания и характеристик жанра «{{genre}}» постройте настройки мира по трём измерениям. Каждый элемент должен «нести встроенные точки конфликта», непосредственно движущие сюжет.

1. 【Основные правила и уязвимости системы】
- Каковы фундаментальные правила, управляющие этим миром? (В зависимости от жанра: система культивации, уровни технологии, социальная структура, сверхъестественные законы и т.д.)
- Какое абсолютное преимущество существует в рамках этих правил? Как золотой палец героя «{{golden_finger}}» создаёт уникальное асимметричное преимущество в этой системе?

2. 【Классовые разломы и ресурсные арены】
- Какие непримиримые противостояния фракций/классов/лагерей существуют в этом мире?
- Какой ресурс является самым дефицитным? Как он распределяется? Где находится герой и с кем ему приходится конкурировать?

3. 【Метафора и скрытый кризис】
- Какова终极ная катастрофа или величайшая тайна, стоящая за этим миром?
- Существуют ли запретные знания, историческая ложь или скрытая правда, которая пересекается с судьбой героя?

【Требования】
1. Все настройки должны вращаться вокруг ключевой привлекательности жанра «{{genre}}» — никаких пустых настроек, которые нельзя вплести в повествование.
2. Взаимодействие золотого пальца и правил мира должно быть конкретным и применимым — никаких абстрактных общих фраз.
3. Строго следуйте глобальным требованиям и запретам на написание.
4. Возвращайте только текст мироздания — никакого лишнего кода или пояснений.`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel planning expert and story architect.',
      ru: 'Вы — ведущий эксперт по планированию веб-романов и архитектор сюжетов.'
    },
  },

  {
    key: 'synopsis',
    name: '情节大纲',
    description: '故事架构第四步：整合所有碎片，按用户选择的故事结构模式生成情节大纲',
    systemRole: '你是一位顶尖的网络小说策划专家与故事架构师。',
    variables: {
      premise: '故事前提',
      character_dynamics: '角色图谱',
      world_building: '世界观',
      genre: '小说类型',
      number_of_chapters: '总章数',
      word_number: '每章字数',
      plot_structure_guide: '故事结构详细指导（由系统根据用户选择的结构模式动态注入）',
      narrative_pov: '叙事视角描述',
      global_guidance: '全局写作要求',
      step_guidance: '作者对本步骤的补充指导（可选）',
    },
    content: `请将前序生成的所有碎片整合为全书的情节大纲。

【核心资产】
- 小说类型：{{genre}}
- 叙事视角：{{narrative_pov}}
- 故事前提：{{premise}}
- 角色图谱：{{character_dynamics}}
- 世界观矩阵：{{world_building}}
- 全局写作要求与禁忌：{{global_guidance}}

【篇幅参数（极其重要！结构节点必须严格基于此）】
- 计划总章数：{{number_of_chapters}} 章
- 每章字数：{{word_number}} 字
- 全书总字数约：{{number_of_chapters}} × {{word_number}} 字

【故事结构模式——严格按以下结构组织大纲】
{{plot_structure_guide}}

【生成任务】
严密推演涵盖全书的情节大纲。写"结构拐点"而非细纲。请根据「{{genre}}」类型的核心看点调整节奏策略。

【要求】
1. 结构节点的章节区间必须基于【{{number_of_chapters}}章】的实际规模标注具体范围，禁止使用与实际章数不符的数字。
2. 每个结构节点都要提到"具体会发生什么事"，不能泛泛而谈。
3. 节奏策略要匹配「{{genre}}」类型（如爽文侧重打脸与升级节奏，悬疑侧重线索与反转，言情侧重情感与误会）。
4. 叙事视角为「{{narrative_pov}}」，大纲设计时需考虑视角限制对信息揭露、悬念制造的影响。
5. 绝不能触碰全局写作要求与禁忌中的毒点。
6. 仅返回情节大纲纯文本，禁止一切废话或旁白。

`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{step_guidance}}`,
    contentLocalized: {
      en: `Integrate all prior outputs into a complete plot synopsis for the entire novel.

【Core Assets】
- Novel genre: {{genre}}
- Narrative POV: {{narrative_pov}}
- Story premise: {{premise}}
- Character dynamics: {{character_dynamics}}
- Worldbuilding matrix: {{world_building}}
- Global writing requirements: {{global_guidance}}

【Scale Parameters (CRITICAL! Structural beats must be based on these)】
- Planned total chapters: {{number_of_chapters}}
- Words per chapter: {{word_number}}
- Approximate total word count: {{number_of_chapters}} × {{word_number}} words

【Story Structure Model — organize the outline strictly according to this structure】
{{plot_structure_guide}}

【Generation Task】
Rigorously derive a plot synopsis covering the entire novel. Write "structural turning points," not a detailed scene-by-scene outline. Adjust pacing strategy based on the core appeal of the "{{genre}}" genre.

【Requirements】
1. Chapter ranges for structural beats must be labeled with specific ranges based on the actual scale of [{{number_of_chapters}} chapters]. Do not use numbers that contradict the actual chapter count.
2. Each structural beat must specify "what exactly will happen" — no vague generalities.
3. Pacing strategy must match the "{{genre}}" genre (e.g., power fantasy focuses on face-slapping and leveling rhythm; mystery focuses on clues and reversals; romance focuses on emotion and misunderstandings).
4. The narrative POV is "{{narrative_pov}}" — the outline design must account for how POV limitations affect information reveal and suspense creation.
5. Never violate any prohibitions listed in global writing requirements.
6. Return only the plot synopsis as plain text — no filler or narration.`,
      ru: `Объедините все предыдущие выходы в полный сюжетный синопсис на весь роман.

【Основные активы】
- Жанр романа: {{genre}}
- Точка зрения повествования: {{narrative_pov}}
- Сюжетная посылка: {{premise}}
- Динамика персонажей: {{character_dynamics}}
- Матрица мироздания: {{world_building}}
- Глобальные требования к написанию: {{global_guidance}}

【Параметры масштаба (КРИТИЧНО! Структурные узлы должны строиться на основе этих данных)】
- Плановое количество глав: {{number_of_chapters}}
- Слов в главе: {{word_number}}
- Примерная общая длина: {{number_of_chapters}} × {{word_number}} слов

【Модель структуры истории — организуйте конспект строго по этой структуре】
{{plot_structure_guide}}

【Задание по генерации】
Строгий вывод сюжетного конспекта на весь роман. Пишите «структурные поворотные точки», а не подробный посценарный план. Корректируйте стратегию темпа на основе ключевой привлекательности жанра «{{genre}}».

【Требования】
1. Диапазоны глав для структурных узлов должны быть обозначены конкретными диапазонами на основе фактического масштаба [{{number_of_chapters}} глав]. Не используйте цифры, противорящие реальному количеству глав.
2. Каждый структурный узел должен указывать, «что именно произойдёт» — никаких абстрактных общих фраз.
3. Стратегия темпа должна соответствовать жанру «{{genre}}» (например, фэнтези силы делает акцент на унижении врагов и ритме прокачки; детектив — на уликах и поворотах; романтика — на эмоциях и недопонимании).
4. Точка зрения повествования — «{{narrative_pov}}» — при проектировании конспекта учитывайте, как ограничения точки зрения влияют на раскрытие информации и создание интриги.
5. Никогда не нарушайте запреты из глобальных требований к написанию.
6. Возвращайте только текст сюжетного конспекта — никакой воды или авторских ремарок.`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel planning expert and story architect.',
      ru: 'Вы — ведущий эксперт по планированию веб-романов и архитектор сюжетов.'
    },
  },



  // ================================================================
  // 章节蓝图生成
  // ================================================================

  {
    key: 'chapter_blueprint',
    name: '章节蓝图生成（全量）',
    description: '基于全书架构一次性生成所有章节的详细蓝图',
    systemRole: '你是一位经验丰富的网文架构师，擅长设计精密的章节蓝图。',
    variables: {
      novel_architecture: '完整故事架构（故事前提+角色图谱+世界观+情节大纲）',
      number_of_chapters: '总章数',
      global_guidance: '全局写作要求',
      genre: '小说类型',
      pacing_guidance: '节奏/风格指导（可选）',
    },
    content: `请基于我们此前推演出的【全书架构引擎】，为本书生成从第1章到第{{number_of_chapters}}章的具体"保姆级执行目录细纲"。

【核心防偏离守则】
- 小说题材：{{genre}}
- 全局写作要求与禁忌：{{global_guidance}}（这是绝对不能触碰的底线！）

【全书架构数据池】
{{novel_architecture}}

【商业网文节奏设计原则】
1. 黄金三章法则：第1章极速抛出"生存/高压困境"，第2章激活金手指/最大反差变量，第3章完成首次"小型打脸/破局"，留钩子。
2. 小高潮循环：严格执行"3-5章一个小循环"。
3. 拒绝水文与流水账：每一章都必须发生"实质性的事件变动"。
4. 悬念钩子机制：每章结尾必须有一个让读者想连续翻页的变数。

【输出格式规定】
${CHAPTER_TITLE_RULES}

严格且仅按以下 JSON 数组格式输出每一章：

{
  "blueprints": [
    {
      "chapterNumber": 1,
      "title": "符合【章节命名规则】的标题",
      "purpose": "本章主角最想解决的一件事",
      "characters": ["本章互动的要人A", "要人B"],
      "keyEvents": "主角做了什么，遭遇了什么反转，金手指怎么用的。100字左右具体说明",
      "suspenseHook": "一句话说明结尾留了什么悬念",
      "userGuidance": "【试炼】关卡名/颜色/大类/是否单人/结算公式与点数；【属性账】进=心识/体魄/力量/敏捷；出=心识/体魄/力量/敏捷；得=心识+X,体魄+Y,力量+Z,敏捷+W。不得只写“属性提升”"
    },
    {
      "chapterNumber": 2
    }
  ]
}

要求：
- 每章的 keyEvents 控制在 100-150 字以内，信息密度必须极高。
- 每章必须输出 userGuidance，其中【属性账】的「进」必须等于上一章的「出」；无属性变化的章节写「进=出，得=0」，不得省略。
- 月供抽取与破障代价只允许「心识」为负，且必须在“得”里注明“月供抽取”或“破障代价”；体魄/力量/敏捷不得为负。
- 属性只能来自试炼结算、属性点卡、非食物天材地宝、文明遗物；食物只恢复体力与精神力。
- 单属性到线即晋升大等级，禁止写「极境」「半步X级」「X级巅峰」「满编份额」「独吞」「劣质破障」「功法系数」。
- 奖励点数必须按规则区的公式计算，并写出完成度/排名/首通/越级系数，禁止只写区间。
- 仅给出最终的 JSON 文本，不要任何客套解释。

★【作者节奏/风格指导（如有，最高优先级）】★：
{{pacing_guidance}}`,
    contentLocalized: {
      en: `Based on our previously derived [Full Novel Architecture Engine], generate a detailed "comprehensive execution blueprint" for chapters 1 through {{number_of_chapters}}.

【Core Anti-Divergence Rules】
- Novel genre: {{genre}}
- Global writing requirements: {{global_guidance}} (this is the absolute bottom line!)

【Full Novel Architecture Data Pool】
{{novel_architecture}}

【Commercial Web Novel Pacing Design Principles】
1. Golden Three Chapters Rule: Chapter 1 immediately presents a "survival / high-pressure dilemma"; Chapter 2 activates the golden finger / maximum contrast variable; Chapter 3 delivers the first "small face-slapping / breakthrough" with a hook.
2. Minor Climax Cycle: Strictly enforce a "small cycle every 3–5 chapters."
3. No filler or diary entries: Every chapter must feature a "substantive plot development."
4. Suspense Hook Mechanism: Every chapter ending must have a variable that makes readers want to turn the page.

【Output Format】
Output each chapter strictly and exclusively in the following JSON array format:

{
  "blueprints": [
    {
      "chapterNumber": 1,
      "title": "An engaging title",
      "purpose": "The one thing the protagonist most wants to resolve this chapter",
      "characters": ["Key person A interacting this chapter", "Person B"],
      "keyEvents": "What the protagonist did, what reversal they encountered, how the golden finger was used. Explain in about 100 words",
      "suspenseHook": "One sentence describing the cliffhanger left at the end"
    },
    {
      "chapterNumber": 2
    }
  ]
}

Requirements:
- Keep each chapter's keyEvents within 100–150 words with maximum information density.
- Output only the final JSON text — no pleasantries or explanations.

★【Author Pacing/Style Guidance (if any, HIGHEST PRIORITY)】★:
{{pacing_guidance}}`,
      ru: `На основе ранее выведенного [Полного архитектурного движка романа] создайте подробный «комплексный план выполнения» для глав 1–{{number_of_chapters}}.

【Правила предотклонения от основы】
- Жанр романа: {{genre}}
- Глобальные требования к написанию: {{global_guidance}} (это абсолютный запрет!)

【Пул данных архитектуры романа】
{{novel_architecture}}

【Принципы проектирования темпа коммерческого веб-романа】
1. Правило первых трёх глав: Глава 1 немедленно представляет «ситуацию выживания / высокого давления»; Глава 2 активирует золотой палец / максимальную переменную контраста; Глава 3 выдаёт первое «маленькое унижение врага / прорыв» с крючком.
2. Цикл малых кульминаций: строго соблюдайте «малый цикл каждые 3–5 глав».
3. Никакой воды и дневниковых записей: каждая глава должна содержать «существенное развитие сюжета».
4. Механизм интриги: каждое завершение главы должно содержать переменную, заставляющую читателя перевернуть страницу.

【Формат вывода】
Выведите каждую главу строго и исключительно в следующем формате JSON-массива:

{
  "blueprints": [
    {
      "chapterNumber": 1,
      "title": "Интересный заголовок",
      "purpose": "То, что герой хочет решить больше всего в этой главе",
      "characters": ["Ключевой персонаж A", "Персонаж B"],
      "keyEvents": "Что сделал герой, какой контратаки он столкнулся, как был использован золотой палец. Опишите примерно 100 слов",
      "suspenseHook": "Одно предложение, описывающее интригу конца главы"
    }
  ]
}

Требования:
- Удерживайте keyEvents каждой главы в пределах 100–150 слов с максимальной плотностью информации.
- Выводите только финальный JSON — никаких вступлений или объяснений.

【Руководство автора по темпу/стилю (если есть, ВЫСШИЙ ПРИОРИТЕТ)】★:
{{pacing_guidance}}`
    },
    systemRoleLocalized: {
      en: 'You are an experienced web novel architect skilled at designing precise chapter blueprints.',
      ru: 'Вы — опытный архитектор веб-романов, искусно проектирующий точные планы глав.'
    },
  },

  {
    key: 'chapter_blueprint_chunk',
    name: '章节蓝图续写（分块）',
    description: '在已有目录基础上续写后续章节蓝图，支持分块生成',
    systemRole: '你是一位经验丰富的网文架构师，擅长设计精密的章节蓝图。',
    variables: {
      novel_architecture: '完整故事架构（故事前提+角色图谱+世界观+情节大纲）',
      chapter_list: '已生成的章节列表（最近100章）',
      number_of_chapters: '总章数',
      n: '起始章节号',
      m: '结束章节号',
      global_guidance: '全局写作要求',
      genre: '小说类型',
      pacing_guidance: '节奏/风格指导（可选）',
    },
    content: `请基于【全书架构引擎】与【已生成的目录进度】，为接下来的 第{{n}}章到第{{m}}章 生成极其严密的"保姆级执行目录细纲"。

【核心防偏离守则】
- 小说题材：{{genre}}
- 全书规模：共 {{number_of_chapters}} 章
- 全局写作要求与禁忌：{{global_guidance}}（这是绝对不能触碰的底线！）

【全书架构数据池】
{{novel_architecture}}

【前置剧情进度与连贯性检查】
以下是前置章节（简略截取，以防遗忘主线进度）：
{{chapter_list}}

【本次生成任务：接力推演】
请紧密承接上面最后一章的情节，继续严密推演 第{{n}}章 到 第{{m}}章。
1. 连续小高潮法则：维持每 3-5 章一个小高潮的节奏。
2. 伏笔强制回收与释放：如果前面章节留下了危机，这里必须引爆或解决。
3. 拒绝水文：每一章都必须有实质性进展。

【输出格式规定】
${CHAPTER_TITLE_RULES}

严格且仅按以下 JSON 数组格式输出每一章：

{
  "blueprints": [
    {
      "chapterNumber": n,
      "title": "符合【章节命名规则】的标题",
      "purpose": "本章主角最想解决的一件事",
      "characters": ["本章互动的要人A", "要人B"],
      "keyEvents": "具体发生了什么，金手指怎么运作的。100字左右",
      "suspenseHook": "结尾留的钩子",
      "userGuidance": "【试炼】关卡名/颜色/大类/是否单人/结算公式与点数；【属性账】进=心识/体魄/力量/敏捷；出=心识/体魄/力量/敏捷；得=心识+X,体魄+Y,力量+Z,敏捷+W"
    }
  ]
}

要求：
- 严格遵循上下文连贯，不要前后矛盾。
- 每章必须输出 userGuidance，其中【属性账】的「进」必须等于上一章的「出」；无属性变化写「进=出，得=0」。
- 月供抽取与破障代价只允许「心识」为负，且必须在“得”里注明“月供抽取”或“破障代价”；体魄/力量/敏捷不得为负。
- 属性只能来自试炼结算、属性点卡、非食物天材地宝、文明遗物；食物只恢复体力与精神力。
- 单属性到线即晋升大等级，禁止写「极境」「半步X级」「X级巅峰」「满编份额」「独吞」「劣质破障」「功法系数」。
- 奖励点数必须按规则区公式计算，写出完成度/排名/首通/越级系数。
- 仅给出最终的 JSON 文本，不要解释。

★【作者节奏/风格指导（如有，最高优先级）】★：
{{pacing_guidance}}`,
    contentLocalized: {
      en: `Based on the [Full Novel Architecture Engine] and the [Existing Blueprint Progress], generate an extremely detailed "comprehensive execution blueprint" for the next chapters: Chapter {{n}} through Chapter {{m}}.

【Core Anti-Divergence Rules】
- Novel genre: {{genre}}
- Total novel scale: {{number_of_chapters}} chapters
- Global writing requirements: {{global_guidance}} (this is the absolute bottom line!)

【Full Novel Architecture Data Pool】
{{novel_architecture}}

【Previous Plot Progress & Continuity Check】
Below is the preceding chapter summary (abridged to prevent losing sight of the main plot):
{{chapter_list}}

【This Generation Task: Relay Derivation】
Pick up seamlessly from the last chapter's plot and rigorously derive Chapter {{n}} through Chapter {{m}}.
1. Continuous Minor Climax Rule: Maintain the rhythm of one minor climax every 3–5 chapters.
2. Foreshadowing Enforcement: If previous chapters left a crisis hanging, it must detonate or resolve here.
3. No filler: Every chapter must have substantive progress.

【Output Format】
Output each chapter strictly and exclusively in the following JSON array format:

{
  "blueprints": [
    {
      "chapterNumber": n,
      "title": "An engaging title",
      "purpose": "The one thing the protagonist most wants to resolve this chapter",
      "characters": ["Key person A interacting this chapter", "Person B"],
      "keyEvents": "What specifically happened, how the golden finger operated. About 100 words",
      "suspenseHook": "The hook left at the end"
    }
  ]
}

Requirements:
- Strictly maintain contextual continuity — no contradictions.
- Output only the final JSON text — no explanations.

★【Author Pacing/Style Guidance (if any, HIGHEST PRIORITY)】★:
{{pacing_guidance}}`,
      ru: `На основе [Полного архитектурного движка романа] и [Текущего прогресса плана] создайте максимально подробный «комплексный план выполнения» для следующих глав: Глава {{n}}–{{m}}.

【Правила предотклонения от основы】
- Жанр романа: {{genre}}
- Общий масштаб романа: {{number_of_chapters}} глав
- Глобальные требования к написанию: {{global_guidance}} (это абсолютный запрет!)

【Пул данных архитектуры романа】
{{novel_architecture}}

【Предыдущий прогресс сюжета и проверка непрерывности】
Ниже приведён краткий обзор предыдущих глав (сжатый, чтобы не потерять основную сюжетную линию):
{{chapter_list}}

【Задание по генерации: ретрансляция】
Плавно перенмите от сюжета последней главы и строго выведите Главы {{n}}–{{m}}.
1. Правило непрерывных малых кульминаций: поддерживайте ритм одной малой кульминации каждые 3–5 глав.
2. Обязательное раскрытие зацепок: если в предыдущих главах остался кризис — он должен здесь взорваться или разрешиться.
3. Никакой воды: каждая глава должна содержать существенное развитие.

【Формат вывода】
Выведите каждую главу строго и исключительно в следующем формате JSON-массива:

{
  "blueprints": [
    {
      "chapterNumber": n,
      "title": "Интересный заголовок",
      "purpose": "То, что герой хочет решить больше всего в этой главе",
      "characters": ["Ключевой персонаж A", "Персонаж B"],
      "keyEvents": "Что конкретно произошло, как работал золотой палец. Примерно 100 слов",
      "suspenseHook": "Крючок, оставленный в конце"
    }
  ]
}

Требования:
- Строго соблюдайте контекстуальную непрерывность — никаких противоречий.
- Выводите только финальный JSON — никаких объяснений.

★【Руководство автора по темпу/стилю (если есть, ВЫСШИЙ ПРИОРИТЕТ)】★:
{{pacing_guidance}}`
    },
    systemRoleLocalized: {
      en: 'You are an experienced web novel architect skilled at designing precise chapter blueprints.',
      ru: 'Вы — опытный архитектор веб-романов, искусно проектирующий точные планы глав.'
    },
  },

  // ================================================================
  // 滚动蓝图 — 写稿前按实际剧情进度自适应刷新本章蓝图
  // ================================================================

  {
    key: 'refresh_chapter_blueprint',
    name: '滚动蓝图刷新',
    description: '写稿前依据已定稿正文、角色当前状态、未回收伏笔与节奏位置，修正本章蓝图；主线定位锚定不变',
    systemRole: '你是一位资深网文责编，擅长在连载推进中微调单章执行方案，让它贴合已经写出来的实际剧情，同时严守主线不偏航。',
    variables: {
      chapter_number: '本章序号',
      number_of_chapters: '全书总章数',
      original_blueprint: '本章原始蓝图 JSON（主线锚点）',
      novel_architecture: '全书架构（故事前提+角色图谱+世界观+情节大纲）',
      global_summary: '已写章节要点时间线（实际发生过的剧情）',
      previous_ending: '上一章结尾实际正文',
      character_states: '角色当前状态档案',
      foreshadowing: '未回收伏笔清单（含到期提醒）',
      anti_repetition: '最近数章开场与断章速览',
      future_blueprints: '后续章节蓝图（不可抢戏、不可提前消耗）',
      global_guidance: '全局写作要求与禁忌',
      rulebook: '本书规则区（属性成长/精神力/伤势/结算判定）',
      pacing_guidance: '节奏/风格指导（可选）',
    },
    content: `连载已经推进到 第 {{chapter_number}} 章（全书共 {{number_of_chapters}} 章）。这一章的蓝图是**开写前很早规划好的**，而前面若干章在实际落笔时往往已经深化或偏移了原计划。你的任务是：对照**已经真实写出来的内容**，把本章蓝图修正到可以直接执行的状态。

【全局写作要求与禁忌（绝对底线）】
{{global_guidance}}

【本书规则区（属性成长/精神力/伤势/结算判定 · 修正蓝图时不得违反）】
{{rulebook}}

【全书架构】
{{novel_architecture}}

【本章原始蓝图（主线锚点，务必尊重其主线定位）】
{{original_blueprint}}

【已经写出来的剧情要点时间线（这是事实，优先级高于原计划）】
{{global_summary}}

【上一章结尾实际正文（本章必须从这里自然接上）】
{{previous_ending}}

【角色当前状态档案（谁在哪、什么境界、身心状态、掌握了什么信息）】
{{character_states}}

【未回收伏笔清单】
{{foreshadowing}}

【最近数章的开场与断章方式（本章须避免雷同）】
{{anti_repetition}}

【后续章节蓝图（本章不得抢戏，不得提前消耗后面的关键节点）】
{{future_blueprints}}

---

【修正守则 — 请严格遵守】

1. **主线定位不可更改**：本章在全书结构中的功能（role）必须与原始蓝图保持一致。你可以改"怎么达成"，绝不可改"本章要达成什么结构任务"。
2. **不得越界**：不得把后续章节蓝图里的关键情节提前搬到本章；不得跳过原本该在本章发生的关键节点。
3. **以事实为准**：如果原蓝图与已写正文存在冲突（人物已死/已离场、地点已变、境界已突破、信息已被揭穿、道具已失去），必须以已写正文和角色当前状态为准来改写本章执行方案。
4. **承接与去雷同**：keyEvents 必须能从"上一章结尾"自然接续；开场与断章方式须避开最近数章的套路。
5. **伏笔纪律**：若清单中有伏笔已到期或本章正是引爆的最佳时机，应在 keyEvents 中安排回收；同时不要一次性倾泻过多伏笔。
6. **节奏感**：结合当前所处的章节位置（{{chapter_number}}/{{number_of_chapters}}）安排强度，保持小高潮节奏，拒绝水章。
7. **保守优先**：若对照事实后发现原蓝图依然完全可用，请原样返回并把 changed 设为 false。**不要为了改而改。**

【输出格式规定】
${CHAPTER_TITLE_RULES}

严格且仅输出以下 JSON，不要任何解释文字：

{
  "changed": true 或 false,
  "changeReason": "一句话说明为何要改（或为何无需改）",
  "title": "按【章节命名规则】生成或微调的本章标题",
  "role": "必须与原始蓝图的 role 一致",
  "purpose": "本章主角最想解决的核心问题（一句话）",
  "characters": ["本章实际会出场互动的重要角色名"],
  "keyEvents": "本章要写的核心事件与因果链（120-200字，具体到可直接执行）",
  "suspenseHook": "章末断章钩子（一句话，避开最近数章的套路）"
}

★【作者节奏/风格指导（如有，最高优先级）】★：
{{pacing_guidance}}`,
  },

  // ================================================================
  // 写稿
  // ================================================================

  {
    key: 'first_chapter_draft',
    name: '第一章草稿',
    description: '生成小说第一章的完整正文',
    systemRole: '你是一位笔力精湛的顶尖网文小说家，擅长撰写引人入胜、让读者欲罢不能的商业网文正文。',
    variables: {
      architecture: '故事架构（故事前提+角色图谱+世界观+情节大纲）',
      world_setting: '本书世界设定（含区域/试炼门/交易规则）',
      rulebook: '本书规则区（属性成长/精神力/伤势/结算判定）',
      chapter_info: '本章信息（JSON）',
      future_blueprints: '后续章节蓝图（防止剧情提前）',
      global_guidance: '全局写作要求',
      word_number: '目标字数',
      word_number_min: '字数硬下限（由目标字数自动派生）',
      word_number_max: '字数上限（由目标字数自动派生）',
      writing_style: '文风描述（可选）',
      style_reference: '作者文风指纹（可选，从样章提炼）',
      user_guidance: '作者本章微操指导（可选）',
    },
    content: `请开始创作这本小说的第一章（破冰章）。

【全书设定池】
{{architecture}}

【本书世界设定（含区域/试炼门/交易规则 · 优先级仅次于正典，与设定冲突时以本节为准）】
{{world_setting}}

【本书规则区（属性成长/精神力/伤势/结算判定 · 必须逐条遵循）】
{{rulebook}}

【本章信息】
{{chapter_info}}

【后续章节大纲预告】（仅供了解后续剧情发力点，请绝对不要在本章提前写出后续内容！）
{{future_blueprints}}

【全局写作要求】
{{global_guidance}}

【文风总纲（最高优先级，与其他条款冲突时以此为准）】
1. 视角贴人：第三人称限知，只写主角看得见、听得见、摸得到、判断得出的东西；不替他解释世界，不写他不可能知道的信息。
2. 一句一件事：平均句长 ≤26 字，短句（≤12 字）占 22% 以上；连续 3 句超过 30 字视为长句链，必须断开。
3. 动作先于感受：先写手在做什么、脚踩在哪里、东西有没有坏，再写疼不疼、怕不怕；禁止先甩情绪词再补动作。
4. 细节只留“会改变决定”的：水够不够、火会不会灭、伤口能不能走、对方会不会动手；不写氛围、不写装饰、不写参数表。
5. 信息从人嘴里、纸上、系统里出来：规则、价格、方向由对白、告示、路牌、旧地图、旧单据、系统提示承担；叙述者一段最多两句概括。
6. 情绪不命名：不写“他感到恐惧/绝望/愤怒”，写他握紧什么、退了几步、把哪句话咽回去。
7. 比喻克制：≤2 处/千字，必须有可验证的物理参照；禁止成品比喻（像灌了铅、像刀割）。
8. 数字克制：全章精确数值（含材料牌号、克数、升数、角度、卡路里）≤3 处，且每一处都必须影响决策；禁止“420 不锈钢”“六十度摆幅”“净重 150 克”式规格介绍。
9. 段落有呼吸：单段 40–70 字，关键场景最多 90 字；一个长段后必须跟短段或独立对白；每 2–3 个叙述段插一个 20–60 字短段。
10. 收在钩子上：段尾不总结、不升华、不哲理；最后一行留一个未完成的动作、一句没说完的话或一个刚出现的威胁。

【节奏样例（照这个拍点写，不要照抄内容）】
✗ 他在泥水里翻过身，背靠着一截半倒的断木坐下，胸膛剧烈起伏，冰凉的雨水顺着领口往里钻，带走皮肤上仅剩的体温。
✓ 他翻过身。泥水没过手背。断木顶住后背，他靠上去，喘了四口气。雨从领口灌进来。冷。他把领子按紧，接着数包里的火柴。
✗ 刀身是 420 不锈钢，净重一百五十克，刃口开六十度。
✓ 刀不重，刃口卷了两处。砍到第三下，木柄开始晃。他换了个握法，继续砍。

【网文"黄金第一章"创作法则】
1. 开场即高能（黄金三秒）：绝不要用长篇大论介绍世界观。起笔第一句必须直接切入一个动作、一次高压审问、一场追杀或一个极具落差感的嘲讽现场。
2. 巧妙引出金手指：在主角陷入困境的最深处，让金手指以一种让人期待的方式展现。
3. 多动少静（动作与对话驱动）：绝不使用上帝视角的干瘪陈述句，全部改成"角色对话 + 神态描写 + 动作互动"。
4. 规避毒点：严格避让全局写作要求与禁忌。
5. ★独场例外（最高优先级）★：若【本章信息】或【本书世界设定】规定本章为"无其他角色"（独场、单人试炼、空场、无人区），可不遵循第 3 条的对话驱动，改用系统广播、机关反馈、环境音与内心独白推进节奏。严禁为了凑对话而自行添加路人、异族、尸体、血迹或旁观者。

【文风要求（如有，请严格遵循）】
{{writing_style}}

【作者文风指纹】（下面是从作者样章中提炼的个人文风特征，请在遣词造句、句式长短、叙述节奏与叙事习惯上向其靠拢；若为空则忽略此项）
{{style_reference}}`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{user_guidance}}

【具体生成要求】
- ★体量硬指标（必须满足，不是参考值）★：本章正文不得少于 {{word_number_min}} 字，目标区间 {{word_number}}~{{word_number_max}} 字。输出前请自行估算全文字数；若不足下限，必须回到场景中继续把内容写足，达标后再输出，绝不允许提前收尾交差。
- 达标的正确做法是把已有场景「写实」，而不是把情节「拉长」：补足具体动作、对白的潜台词与信息差、主角的即时判断、危险的可核查细节；不要把篇幅花在五感堆叠与环境抒情上。
- 严禁用于凑字数的手段：旁白式设定科普、与本章目标无关的日常寒暄、把同一个信息点反复换句表达、提前挪用后续章节的情节。
- 内容边界（与篇幅要求不冲突）：本章只推演【本章信息】规定的核心剧情，达成首章目标后即留悬念断章，绝不可提前泄露后续情节。
- 格式要求：直接输出纯文本正文。禁止使用任何 Markdown 语法符号（如不要用 * 或 ** 或 # 等）。所有对话必须使用标准中文双引号，严禁使用剧本式的对话格式。
- **面板与装备格式（硬指标）**：固定面板只有四类——属性（两行：姓名/等阶、四维）、装备（≤4 行：主手/护具/背包）、道具信息（≤3 行，一次一件）、技能（≤3 行，一次一个）；合计 ≤8 行/章。交易面板、区域等级、边界线、试炼门坐标一律不做固定面板，改走点开、人嘴、告示、路牌、旧地图。禁止在面板内加括号解释；结算不另开「【结算】」卡，只更新属性两行＋两句实物结果。装备只写主手/护具/背包/耐久/防御/已用上限，禁止写重量、体积、便携性（本书规则要求计负重时除外）。
- **强制排版要求：【段落与段落之间必须保留一个空行作为分隔】。绝对不允许连续多行不留空行！**
- **第 1 章开局（硬指标，仅全书第一章）**：按普通求生文开局——现实世界最后三分钟 → 全城公告 → 散点投放 → 坠落与落地 → 检查随身装备 → 属性面板两行 → 找水/找火/第一夜 → 钩子。不写系统目标、不写试炼门、不写交易面板、不写频道、不写老K式熟人；不得直接从雨林醒来，不得用旁白解释世界观，不得让系统弹教程或写“恭喜/欢迎”。
- **系统信息（硬指标，仅全书第一章）**：落地只显示属性面板两行，不给任务、不给目标、不给坐标；第一章系统最多出现一次。前三个月系统不发任务、不给门和交易站位置。
- **投放方式（硬指标，仅全书第一章）**：投放是散点撒落，每个落点单独随机，落地周围没有人。不得写旁边有人摔死、被拖走、呼救；死亡只在远处声音或后续痕迹里出现。
- **聊天（硬指标，全书）**：本书没有好友、区域、世界、队伍频道，也没有聊天面板；不得写任何频道字段卡、好友数、搜索结果。交易面板第 38 章才第一次打开，第一章不写。
- **段落节奏硬指标（手机竖屏 4 行≈70 字）：单段以 40–70 字为宜；关键场景（战斗、揭秘、情绪爆发）单段最多到 90 字，且一个长段之后必须紧跟一个短段或独立成段的对白，禁止连续出现两个长段；任何单段不得超过 120 字。**
- **每 2–3 个叙述段之间，必须插入一个 20–60 字的短段或一句独立成段的对白，用来打破长段的压迫感。**
- **场景切换、时间跳跃、视角转移时必须另起一段；一句对白、一个动作、一个心理闪念都可以单独成段，不必强行合并。**
- **开篇起笔（硬指标）：第一段必须承接上一章结尾的动作、事件或对话往下写；禁止以伤情、天气、汗味、气味等环境句作为固定起手，禁止全章每章都用同一套开场模板。**
- **身体状态（硬指标）：伤情与身体状态只在「发生变化」时写一次，部位+程度+体感最多一句；同一部位、同一程度的状态写过之后，后续章节未加重、未换部位时一律不再复述。除非章纲明确写了致伤事件，否则不写受伤过程和伤情变化。**
- **伤势来源（硬指标）：伤口只允许出现在「战斗之后、试炼内遇袭、遭遇危险、现实遭遇埋伏、章纲指定致伤事件」之后。日常生活琐事（砸废铁、搬货、切菜、刮蹭、磕碰、摔倒、门夹）造成的伤一律不许写；「旧伤＋布条/纱布/渗血/抽痛」式的背景细节也不许写。本章没有致伤事件时，伤口数量必须为 0，身体状态只能写「无伤」「旧伤已愈」或不写。**
- **伤口复述与疼痛写法（硬指标）**：同一处伤口全章最多提两次——受伤当场 1 次（写来源与功能损失），之后最多 1 次（写绕开它的动作或代价）。伤口外观（翻卷/凝固/渗血/结痂/被布条勒住）全章只写 1 次，之后不得再描伤口本身。疼痛词（钝痛/抽痛/刺痛/灼痛/酸胀/发麻/生疼/疼得）全章 ≤2 处。禁止三种句式：①动作触发式疼痛（「每一次/每回/每走一步/每抬一次手/只要…就…扯动/牵扯/传来…钝痛/抽痛/刺痛」）；②「伤口/创口被…勒住/裹住/扎紧」后再接疼；③用「皮肉/神经/甲床/骨膜」等解剖词当疼痛来源。疼只报一次，报「做不到什么」（抬不过肩、握不紧、跑起来左肩发空、喘气只到一半），之后写改法（换手、换肩、改握法、先迈好腿、把包挪到另一边）与代价（慢半拍、失手、被对手抢到空档）。每次想写疼，先问：这个疼改变了哪个动作或决定？改变不了就删。
- **伤口功能化（硬指标）**：伤口的作用是改变动作与选择，不是提醒读者「他受伤了」。同一章不得用两个不同的疼法（钝痛/抽痛/刺痛）轮换，那等于同一句复述；也不得用「不由皱眉/倒吸一口凉气/脸色发白」替代疼。
- **等阶写法（硬指标）**：人物实力写「未入流 / F 阶 / E 阶 / D 阶 / C 阶 / B 阶 / A 阶 / S 阶」；试炼门写「一级 / 二级 / 三级」；装备用品阶「T1–T7」。不写颜色门、颜色装备、卡牌等阶。
- **入场口径（硬指标）**：试炼门没有准入、报名、审批、名单、配额、刷卡、投候室；走到门口推门即进，越级只警告一次。带什么、带多少以【全局写作要求】为准，进门不剥装备。
- **可携带物（硬指标）**：能否随身带入、带什么、带多少，一律以【全局写作要求】的本书规则为准；没有该规则时不自行限制或增设寄存机制。食物、饮水、工具与药品只要在场景中出现，就必须保持连续（谁带的、怎么带、消耗多少），不得凭空出现或凭空消失。
- **系统提示格式（硬指标）：系统提示必须独立成段，以【系统】开头，一次一句，一章 ≤2 次；不得写进人物对白，也不得加引号；不得扩展成多行字段卡。**
- **反规则科普（硬指标）：不得整段解释入场规则、价格规则；规则只能通过动作、对白、单据、系统提示透露，一段最多两句。价格与估值必须带地点或参照（「在这个区」「在三棵榕交易站」「系统商城」），不得写成省略限定语的判断句。**
- **开篇（仅全书第一章）：先用两三句给出世界、时代、地点与事件窗口，再落到人物；起句必须是具体事件或动作，禁止「今天是某某的成年礼」这类流水账起手，也禁止套用其他书的固定句式。非第一章忽略本条。**
- **环境配额（硬指标）：按章纲每场「场景锁定」执行——同一大场景连续时不重复描写环境，沿用已写过的空间/气味/声音；小场景切换只用一句带过（如「整间屋子里安静得只能听见自己的呼吸声」）；配额为 0 的场次不写任何环境句。环境描写必须有功能，能不写就不写。**
- **环境感官形容词（硬指标）：气味必须写出来源物件与位置（如「烧焦的胶皮贴在墙根」「铁皮桶里的雨水泡着烟头」），禁止只甩「焦糊味/铁锈味/腥臭味/土腥味/霉味/腐臭味/臭氧味/化工试剂味」这类固定名词；禁止「空气中弥漫着 X、Y、Z」「混杂着/交织着/夹杂着」「钻进鼻腔」「令人作呕」「沉甸甸压在胸口」「仿佛能拧出水」这套公式，禁止气味三连。废土滤镜词（阴冷、潮湿、斑驳、腐朽、破败、荒凉、死寂、灰败、狰狞、黏腻）全章合计不超过 2 次，且不得用来替人物写情绪（不写「灯光变暗＝他害怕」这种环境映射）。每章气味描写最多 2 处，同一场景不重复。**
- **单人对白超过 80 字时分段：每段行首加左引号，仅最后一段收右引号，禁止一整屏连续独白。**
- **术语复述：本章再次出现前文核心设定词（境界、道具、组织、规则）时，首次出现用一句话轻带解释，帮助隔章阅读的读者回忆，禁止只丢名词。**
- **套路化描写（硬指标，零容忍，出现即违规）：摩挲食指骨节、瞳孔骤缩/缩成针尖、七窍/血线/血丝、后槽牙/牙龈、百丈、“轰”拟声、浑身/全身肌肉紧绷、五指紧扣/指节发白、牙关咬紧、火辣辣地疼、像灌满了铅、耳膜生疼、高频震荡的蜂鸣、翻江倒海——一律 0 次。句式套话同样 0 次：不是…而是…、与其说…不如说、这就够了/仅此而已、事实上/本质上/客观上、形容词三连、破折号抒情。比喻 ≤2 处/千字，破折号 ≤2 处/千字，感叹号 ≤3 个/章。**
- **动作句法模板（硬指标，出现即违规）**：拟声句首「X的一声/一声X」每章 ≤1 次，声音必须写来源（金属撞石棱、铁钉入木、门轴刮地），禁止「啪的一声砸在…」；「动词＋得＋部位＋生疼/发麻/发僵」每章 ≤1 次；「整个人/浑身/全身」做总括主语每章 ≤2 次；「X感顺着Y」每章 ≤1 次；「带走体温/力气」「背靠着…坐下」「胸膛剧烈起伏」「顺着领口往里钻」一律 0 次；「顺手/反手/下意识/本能地」合计 ≤3 次。
- **对话与信息载体（硬指标）**：有第二个人在场的章节，对话（含喊话、广播）占全章 8%–25%，且至少有 1 条规则/价格/方向由别人的嘴、告示牌、旧地图、旧单据给出，叙述者不得概括转述；该章至少 3 个可触摸的社会物件（价目牌、票据、绳索、砍刀、营火、饭盒）。独场章按「独场例外」处理，但至少保留 1 处人声载体（远处喊话、留字条、旧录音、林子里的人声）。
- **句法节奏（硬指标）**：连续 3 句超过 30 字视为长句链，必须拆成动作短句；连续 3 段以「他/她」开头必须换主语、换段式或改成对白；每段最多 1 个比喻；对话单句 ≤25 字；禁止用「于是/然后/接着/随即/紧接着」串联动作，直接用句号断开。
- **参数腔（硬指标，零容忍）**：材料牌号（420 不锈钢、T6 铝合金、60 度摆幅、净重 150 克、热值 1200 大卡之类）一律 0 次；全章精确数值（毫米/厘米/米/公里/克/公斤/升/毫升/度/大卡/百分比/秒）合计 ≤3 处，且每一处都必须服务于一个决定（还剩几根火柴、几公里、几小时）。器物与装备只写「能不能用、还能撑多久、坏了会怎样」，禁止规格介绍、禁止仪表读数式描写。
- **状态转动作（硬指标）：任何情绪或体感必须落成“受力点＋动作对象＋可观察结果”，禁止只写状态词或总括（浑身/全身/四肢/整个人）。疼痛按轻/中/重三级写：轻改握法或重心，中动作中断并付代价，重失能并写出后果。同一具体动作全章 ≤2 次，不得用另一个套话替代套话。**
- **描写节制（硬指标）：一个动作最多跟 1 句体感/环境描写；连续描写不超过 2 句，第 3 句必须回到动作、判断或信息。一段最多 1 个比喻；宁可删掉不硬凑。禁止书面生造词：坠腕/压肩/沁凉/滞涩/绵密/鼓胀。**
- **数字复读（硬指标）：同一段里同一个数字只出现一次；第二次改约数（数十道/十几道/一片）。**
- **卷末/终章或全书高潮章可放宽到目标字数的 1.2–1.5 倍（约 3000–4000 字），用于收束主线、回收伏笔；必须是有效内容，禁止注水复述。**
- 结尾法则：在章节的最后一行留置一个强力钩子。

【AI 味反制——以下模式严禁出现】
- 禁止段尾总结句（如“他知道，这一切才刚刚开始”、“命运的齿轮开始转动”）
- 比喻（仿佛/犹如/宛如/好似/如同/像是）≤2 处/千字，且必须有可验证的物理参照；禁止成品比喻
- 对话必须区分角色语气：不同角色的说话方式必须有辨识度
- 禁止在结尾添加与正文无关的哲理感悟或旁白总结

【写完自检（最后一道；输出前逐条核对，任一条不达标就重写对应段落，不得交差）】
1. 字数：≥{{word_number_min}} 字。
2. 句长：平均 ≤26 字；≤12 字的短句占 22% 以上；连续 3 句 >30 字即长句链，必须拆。
3. 段首：不得连续 3 段以「他/她」开头；单段 40–70 字，关键场景最多 90 字，任何单段不超过 120 字。
4. 拟声句首「X的一声/一声X」≤1 次，且必须写出声音来源（金属撞石棱、铁钉入木、门轴刮地）。
5. 精确数值（毫米/厘米/米/公里/克/公斤/升/毫升/度/大卡/百分比/秒）合计 ≤3 处，且每处都改变一个决定；材料牌号与器物参数（420 不锈钢、T6 铝合金、净重、摆幅、热值、公差、口径、扭矩）0 次。
6. 比喻（仿佛/犹如/宛如/好似/如同/像是）≤2 处/千字；段尾无总结句、无升华、无哲理。
7. 引号：对话一律用中文双引号“”，不得出现英文直引号 " 或 '，不得写成「角色：台词」的剧本格式。
8. 伤口：同一处伤口全章提及 ≤2 次；伤口外观只写 1 次；疼痛词 ≤2 处；无「每一次/每走一步…就…钝痛」「皮肉扯动神经」「疼得直抽气/倒吸凉气」句式；每次疼都改变了动作或决定。
9. 面板：固定面板只有属性（≤2 次、每次 2 行）、装备（≤1 次、≤4 行）、道具（≤1 次、≤3 行）、技能（≤1 次、≤3 行），合计 ≤8 行；不得出现聊天/商城/频道/交易面板/区域等级/边界线状态卡；交易面板与商家私聊只做主观界面（点开、看见、决定）。
10. 最后一行是钩子：一个未完成的动作、一句没说完的话，或一个刚出现的威胁。`,
    contentLocalized: {
      en: `Begin writing the first chapter (the hook chapter) of this novel.

【Full Novel Setting Pool】
{{architecture}}

【Novel World Setting (level cards & trial rules · second only to canon)】
{{world_setting}}

【This Chapter's Info】
{{chapter_info}}

【Future Chapter Outline Preview】(for awareness only — DO NOT write any future content in this chapter!)
{{future_blueprints}}

【Global Writing Requirements】
{{global_guidance}}

【Web Novel "Golden First Chapter" Creation Rules】
1. Open with high energy (golden 3 seconds): Never use lengthy worldbuilding exposition. The opening sentence must dive straight into an action, a high-pressure interrogation, a chase, or a moment of sharp ironic contrast.
2. Cleverly introduce the golden finger: At the protagonist's deepest point of desperation, reveal the golden finger in a way that builds anticipation.
3. Motion over stillness (action and dialogue driven): Never use dry omniscient narration — replace everything with "character dialogue + body language + action interaction."
4. Avoid prohibited elements: Strictly adhere to global writing requirements.

【Writing Style Requirements (if any, follow strictly)】
{{writing_style}}`,
      ru: `Начните писать первую главу (зацепляющую главу) этого романа.

【Пул настроек романа】
{{architecture}}

【Информация об этой главе】
{{chapter_info}}

【Предварительный просмотр конспектов будущих глав】(только для ознакомления — НЕ пишите ничего из будущего в этой главе!)
{{future_blueprints}}

【Глобальные требования к написанию】
{{global_guidance}}

【Правила создания «Золотой первой главы» веб-романа】
1. Откройте с высокой энергией (золотые 3 секунды): никогда не используйте пространные описания мира. Первое предложение должно сразу погрузить в действие, допрос под давлением, погоню или момент острого иронического контраста.
2. Изящно представьте золотой палец: в самой глубокой точке отчаяния героя покажите золотой палец так, чтобы это создало ожидание.
3. Движение вместо статики (через действия и диалоги): никогда не используйте сухое всеведущее повествование — замените всё на «диалоги персонажей + язык тела + действия».
4. Избегайте запрещённых элементов: строго следуйте глобальным требованиям.

【Требования к стилю (если есть, строго соблюдайте)】
{{writing_style}}`
    },
    systemRoleLocalized: {
      en: 'You are a masterful web novel author, skilled at writing gripping, page-turning commercial fiction.',
      ru: 'Вы — мастерски владеющий пером автор веб-романов, искусно пишущий захватывающую, увлекательную коммерческую прозу.'
    },
  },

  {
    key: 'next_chapter_draft',
    name: '后续章节草稿',
    description: '基于上下文和章节蓝图生成后续章节',
    systemRole: '你是一位笔力精湛的顶尖网文小说家，擅长撰写引人入胜、让读者欲罢不能的商业网文正文。',
    variables: {
      canon_context: '【强制】叙事一致性 Canon Context（最高优先级：包含正史设定、人物状态、时间线、最近章节摘要、未结剧情、本章目标、RAG、风格、硬性约束）',
      global_summary: '章节要点时间线（从蓝图按序拼装）',
      character_states: '角色状态',
      short_summary: '近期三章简要',
      previous_ending: '上章结尾800字',
      chapter_info: '本章蓝图信息（JSON）',
      world_setting: '本书世界设定（含区域/试炼门/交易规则）',
      rulebook: '本书规则区（属性成长/精神力/伤势/结算判定）',
      future_blueprints: '后续章节蓝图（防止剧情提前）',
      user_guidance: '作者本章微操指导（可选）',
      filtered_context: '知识库检索结果',
      global_guidance: '全局写作要求',
      word_number: '目标字数',
      word_number_min: '字数硬下限（由目标字数自动派生）',
      word_number_max: '字数上限（由目标字数自动派生）',
      writing_style: '文风描述（可选）',
      style_reference: '作者文风指纹（可选，从样章提炼）',
      foreshadowing: '未回收伏笔清单（可选）',
      anti_repetition: '近期章节开场/断章速览（可选，用于反雷同）',
      character_voices: '出场角色说话风格（可选）',
    },
    content: `你正在连载写作最新章节。

【★★★ 叙事一致性 Canon 上下文（必须严格遵循 · 优先级最高）★★★】
{{canon_context}}

【本书世界设定（含区域/试炼门/交易规则 · 优先级仅次于正典，与设定冲突时以本节为准）】
{{world_setting}}

【本书规则区（属性成长/精神力/伤势/结算判定 · 必须逐条遵循）】
{{rulebook}}

【剧情记忆库与前置断点上下文】
- [全局剧情进展]：{{global_summary}}
- [角色状态监控]：{{character_states}}
- [出场角色说话风格]（对白须贴合各自口癖，不同角色说话方式要有辨识度）：{{character_voices}}
- [近期三章简要]：{{short_summary}}
★【上一章结尾最后一小段（极其关键，起笔必须无缝衔接）】★：
{{previous_ending}}

【本章写作方向与核心任务】
{{chapter_info}}

【后续章节大纲预告】（仅供了解后续剧情发力点，请绝对不要在本章提前写出后续内容！）
{{future_blueprints}}

【知识库资料（如有）】
{{filtered_context}}

【未回收伏笔清单】（下列伏笔尚未回收：到期的应在本章自然回收，未到期的可适度呼应或推进，切勿遗忘，也不要强行提前收束）
{{foreshadowing}}

【近期章节开场/断章速览——反雷同参考】（本章务必与下列章节在"开场方式、场景切入、过渡与断章手法"上明显区分，严禁套用相同的起笔句式、转场模板或断章桥段）
{{anti_repetition}}

【网文连载更新核心法则】
1. 无缝衔接断句：你的第一段必须自然、丝滑地接续上一章结尾，绝不允许出现场景瞬移或突兀的视角跳跃。
2. 动作与神态驱动：用动态的描写推动剧情，不要写"他们聊了很久"，用拔剑声、茶水滴落声、瞳孔的骤缩来代替。
3. 落实本章核心冲突：用 {{word_number}}~{{word_number_max}} 字的篇幅，踏踏实实地推演完本章目标，每个情节节拍都要落到具体的动作与对白上写足，拒绝平淡流水账，更不许写成提纲式的跳跃概述。
4. 悬念断章大法：全章的最后一段，必须卡在一个剧情的小高潮点或突发变故上。
5. 底线铁律：严禁碰触【全局写作要求与禁忌】：{{global_guidance}}。
6. ★独场例外（最高优先级）★：若本章蓝图或【本书世界设定】规定为"无其他角色"（独场、单人试炼、空场、无人区），可不遵循第 2 条的动作/对话驱动，改用系统广播、机关反馈、环境音与内心独白推进节奏。严禁为了凑对白自行添加路人、异族、尸体、血迹或旁观者。

【文风要求（如有，请严格遵循）】
{{writing_style}}

【作者文风指纹】（下面是从作者样章中提炼的个人文风特征，请在遣词造句、句式长短、叙述节奏与叙事习惯上向其靠拢；若为空则忽略此项）
{{style_reference}}`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{user_guidance}}

【输出格式】
- ★体量硬指标（必须满足，不是参考值）★：本章正文不得少于 {{word_number_min}} 字，目标区间 {{word_number}}~{{word_number_max}} 字。输出前请自行估算全文字数；若不足下限，必须回到场景中继续把内容写足，达标后再输出，绝不允许提前收尾交差。
- 达标的正确做法是把已有场景「写实」，而不是把情节「拉长」：补足具体动作、对白的潜台词与信息差、主角的即时判断、危险的可核查细节；不要把篇幅花在五感堆叠与环境抒情上。
- 严禁用于凑字数的手段：旁白式设定科普、与本章目标无关的日常寒暄、把同一个信息点反复换句表达、提前挪用后续大纲的情节。
- 内容边界（与篇幅要求不冲突）：本章只推演【本章信息】规定的核心冲突，达成目标即断章，绝不可擅自拓展后续大纲的情节。
- 仅输出纯文本正文！绝对不要在开头写"第x章 正文如下"。
- 强制要求纯文本，禁止使用任何 Markdown 语法符号。所有对话必使用双引号，严禁剧本式格式。
- **面板与装备格式（硬指标）**：固定面板只有四类——属性（两行：姓名/等阶、四维）、装备（≤4 行：主手/护具/背包）、道具信息（≤3 行，一次一件）、技能（≤3 行，一次一个）；合计 ≤8 行/章。交易面板、区域等级、边界线、试炼门坐标一律不做固定面板，改走点开、人嘴、告示、路牌、旧地图。禁止在面板内加括号解释；结算不另开「【结算】」卡，只更新属性两行＋两句实物结果。装备只写主手/护具/背包/耐久/防御/已用上限，禁止写重量、体积、便携性（本书规则要求计负重时除外）。
- **强制排版要求：【段落与段落之间必须毫无例外地保留一个空行作为分隔】。禁止将多个段落紧凑拼凑成一大块！**
- **主观界面（硬指标）**：交易面板与商家私聊只写角色点开、看见、问价、决定；只留会改变决定的信息（库存、价格、预留、方向、天气）。不得排成「【系统商城｜未接入】」这类字段卡，不得写税率、信用分、拍卖倒计时、在线人数。没有好友、区域、世界、队伍频道；任何频道字段卡都是错误。
- **世界态势（硬指标）**：试炼门位置、区域等级、边界线、交易站位置只走告示、路牌、旧地图、旧单据、尸体、兽群异常、人的嘴；每章最多新增 1 条，不 recap、不倒豆子。
- **段落节奏硬指标（手机竖屏 4 行≈70 字）：单段以 40–70 字为宜；关键场景（战斗、揭秘、情绪爆发）单段最多到 90 字，且一个长段之后必须紧跟一个短段或独立成段的对白，禁止连续出现两个长段；任何单段不得超过 120 字。**
- **每 2–3 个叙述段之间，必须插入一个 20–60 字的短段或一句独立成段的对白，用来打破长段的压迫感。**
- **场景切换、时间跳跃、视角转移时必须另起一段；一句对白、一个动作、一个心理闪念都可以单独成段，不必强行合并。**
- **开篇起笔（硬指标）：第一段必须承接上一章结尾的动作、事件或对话往下写；禁止以伤情、天气、汗味、气味等环境句作为固定起手，禁止全章每章都用同一套开场模板。**
- **身体状态（硬指标）：伤情与身体状态只在「发生变化」时写一次，部位+程度+体感最多一句；同一部位、同一程度的状态写过之后，后续章节未加重、未换部位时一律不再复述。除非章纲明确写了致伤事件，否则不写受伤过程和伤情变化。**
- **伤势来源（硬指标）：伤口只允许出现在「战斗之后、试炼内遇袭、遭遇危险、现实遭遇埋伏、章纲指定致伤事件」之后。日常生活琐事（砸废铁、搬货、切菜、刮蹭、磕碰、摔倒、门夹）造成的伤一律不许写；「旧伤＋布条/纱布/渗血/抽痛」式的背景细节也不许写。本章没有致伤事件时，伤口数量必须为 0，身体状态只能写「无伤」「旧伤已愈」或不写。**
- **伤口复述与疼痛写法（硬指标）**：同一处伤口全章最多提两次——受伤当场 1 次（写来源与功能损失），之后最多 1 次（写绕开它的动作或代价）。伤口外观（翻卷/凝固/渗血/结痂/被布条勒住）全章只写 1 次，之后不得再描伤口本身。疼痛词（钝痛/抽痛/刺痛/灼痛/酸胀/发麻/生疼/疼得）全章 ≤2 处。禁止三种句式：①动作触发式疼痛（「每一次/每回/每走一步/每抬一次手/只要…就…扯动/牵扯/传来…钝痛/抽痛/刺痛」）；②「伤口/创口被…勒住/裹住/扎紧」后再接疼；③用「皮肉/神经/甲床/骨膜」等解剖词当疼痛来源。疼只报一次，报「做不到什么」（抬不过肩、握不紧、跑起来左肩发空、喘气只到一半），之后写改法（换手、换肩、改握法、先迈好腿、把包挪到另一边）与代价（慢半拍、失手、被对手抢到空档）。每次想写疼，先问：这个疼改变了哪个动作或决定？改变不了就删。
- **伤口功能化（硬指标）**：伤口的作用是改变动作与选择，不是提醒读者「他受伤了」。同一章不得用两个不同的疼法（钝痛/抽痛/刺痛）轮换，那等于同一句复述；也不得用「不由皱眉/倒吸一口凉气/脸色发白」替代疼。
- **等阶写法（硬指标）**：人物实力写「未入流 / F 阶 / E 阶 / D 阶 / C 阶 / B 阶 / A 阶 / S 阶」；试炼门写「一级 / 二级 / 三级」；装备用品阶「T1–T7」。不写颜色门、颜色装备、卡牌等阶。
- **入场口径（硬指标）**：试炼门没有准入、报名、审批、名单、配额、刷卡、投候室；走到门口推门即进，越级只警告一次。带什么、带多少以【全局写作要求】为准，进门不剥装备。
- **可携带物（硬指标）**：能否随身带入、带什么、带多少，一律以【全局写作要求】的本书规则为准；没有该规则时不自行限制或增设寄存机制。食物、饮水、工具与药品只要在场景中出现，就必须保持连续（谁带的、怎么带、消耗多少），不得凭空出现或凭空消失。
- **系统提示格式（硬指标）：系统提示必须独立成段，以【系统】开头，一次一句，一章 ≤2 次；不得写进人物对白，也不得加引号；不得扩展成多行字段卡。**
- **反规则科普（硬指标）：不得整段解释入场规则、价格规则；规则只能通过动作、对白、单据、系统提示透露，一段最多两句。价格与估值必须带地点或参照（「在这个区」「在三棵榕交易站」「系统商城」），不得写成省略限定语的判断句。**
- **开篇（仅全书第一章）：先用两三句给出世界、时代、地点与事件窗口，再落到人物；起句必须是具体事件或动作，禁止「今天是某某的成年礼」这类流水账起手，也禁止套用其他书的固定句式。非第一章忽略本条。**
- **环境配额（硬指标）：按章纲每场「场景锁定」执行——同一大场景连续时不重复描写环境，沿用已写过的空间/气味/声音；小场景切换只用一句带过（如「整间屋子里安静得只能听见自己的呼吸声」）；配额为 0 的场次不写任何环境句。环境描写必须有功能，能不写就不写。**
- **环境感官形容词（硬指标）：气味必须写出来源物件与位置（如「烧焦的胶皮贴在墙根」「铁皮桶里的雨水泡着烟头」），禁止只甩「焦糊味/铁锈味/腥臭味/土腥味/霉味/腐臭味/臭氧味/化工试剂味」这类固定名词；禁止「空气中弥漫着 X、Y、Z」「混杂着/交织着/夹杂着」「钻进鼻腔」「令人作呕」「沉甸甸压在胸口」「仿佛能拧出水」这套公式，禁止气味三连。废土滤镜词（阴冷、潮湿、斑驳、腐朽、破败、荒凉、死寂、灰败、狰狞、黏腻）全章合计不超过 2 次，且不得用来替人物写情绪（不写「灯光变暗＝他害怕」这种环境映射）。每章气味描写最多 2 处，同一场景不重复。**
- **单人对白超过 80 字时分段：每段行首加左引号，仅最后一段收右引号，禁止一整屏连续独白。**
- **术语复述：本章再次出现前文核心设定词（境界、道具、组织、规则）时，首次出现用一句话轻带解释，帮助隔章阅读的读者回忆，禁止只丢名词。**
- **套路化描写（硬指标，零容忍，出现即违规）：摩挲食指骨节、瞳孔骤缩/缩成针尖、七窍/血线/血丝、后槽牙/牙龈、百丈、“轰”拟声、浑身/全身肌肉紧绷、五指紧扣/指节发白、牙关咬紧、火辣辣地疼、像灌满了铅、耳膜生疼、高频震荡的蜂鸣、翻江倒海——一律 0 次。句式套话同样 0 次：不是…而是…、与其说…不如说、这就够了/仅此而已、事实上/本质上/客观上、形容词三连、破折号抒情。比喻 ≤2 处/千字，破折号 ≤2 处/千字，感叹号 ≤3 个/章。**
- **动作句法模板（硬指标，出现即违规）**：拟声句首「X的一声/一声X」每章 ≤1 次，声音必须写来源（金属撞石棱、铁钉入木、门轴刮地），禁止「啪的一声砸在…」；「动词＋得＋部位＋生疼/发麻/发僵」每章 ≤1 次；「整个人/浑身/全身」做总括主语每章 ≤2 次；「X感顺着Y」每章 ≤1 次；「带走体温/力气」「背靠着…坐下」「胸膛剧烈起伏」「顺着领口往里钻」一律 0 次；「顺手/反手/下意识/本能地」合计 ≤3 次。
- **对话与信息载体（硬指标）**：有第二个人在场的章节，对话（含喊话、广播）占全章 8%–25%，且至少有 1 条规则/价格/方向由别人的嘴、告示牌、旧地图、旧单据给出，叙述者不得概括转述；该章至少 3 个可触摸的社会物件（价目牌、票据、绳索、砍刀、营火、饭盒）。独场章按「独场例外」处理，但至少保留 1 处人声载体（远处喊话、留字条、旧录音、林子里的人声）。
- **句法节奏（硬指标）**：连续 3 句超过 30 字视为长句链，必须拆成动作短句；连续 3 段以「他/她」开头必须换主语、换段式或改成对白；每段最多 1 个比喻；对话单句 ≤25 字；禁止用「于是/然后/接着/随即/紧接着」串联动作，直接用句号断开。
- **参数腔（硬指标，零容忍）**：材料牌号（420 不锈钢、T6 铝合金、60 度摆幅、净重 150 克、热值 1200 大卡之类）一律 0 次；全章精确数值（毫米/厘米/米/公里/克/公斤/升/毫升/度/大卡/百分比/秒）合计 ≤3 处，且每一处都必须服务于一个决定（还剩几根火柴、几公里、几小时）。器物与装备只写「能不能用、还能撑多久、坏了会怎样」，禁止规格介绍、禁止仪表读数式描写。
- **状态转动作（硬指标）：任何情绪或体感必须落成“受力点＋动作对象＋可观察结果”，禁止只写状态词或总括（浑身/全身/四肢/整个人）。疼痛按轻/中/重三级写：轻改握法或重心，中动作中断并付代价，重失能并写出后果。同一具体动作全章 ≤2 次，不得用另一个套话替代套话。**
- **描写节制（硬指标）：一个动作最多跟 1 句体感/环境描写；连续描写不超过 2 句，第 3 句必须回到动作、判断或信息。一段最多 1 个比喻；宁可删掉不硬凑。禁止书面生造词：坠腕/压肩/沁凉/滞涩/绵密/鼓胀。**
- **数字复读（硬指标）：同一段里同一个数字只出现一次；第二次改约数（数十道/十几道/一片）。**
- **卷末/终章或全书高潮章可放宽到目标字数的 1.2–1.5 倍（约 3000–4000 字），用于收束主线、回收伏笔；必须是有效内容，禁止注水复述。**

【AI 味反制——以下模式严禁出现】
- 禁止段尾总结句（如"他知道，这一切才刚刚开始"、"命运的齿轮开始转动"）
- "仿佛"、"犹如"、"宛如"全章合计不超过3次
- 对话必须区分角色语气：不同角色的说话方式必须有辨识度
- 禁止在结尾添加与正文无关的哲理感悟或旁白总结

【写完自检（最后一道；输出前逐条核对，任一条不达标就重写对应段落，不得交差）】
1. 字数：≥{{word_number_min}} 字。
2. 句长：平均 ≤26 字；≤12 字的短句占 22% 以上；连续 3 句 >30 字即长句链，必须拆。
3. 段首：不得连续 3 段以「他/她」开头；单段 40–70 字，关键场景最多 90 字，任何单段不超过 120 字。
4. 拟声句首「X的一声/一声X」≤1 次，且必须写出声音来源（金属撞石棱、铁钉入木、门轴刮地）。
5. 精确数值（毫米/厘米/米/公里/克/公斤/升/毫升/度/大卡/百分比/秒）合计 ≤3 处，且每处都改变一个决定；材料牌号与器物参数（420 不锈钢、T6 铝合金、净重、摆幅、热值、公差、口径、扭矩）0 次。
6. 比喻（仿佛/犹如/宛如/好似/如同/像是）≤2 处/千字；段尾无总结句、无升华、无哲理。
7. 引号：对话一律用中文双引号“”，不得出现英文直引号 " 或 '，不得写成「角色：台词」的剧本格式。
8. 伤口：同一处伤口全章提及 ≤2 次；伤口外观只写 1 次；疼痛词 ≤2 处；无「每一次/每走一步…就…钝痛」「皮肉扯动神经」「疼得直抽气/倒吸凉气」句式；每次疼都改变了动作或决定。
9. 面板：固定面板只有属性（≤2 次、每次 2 行）、装备（≤1 次、≤4 行）、道具（≤1 次、≤3 行）、技能（≤1 次、≤3 行），合计 ≤8 行；不得出现聊天/商城/频道/交易面板/区域等级/边界线状态卡；交易面板与商家私聊只做主观界面（点开、看见、决定）。
10. 最后一行是钩子：一个未完成的动作、一句没说完的话，或一个刚出现的威胁。`,
    contentLocalized: {
      en: `You are continuing serialization with the latest chapter.

【★★★ Narrative Consistency Canon Context (MUST follow strictly · HIGHEST PRIORITY) ★★★】
{{canon_context}}

【Novel World Setting (level cards & trial rules · second only to canon)】
{{world_setting}}

【Plot Memory Bank & Prior Breakpoint Context】
- [Global plot progress]: {{global_summary}}
- [Character state monitoring]: {{character_states}}
- [Recent three chapters brief]: {{short_summary}}
★【Last paragraph of the previous chapter (CRITICAL — opening must connect seamlessly)】★:
{{previous_ending}}

【This Chapter's Writing Direction & Core Task】
{{chapter_info}}

【Future Chapter Outline Preview】(for awareness only — DO NOT write any future content in this chapter!)
{{future_blueprints}}

【Knowledge Base Materials (if any)】
{{filtered_context}}

【Core Serialization Update Rules】
1. Seamless sentence bridging: Your first paragraph must naturally and smoothly continue from the previous chapter's ending — absolutely no scene jumps or abrupt POV shifts.
2. Action and body language driven: Use dynamic descriptions to push the plot. Don't write "they talked for a long time" — use the sound of a sword drawn, tea dripping, pupils contracting.
3. Execute this chapter's core conflict: In approximately {{word_number}} words, thoroughly play out this chapter's objective — no bland diary entries.
4. Suspense cliffhanger technique: The final paragraph must land on a minor climax or sudden twist.
5. Iron-bottom rule: Never violate [Global Writing Requirements]: {{global_guidance}}.

【Writing Style Requirements (if any, follow strictly)】
{{writing_style}}`,
      ru: `Вы продолжаете сериал сlatest главой.

【★★★ Контекст канона нарративной согласованности (СТРОГО соблюдать · ВЫСШИЙ ПРИОРИТЕТ) ★★★】
{{canon_context}}

【Банк памяти сюжета и контекст предыдущей точки разрыва】
- [Глобальный прогресс сюжета]: {{global_summary}}
- [Мониторинг состояния персонажей]: {{character_states}}
- [Краткое содержание последних трёх глав]: {{short_summary}}
★【Последний абзац предыдущей главы (КРИТИЧНО — начало должно бесшовно продолжать)】★:
{{previous_ending}}

【Направление написания этой главы и основная задача】
{{chapter_info}}

【Предварительный просмотр конспектов будущих глав】(только для ознакомления — НЕ пишите ничего из будущего в этой главе!)
{{future_blueprints}}

【Материалы из базы знаний (если есть)】
{{filtered_context}}

【Основные правила обновления сериала】
1. Бесшовное соединение предложений: ваш первый абзац должен естественно и плавно продолжать концовку предыдущей главы — абсолютно никаких скачков сцены или резких переключений точки зрения.
2. Через действия и язык тела: используйте динамичные описания для продвижения сюжета. Не пишите «они долго разговаривали» — используйте звук вынутого меча, капающий чай, резкое сужение зрачков.
3. Выполните основной конфликт этой главы: в объёме примерно {{word_number}} слов тщательно разыграйте цель этой главы — никаких скучных дневниковых записей.
4. Техника интриги: последний абзац должен завершиться малой кульминацией или внезапным поворотом.
5. Железное правило: никогда не нарушайте [Глобальные требования к написанию]: {{global_guidance}}.

【Требования к стилю (если есть, строго соблюдайте)】
{{writing_style}}`
    },
    systemRoleLocalized: {
      en: 'You are a masterful web novel author, skilled at writing gripping, page-turning commercial fiction.',
      ru: 'Вы — мастерски владеющий пером автор веб-романов, искусно пишущий захватывающую, увлекательную коммерческую прозу.'
    },
  },

  // ================================================================
  // 修稿
  // ================================================================

  {
    key: 'refine_chapter',
    name: '大神级修稿',
    description: '将草稿提升到大神级质量',
    systemRole: '你是一位功力深厚的文学编辑，擅长将普通文稿精修为白金品质力作。',
    variables: {
      canon_context: '【强制】叙事一致性 Canon Context（精修时绝不可破坏的事实基线）',
      rulebook: '本书规则区（属性成长/精神力/伤势/结算判定）',
      draft_content: '章节草稿内容',
      chapter_info: '章节信息',
      global_guidance: '写作要求',
      global_summary: '近章要点（蓝图摘要）',
      short_summary: '近章摘要',
      word_number: '目标字数',
      word_number_min: '字数硬下限（由目标字数自动派生）',
      word_number_max: '字数上限（由目标字数自动派生）',
      user_refine_prompt: '用户自定义修稿指导（可选）',
      writing_style: '文风描述（可选）',
    },
    content: `请对章节草稿进行【精修与细节填充】。

【★★★ 叙事一致性 Canon 上下文（精修时绝不可破坏的事实基线）★★★】
{{canon_context}}

【本书规则区（属性成长/精神力/伤势/结算判定 · 精修不得违反）】
{{rulebook}}

【剧情上下文】
- 全书目前进度摘要：{{global_summary}}
- 近期章节回顾：{{short_summary}}

【本章信息】
{{chapter_info}}

【精修要求】
1. 画面感（Sense of Presence）：只在动作或信息需要时补 1 句可核查的感官细节，优先写动作结果与危险信息；禁止五感堆叠，禁止为了"有画面"硬加比喻。
2. 设定咬合：巧妙地将金手指的使用细节融入战斗或博弈中，体现主角的差异化优势。
3. 情绪张力：强化反派的压迫感与主角的回击力度。遵循"欲扬先抑"法则，但在高潮处必须给足爽感。
4. 词汇升级：使用更精准、更具镜头感的动作词汇。用动作和细节来展示情绪（Show, Don't Tell）。
5. 钩子与节奏：检查结尾处是否有强力钩子（Hook），确保读者有强烈的追读欲望。
6. 篇幅底线：精修以"修掉问题"为目标，不以扩写为目标。精修后字数不得低于 {{word_number_min}} 字，上限 {{word_number_max}} 字；删除套话、体感堆叠、数字复读后不需要补回，只有信息缺失时才补具体动作或判断，不得为凑字数增肥。
7. 反注水（约束手段，不约束长度）：禁止靠说教式科普、无关寒暄、重复表述同一信息点来充数；也禁止增补原稿没有的新剧情。
8. 套路化描写零容忍（出现即删）：摩挲食指骨节/瞳孔骤缩/七窍血线/后槽牙/百丈/轰/浑身肌肉紧绷/五指紧扣/牙关咬紧/火辣辣地疼/像灌满了铅/耳膜生疼/蜂鸣/翻江倒海，一律改成“受力点＋动作对象＋可观察结果”的具体动作；疼痛按轻改握法、中动作中断、重失能三级写。
9. 数字复读：同一段里同一个数字只出现一次，第二次改约数（数十道/十几道/一片）。
10. 面板分层：固定面板只保留属性（两行：姓名/等阶、四维）、装备（≤4 行）、道具信息（≤3 行，一次一件）、技能（≤3 行，一次一个），合计 ≤8 行/章；交易面板、区域等级、边界线、门坐标不得写成「【…｜…】」状态卡，只保留角色点开、看见、决定的叙述。原稿若把状态卡写成正文，按此改写，不得新增教程。

【全局写作禁忌】
{{global_guidance}}

【待精修原稿】
{{draft_content}}

【文风要求（如有，精修时严格向此风格靠拢）】
{{writing_style}}`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{user_refine_prompt}}

请直接输出精修后的全文章节内容。强制要求纯文本，禁止使用任何 Markdown 语法符号，严禁剧本式对话。【严禁】任何开场白或解释文字。
**【强制排版底线】：段落与段落之间必须保留一个空行作为分隔，绝不允许不留空行的连续长段落。单段控制在 40–70 字（手机竖屏 3–4 行），超过 90 字的段落必须按语义拆开；不得把多段合并成一大块。**

**【精修完成自检（最后一道，逐条核对）】**
- 精修后字数不得低于本章下限；不为凑字数增肥，也不得净删超过 10%。
- 平均句长 ≤26 字；≤12 字的短句 ≥22%；连续 3 句 >30 字必须拆；不得连续 3 段以「他/她」开头。
- 精确数值全章 ≤3 处；材料牌号与器物参数（420 不锈钢、净重、摆幅、热值、公差）0 次；不得把原文的动作改写成规格表。
- 同一处伤口提及 ≤2 次、疼痛词 ≤2 处；不得新增「每一次…就疼」式复述或新的伤口外观描写。
- 固定面板只有属性/装备/道具/技能四类，合计 ≤8 行；不得新增聊天/频道/交易面板/区域等级/边界线状态卡。
- 比喻 ≤2 处/千字；段尾无总结、无升华；最后一行仍是钩子。
- 对话一律用中文双引号“”，不得出现英文直引号 " 或 '。`,
    contentLocalized: {
      en: `Please perform a [polish and detail enrichment] pass on this chapter draft.

【★★★ Narrative Consistency Canon Context (MUST NOT violate during polish) ★★★】
{{canon_context}}

【Plot Context】
- Current global progress summary: {{global_summary}}
- Recent chapters review: {{short_summary}}

【This Chapter's Info】
{{chapter_info}}

【Polish Requirements】
1. Sensory Presence: Strengthen environmental descriptions through "five senses" details (sight, sound, smell, touch, taste) — reject bland, watered-down narration.
2. Setting Integration: Skillfully weave golden finger usage details into combat or strategy scenes, showcasing the protagonist's differentiated advantage.
3. Emotional Tension: Amplify the antagonist's oppressive presence and the protagonist's counterforce. Follow the "build-up before the payoff" rule, but deliver maximum satisfaction at the climax.
4. Vocabulary Upgrade: Use more precise, cinematic action verbs. Show emotions through actions and details (Show, Don't Tell).
5. Hook and Pacing: Check whether the ending has a strong hook (Hook) that gives readers a compelling urge to continue reading.
6. Anti-Filler Substitution: Polish means vocabulary substitution and enhanced sensory presence — NOT padding the word count with bloated exposition or sermon-like exposition. Target approximately {{word_number}} words. If you find verbose action descriptions or preachy exposition, cut decisively — never infinitely expand and drag down the pacing.

【Global Writing Prohibitions】
{{global_guidance}}

【Original Draft to Polish】
{{draft_content}}

【Writing Style Requirements (if any, polish strictly toward this style)】
{{writing_style}}`,
      ru: `Пожалуйста, выполните этап [шлифовки и обогащения деталями] для этого черновика главы.

【★★★ Контекст канона нарративной согласованности (НЕ НАРУШАТЬ при шлифовке) ★★★】
{{canon_context}}

【Контекст сюжета】
- Краткое содержание текущего глобального прогресса: {{global_summary}}
- Обзор последних глав: {{short_summary}}

【Информация об этой главе】
{{chapter_info}}

【Требования к шлифовке】
1. Ощущение присутствия: усильте описания окружения через детали «пяти чувств» (зрение, слух, обоняние, осязание, вкус) — отбрасывайте водянистое повествование.
2. Интеграция сеттинга: искусно вплетайте детали использования золотого пальца в боевые или стратегические сцены, демонстрируя дифференцированное преимущество героя.
3. Эмоциональное напряжение: усиливайте давящее присутствие антагониста и контрудар героя. Следуйте правилу «нарастание перед кульминацией», но обеспечивайте максимальное удовлетворение в кульминационный момент.
4. Обновление словаря: используйте более точные, кинематографичные глаголы действия. Покажите эмоции через действия и детали (Покажи, а не расскажи).
5. Крючок и темп: проверьте, есть ли в конце сильный крючок (Hook), дающий читателю непреодолимое желание продолжить чтение.
6. Антиводозамена: шлифовка — это замена слов и усиление ощущения присутствия — А НЕ наращивание объёма пространными описаниями или поучительными отступлениями. Целевой объём: примерно {{word_number}} слов. Если встречается многословное описание действий или поучительная проповедь —果断 сокращайте, никогда не раздувайте бесконечно и не замедляйте темп.

【Глобальные запреты на написание】
{{global_guidance}}

【Исходный черновик для шлифовки】
{{draft_content}}

【Требования к стилю (если есть, при шлифовке строго приближайтесь к этому стилю)】
{{writing_style}}`
    },
    systemRoleLocalized: {
      en: 'You are a seasoned literary editor, skilled at elevating ordinary drafts to platinum-quality masterpieces.',
      ru: 'Вы — опытный литературный редактор, искусно превращающий обычные черновики в произведения платинового качества.'
    },

  },

  // ================================================================
  // 时间线抽取
  // ================================================================

  {
    key: 'extract_chapter_timeline',
    name: '章节时间线抽取',
    description: '从定稿正文中抽取时间点，供时间校准与时间轴写入',
    systemRole: '你是一位负责时间线校对的小说编辑。你只提取正文明确写出或可直接推算的时间，不臆测、不补写。',
    variables: {
      chapter_content: '定稿章节正文',
      chapter_title: '章节标题',
      chapter_number: '章节号',
      blueprint_events: '本章章纲计划事件（含计划时间）',
      timeline_config: '本书时间设定（历法/起点/流速/口径）',
      previous_events: '前情已确认时间线事件',
    },
    content: `请从下面的定稿正文中抽取时间线事件，并标注每个事件的时间依据。

【本章】第 {{chapter_number}} 章 {{chapter_title}}

【本书时间设定】
{{timeline_config}}

【前情已确认事件】
{{previous_events}}

【本章章纲计划事件】
{{blueprint_events}}

【定稿正文】
{{chapter_content}}

【抽取规则】
1. 只记「发生了什么 + 什么时候」，不写心理描写。
2. 时间必须来自正文：明示日期/第几天/时段，或可由「三天后/次日/当晚/半小时后」直接推算。
3. 推算时以上一条事件的 absolute_time 为锚点；没有锚点时用章纲计划时间。
4. 「几天后 / 没多久 / 过了好一阵」标 confidence=low，不臆造具体天数。
5. 回忆、倒叙必须把 time_flow 设为 flashback，并在 summary 首字写「回忆」。
6. 每章 1–6 条事件；同一场景内连续动作合并成一条。
7. absolute_time 用相对天数：6 月 30 日 = 1，7 月 1 日 = 2；可带小数表示钟点（上午 9 点 = 当天 +0.375）。
8. 不写正文里没有的地点、人物、道具。

【输出 JSON】
{
  "events": [
    {
      "sequence": 1,
      "story_time": "第 3 天 深夜",
      "raw_time": "三天后，他回到了焦痕",
      "absolute_time": "3.98",
      "duration": "两个时辰",
      "location": "焦痕",
      "participants": ["商临野"],
      "summary": "商临野回到焦痕，确认落点没有返回提示。",
      "time_flow": "sequential",
      "evidence": "三天后，他回到了焦痕"
    }
  ]
}

只输出 JSON，不要解释。`,
  },

  // ================================================================
  // 审稿
  // ================================================================

  {
    key: 'consistency_check',
    name: '一致性审稿',
    description: '检查章节的一致性问题',
    systemRole: '你是一位极其严谨、铁面无私的小说质量监督编辑。你只检查可验证的问题：事实一致性、设定规则合规、模板化表达；不评价主观文笔与创作方向。',
    variables: {
      chapter_content: '章节内容',
      character_states: '角色状态',
      global_summary: '上下文检索结果',
      world_building: '世界观设定',
      system_rules: '本书规则区（属性成长/精神力/伤势/结算判定），用于规则合规审查',
      canon_context: '已确立事实（时间线+角色状态+剧情线+硬性约束），用于交叉验证',
      review_focus: '审稿维度侧重点（可选）',
      foreshadowing: '已知未回收伏笔清单（可选）',
    },
    content: `请对以下章节进行审查。

【待审章节】
{{chapter_content}}

【角色状态】
{{character_states}}

【全局摘要】
{{global_summary}}


【已确立事实基线（用于交叉验证 — 所有事实以此为准，本章不得与之矛盾）】
{{canon_context}}

【世界观设定】
{{world_building}}

【本书规则区（属性成长/精神力/伤势/结算 · 用于规则合规审查）】
{{system_rules}}

【已知未回收伏笔清单】（用于核对"伏笔完整性"维度：本章是否漏收了到期伏笔、是否与已有伏笔体系冲突）
{{foreshadowing}}

【审查原则】

1. 举证审查：只报告有明确文本证据的问题。每个问题必须引用原文具体句子。
2. 宁缺毋滥：没有问题的维度，输出一条 severity 为 pass 的记录即可。不要凑数量。
3. 只查可验证问题：事实一致性、设定规则合规、模板化表达；不报告主观风格偏好或创作灵感建议。
4. 客观可验证：报出的每个问题必须能被第三方编辑复查确认。

【检查维度】

1. 剧情连贯性：本章情节是否与前文（全局摘要）有矛盾？前后文是否自相矛盾？
2. 剧情合理性：因果逻辑是否成立？人物动机是否合理？是否有常识性硬伤？
3. 角色状态：角色行为、能力、位置、情感是否与角色状态档案一致？
4. 前后章节串联：伏笔、悬念是否连贯？是否出现未交代前因的突兀情节？
5. 伏笔完整性：本章是否存在应回收而未提及的前置伏笔？是否有与已知伏笔体系冲突的新增设置？
6. 设定规则合规（对照【本书规则区】）：属性是否只在试炼结算时增长？是否出现吃灵植/喝药/穿装备直接加属性？七阶只看最高单项与 1/4 铁律是否成立？伤势等级、治疗手段与恢复时间是否成立？技能槽是否超限？是否发放契约类道具？凡出现"战斗中突破/药剂瞬回/未结算先涨属性/结构视界越一个大阶解析/契约道具"，一律记 error。
7. 模板化与冗余表达：套话比喻（火辣辣地疼/像灌满了铅/血腥味/耳膜生疼/高频震荡的蜂鸣/翻江倒海）、单段体感堆叠（同一段≥4 个体感词）、同段数字复读（如"三十六颗……三十六道"）、书面生造词（坠腕/压肩/沁凉/滞涩/绵密/鼓胀）；句式套话（不是…而是…、与其说…不如说、这就够了/仅此而已、事实上/本质上、形容词三连）。命中记 warning；同类共现 3 处以上记 error，并引用原句。
8. 试炼设计合规：本章若涉及试炼门，必须属于生存、狩猎、采集、守点四类之一；门是否野外随机刷新、存在 3–7 天？系统是否只给门等级/类型/时限/奖励类别，而没有给坐标？越级进门是否只警告、不阻止？是否错误地写成固定窗口、投候室、刷卡入场、排行榜、跨星 PVP、全星区公告？违规一律记 error。
9. 面板分层：是否出现「【聊天/商城/频道/交易面板/区域等级/边界线/接入/额度…】」状态卡？固定面板是否只有属性/装备/道具/技能四类、合计 ≤8 行？属性面板是否 ≤2 次？是否夹带第 N 天、门坐标、交易站距离、人口、边界线速度、伤势、负重、击杀、材料？H01/H02/H04 命中记 error，H03 超限记 warning；并核对全书没有频道、没有好友、系统未发任务/未给坐标。
10. 术语与境界命名：实力只能写未入流、F 阶、E 阶、D 阶、C 阶、B 阶、A 阶、S 阶；试炼门只能写一级/二级/三级门；装备只能写 T1–T7。凡出现"白门/黄门/蓝门/红门/紫门/金门/黑门、白装/黄装、试炼卡、卡源、凡胎境、破限境、半步X级、X级巅峰、初阶/中阶/高阶"等旧口径，一律记 error。属性只能写"心识"，出现"意识属性"记 error。
11. 伤势来源：本章每处伤口/绷带/血迹/疼痛，是否有"战斗之后、试炼内遇袭、遭遇危险、现实遭遇埋伏、章纲指定致伤事件"作为来源？日常生活琐事（砸废铁、搬货、切菜、刮蹭、磕碰、摔倒、门夹）致伤、以及"旧伤＋布条"式背景，一律记 error。章纲没有致伤事件时，伤口数量必须为 0，写成"无伤的完好状态"这类病历式表达记 warning。
12. 装备命名与品阶：是否出现颜色装备（白装/黄装/蓝装/红装/紫装/金装/黑装）或"返X卡"？装备只能写 T1–T7；人物实力写"F 阶"等；试炼门写"一级/二级"；不得写"F 级装备""E 阶装备"。违规记 error。
13. 携带物与来路：本章出现的食物、饮水、工具、药品、星币，是否都有来路（随身、捡的、换的、做的、抢的、试炼给的）？是否凭空出现或凭空消失？进门是否错误地写"只能带 3 件装备/1 张卡"或被入口剥离？本书进门不剥装备、不验资、不刷卡。违规记 error。
14. 入场语义与系统边界：是否把进门写成报名、审批、名单、配额、刷卡、投候室、投放台？本书进门只需走到门口、推门进入；系统只警告一次，不阻止。系统是否发了任务、给了目标、给了门坐标或交易站位置？是否出现好友/区域/世界/队伍频道？违规记 error。系统提示若写进人物对白或加引号，记 warning。
15. 反规则科普与价格句：是否整段解释入场规则、卡规则、价格规则（一段超过两句规则说明记 warning）？价格句是否缺地点介词（"这个区，这盒东西……"式）？是否出现系统提示未独立成段、未以【系统】开头？
16. 环境感官套话：是否出现"空气中弥漫着焦糊味/铁锈味/腥臭味/土腥味/霉味/腐臭味/臭氧味/化工试剂味"这类固定名词堆叠？是否用"混杂着/交织着/夹杂着/钻进鼻腔/令人作呕/沉甸甸压在胸口/仿佛能拧出水"收尾？是否气味三连、且没有写出具体来源物件与位置？废土滤镜词（阴冷、潮湿、斑驳、腐朽、破败、荒凉、死寂、灰败、狰狞、黏腻）全章是否超过 2 次？是否用环境替人物写情绪（灯光变暗＝害怕、空气凝固＝震惊）？命中两项以上记 warning，三项以上记 error。
17. 描写落点与状态转动作：每处情绪/体感是否落成"受力点＋动作对象＋可观察结果"？是否只写状态词或总括（浑身/全身/四肢/整个人＋紧绷/发紧/发凉/发麻/发抖）？是否把"五指紧扣"换成"指节发白"这类换汤不换药？同一具体动作是否全章超过 2 次？整段只有状态词且没有动作，记 error；其余命中记 warning。
18. 句法节奏与参数腔：全文精确数值（毫米/厘米/米/公里/克/公斤/升/毫升/度/大卡/百分比/秒）是否超过 3 处？是否出现材料牌号或器物规格（420 不锈钢、T6 铝合金、净重、摆幅、热值、公差、口径、扭矩）？是否连续 3 句超过 30 字、连续 3 段以「他/她」开头、或用「于是/然后/接着/随即/紧接着」串联动作？是否用英文直引号 " 代替中文双引号“”？参数腔命中记 error；句法节奏命中两项以上记 warning，三项以上记 error，并引用原句。
19. 伤口复述：同一处伤口全章提及是否超过 2 次？伤口外观（翻卷/凝固/渗血/结痂/被布条勒住）是否重复描写？疼痛词（钝痛/抽痛/刺痛/酸胀/生疼/疼得）是否超过 2 处？是否出现「每一次/每回/每走一步/每抬一次手/只要…就…扯动/牵扯…钝痛」「皮肉/神经」当痛源、「疼得直抽气/倒吸凉气/皱眉/脸色发白」式疼痛表演？每次疼是否改变了动作或决定？命中两项以上记 error，并引用原句。

`,
    systemSuffix: `★【作者要求重点检查的维度（如有，这些维度必须优先、深入检查）】★：
{{review_focus}}

## 输出格式（JSON）

请严格输出以下 JSON 格式：

{"items":[{"category":"剧情连贯性","severity":"pass","description":"未发现与前文矛盾"},{"category":"剧情合理性","severity":"error","quote":"原文中的具体句子","description":"问题描述"},{"category":"角色状态","severity":"warning","quote":"原文句子","description":"轻微不一致说明"},{"category":"设定规则合规","severity":"error","quote":"原文句子","description":"未结算就长属性，来源不成立"},{"category":"术语与境界命名","severity":"error","quote":"原文句子","description":"出现非标准境界名或错误术语"},{"category":"模板化描写","severity":"warning","quote":"原文句子","description":"套话比喻，建议删除"}],"summary":"一句话总体评价"}

severity 取值：error=严重矛盾或规则违规（强烈建议修复）, warning=轻微不一致或模板化表达（酌情修复）, pass=该维度通过无问题。
每个 category 至少输出一条记录。quote 字段在 pass 时可省略。`,
    contentLocalized: {
      en: `Please review the following chapter.

【Chapter Under Review】
{{chapter_content}}

【Character States】
{{character_states}}

【Global Summary】
{{global_summary}}


【Established Facts Baseline (for cross-validation — all facts take precedence here; this chapter must not contradict them)】
{{canon_context}}

【Worldbuilding】
{{world_building}}

【Review Principles】

1. Evidence-based review: Only report problems with clear textual evidence. Each problem must cite a specific sentence from the original text.
2. Quality over quantity: For dimensions with no issues, output a single record with severity "pass." Don't pad the count.
3. Check consistency only — no style critique: Do not report style preferences, writing suggestions, or creative advice. Only report verifiable factual contradictions.
4. Objective and verifiable: Each problem you report must be confirmable by a third-party editor.

【Check Dimensions】

1. Plot Continuity: Does this chapter's plot contradict earlier content (global summary)? Are there self-contradictions within the chapter?
2. Plot Logic: Do cause-and-effect relationships hold up? Are character motivations plausible? Are there common-sense errors?
3. Character States: Are character behaviors, abilities, locations, and emotions consistent with the character state files?
4. Cross-Chapter Continuity: Are foreshadowing and suspense lines consistent? Are there abrupt plot developments without established cause?
5. Foreshadowing Completeness: Are there any foreshadowed elements from prior chapters that should have been resolved but weren't? Are there new settings that conflict with the established foreshadowing system?`,
      ru: `Пожалуйста, проверьте следующую главу.

【Проверяемая глава】
{{chapter_content}}

【Состояния персонажей】
{{character_states}}

【Глобальное резюме】
{{global_summary}}


【Базовый набор установленных фактов (для перекрёстной проверки — все факты здесь имеют приоритет; эта глава не должна им противоречить)】
{{canon_context}}

【Мироздание】
{{world_building}}

【Принципы проверки】

1. Проверка на основе доказательств: сообщайте только о проблемах с чёткой текстовой поддержкой. Каждая проблема должна цитировать конкретное предложение из оригинального текста.
2. Качество важнее количества: для измерений без проблем выводите одну запись со severity «pass». Не наращивайте количество.
3. Проверяйте только согласованность — без критики стиля: не сообщайте о предпочтениях стиля, советах по написанию или творческих рекомендациях. Только проверяемые фактологические противоречия.
4. Объективность и проверяемость: каждая проблема, о которой вы сообщаете, должна быть подтверждаема сторонним редактором.

【Измерения для проверки】

1. Непрерывность сюжета: противоречит ли сюжет этой главы предыдущему контенту (глобальное резюме)? Есть ли внутренние противоречия?
2. Логика сюжета: выдерживают ли причинно-следственные связи? Правдоподобны ли мотивации персонажей? Есть ли ошибки здравого смысла?
3. Состояния персонажей: соответствуют ли поведение, способности, местоположение и эмоции персонажей файлам состояний?
4. Сквозная непрерывность: последовательны ли линии предвестий и интриг? Есть ли резкие сюжетные повороты без установленной причины?
5. Полнота предвестий: остались ли какие-либо элементы из предыдущих глав, которые должны были быть раскрыты, но не были? Есть ли новые настройки, противоречащие установленной системе предвестий?`
    },
    systemRoleLocalized: {
      en: 'You are a meticulous, impartial quality control editor. You check only objective factual issues — you never evaluate subjective writing quality.',
      ru: 'Вы — тщательный, беспристрастный редактор контроля качества. Вы проверяете только объективные фактологические проблемы — никогда не оцениваете субъективное качество текста.'
    },
  },

  // ================================================================
  // 文风分析
  // ================================================================

  {
    key: 'analyze_writing_style',
    name: '文风分析',
    description: '从正文样本中提取作者的写作风格特征',
    systemRole: '你是一位资深的文学评论家和网文研究者，擅长精准捕捉作者的写作风格指纹。',
    variables: {
      sample_text: '正文采样文本（3-5章拼接）',
    },
    content: `请仔细阅读以下小说正文样本，深度分析并提炼作者的写作风格特征。

【正文样本】
{{sample_text}}

【分析维度与输出要求】
请从以下 7 个维度分析，每个维度用 2-3 句话精准概括，并附带 1 个原文例句作为佐证（总计 300-500 字）：

1. 叙述节奏：整体叙事快慢、场景切换频率、段落长短偏好
2. 描写密度：环境描写/动作描写/心理描写的比重偏好
3. 对话风格：对话在全文中的比例、对话的口语化程度、是否使用方言或特殊腔调
4. 用词偏好：是否偏好古风用词/现代流行语/专业术语、整体词汇丰富度
5. 情感基调：整体偏热血/冷峻/诙谐/沉重/轻松
6. 叙事视角习惯：主要用第几人称、是否频繁切换视角、内心独白的使用频率
7. 标志性手法：作者特有的修辞手法、常用的过渡技巧、独特的段落结构

【输出格式】
直接输出纯文本分析结果，使用以下格式：

叙述节奏：……
描写密度：……
对话风格：……
用词偏好：……
情感基调：……
叙事视角：……
标志性手法：……

不要添加任何无关解释或客套话。`,
    contentLocalized: {
      en: `Please carefully read the following novel text sample and deeply analyze the author's writing style characteristics.

【Text Sample】
{{sample_text}}

【Analysis Dimensions & Output Requirements】
Analyze across the following 7 dimensions, using 2–3 precise sentences per dimension with 1 original-text quote as evidence (total 300–500 words):

1. Narrative Pacing: overall narrative speed, scene transition frequency, paragraph length preferences
2. Descriptive Density: ratio of environment/action/psychological descriptions
3. Dialogue Style: proportion of dialogue in the text, level of colloquialism, use of dialect or distinctive speech patterns
4. Vocabulary Preference: classical/literary phrasing vs. modern slang vs. technical jargon, overall lexical richness
5. Emotional Tone: overall lean toward hot-blooded / cool and detached / witty / somber / lighthearted
6. Narrative POV Habits: primary person used, frequency of POV switches, frequency of internal monologue
7. Signature Techniques: the author's distinctive rhetorical devices, common transitional techniques, unique paragraph structures

【Output Format】
Output the analysis as plain text using the following format:

Narrative Pacing: …
Descriptive Density: …
Dialogue Style: …
Vocabulary Preference: …
Emotional Tone: …
Narrative POV: …
Signature Techniques: …

Do not add any irrelevant explanations or pleasantries.`,
      ru: `Пожалуйста, внимательно прочитайте следующий образец текста романа и глубоко проанализируйте стилистические особенности автора.

【Образец текста】
{{sample_text}}

【Измерения анализа и требования к выводу】
Проанализируйте по следующим 7 измерениям, используя 2–3 точных предложения на измерение с 1 цитатой из оригинала в качестве доказательства (всего 300–500 слов):

1. Ритм повествования: общая скорость повествования, частота переключения сцен, предпочтения по длине абзацев
2. Плотность описаний: соотношение описаний окружения / действий / переживаний
3. Стиль диалогов: доля диалогов в тексте, уровень разговорности, использование диалекта или характерной речи
4. Лексические предпочтения: литературная / архаичная речь vs. современный сленг vs. профессиональный жаргон, общая лексическая насыщенность
5. Эмоциональный тон: общий уклон в сторону героического / холодно-отстранённого / ироничного / мрачного / лёгкого
6. Привычки точки зрения: основное лицо повествования, частота переключений точки зрения, частота внутреннего монолога
7. Фирменные приёмы: характерные риторические устройства автора, типичные переходы, уникальная структура абзацев

【Формат вывода】
Выведите анализ в виде простого текста в следующем формате:

Ритм повествования: …
Плотность описаний: …
Стиль диалогов: …
Лексические предпочтения: …
Эмоциональный тон: …
Точка зрения: …
Фирменные приёмы: …

Не добавляйте лишних пояснений или вступлений.`
    },
    systemRoleLocalized: {
      en: 'You are a seasoned literary critic and web novel researcher, skilled at precisely capturing an author\'s writing style fingerprint.',
      ru: 'Вы — опытный литературный критик и исследователь веб-романов, искусно точно определяющий стилистический «отпечаток» автора.'
    },
  },

  {
    key: 'refine_from_review',
    name: '审稿驱动修稿',
    description: '根据审稿报告中的问题精准修复草稿',
    systemRole: '你是一位严谨的小说编辑，擅长精准修复文本中的具体问题而不过度改写。',
    variables: {
      canon_context: '【强制】叙事一致性 Canon Context（审稿修复时绝不可破坏的事实基线）',
      rulebook: '本书规则区（属性成长/精神力/伤势/结算判定）',
      review_report: '审稿报告内容',
      draft_content: '待修稿内容',
      global_guidance: '全局写作要求',
      user_refine_prompt: '用户额外修稿指导（可选）',
    },
    content: `请根据【审稿报告】中列出的问题，对草稿进行**精准修复**。

【★★★ 叙事一致性 Canon 上下文（修复时绝不可破坏的事实基线）★★★】
{{canon_context}}

【本书规则区（修复时不得违反，也不得把违规改得更违规）】
{{rulebook}}

【审稿报告】
{{review_report}}

【待修稿内容】
{{draft_content}}

【全局写作要求】
{{global_guidance}}

【文风总纲（最高优先级，与其他条款冲突时以此为准）】
1. 视角贴人：第三人称限知，只写主角看得见、听得见、摸得到、判断得出的东西；不替他解释世界，不写他不可能知道的信息。
2. 一句一件事：平均句长 ≤26 字，短句（≤12 字）占 22% 以上；连续 3 句超过 30 字视为长句链，必须断开。
3. 动作先于感受：先写手在做什么、脚踩在哪里、东西有没有坏，再写疼不疼、怕不怕；禁止先甩情绪词再补动作。
4. 细节只留“会改变决定”的：水够不够、火会不会灭、伤口能不能走、对方会不会动手；不写氛围、不写装饰、不写参数表。
5. 信息从人嘴里、纸上、系统里出来：规则、价格、方向由对白、告示、路牌、旧地图、旧单据、系统提示承担；叙述者一段最多两句概括。
6. 情绪不命名：不写“他感到恐惧/绝望/愤怒”，写他握紧什么、退了几步、把哪句话咽回去。
7. 比喻克制：≤2 处/千字，必须有可验证的物理参照；禁止成品比喻（像灌了铅、像刀割）。
8. 数字克制：全章精确数值（含材料牌号、克数、升数、角度、卡路里）≤3 处，且每一处都必须影响决策；禁止“420 不锈钢”“六十度摆幅”“净重 150 克”式规格介绍。
9. 段落有呼吸：单段 40–70 字，关键场景最多 90 字；一个长段后必须跟短段或独立对白；每 2–3 个叙述段插一个 20–60 字短段。
10. 收在钩子上：段尾不总结、不升华、不哲理；最后一行留一个未完成的动作、一句没说完的话或一个刚出现的威胁。

【节奏样例（照这个拍点写，不要照抄内容）】
✗ 他在泥水里翻过身，背靠着一截半倒的断木坐下，胸膛剧烈起伏，冰凉的雨水顺着领口往里钻，带走皮肤上仅剩的体温。
✓ 他翻过身。泥水没过手背。断木顶住后背，他靠上去，喘了四口气。雨从领口灌进来。冷。他把领子按紧，接着数包里的火柴。
✗ 刀身是 420 不锈钢，净重一百五十克，刃口开六十度。
✓ 刀不重，刃口卷了两处。砍到第三下，木柄开始晃。他换了个握法，继续砍。

【修复原则】
1. 只修复审稿报告中明确指出的问题，一条一条逐项解决
2. 不要进行审稿报告未提及的润色或改写
3. 保持原文的风格与节奏；修复套话、冗余描写、数字复读时允许净删，但删减后全文字数不得低于原文的 90%，且不得低于本章字数下限（不足时用等量的动作、对话、环境细节补回，不得注水复读）；不得为了凑字数而增肥
4. 对每处修改保持最小变化原则——改得越少越好，只解决问题本身；但被审稿点名的套话必须删掉，不能换一个比喻顶上`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{user_refine_prompt}}

请直接输出修复后的全文章节内容。强制要求纯文本，严禁剧本式格式，【严禁】任何开场白、解释文字。
**【强制排版底线】：段落与段落之间必须保留一个空行作为分隔，绝对不允许连续文本不留空行。单段控制在 40–70 字（手机竖屏 3–4 行），超过 90 字的段落按语义拆开。**

**【修完自检（最后一道，逐条核对）】**
- 修复后字数不得低于原文的 90%，且不低于本章字数下限。
- 平均句长 ≤26 字；≤12 字的短句 ≥22%；连续 3 句 >30 字必须拆；不得连续 3 段以「他/她」开头。
- 精确数值全章 ≤3 处；材料牌号与器物参数（420 不锈钢、净重、摆幅、热值、公差）0 次，不得新增原文没有的规格描述。
- 同一处伤口提及 ≤2 次、疼痛词 ≤2 处；不得新增「每一次…就疼」式复述或新的伤口外观描写。
- 固定面板只有属性/装备/道具/技能四类，合计 ≤8 行；不得新增聊天/频道/交易面板/区域等级/边界线状态卡。
- 对话一律用中文双引号“”，不得出现英文直引号 " 或 '。
- 段尾无总结、无升华；最后一行仍是钩子。`,
    contentLocalized: {
      en: `Please perform a **targeted fix** on the draft based on the issues listed in the review report.

【★★★ Narrative Consistency Canon Context (MUST NOT violate during repair) ★★★】
{{canon_context}}

【Review Report】
{{review_report}}

【Draft to Repair】
{{draft_content}}

【Global Writing Requirements】
{{global_guidance}}

【Repair Principles】
1. Fix ONLY the problems explicitly identified in the review report — address them one by one.
2. Do NOT perform any polishing or rewriting beyond what the review report mentions.
3. Preserve the original's style, pacing, and word count volume.
4. For each change, maintain the principle of minimal change — fix as little as possible, only addressing the problem itself.`,
      ru: `Пожалуйста, выполните **точечный ремонт** черновика на основе проблем, перечисленных в отчёте проверки.

【★★★ Контекст канона нарративной согласованности (НЕ НАРУШАТЬ при ремонте) ★★★】
{{canon_context}}

【Отчёт проверки】
{{review_report}}

【Черновик для ремонта】
{{draft_content}}

【Глобальные требования к написанию】
{{global_guidance}}

【Принципы ремонта】
1. Исправляйте ТОЛЬКО проблемы, явно указанные в отчёте проверки — решайте их по одной.
2. НЕ проводите никакой дополнительной шлифовки или переписывания сверх того, что указано в отчёте.
3. Сохраняйте стиль, темп и объём оригинала.
4. Для каждого изменения соблюдайте принцип минимальных изменений — исправляйте как можно меньше, только устраняя саму проблему.`
    },
    systemRoleLocalized: {
      en: 'You are a meticulous fiction editor, skilled at precisely fixing specific textual issues without over-rewriting.',
      ru: 'Вы — тщательный редактор художественной литературы, искусно точно исправляющий конкретные текстовые проблемы без избыточного переписывания.'
    },
  },

  // ================================================================
  // 去 AI 味润色
  // ================================================================

  {
    key: 'deaify_polish',
    name: '去 AI 味润色',
    description: '检测并改写"一眼是 AI 写的"文本特征，降低平台 AI 检测命中率，同时保持情节/风格/篇幅',
    systemRole: '你是一位深谙网文语感的资深责编，专治"AI 腔"。你能在不改动情节与人设的前提下，把机械、套路、书面的表达改写成有呼吸感的人类文字。',
    variables: {
      draft_content: '待清洗的章节正文',
      writing_style: '作者文风描述（清洗后需向此风格靠拢）',
      intensity: '清洗强度（轻/中/重）',
      rule_findings: '本地规则命中的高风险片段（优先改写）',
    },
    content: `请对以下章节正文进行【去 AI 味】清洗改写。目标：消除"一眼是 AI 写的"痕迹，让文字更像真人写手，同时**不改动任何情节、人设、设定与关键信息**。

【清洗强度】：{{intensity}}
- 轻：只清理最明显的 AI 腔，改动克制
- 中：系统性清理下列所有模式（默认）
- 重：在中的基础上更大胆地重组句式与节奏

【本地规则命中（优先处理，改完不得保留同类句式）】
{{rule_findings}}

【需要重点清除/改写的 AI 味模式】
1. 段尾升华总结句：删除或改写"他知道，这一切才刚刚开始""命运的齿轮开始转动""而这，仅仅是个开始"这类空洞收尾。
2. 比喻词滥用："仿佛/犹如/宛如/像是"整章合计压到 3 次以内，其余改成具体动作或感官细节。
3. 万能过渡句："与此同时""不知过了多久""空气仿佛凝固了""时间仿佛静止"等模板化过渡，替换为具体的时间/动作/环境信号。
4. 机械排比与三段式：打散"他看着…，他想着…，他知道…"这类节拍雷同的排比堆砌。
5. 情绪解说（Tell）：把"他感到一阵恐惧""内心涌起愤怒"改为通过动作、生理反应、对话展示（Show）。
6. 播音腔对话：让不同角色的说话方式有辨识度，去掉千人一面的书面对白，加入符合人设的口语、停顿、语气词。
7. 过度工整：适度打破句子长度的均匀感，长短句交错，制造真人写作的节奏起伏。
8. 套路化描写零容忍：摩挲食指骨节/瞳孔骤缩/七窍血线/后槽牙/百丈/轰/浑身肌肉紧绷/五指紧扣/牙关咬紧/火辣辣地疼/像灌满了铅/耳膜生疼/蜂鸣/翻江倒海，出现即删，改成“受力点＋动作对象＋可观察结果”的具体动作；疼痛按轻改握法、中动作中断、重失能三级写。不得用另一个套话顶上。
9. 描写堆叠与套话：一个动作跟了 3 句以上体感/环境描写时，直接删到 1-2 句；"火辣辣的疼/像灌满了铅/每一次呼吸都带着血腥味/耳膜生疼/高频震荡的蜂鸣/胃里翻江倒海"这类套话，优先整句删除，不要换一个比喻顶上；"坠腕/压肩/沁凉/滞涩/绵密/鼓胀"这类书面生造词改成大白话。
10. 数字复读：同一段里同一个数字出现两次（如"三十六颗晶石……三十六道射线"），第二次改成约数"数十道/十几道/一片"，避免阅读节奏打结。
11. 描写节制：描写必须服务于动作推进、危险信息或人物判断；三者都不服务的，整句删。宁可少写，不要硬凑气氛。
12. 环境气味套话：删除"空气中弥漫着焦糊味/铁锈味/腥臭味/土腥味/霉味/腐臭味/臭氧味/化工试剂味"这类固定名词堆叠，以及"混杂着/交织着/钻进鼻腔/令人作呕/沉甸甸压在胸口/仿佛能拧出水"的固定搭配。气味只能保留有具体来源、有位置的写法（"烧焦的胶皮贴在墙根"）；删掉靠气味渲染气氛、但不承载信息的整句。废土滤镜词（阴冷、潮湿、斑驳、腐朽、破败、荒凉、死寂、灰败、狰狞、黏腻）全章合计压到 2 次以内。禁止用环境替人物写情绪（"灯光变暗＝他害怕"）。
13. 参数腔：删掉材料牌号与器物规格（420 不锈钢、T6 铝合金、净重一百五十克、六十度摆幅、热值一千二百大卡、公差、口径、扭矩、目数、纯度），改成"能不能用、还能撑多久、坏了会怎样"。全章精确数值压到 3 处以内，且每处都要影响一个决定；纯说明用数字（规格、读数、仪表刻度）一律改成动作结果或约数。
14. 句法节奏：把连续 3 句以上的长句（>30 字）拆成动作短句；把连续 3 段以「他/她」开头的段落换主语、换段式或改成对白；删掉用「于是/然后/接着/随即/紧接着」串起来的动作链，改用句号断开。改写后平均句长压到 26 字以内，≤12 字的短句占 22% 以上。
15. 伤口复述：同一处伤口只留「受伤当场 1 次 + 功能受限 1 次」；删掉所有「每一次摆臂/每走一步/每抬一次手，皮肉就扯动神经，传来阵阵钝痛」的动作触发式疼痛句；删掉「疼得直抽气/倒吸凉气/皱眉/脸色发白」的疼痛表演；疼痛词（钝痛/抽痛/刺痛/酸胀/生疼/疼得）压到 2 处以内；不得用「皮肉/神经/甲床/骨膜」当痛源；把疼改成「做不到什么/改了什么动作」，不保留单纯的疼痛形容词。
16. 面板分层：把「【聊天/商城/频道/交易面板/区域等级/边界线/接入/额度…】」状态卡改成角色点开、看见、问价、决定的 2–3 条信息；固定面板只保留属性（两行）、装备（≤4 行）、道具（≤3 行，一次一件）、技能（≤3 行，一次一个），合计 ≤8 行/章；删掉面板里的第 N 天、门坐标、交易站距离、人口、边界线速度、伤势、负重、击杀、材料；连续 3 行以上字段卡只保留规定行数。不得把状态卡改成另一种字段卡。

【作者文风（清洗后须贴合，不可改变整体调性）】
{{writing_style}}

【待清洗正文】
{{draft_content}}`,
    systemSuffix: `【硬约束（违反任意一条都算失败，宁可少改也不能越界）】
- 绝不改动情节走向、人物行为、设定细节、数字、时间与专有名词。
- **对白的语义与信息量必须完整保留**：可以改口吻、用词、口语化程度，但**不得删掉台词里的任何关键信息或前文呼应**（例如"刚才还说电梯会——"这类回指，绝不能砍成一句脏话/感叹了事）。
- **伏笔、回指、因果线索一律保留**，不得以"精简/去套路"为名删除任何承载信息的句子。
- **角色专属信息不得泛化**（例如"林越锁骨处未愈合的玻璃"是林越的专属伤情，不能替换成"像有人往伤口塞玻璃"这类通用比喻）。
- 常规改写幅度控制在 ±10%；若为删除套话、体感堆叠与数字复读，允许净减最多 10%；不得增肥。删除只限纯修饰、套话、重复体感，承载情节/伏笔/角色信息的句子一律保留。
- **禁止用另一个比喻替换原比喻**：套话要么删，要么改成具体动作或结果。
- 只做"表达层"的去 AI 味，不做"内容层"的改写。若某处改写会牵动以上任意一条，**保持原文不动**。

【输出格式】
- 只输出清洗后的章节正文，【严禁】任何开场白、说明、批注或前后缀。
- 纯文本，禁止任何 Markdown 语法符号；对话一律使用中文双引号，严禁剧本式格式。
- **段落与段落之间必须保留一个空行作为分隔。单段控制在 40–70 字（手机竖屏 3–4 行），超过 90 字的段落按语义拆开。**`,
  },

  // ================================================================
  // 章节要点生成（定稿后处理 / 按章推演）
  // ================================================================

  {
    key: 'generate_chapter_notes',
    name: '章节要点生成',
    description: '定稿后为本章生成结构化要点（剧情节点、角色动态、新增设定、伏笔与钩子）',
    systemRole: '你是一位专业的网文结构分析师。',
    variables: {
      chapter_content: '章节正文内容',
      chapter_number: '章节编号',
      chapter_title: '章节标题',
    },
    content: `请为以下章节生成一份精确的【结构化章节要点】。

【章节正文】
第{{chapter_number}}章 {{chapter_title}}
{{chapter_content}}

---

请严格按照以下 Markdown 格式输出，不要添加任何额外说明：

# 第{{chapter_number}}章 要点

## 剧情节点
（列出本章中不可逆的关键剧情进展，使用 [类型] 标注）
- [触发] ...
- [转折] ...
- [结果] ...

## 角色动态
（用表格记录本章出场的主要角色及其变化）
| 角色 | 本章变化/状态 |
|------|-------------|
| 角色名 | 具体变化描述 |

## 新增设定
（本章首次出现或确认的世界观/力量体系/规则，无则省略此节）
- ...

## 伏笔与钩子
（本章埋下的伏笔用 [埋]，章末留给读者的钩子用 [钩]，无则省略此节）
- [埋] ...
- [钩] ...

严格按格式输出，内容精炼，每项不超过 30 字。`,
    contentLocalized: {
      en: `Please generate an accurate set of [Structured Chapter Notes] for the following chapter.

【Chapter Text】
Chapter {{chapter_number}}: {{chapter_title}}
{{chapter_content}}

---

Please output strictly in the following Markdown format without any additional explanation:

# Chapter {{chapter_number}} Notes

## Plot Beats
(List irreversible key plot developments in this chapter, annotated with [Type])
- [Trigger] …
- [Turning Point] …
- [Outcome] …

## Character Dynamics
(Record the main characters appearing this chapter and their changes in a table)
| Character | This Chapter's Change / Status |
|-----------|-------------------------------|
| Character Name | Specific change description |

## New Settings
(World-building / power systems / rules first introduced or confirmed in this chapter; omit if none)
- …

## Foreshadowing & Hooks
(Foreshadowed elements marked [Planted]; cliffhangers left for readers marked [Hook]; omit if none)
- [Planted] …
- [Hook] …

Output strictly in format, keep content concise, each item no more than 30 words.`,
      ru: `Пожалуйста, создайте точный набор [Структурированных заметок к главе] для следующей главы.

【Текст главы】
Глава {{chapter_number}}: {{chapter_title}}
{{chapter_content}}

---

Выведите строго в следующем формате Markdown без каких-либо дополнительных пояснений:

# Заметки к главе {{chapter_number}}

## Сюжетные узлы
(Перечислите необратимые ключевые сюжетные события этой главы с пометкой [Тип])
- [Триггер] …
- [Поворотный момент] …
- [Исход] …

## Динамика персонажей
(Зафиксируйте основных персонажей этой главы и их изменения в таблице)
| Персонаж | Изменение / Статус за эту главу |
|----------|----------------------------------|
| Имя персонажа | Описание конкретного изменения |

## Новые настройки
(Мироздание / системы сил / правила, впервые введённые или подтверждённые в этой главе; опустите, если нет)
- …

## Предвестия и крючки
(Предвестия — пометка [Заложено]; интриги для читателей — пометка [Крючок]; опустите, если нет)
- [Заложено] …
- [Крючок] …

Выводите строго по формату, содержание краткое, каждый пункт не более 30 слов.`
    },
    systemRoleLocalized: {
      en: 'You are a professional web novel structural analyst.',
      ru: 'Вы — профессиональный структурный аналитик веб-романов.'
    },
  },

  // ================================================================
  // 分层摘要：卷摘要 / 全书摘要（定稿后处理，每卷最后一章定稿时生成）
  // ================================================================

  {
    key: 'generate_arc_summary',
    name: '卷摘要生成',
    description: '每卷最后一章定稿后，把本卷各章要点压缩为卷摘要，作为长篇写作的远期记忆',
    systemRole: '你是一位资深的长篇网文编辑，擅长提炼长篇叙事的主线脉络。',
    variables: {
      arc_start: '本卷起始章',
      arc_end: '本卷结束章',
      chapter_summaries: '本卷各章要点',
    },
    content: `请把下面第{{arc_start}}-{{arc_end}}章的章节要点，压缩成一段【卷摘要】，供后续写作时回顾本卷剧情。

【本卷各章要点】
{{chapter_summaries}}

---

写作要求：
1. 300~500 字，连贯叙述，不要逐章罗列，不要使用 Markdown 标题或列表。
2. 必须保留：主线推进与走向、关键转折及其因果、主要角色的立场 / 关系 / 实力变化、本卷新确立且后续会用到的设定、仍未回收的伏笔与悬念。
3. 只写已经发生的内容，不预测、不评价、不加入要点里没有的情节。
4. 直接输出摘要正文，不要任何开场白或说明。`,
    contentLocalized: {
      en: `Please condense the chapter notes for chapters {{arc_start}}-{{arc_end}} below into a single [Arc Summary], used to recall this arc's story during later writing.

【Chapter Notes for This Arc】
{{chapter_summaries}}

---

Requirements:
1. 200–350 words of continuous prose — do not go chapter by chapter, and do not use Markdown headings or lists.
2. Must preserve: main-plot progress and direction, key turning points and their causes, changes in the main characters' stances / relationships / power, settings established in this arc that later chapters will rely on, and foreshadowing or open questions not yet resolved.
3. Only describe what has already happened — no predictions, no commentary, no plot that is not in the notes.
4. Output the summary text directly, without any preamble or explanation.`,
      ru: `Сожмите приведённые ниже заметки к главам {{arc_start}}–{{arc_end}} в одно [Резюме арки], чтобы при дальнейшей работе можно было вспомнить сюжет этой арки.

【Заметки к главам этой арки】
{{chapter_summaries}}

---

Требования:
1. 200–350 слов связного текста — не пересказывайте главы по порядку и не используйте заголовки или списки Markdown.
2. Обязательно сохраните: развитие и направление основного сюжета, ключевые повороты и их причины, изменения позиций / отношений / силы главных персонажей, установки этой арки, на которые будут опираться следующие главы, а также ещё не раскрытые предвестия и загадки.
3. Описывайте только уже произошедшее — без прогнозов, оценок и событий, которых нет в заметках.
4. Выведите сразу текст резюме, без вступлений и пояснений.`
    },
    systemRoleLocalized: {
      en: 'You are a senior long-form web novel editor, skilled at distilling the main throughline of a long narrative.',
      ru: 'Вы — опытный редактор длинных веб-романов, умеющий выделять главную линию длинного повествования.'
    },
  },

  {
    key: 'generate_book_summary',
    name: '全书摘要生成',
    description: '由各卷卷摘要汇总出全书摘要，作为长篇写作的远期记忆',
    systemRole: '你是一位资深的长篇网文编辑，擅长提炼长篇叙事的主线脉络。',
    variables: {
      arc_summaries: '各卷卷摘要（按顺序）',
      covered_until: '覆盖到的章节',
    },
    content: `下面是这部小说目前已完成各卷的卷摘要（覆盖到第{{covered_until}}章）。请据此写出一份【全书摘要】，作为后续写作的长期记忆。

【各卷摘要（按顺序）】
{{arc_summaries}}

---

写作要求：
1. 600~1000 字，按时间顺序连贯叙述整部作品至今的主线，不要使用 Markdown 标题或列表。
2. 越早的剧情写得越概括，越近的剧情保留越多细节。
3. 必须保留：核心矛盾及其演变、主角成长轨迹、重要人物的关系与命运变化、已确立的关键设定、仍在进行的主线与未回收的重大伏笔。
4. 只写已经发生的内容，不预测后续、不评价。
5. 直接输出摘要正文，不要任何开场白或说明。`,
    contentLocalized: {
      en: `Below are the arc summaries of every completed arc of this novel so far (through chapter {{covered_until}}). Based on them, write a [Book Summary] to serve as long-term memory for later writing.

【Arc Summaries (in order)】
{{arc_summaries}}

---

Requirements:
1. 400–700 words of continuous prose narrating the main line of the whole work so far in chronological order — no Markdown headings or lists.
2. The earlier the events, the more condensed; the more recent, the more detail you keep.
3. Must preserve: the core conflict and how it evolved, the protagonist's growth arc, changes in the relationships and fates of important characters, key established settings, and ongoing main plotlines and major unresolved foreshadowing.
4. Only describe what has already happened — no predictions of what comes next, no commentary.
5. Output the summary text directly, without any preamble or explanation.`,
      ru: `Ниже приведены резюме всех завершённых арок романа на данный момент (до главы {{covered_until}}). На их основе напишите [Резюме книги], которое послужит долгосрочной памятью для дальнейшей работы.

【Резюме арок (по порядку)】
{{arc_summaries}}

---

Требования:
1. 400–700 слов связного текста, излагающего основную линию всего произведения до настоящего момента в хронологическом порядке, — без заголовков и списков Markdown.
2. Чем раньше события, тем сжатее; чем ближе к текущему моменту, тем больше деталей.
3. Обязательно сохраните: основной конфликт и его развитие, путь роста главного героя, изменения в отношениях и судьбах важных персонажей, ключевые установленные установки, продолжающиеся сюжетные линии и крупные нераскрытые предвестия.
4. Описывайте только уже произошедшее — без прогнозов и оценок.
5. Выведите сразу текст резюме, без вступлений и пояснений.`
    },
    systemRoleLocalized: {
      en: 'You are a senior long-form web novel editor, skilled at distilling the main throughline of a long narrative.',
      ru: 'Вы — опытный редактор длинных веб-романов, умеющий выделять главную линию длинного повествования.'
    },
  },

  // ================================================================
  // 伏笔抽取与回收识别（定稿后处理 / JSON 输出）
  // ================================================================

  {
    key: 'foreshadow_extract',
    name: '伏笔抽取与回收识别',
    description: '定稿后从本章正文抽取新埋伏笔，并识别哪些已知未回收伏笔在本章得到回收（结构化 JSON）',
    systemRole: '你是一位擅长长篇叙事结构的网文责编，精于追踪伏笔的埋设与回收。',
    variables: {
      chapter_number: '章节编号',
      chapter_content: '本章正文',
      open_foreshadowings: '当前未回收伏笔清单（JSON 数组，含 id）',
    },
    content: `分析第 {{chapter_number}} 章正文，完成两件事：
1. 识别本章【新埋下】的伏笔/悬念/未解之谜（只收真正需要后续回收的线索，不要把当场已解决的普通事件当伏笔）。
2. 对照【已知未回收伏笔】，判断其中哪些在本章【已被回收/兑现】。

【本章正文（第{{chapter_number}}章）】
{{chapter_content}}

【已知未回收伏笔】（JSON 数组，每项含 id / content / plantedChapter / expectedChapter）
{{open_foreshadowings}}

【输出格式（严格 JSON，不要任何多余文字）】
{"planted":[{"content":"新伏笔的简洁描述（30字内）","expectedChapter":预期回收章节号或null}],"paidIds":[被本章回收的已知伏笔 id 数组]}

要求：
- planted 不要重复【已知未回收伏笔】中已存在的条目。
- paidIds 只填【已知未回收伏笔】中确实在本章被回收的项的 id（数字），没有则填空数组 []。
- expectedChapter 无法判断时填 null。
- 若本章既无新伏笔也无回收，输出 {"planted":[],"paidIds":[]}。`,
  },

  // ================================================================
  // 角色卡 currentState 更新（JSON 输出）
  // ================================================================

  {
    key: 'update_character_cards',
    name: '更新角色卡动态状态',
    description: '定稿后分析章节内容，以 JSON 格式返回有变化的角色的 currentState 字段，用于自动更新角色卡',
    systemRole: '你是一位严谨的小说角色档案管理员，擅长追踪角色多维状态变化。',
    variables: {
      chapter_content: '章节正文内容',
      chapter_number: '章节编号',
      existing_cards_json: '现有角色卡 JSON 数组（包含 name/role 等基础信息）',
    },
    content: `请根据章节内容，以 JSON 格式返回在本章中发生状态变化的角色的最新状态。

【本章内容（第{{chapter_number}}章）】
{{chapter_content}}

【现有角色卡（基础信息）】
{{existing_cards_json}}

---

【任务要求】
1. 分析并在 \`updates\` 中提取已有角色（从提供的现有角色卡中找）发生状态变化的信息。
2. 分析并在 \`newCharacters\` 中提取本章新出场的重要角色（不要包含路人或已死无后续影响的龙套）。
3. \`currentState\` 字段说明：
   - location: 当前所在位置/阵营（字符串）
   - powerLevel: 修为境界/能力等级（字符串）
   - physicalState: 身体状态，按「部位·程度·起始章节」记录（如「右膝擦伤·轻微·第2章」；无伤写「正常」）；旧伤未变化时保留原值原样，不要因本章没写就清空，也不要把无关旧伤堆在一起（字符串，80字以内）
   - mentalState: 心理状态，当前愿望/恐惧/心态（字符串）
   - keyItems: 当前持有的关键道具/资源（字符串）
   - recentEvents: 本章发生的最重要事件（字符串，50字以内）
   - knownInfo: 【累积维护】该角色截至本章已经知晓的关键信息/秘密/情报，尤其是与其他角色存在信息差的部分（谁不知道什么）。请完整列出（含往期已知的，不要只写本章新增）；确无特别信息时可留空（字符串，100字以内）
   - speechStyle: 【仅在该角色说话方式有鲜明特征时才填】把其口头禅/句式/语气习惯提炼成一句话（如"爱用反问、句尾常带'懂?'、话少而冲"）；没有明显特征就留空。用于在角色卡尚无说话风格档案时自动初始化，不必每章重复填（字符串，60字以内）
   - talents: 【动态·结构化】天赋/体质/血脉等先天或觉醒能力，字符串数组（如 ["十倍痛觉","浊息亲和"]）；本章有新增或变化才填，无变化可省略该字段
   - skills: 【动态·结构化】已掌握的功法/技能/招式，字符串数组（如 ["斩铁式","血锈铭域"]）；本章有新增或变化才填，无变化可省略该字段
   - updatedAtChapter: 固定填写 {{chapter_number}}（数字）

【固定档案禁止改写】外貌、性格、背景故事、动机、人物弧光、关系等固定档案不属于 currentState，一律不要输出，即使本章剧情涉及它们。

【输出格式（JSON）】
{
  "updates": [
    {
      "name": "已有角色的精确名字",
      "currentState": {
        "location": "...",
        "powerLevel": "...",
        "physicalState": "...",
        "mentalState": "...",
        "keyItems": "...",
        "recentEvents": "...",
        "knownInfo": "...",
        "speechStyle": "",
        "talents": [],
        "skills": [],
        "updatedAtChapter": {{chapter_number}}
      }
    }
  ],
  "newCharacters": [
    {
      "name": "新角色名字",
      "role": "主要人物/反派/配角/导师",
      "currentState": {
        "location": "...",
        "powerLevel": "...",
        "physicalState": "...",
        "mentalState": "...",
        "keyItems": "...",
        "recentEvents": "...",
        "knownInfo": "...",
        "speechStyle": "",
        "talents": [],
        "skills": [],
        "updatedAtChapter": {{chapter_number}}
      }
    }
  ]
}

如果本章无任何角色发生状态变化且无新角色，返回 {"updates": [], "newCharacters": []}。`,
    contentLocalized: {
      en: `Based on the chapter content, return the latest states of characters who underwent changes in this chapter in JSON format.

【This Chapter's Content (Chapter {{chapter_number}})】
{{chapter_content}}

【Existing Character Cards (Basic Info)】
{{existing_cards_json}}

---

【Task Requirements】
1. Analyze and extract in \`updates\` the state changes of existing characters (found among the provided character cards).
2. Analyze and extract in \`newCharacters\` any important new characters appearing in this chapter (exclude background extras or dead characters with no further impact).
3. \`currentState\` field description:
   - location: current location / faction (string)
   - powerLevel: cultivation level / ability tier (string)
   - physicalState: physical condition including injuries / buffs / appearance changes (string)
   - mentalState: psychological state, current wish / fear / mindset (string)
   - keyItems: currently held key items / resources (string)
   - recentEvents: most important event in this chapter (string, under 50 words)
   - talents: 【dynamic · structured】innate or awakened traits (e.g. ["tenfold pain","turbid-breath affinity"]) as a string array; only include when new or changed in this chapter, otherwise omit
   - skills: 【dynamic · structured】techniques / martial arts / spells already mastered as a string array; only include when new or changed, otherwise omit
   - updatedAtChapter: fixed value {{chapter_number}} (number)

【Fixed profile is read-only】Appearance, personality, background, motivation, character arc and relationships are fixed profile fields and must NOT be output in currentState.

【Output Format (JSON)】
{
  "updates": [
    {
      "name": "Exact name of existing character",
      "currentState": {
        "location": "...",
        "powerLevel": "...",
        "physicalState": "...",
        "mentalState": "...",
        "keyItems": "...",
        "recentEvents": "...",
        "talents": [],
        "skills": [],
        "updatedAtChapter": {{chapter_number}}
      }
    }
  ],
  "newCharacters": [
    {
      "name": "New character name",
      "role": "protagonist/antagonist/supporting/minor",
      "currentState": {
        "location": "...",
        "powerLevel": "...",
        "physicalState": "...",
        "mentalState": "...",
        "keyItems": "...",
        "recentEvents": "...",
        "talents": [],
        "skills": [],
        "updatedAtChapter": {{chapter_number}}
      }
    }
  ]
}

If no characters had state changes and no new characters appeared, return {"updates": [], "newCharacters": []}.`,
      ru: `На основе содержания главы верните в формате JSON最新的 состояния персонажей, которые изменились в этой главе.

【Содержание этой главы (Глава {{chapter_number}})】
{{chapter_content}}

【Существующие карточки персонажей (основная информация)】
{{existing_cards_json}}

---

【Требования к заданию】
1. Проанализируйте и извлеките в \`updates\` изменения состояний существующих персонажей (среди предоставленных карточек).
2. Проанализируйте и извлеките в \`newCharacters\` любых важных новых персонажей, появившихся в этой главе (исключайте фоновых extras или мёртвых персонажей без дальнейшего влияния).
3. Описание поля \`currentState\`:
   - location: текущее местоположение / фракция (строка)
   - powerLevel: уровень культивации / уровень способностей (строка)
   - physicalState: физическое состояние, включая травмы / баффы / внешние изменения (строка)
   - mentalState: психологическое состояние, текущее желание / страх / настрой (строка)
   - keyItems: текущие ключевые предметы / ресурсы (строка)
   - recentEvents: важнейшее событие главы (строка, до 50 слов)
   - updatedAtChapter: фиксированное значение {{chapter_number}} (число)

【Формат вывода (JSON)】
{
  "updates": [
    {
      "name": "Точное имя существующего персонажа",
      "currentState": {
        "location": "...",
        "powerLevel": "...",
        "physicalState": "...",
        "mentalState": "...",
        "keyItems": "...",
        "recentEvents": "...",
        "updatedAtChapter": {{chapter_number}}
      }
    }
  ],
  "newCharacters": [
    {
      "name": "Имя нового персонажа",
      "role": "protagonist/antagonist/supporting/minor",
      "currentState": {
        "location": "...",
        "powerLevel": "...",
        "physicalState": "...",
        "mentalState": "...",
        "keyItems": "...",
        "recentEvents": "...",
        "updatedAtChapter": {{chapter_number}}
      }
    }
  ]
}

Если ни один персонаж не изменил состояние и новых персонажей нет, верните {"updates": [], "newCharacters": []}.`
    },
    systemRoleLocalized: {
      en: 'You are a meticulous novel character file manager, skilled at tracking multi-dimensional state changes across characters.',
      ru: 'Вы — тщательный менеджер файлов персонажей романа, искусно отслеживающий многомерные изменения состояний.'
    },
  },

  // ================================================================
  // 逆向推演 — 从知识库内容反推全局配置（旧作续写）
  // ================================================================

  {
    key: 'infer_novel_config',
    name: '逆向推演全局配置',
    description: '从已有小说内容（知识库采样片段）反推出小说配置、四段架构和主角色卡，用于旧作续写场景',
    systemRole: '你是一位顶级网文主编和资深阅读分析师，擅长从已有作品中逆向推演设定体系。',
    variables: {
      sample_content: '知识库代表性采样内容（开头+中段+结尾）',
    },
    content: `请根据以下已有小说内容片段，逆向推演出这部小说的完整设定体系，用于支持续写工作。

【已有内容样本】
{{sample_content}}

---

请严格按照以下 JSON 格式返回分析结果：

{
  "novelConfig": {
    "genre": "主类型（玄幻/仙侠/都市/科幻/历史/悬疑/游戏/军事/奇幻/武侠/现实/其他）",
    "targetAudience": "受众（男频/女频/通用）",
    "subGenre": "细分类型及标签",
    "coreOutline": "核心大纲（150字以上，含主线目标、核心冲突、故事走向）",
    "worldSetting": "世界观背景与力量体系",
    "goldenFinger": "主角金手指/核心能力体系",
    "protagonistProfile": "主角人设（性格、背景、核心驱动力）",
    "globalGuidance": "根据已有内容归纳的全局写作风格与节奏要求"
  },
  "architectureFiles": {
    "premise": "核心故事前提文本（200字以内的高度浓缩核心）",
    "characters": "已知主要角色的关系网与动力学分析",
    "worldbuilding": "世界观矩阵（力量体系、阶层结构、重要场景）",
    "synopsis": "已知的情节走向分析（含已完成的部分和推测的后续走向）"
  },
  "characterCards": [
    {
      "name": "角色名",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "性别",
      "age": "年龄或阶段",
      "appearance": "外貌描写",
      "personality": "性格特征",
      "background": "背景故事",
      "abilities": "能力/技能",
      "motivation": "核心动机",
      "relationships": "关系网",
      "arc": "已知成长轨迹",
      "notes": "其他注意事项",
      "currentState": {
        "location": "最后已知位置",
        "powerLevel": "当前境界/能力等级",
        "physicalState": "当前身体状态",
        "mentalState": "当前心理状态",
        "keyItems": "当前持有的关键道具",
        "recentEvents": "最近发生的重要事件",
        "updatedAtChapter": 0
      }
    }
  ]
}

要求：
1. characterCards 仅包含主角和重要配角（3-8人），不要填写次要龙套
2. 所有字段基于内容推断，未能确定的字段填写"（待确认）"
3. currentState 应基于最新内容（结尾采样）推断，不是初始状态`,
    contentLocalized: {
      en: `Based on the following existing novel content excerpts, reverse-engineer the complete setting system of this novel to support continuation work.

【Existing Content Sample】
{{sample_content}}

---

Please return the analysis results strictly in the following JSON format:

{
  "novelConfig": {
    "genre": "Primary genre (fantasy / xianxia / urban / sci-fi / historical / mystery / gaming / military / wuxia / realism / other)",
    "targetAudience": "Target audience (male-oriented / female-oriented / general)",
    "subGenre": "Sub-genre and tags",
    "coreOutline": "Core outline (150+ words, including main-line objective, core conflict, story trajectory)",
    "worldSetting": "World background and power system",
    "goldenFinger": "Protagonist's golden finger / core ability system",
    "protagonistProfile": "Protagonist profile (personality, background, core motivation)",
    "globalGuidance": "Global writing style and pacing requirements inferred from existing content"
  },
  "architectureFiles": {
    "premise": "Core story premise text (under 200 words, highly condensed)",
    "characters": "Known main characters' relationship web and dynamics analysis",
    "worldbuilding": "Worldbuilding matrix (power system, class structure, key locations)",
    "synopsis": "Known plot trajectory analysis (including completed portions and inferred future trajectory)"
  },
  "characterCards": [
    {
      "name": "Character name",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "Gender",
      "age": "Age or life stage",
      "appearance": "Appearance description",
      "personality": "Personality traits",
      "background": "Backstory",
      "abilities": "Abilities / skills",
      "motivation": "Core motivation",
      "relationships": "Relationship web",
      "arc": "Known growth trajectory",
      "notes": "Other notes",
      "currentState": {
        "location": "Last known location",
        "powerLevel": "Current level / ability tier",
        "physicalState": "Current physical condition",
        "mentalState": "Current psychological state",
        "keyItems": "Currently held key items",
        "recentEvents": "Most recent important events",
        "updatedAtChapter": 0
      }
    }
  ]
}

Requirements:
1. characterCards should only include the protagonist and key supporting characters (3–8), not minor extras.
2. All fields are inferred from the content; undetermined fields should be filled with "(TBD)".
3. currentState should be inferred from the latest content (ending sample), not the initial state.`,
      ru: `На основе следующих отрывков из существующего романа выполните обратное проектирование полной системы настроек этого романа для поддержки работы по продолжению.

【Образец существующего содержания】
{{sample_content}}

---

Выведите результаты анализа строго в следующем формате JSON:

{
  "novelConfig": {
    "genre": "Основной жанр (фэнтези / сянься / городское / научная фантастика / исторический / детектив / игровые / военный / уся / реализм / другое)",
    "targetAudience": "Целевая аудитория (мужская / женская / универсальная)",
    "subGenre": "Поджанр и теги",
    "coreOutline": "Основной конспект (150+ слов, включая главную цель, основной конфликт, траекторию истории)",
    "worldSetting": "Фон мира и система сил",
    "goldenFinger": "Золотой палец героя / система основных способностей",
    "protagonistProfile": "Профиль героя (характер, предыстория, основная мотивация)",
    "globalGuidance": "Глобальные требования к стилю и темпу, выведенные из существующего контента"
  },
  "architectureFiles": {
    "premise": "Текст основной сюжетной посылки (до 200 слов, высоко концентрированный)",
    "characters": "Известная сеть отношений и динамика ключевых персонажей",
    "worldbuilding": "Матрица мироздания (система сил, классовая структура, ключевые локации)",
    "synopsis": "Анализ известной траектории сюжета (включая завершённые части и предполагаемую дальнейшую траекторию)"
  },
  "characterCards": [
    {
      "name": "Имя персонажа",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "Пол",
      "age": "Возраст или этап жизни",
      "appearance": "Описание внешности",
      "personality": "Черты характера",
      "background": "Предыстория",
      "abilities": "Способности / навыки",
      "motivation": "Основная мотивация",
      "relationships": "Сеть отношений",
      "arc": "Известная траектория развития",
      "notes": "Другие заметки",
      "currentState": {
        "location": "Последнее известное местоположение",
        "powerLevel": "Текущий уровень",
        "physicalState": "Текущее физическое состояние",
        "mentalState": "Текущее психологическое состояние",
        "keyItems": "Текущие ключевые предметы",
        "recentEvents": "Последние важные события",
        "updatedAtChapter": 0
      }
    }
  ]
}

Требования:
1. characterCards должны включать только главного героя и ключевых второстепенных персонажей (3–8), не фоновых extras.
2. Все поля выводятся из содержания; неопределённые поля заполняются «(уточнить)».
3. currentState выводится из самого позднего контента (образец финала), а не из начального состояния.`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel editor and seasoned literary analyst, skilled at reverse-engineering setting systems from existing works.',
      ru: 'Вы — ведущий редактор веб-романов и опытный литературный аналитик, искусно выполняющий обратное проектирование систем настроек из существующих произведений.'
    },
  },

  // ================================================================
  // 架构生成 — 从角色图谱提取初始角色卡
  // ================================================================

  {
    key: 'extract_initial_characters',
    name: '提取初始角色卡',
    description: '从角色图谱纯文本中提取结构化角色卡数据，用于架构生成后自动创建角色卡 JSON 文件',
    systemRole: '你是一位专业的小说数据结构化专家。',
    variables: {
      character_dynamics: '角色图谱纯文本',
      genre: '小说类型',
    },
    content: `请从以下角色图谱文本中提取所有重要角色的结构化信息。

【角色图谱文本】
{{character_dynamics}}

【小说类型】
{{genre}}

【任务要求】
1. 提取所有在图谱中明确描述的角色（主角、反派、重要配角），不要遗漏。
2. 龙套或仅一笔带过的角色不用提取。
3. 所有字段基于图谱内容提取。如果图谱中未明确描写外貌，请务必根据角色的身份背景与性格推测并补充一段丰满的标志性外貌描写（外貌特征绝对不要留空或写未知）。未能确定的其他次要字段可填写空字符串。
4. role 字段仅限以下取值：protagonist（主角）、antagonist（反派）、supporting（配角）、minor（龙套）。
5. currentState 是角色的初始状态（故事开始时），updatedAtChapter 固定为 0。

【输出格式】
必须返回一个 JSON 对象，格式如下（characters 数组包含所有角色）：
{
  "characters": [
    {
      "name": "角色名",
      "role": "protagonist",
      "gender": "性别",
      "age": "年龄或年龄段",
      "appearance": "外貌特征",
      "personality": "性格特点",
      "background": "背景故事",
      "abilities": "能力/技能/修为",
      "motivation": "核心动机与渴望",
      "relationships": "与其他角色的关系",
      "arc": "预期的角色弧光/成长轨迹",
      "notes": "其他补充说明",
      "currentState": {
        "location": "初始位置",
        "powerLevel": "初始境界/能力等级",
        "physicalState": "初始身体状态",
        "mentalState": "初始心理状态",
        "keyItems": "初始持有道具",
        "recentEvents": "故事开始前的背景事件",
        "updatedAtChapter": 0
      }
    }
  ]
}

如果图谱中没有任何可提取的角色，返回 {"characters": []}。`,
    contentLocalized: {
      en: `Please extract all important characters' structured information from the following character dynamics text.

【Character Dynamics Text】
{{character_dynamics}}

【Novel Genre】
{{genre}}

【Task Requirements】
1. Extract all clearly described characters in the dynamics (protagonist, antagonist, key supporting characters) — do not omit any.
2. Do not extract background extras or characters mentioned only in passing.
3. All fields are extracted from the dynamics text. If the dynamics do not explicitly describe appearance, you MUST infer and provide a rich signature appearance description based on the character's background and personality (appearance must NEVER be left blank or marked as unknown). Other minor fields that cannot be determined may be left as empty strings.
4. The role field may only have these values: protagonist, antagonist, supporting, minor.
5. currentState represents the character's initial state (at story start); updatedAtChapter is fixed at 0.

【Output Format】
Must return a JSON object in the following format (characters array contains all characters):
{
  "characters": [
    {
      "name": "Character name",
      "role": "protagonist",
      "gender": "Gender",
      "age": "Age or age range",
      "appearance": "Physical description",
      "personality": "Personality traits",
      "background": "Backstory",
      "abilities": "Abilities / skills / cultivation",
      "motivation": "Core motivation and desires",
      "relationships": "Relationships with other characters",
      "arc": "Expected character arc / growth trajectory",
      "notes": "Other supplementary notes",
      "currentState": {
        "location": "Initial location",
        "powerLevel": "Initial level / ability tier",
        "physicalState": "Initial physical condition",
        "mentalState": "Initial psychological state",
        "keyItems": "Initially held items",
        "recentEvents": "Background events before story start",
        "updatedAtChapter": 0
      }
    }
  ]
}

If the dynamics contain no extractable characters, return {"characters": []}.`,
      ru: `Пожалуйста, извлеките всю структурированную информацию о важных персонажах из следующего текста динамики персонажей.

【Текст динамики персонажей】
{{character_dynamics}}

【Жанр романа】
{{genre}}

【Требования к заданию】
1. Извлеките всех чётко описанных персонажей (главного героя, антагониста, ключевых второстепенных) — не пропускайте ни одного.
2. Не извлекайте фоновых extras или персонажей, упомянутых лишь мимоходом.
3. Все поля извлекаются из текста динамики. Если динамика не описывает внешность, вы ОБЯЗАНЫ вывести и предоставить богатое описание характерной внешности на основе предыстории и характера персонажа (внешность НИКОГДА не должна оставаться пустой или помечаться как неизвестная). Другие второстепенные поля, которые невозможно определить, могут быть оставлены пустыми строками.
4. Поле role может принимать только значения: protagonist, antagonist, supporting, minor.
5. currentState отражает начальное состояние персонажа (в начале истории); updatedAtChapter фиксируется на 0.

【Формат вывода】
Обязательно верните объект JSON в следующем формате (массив characters содержит всех персонажей):
{
  "characters": [
    {
      "name": "Имя персонажа",
      "role": "protagonist",
      "gender": "Пол",
      "age": "Возраст или возрастная категория",
      "appearance": "Описание внешности",
      "personality": "Черты характера",
      "background": "Предыстория",
      "abilities": "Способности / навыки / уровень культивации",
      "motivation": "Основная мотивация и желания",
      "relationships": "Отношения с другими персонажами",
      "arc": "Ожидаемая арка персонажа / траектория развития",
      "notes": "Другие дополнительные заметки",
      "currentState": {
        "location": "Начальное местоположение",
        "powerLevel": "Начальный уровень",
        "physicalState": "Начальное физическое состояние",
        "mentalState": "Начальное психологическое состояние",
        "keyItems": "Начальные предметы",
        "recentEvents": "Предысторические события до начала истории",
        "updatedAtChapter": 0
      }
    }
  ]
}

Если в динамике нет извлекаемых персонажей, верните {"characters": []}.`
    },
    systemRoleLocalized: {
      en: 'You are a professional novel data structuring expert.',
      ru: 'Вы — профессиональный эксперт по структурированию данных романа.'
    },
  },

  // ================================================================
  // 逆向推演 — 按章蓝图精准推演（导入已有小说用）
  // ================================================================

  {
    key: 'infer_single_chapter_blueprint',
    name: '逆向推演单章蓝图',
    description: '从已有小说章节正文高精度反推出该章的结构化蓝图信息，用于导入旧作场景',
    systemRole: '你是一位专业的网文结构分析师，擅长从正文中提取结构化蓝图信息。',
    variables: {
      chapter_content: '本章正文全文',
      chapter_number: '本章序号',
      chapter_title: '本章标题（来自拆章）',
      novel_config_summary: '全局配置脱水版',
    },
    content: `请阅读以下已有章节正文，从中提取结构化蓝图信息。

【全局小说设定概要】
{{novel_config_summary}}

【章节信息】
- 章节序号：第 {{chapter_number}} 章
- 拆章标题：{{chapter_title}}

【本章正文】
{{chapter_content}}

---

${CHAPTER_TITLE_RULES}

请严格按以下 JSON 格式输出本章蓝图：

{
  "chapterNumber": {{chapter_number}},
  "title": "从正文内容中提炼、并符合【章节命名规则】的标题（如果拆章标题已经符合规则可保留）",
  "role": "本章在全书中的角色（起、承、转、合、伏笔、高潮、过渡 等）",
  "purpose": "本章主角最想解决的核心问题（一句话）",
  "characters": ["本章出场的重要角色名"],
  "keyEvents": "本章核心事件概述（100-150字，包含因果关系和结果）",
  "suspenseHook": "章末留下的悬念或钩子（一句话）"
}

要求：
1. keyEvents 必须基于正文实际内容提取，不可臆造。
2. characters 只列主要互动角色名（3-5个），不要列龙套。
3. role 从正文的叙事功能判断（建置/发展/转折/高潮/结局/过渡等）。
4. 仅输出 JSON，不要任何额外文字。`,
    contentLocalized: {
      en: `Please read the following existing chapter text and extract structured blueprint information from it.

【Global Novel Setting Summary】
{{novel_config_summary}}

【Chapter Info】
- Chapter number: {{chapter_number}}
- Split chapter title: {{chapter_title}}

【This Chapter's Full Text】
{{chapter_content}}

---

Please output this chapter's blueprint strictly in the following JSON format:

{
  "chapterNumber": {{chapter_number}},
  "title": "Precise chapter title distilled from the text (retain if the split title is already good)",
  "role": "This chapter's role in the overall novel (setup / development / turning point / climax / resolution / transition, etc.)",
  "purpose": "The core problem the protagonist most wants to solve this chapter (one sentence)",
  "characters": ["Important character names appearing in this chapter"],
  "keyEvents": "Summary of core events in this chapter (100–150 words, including cause-and-effect and outcome)",
  "suspenseHook": "Cliffhanger or hook left at the end (one sentence)"
}

Requirements:
1. keyEvents must be extracted from the actual text — do not fabricate.
2. characters should only list main interacting characters (3–5), not extras.
3. role is determined by the narrative function in the text (setup / development / turning point / climax / resolution / transition, etc.).
4. Output only JSON — no additional text.`,
      ru: `Пожалуйста, прочитайте следующий текст существующей главы и извлеките из него структурированную информацию о плане.

【Общая сводка настроек романа】
{{novel_config_summary}}

【Информация о главе】
- Номер главы: {{chapter_number}}
- Заголовок по разбиению: {{chapter_title}}

【Полный текст этой главы】
{{chapter_content}}

---

Выведите план этой главы строго в следующем формате JSON:

{
  "chapterNumber": {{chapter_number}},
  "title": "Точный заголовок главы, извлечённый из текста (сохраните, если заголовок по разбиению уже хорош)",
  "role": "Роль этой главы в общем романе (завязка / развитие / поворотный момент / кульминация / развязка / переход и т.д.)",
  "purpose": "Основная проблема, которую герой хочет решить в этой главе (одно предложение)",
  "characters": ["Имена важных персонажей, появляющихся в этой главе"],
  "keyEvents": "Краткое изложение основных событий главы (100–150 слов, включая причинно-следственные связи и результат)",
  "suspenseHook": "Интрига или крючок, оставленный в конце (одно предложение)"
}

Требования:
1. keyEvents должны быть извлечены из фактического текста — не придумывайте.
2. characters должны включать только основных взаимодействующих персонажей (3–5), не фоновых extras.
3. role определяется повествовательной функцией в тексте (завязка / развитие / поворотный момент / кульминация / развязка / переход и т.д.).
4. Выводите только JSON — никакого дополнительного текста.`
    },
    systemRoleLocalized: {
      en: 'You are a professional web novel structural analyst, skilled at extracting structured blueprint information from prose.',
      ru: 'Вы — профессиональный структурный аналитик веб-романов, искусно извлекающий структурированную информацию о плане из прозы.'
    },
  },

  // ================================================================
  // 逆向推演 — 向量采样增强版配置推演（导入已有小说用）
  // ================================================================

  {
    key: 'infer_novel_config_with_vectors',
    name: '向量采样增强推演',
    description: '利用向量检索采样的精确内容片段，增强全局配置推演的准确度',
    systemRole: '你是一位顶级网文主编和资深阅读分析师，擅长从已有作品中逆向推演设定体系。',
    variables: {
      sampled_worldview: '向量检索：世界观与力量体系相关片段',
      sampled_protagonist: '向量检索：主角设定与金手指相关片段',
      sampled_conflict: '向量检索：核心矛盾与敌对势力相关片段',
      sampled_style: '向量检索：写作风格与叙事视角相关片段',
      first_chapter: '第一章正文（开局风格参考）',
      latest_chapter: '最新一章正文（当前进度参考）',
      total_chapters: '已有总章数',
    },
    content: `请根据以下从小说中精准提取的关键片段，逆向推演出这部小说的完整设定体系。

【第一章正文（开局风格参考）】
{{first_chapter}}

【最新一章正文（当前进度参考）】
{{latest_chapter}}

【总章数】{{total_chapters}} 章

【向量检索精选片段 — 世界观与力量体系】
{{sampled_worldview}}

【向量检索精选片段 — 主角设定与金手指】
{{sampled_protagonist}}

【向量检索精选片段 — 核心矛盾与敌对势力】
{{sampled_conflict}}

【向量检索精选片段 — 写作风格与叙事手法】
{{sampled_style}}

---

请严格按照以下 JSON 格式返回分析结果：

{
  "novelConfig": {
    "genre": "主类型（玄幻/仙侠/都市/科幻/历史/悬疑/游戏/军事/奇幻/武侠/现实/其他）",
    "targetAudience": "受众（男频/女频/通用）",
    "subGenre": "细分类型及标签",
    "plotStructure": "故事结构（three_act/heros_journey/save_the_cat/kishotenketsu/multi_thread/freeform）",
    "narrativePOV": "叙事视角（third_limited/first_person/third_omniscient/multi_pov）",
    "coreOutline": "核心大纲（150字以上，含主线目标、核心冲突、故事走向）",
    "worldSetting": "世界观背景与力量体系",
    "goldenFinger": "主角金手指/核心能力体系",
    "protagonistProfile": "主角人设（性格、背景、核心驱动力）",
    "globalGuidance": "根据已有内容归纳的全局写作风格与节奏要求"
  },
  "architectureFiles": {
    "premise": "核心故事前提文本（200字以内的高度浓缩核心）",
    "characters": "已知主要角色的关系网与动力学分析",
    "worldbuilding": "世界观矩阵（力量体系、阶层结构、重要场景）",
    "synopsis": "已知的情节走向分析（含已完成的部分和推测的后续走向）"
  },
  "characterCards": [
    {
      "name": "角色名",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "性别",
      "age": "年龄或阶段",
      "appearance": "外貌描写",
      "personality": "性格特征",
      "background": "背景故事",
      "abilities": "能力/技能",
      "motivation": "核心动机",
      "relationships": "关系网",
      "arc": "已知成长轨迹",
      "notes": "其他注意事项",
      "currentState": {
        "location": "最后已知位置",
        "powerLevel": "当前境界/能力等级",
        "physicalState": "当前身体状态",
        "mentalState": "当前心理状态",
        "keyItems": "当前持有的关键道具",
        "recentEvents": "最近发生的重要事件",
        "updatedAtChapter": 0
      }
    }
  ]
}

要求：
1. characterCards 仅包含主角和重要配角（3-8人），不要填写次要龙套
2. 所有字段基于检索片段推断，未能确定的填写"（待确认）"
3. currentState 应基于最新章节推断当前状态，而非初始状态
4. plotStructure 和 narrativePOV 请根据实际叙事特征判断，而非猜测`,
    contentLocalized: {
      en: `Based on the following precisely extracted key passages from the novel, reverse-engineer the complete setting system of this novel.

【Chapter 1 Full Text (opening style reference)】
{{first_chapter}}

【Latest Chapter Full Text (current progress reference)】
{{latest_chapter}}

【Total chapters】{{total_chapters}}

【Vector Search Selected Passages — Worldbuilding & Power System】
{{sampled_worldview}}

【Vector Search Selected Passages — Protagonist Settings & Golden Finger】
{{sampled_protagonist}}

【Vector Search Selected Passages — Core Conflicts & Antagonist Forces】
{{sampled_conflict}}

【Vector Search Selected Passages — Writing Style & Narrative Techniques】
{{sampled_style}}

---

Please return the analysis results strictly in the following JSON format:

{
  "novelConfig": {
    "genre": "Primary genre (fantasy / xianxia / urban / sci-fi / historical / mystery / gaming / military / wuxia / realism / other)",
    "targetAudience": "Target audience (male-oriented / female-oriented / general)",
    "subGenre": "Sub-genre and tags",
    "plotStructure": "Story structure (three_act / heros_journey / save_the_cat / kishotenketsu / multi_thread / freeform)",
    "narrativePOV": "Narrative POV (third_limited / first_person / third_omniscient / multi_pov)",
    "coreOutline": "Core outline (150+ words, including main-line objective, core conflict, story trajectory)",
    "worldSetting": "World background and power system",
    "goldenFinger": "Protagonist's golden finger / core ability system",
    "protagonistProfile": "Protagonist profile (personality, background, core motivation)",
    "globalGuidance": "Global writing style and pacing requirements inferred from existing content"
  },
  "architectureFiles": {
    "premise": "Core story premise text (under 200 words, highly condensed)",
    "characters": "Known main characters' relationship web and dynamics analysis",
    "worldbuilding": "Worldbuilding matrix (power system, class structure, key locations)",
    "synopsis": "Known plot trajectory analysis (including completed portions and inferred future trajectory)"
  },
  "characterCards": [
    {
      "name": "Character name",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "Gender",
      "age": "Age or life stage",
      "appearance": "Appearance description",
      "personality": "Personality traits",
      "background": "Backstory",
      "abilities": "Abilities / skills",
      "motivation": "Core motivation",
      "relationships": "Relationship web",
      "arc": "Known growth trajectory",
      "notes": "Other notes",
      "currentState": {
        "location": "Last known location",
        "powerLevel": "Current level / ability tier",
        "physicalState": "Current physical condition",
        "mentalState": "Current psychological state",
        "keyItems": "Currently held key items",
        "recentEvents": "Most recent important events",
        "updatedAtChapter": 0
      }
    }
  ]
}

Requirements:
1. characterCards should only include the protagonist and key supporting characters (3–8), not minor extras.
2. All fields are inferred from the retrieved passages; undetermined fields should be filled with "(TBD)".
3. currentState should be inferred from the latest chapter, not the initial state.
4. Determine plotStructure and narrativePOV based on actual narrative characteristics, not guesses.`,
      ru: `На основе следующих точно извлечённых ключевых отрывков из романа выполните обратное проектирование полной системы настроек этого романа.

【Полный текст Главы 1 (образец начального стиля)】
{{first_chapter}}

【Полный текст последней главы (образец текущего прогресса)】
{{latest_chapter}}

【Общее количество глав】{{total_chapters}}

【Избранные отрывки из векторного поиска — Мироздание и система сил】
{{sampled_worldview}}

【Избранные отрывки из векторного поиска — Настройки героя и золотой палец】
{{sampled_protagonist}}

【Избранные отрывки из векторного поиска — Основные конфликты и противостоящие силы】
{{sampled_conflict}}

【Избранные отрывки из векторного поиска — Стиль написания и повествовательные приёмы】
{{sampled_style}}

---

Выведите результаты анализа строго в следующем формате JSON:

{
  "novelConfig": {
    "genre": "Основной жанр (фэнтези / сянься / городское / научная фантастика / исторический / детектив / игровые / военный / уся / реализм / другое)",
    "targetAudience": "Целевая аудитория (мужская / женская / универсальная)",
    "subGenre": "Поджанр и теги",
    "plotStructure": "Структура истории (three_act / heros_journey / save_the_cat / kishotenketsu / multi_thread / freeform)",
    "narrativePOV": "Точка зрения повествования (third_limited / first_person / third_omniscient / multi_pov)",
    "coreOutline": "Основной конспект (150+ слов, включая главную цель, основной конфликт, траекторию истории)",
    "worldSetting": "Фон мира и система сил",
    "goldenFinger": "Золотой палец героя / система основных способностей",
    "protagonistProfile": "Профиль героя (характер, предыстория, основная мотивация)",
    "globalGuidance": "Глобальные требования к стилю и темпу, выведенные из существующего контента"
  },
  "architectureFiles": {
    "premise": "Текст основной сюжетной посылки (до 200 слов, высоко концентрированный)",
    "characters": "Известная сеть отношений и динамика ключевых персонажей",
    "worldbuilding": "Матрица мироздания (система сил, классовая структура, ключевые локации)",
    "synopsis": "Анализ известной траектории сюжета (включая завершённые части и предполагаемую дальнейшую траекторию)"
  },
  "characterCards": [
    {
      "name": "Имя персонажа",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "Пол",
      "age": "Возраст или этап жизни",
      "appearance": "Описание внешности",
      "personality": "Черты характера",
      "background": "Предыстория",
      "abilities": "Способности / навыки",
      "motivation": "Основная мотивация",
      "relationships": "Сеть отношений",
      "arc": "Известная траектория развития",
      "notes": "Другие заметки",
      "currentState": {
        "location": "Последнее известное местоположение",
        "powerLevel": "Текущий уровень",
        "physicalState": "Текущее физическое состояние",
        "mentalState": "Текущее психологическое состояние",
        "keyItems": "Текущие ключевые предметы",
        "recentEvents": "Последние важные события",
        "updatedAtChapter": 0
      }
    }
  ]
}

Требования:
1. characterCards должны включать только главного героя и ключевых второстепенных персонажей (3–8), не фоновых extras.
2. Все поля выводятся из полученных отрывков; неопределённые поля заполняются «(уточнить)».
3. currentState выводится из последней главы, а не из начального состояния.
4. Определите plotStructure и narrativePOV на основе фактических повествовательных характеристик, а не догадок.`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel editor and seasoned literary analyst, skilled at reverse-engineering setting systems from existing works.',
      ru: 'Вы — ведущий редактор веб-романов и опытный литературный аналитик, искусно выполняющий обратное проектирование систем настроек из существующих произведений.'
    },
  },
]

/** 全局自定义覆盖 Prompt 缓存（~/.moshu/prompts/） */
const customPrompts: Map<string, PromptTemplate> = new Map()
let customPromptsLoaded = false

/** 项目级自定义覆盖 Prompt 缓存（{project}/.moshu/prompts/） */
const projectCustomPrompts: Map<string, PromptTemplate> = new Map()

/** 加载全局自定义 Prompt 覆盖（从 ~/.moshu/prompts/ 目录） */
export async function loadCustomPrompts(): Promise<void> {
  try {
    const { ipc } = await import('./ipc-client')
    if (!ipc.isElectron) return

    const moshuHome = await ipc.invoke('config:get-moshu-home')
    const promptsDir = `${moshuHome}/prompts`

    await _loadPromptsFromDir(promptsDir, customPrompts)
    customPromptsLoaded = true
    console.log(`[MoShu Prompts] 已加载 ${customPrompts.size} 个全局自定义覆盖`)
  } catch {
    // prompts 目录可能不存在，忽略
    customPromptsLoaded = true
  }
}

/** 加载项目级自定义 Prompt 覆盖（从 {projectPath}/.moshu/prompts/ 目录） */
export async function loadProjectCustomPrompts(projectPath: string): Promise<void> {
  try {
    projectCustomPrompts.clear()
    const promptsDir = `${projectPath}/.moshu/prompts`

    await _loadPromptsFromDir(promptsDir, projectCustomPrompts)
    console.log(`[MoShu Prompts] 已加载 ${projectCustomPrompts.size} 个项目级自定义覆盖`)
  } catch {
    // 目录不存在时忽略
  }
}

/** 内部工具：从目录加载 JSON 覆盖到指定 Map */
async function _loadPromptsFromDir(dirPath: string, target: Map<string, PromptTemplate>): Promise<void> {
  const { ipc } = await import('./ipc-client')
  const exists = await ipc.invoke('fs:check-exists', dirPath)
  if (!exists) return

  const files = await ipc.invoke('fs:list-dir', dirPath)
  const jsonFiles = files.filter((f) => !f.isDir && f.name.endsWith('.json'))

  for (const file of jsonFiles) {
    const result = await ipc.invoke('fs:read-file', file.path)
    if (result.success && result.content.trim()) {
      try {
        const custom = JSON.parse(result.content) as PromptTemplate
        if (custom.key) {
          target.set(custom.key, custom)
        }
      } catch { /* 忽略无效 JSON */ }
    }
  }
}

/** 根据 key 获取 Prompt 模板（三级优先级：项目级 > 全局级 > 内置） */
export function getPromptTemplate(key: string): PromptTemplate | undefined {
  // 优先级 1：项目级自定义覆盖
  const projectCustom = projectCustomPrompts.get(key)
  if (projectCustom) return projectCustom

  // 优先级 2：全局自定义覆盖
  if (customPromptsLoaded) {
    const globalCustom = customPrompts.get(key)
    if (globalCustom) return globalCustom
  }

  // 优先级 3：内置默认
  return BUILTIN_PROMPTS.find((p) => p.key === key)
}

/** 获取指定模板当前生效的来源 */
export function getPromptSource(key: string): 'builtin' | 'global' | 'project' {
  if (projectCustomPrompts.has(key)) return 'project'
  if (customPromptsLoaded && customPrompts.has(key)) return 'global'
  return 'builtin'
}

/** 获取所有模板（合并自定义，保留三级覆盖优先级） */
export function getAllPromptTemplates(): PromptTemplate[] {
  const all = [...BUILTIN_PROMPTS]
  // 用全局自定义覆盖同名内置模板
  for (const [key, custom] of customPrompts) {
    const idx = all.findIndex((p) => p.key === key)
    if (idx >= 0) {
      all[idx] = custom
    } else {
      all.push(custom)
    }
  }
  // 用项目级自定义覆盖
  for (const [key, custom] of projectCustomPrompts) {
    const idx = all.findIndex((p) => p.key === key)
    if (idx >= 0) {
      all[idx] = custom
    } else {
      all.push(custom)
    }
  }
  return all
}

/** 保存全局自定义 Prompt 到 ~/.moshu/prompts/ */
export async function saveCustomPrompt(template: PromptTemplate): Promise<boolean> {
  try {
    const { ipc } = await import('./ipc-client')
    const moshuHome = await ipc.invoke('config:get-moshu-home')
    const dirPath = `${moshuHome}/prompts`
    // 确保目录存在
    const exists = await ipc.invoke('fs:check-exists', dirPath)
    if (!exists) await ipc.invoke('fs:mkdir', dirPath)
    const filePath = `${dirPath}/${template.key}.json`

    await ipc.invoke('fs:write-file', filePath, JSON.stringify(template, null, 2))
    customPrompts.set(template.key, template)
    return true
  } catch {
    return false
  }
}

/** 保存项目级自定义 Prompt 到 {projectPath}/.moshu/prompts/ */
export async function saveProjectCustomPrompt(projectPath: string, template: PromptTemplate): Promise<boolean> {
  try {
    const { ipc } = await import('./ipc-client')
    const dirPath = `${projectPath}/.moshu/prompts`
    // 确保目录存在
    const exists = await ipc.invoke('fs:check-exists', dirPath)
    if (!exists) {
      await ipc.invoke('fs:mkdir', `${projectPath}/.moshu`)
      await ipc.invoke('fs:mkdir', dirPath)
    }
    const filePath = `${dirPath}/${template.key}.json`

    await ipc.invoke('fs:write-file', filePath, JSON.stringify(template, null, 2))
    projectCustomPrompts.set(template.key, template)
    return true
  } catch {
    return false
  }
}

/** 删除全局自定义 Prompt（恢复为内置版本） */
export async function deleteCustomPrompt(key: string): Promise<boolean> {
  try {
    const { ipc } = await import('./ipc-client')
    const moshuHome = await ipc.invoke('config:get-moshu-home')
    const filePath = `${moshuHome}/prompts/${key}.json`
    const exists = await ipc.invoke('fs:check-exists', filePath)
    if (exists) await ipc.invoke('fs:write-file', filePath, '')
    customPrompts.delete(key)
    return true
  } catch {
    return false
  }
}

/** 删除项目级自定义 Prompt（恢复为全局/内置版本） */
export async function deleteProjectCustomPrompt(projectPath: string, key: string): Promise<boolean> {
  try {
    const { ipc } = await import('./ipc-client')
    const filePath = `${projectPath}/.moshu/prompts/${key}.json`
    const exists = await ipc.invoke('fs:check-exists', filePath)
    if (exists) await ipc.invoke('fs:write-file', filePath, '')
    projectCustomPrompts.delete(key)
    return true
  } catch {
    return false
  }
}

/** 渲染 Prompt 模板（填充变量 + 自动追加内置 systemSuffix + 空段落裁剪） */
export function renderPrompt(template: PromptTemplate, variables: Record<string, string>): string {
  let content = getLocalizedContent(template)
  for (const [key, value] of Object.entries(variables)) {
    content = content.replaceAll(`{{${key}}}`, value)
  }

  // 自动追加系统约束（始终从内置模板获取，不受用户自定义影响）
  const builtinTemplate = BUILTIN_PROMPTS.find(p => p.key === template.key)
  const suffix = builtinTemplate ? getLocalizedSystemSuffix(builtinTemplate) : undefined
  if (suffix) {
    let renderedSuffix = suffix
    for (const [key, value] of Object.entries(variables)) {
      renderedSuffix = renderedSuffix.replaceAll(`{{${key}}}`, value)
    }
    content = content + '\n\n' + renderedSuffix
  }

  // 空变量段落裁剪：当可选变量为空时，清除残留的空标签段落，避免分散 LLM 注意力
  content = content
    .replace(/\n★【[^】]*】★[：:]\s*\n?\s*$/gm, '')   // 清除空的 ★【...】★ 标签行
    .replace(/\n【[^】]*（如有[^）]*）[^】]*】\s*\n?\s*$/gm, '') // 清除空的 【...如有...】 标签行
    .replace(/\n{3,}/g, '\n\n') // 合并多余空行

  return content
}
