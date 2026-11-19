/**
 * 感官描写合理性检查（S-1 / S-2 / S-3）
 *
 * 纯函数、零成本、不依赖模型。抓三类「信息不成立」的描写：
 *   S-1 词形误用：用身体部位或物体名词顶替感受名词（触手粗糙 / 触须冰凉）
 *   S-2 无来源感官：高危气味、声音在场景里找不到产生者（臭氧味 / 硫磺味）
 *   S-3 感官堆叠：同一段堆四种以上感官，或连续三段以气味 / 触感开头
 *
 * 设计约定：与 rule-review.ts 一致，本文件不读 DB、不发 IPC。
 */
import type { ReviewFindingInput } from '../../../electron/repositories/review-finding-repository'

export const SENSORY_CATEGORY = {
  word: '描写合理性·词形误用',
  source: '描写合理性·无来源',
  stack: '描写合理性·感官堆叠',
} as const

/** 感受名词的位置被这些名词占用时为硬错误 */
const MISUSED_NOUNS = ['触手', '触须', '肢感', '视力感', '听力感', '嗅觉感', '味觉感']

/** 同段出现这些词时，触手按「真触手生物」放行 */
const TENTACLE_OWNER = /章鱼|腕足|触须类|触手类|怪物[^。]{0,8}触手|触手[^。]{0,8}(生物|怪物|肢体)/

/** 高危气味词 → 场景内可接受的来源词 */
const HIGH_RISK_SMELL: Array<{ word: string; sources: string[] }> = [
  { word: '臭氧', sources: ['电弧', '放电', '高压', '电击', '电机', '变压器', '焊接', '短路', '雷击', '电晕'] },
  { word: '硫磺', sources: ['火山', '硫矿', '火药', '岩浆', '地热'] },
  { word: '氨', sources: ['氨水', '化肥', '尿液', '制冷剂', '清洁剂'] },
  { word: '甲醛', sources: ['胶水', '板材', '防腐', '标本', '树脂'] },
  { word: '乙醚', sources: ['麻醉', '药瓶', '试剂', '实验室'] },
  { word: '麝香', sources: ['麝', '香料', '药材', '香囊'] },
  { word: '硝烟', sources: ['开枪', '爆炸', '火药', '炮击', '枪口'] },
]

/** 显式交代来源的句式：句中已说明气味从哪来（“那是密封液在挥发”“来自墙缝”），不再算无来源 */
const EXPLICIT_SOURCE = /(?:来自|源自|由[^。]{0,12}(?:产生|散发|挥发|泄漏)|从[^。]{0,12}(?:冒|飘|渗|溢|喷|漏)出|那是[^。]{0,18}(?:挥发|散发|泄漏|逸出|分解|燃烧|腐蚀|老化))/

/** 高危声音词 → 来源词 */
const HIGH_RISK_SOUND: Array<{ word: string; sources: string[] }> = [
  { word: '次声波', sources: ['震源', '低频', '机械', '引擎', '共振'] },
  { word: '高频啸叫', sources: ['变压器', '电机', '扩音', '电容', '短路'] },
  { word: '等离子嗡鸣', sources: ['等离子', '电弧', '放电', '反应堆'] },
]

/** 无功能触感：删掉不影响情节的触觉小动作 */
const NO_FUNCTION_TOUCH = [
  /台面[^。]{0,6}(?:凉|冰|冷)/,
  /指尖[^。]{0,6}划过[^。]{0,8}(?:桌面|台面|墙面)/,
  /(?:灰尘|浮尘)[^。]{0,8}(?:光里|光束|阳光)[^。]{0,6}(?:飘|浮|悬)/,
]

const SMELL_OPENING = /^(?:空气里|空气当中|鼻子里|鼻腔里|一股|那股|闻起来|气味|味道|香味|腥味|臭味|酸味)/

function splitParagraphs(content: string): string[] {
  return content.split(/\n+/).map((line) => line.trim()).filter(Boolean)
}

function evidenceAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 25)
  const end = Math.min(text.length, index + length + 25)
  return text.slice(start, end).replace(/\s+/g, ' ').trim()
}

function add(
  out: ReviewFindingInput[],
  chapterNumber: number,
  category: string,
  severity: 'error' | 'warning',
  message: string,
  evidence: string,
  locationHint: string,
): void {
  out.push({
    chapterNumber,
    stage: 'rule-review',
    category,
    severity,
    message,
    evidence,
    locationHint,
  })
}

/** S-1：感受名词被身体部位 / 物体名词顶替 */
export function checkSensoryWordMisuse(chapterNumber: number, content: string): ReviewFindingInput[] {
  const out: ReviewFindingInput[] = []
  const paragraphs = splitParagraphs(content)
  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i]
    for (const noun of MISUSED_NOUNS) {
      const index = paragraph.indexOf(noun)
      if (index === -1) continue
      // 真写触手生物时放行；「触手」在真触手语境里是本体，不是顶替触感
      if (noun === '触手' && TENTACLE_OWNER.test(paragraph)) continue
      add(
        out, chapterNumber, SENSORY_CATEGORY.word, 'error',
        `「${noun}」是名词，读者会误读成身体部位或触须；这里要写的是感受，应改为「触感」。`,
        evidenceAround(paragraph, index, noun.length),
        `第 ${i + 1} 段`,
      )
      break
    }
  }
  return out
}

/** S-2：高危气味 / 声音在场景里没有来源 */
export function checkSensorySource(chapterNumber: number, content: string): ReviewFindingInput[] {
  const out: ReviewFindingInput[] = []
  const paragraphs = splitParagraphs(content)
  const checkTable = (table: Array<{ word: string; sources: string[] }>, kind: '气味' | '声音') => {
    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i]
      // 来源允许在本段或前一段：气味常常是上一段动作的残留
      const sourceWindow = `${i > 0 ? paragraphs[i - 1] : ''}\n${paragraph}`
      for (const item of table) {
        const index = paragraph.indexOf(item.word)
        if (index === -1) continue
        const hasSource = item.sources.some((source) => sourceWindow.includes(source))
          || EXPLICIT_SOURCE.test(paragraph)
        if (hasSource) continue
        add(
          out, chapterNumber, SENSORY_CATEGORY.source, 'error',
          `「${item.word}」${kind}在本场景找不到产生者，读者会追问「哪来的」；要么同段交代来源（如${item.sources.slice(0, 2).join('、')}），要么换成有来源的常见${kind}。`,
          evidenceAround(paragraph, index, item.word.length),
          `第 ${i + 1} 段`,
        )
      }
    }
  }
  checkTable(HIGH_RISK_SMELL, '气味')
  checkTable(HIGH_RISK_SOUND, '声音')
  return out
}

/** S-3：感官堆叠 / 无功能触感 */
export function checkSensoryStacking(chapterNumber: number, content: string): ReviewFindingInput[] {
  const out: ReviewFindingInput[] = []
  const paragraphs = splitParagraphs(content)

  const sensoryGroups: RegExp[] = [
    /(?:气味|味道|香味|腥味|臭味|酸味|汗味|霉味|焦味|铁锈味|臭氧|硫磺|闻|嗅)/,
    /(?:声音|响声|响动|轰鸣|嗡鸣|呼啸|脆响|闷响|听见|听到|耳朵|耳膜)/,
    /(?:触感|手感|摸起来|粗糙|湿冷|冰凉|烫|黏|震动|发麻|刺痛)/,
    /(?:刺眼|晃眼|昏暗|灰蒙蒙|光线|光斑|阴影|亮起|暗下去)/,
  ]

  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i]
    let count = 0
    for (const group of sensoryGroups) if (group.test(paragraph)) count++
    if (count >= 4) {
      add(
        out, chapterNumber, SENSORY_CATEGORY.stack, 'warning',
        `本段同时写了 ${count} 类感官，信息挤在一起；只留推动当下情节的那一种，其余删掉。`,
        paragraph.slice(0, 80),
        `第 ${i + 1} 段`,
      )
    }
  }

  for (let i = 2; i < paragraphs.length; i++) {
    if (SMELL_OPENING.test(paragraphs[i]) && SMELL_OPENING.test(paragraphs[i - 1]) && SMELL_OPENING.test(paragraphs[i - 2])) {
      add(
        out, chapterNumber, SENSORY_CATEGORY.stack, 'warning',
        `连续三段用气味 / 触感开头，读起来像在堆感官；换一段用动作、对话或念头起句。`,
        paragraphs[i].slice(0, 60),
        `第 ${i + 1} 段`,
      )
    }
  }

  for (let i = 0; i < paragraphs.length; i++) {
    for (const pattern of NO_FUNCTION_TOUCH) {
      const match = paragraphs[i].match(pattern)
      if (!match) continue
      add(
        out, chapterNumber, SENSORY_CATEGORY.stack, 'warning',
        `「${match[0]}」是无功能触感，删掉不影响情节；环境描写只留有作用的那一笔。`,
        evidenceAround(paragraphs[i], match.index || 0, match[0].length),
        `第 ${i + 1} 段`,
      )
      break
    }
  }
  return out
}

/** 聚合入口 */
export function checkSensoryIssues(chapterNumber: number, content: string): ReviewFindingInput[] {
  return [
    ...checkSensoryWordMisuse(chapterNumber, content),
    ...checkSensorySource(chapterNumber, content),
    ...checkSensoryStacking(chapterNumber, content),
  ]
}

export const SCENE_ENV_CATEGORY = '场景环境·配额'

/** 环境描写标记（按类别分组，句内命中 ≥2 类视为一句环境描写） */
const ENV_MARKER_GROUPS: RegExp[] = [
  /(?:空气|气味|味道|香味|腥味|臭味|汗味|霉味|焦味|铁锈味|臭氧|硫磺|闻|嗅)/,
  /(?:声音|响声|响动|轰鸣|嗡鸣|呼啸|脆响|闷响|听见|听到|耳朵|耳膜)/,
  /(?:光线|光斑|阴影|亮起|暗下去|昏暗|灰蒙蒙|刺眼|晃眼|灯光|台灯)/,
  /(?:潮|湿|冰凉|闷热|灰尘|浮尘|雾气)/,
  /(?:墙壁|墙面|天花板|屋顶|地面|地砖|走廊|房间|屋子|隔间|角落|空间)/,
]

/** 一句里含 ≥2 类环境标记，视为环境描写句 */
function isEnvironmentSentence(sentence: string): boolean {
  let groups = 0
  for (const group of ENV_MARKER_GROUPS) if (group.test(sentence)) groups++
  return groups >= 2
}

/**
 * 场景环境配额检查（C）：
 * - 全章环境描写句数超过章纲配额总和的 1.5 倍（且至少多 2 句）时记 warning；
 * - 首场环境配额为 0、却以纯环境句开篇时记 warning（典型的「每章开头都写环境」）。
 *
 * envBudget 为本章各场 envQuota 之和（章纲未设置配额时传 undefined，跳过总量检查）。
 */
export function checkSceneEnvQuota(
  chapterNumber: number,
  content: string,
  envBudget?: number,
  firstSceneBudget?: number,
): ReviewFindingInput[] {
  const out: ReviewFindingInput[] = []
  const paragraphs = splitParagraphs(content)
  if (paragraphs.length === 0) return out

  const sentences = content.split(/[。！？!?]/).map((s) => s.trim()).filter(Boolean)
  const envCount = sentences.filter(isEnvironmentSentence).length

  if (envBudget !== undefined && envCount > Math.max(envBudget + 2, Math.round(envBudget * 1.5))) {
    out.push({
      chapterNumber,
      stage: 'rule-review',
      category: SCENE_ENV_CATEGORY,
      severity: 'warning',
      message: `全章环境描写约 ${envCount} 句，超过章纲配额合计 ${envBudget} 句；同一大场景不重复描写，小场景切换一句带过。`,
      evidence: '',
      locationHint: '',
    })
  }

  if (firstSceneBudget === 0 && isEnvironmentSentence(sentences[0] || '')) {
    out.push({
      chapterNumber,
      stage: 'rule-review',
      category: SCENE_ENV_CATEGORY,
      severity: 'warning',
      message: '首场环境配额为 0，但本章开篇是环境描写句；应承接上一章结尾的动作/事件起笔。',
      evidence: (sentences[0] || '').slice(0, 40),
      locationHint: '开篇第 1 句',
    })
  }

  return out
}
