/**
 * style-scan — 接地气扫描（纯函数，可单测）
 *
 * 目标：在生成/定稿环节给出可量化的「AI 腔」证据，而不是只靠主观阅读。
 * 扫描四类问题：
 * 1. banned：作者在项目词表里明确禁用的词（可附带替换建议）
 * 2. decoration：道具前的冗余修饰语（干枯的/破旧的/冰冷的…）
 * 3. nounified：名词化句式（进行了检查 / 作出了决定 / 实现了突破）
 * 4. density：专名密度过高（【】标记的专名每 500 字超过上限）
 * 5. hot：抽象高频词（气机/气息/威压…）单章重复过多
 */

export type StyleHitKind = 'banned' | 'decoration' | 'nounified' | 'density' | 'hot' | 'cliche' | 'numeric' | 'sensory' | 'cadence' | 'panel'

export interface StyleScanHit {
  kind: StyleHitKind
  term: string
  count: number
  /** 处理建议（banned 且配置了替换词时为替换目标） */
  suggestion?: string
}

export interface StyleScanReport {
  wordCount: number
  hits: StyleScanHit[]
  /** 命中总数（同名多次按次数累计） */
  totalHits: number
}

export interface StyleScanOptions {
  /** 项目词表：禁用词 */
  bannedTerms?: string[]
  /** 项目词表：禁用词 → 替换词 */
  replacements?: Record<string, string>
  /** 每 500 字允许的新增专名数，默认 2 */
  termDensityPer500?: number
}

/** 冗余修饰语：道具前可删的形容词 */
const DECORATIONS = ['干枯的', '破旧的', '冰冷的', '陈旧的', '斑驳的', '枯黄的', '灰白的', '幽深的', '森然的']

/** 名词化句式（匹配整段以统计次数） */
const NOUNIFIED_PATTERNS: Array<{ pattern: RegExp; suggestion: string }> = [
  { pattern: /进行了(?:一次|一番)?([\u4e00-\u9fa5]{2,4})/g, suggestion: '改成动词直述，如「检查了一遍」' },
  { pattern: /作出了(?:一个|一番)?([\u4e00-\u9fa5]{2,4})/g, suggestion: '直接写动作，如「他决定…」' },
  { pattern: /给予了[他她它]?(?:一)?(?:击|下|些)/g, suggestion: '写成具体动作，如「打了他一下」' },
  { pattern: /实现了([\u4e00-\u9fa5]{2,4})/g, suggestion: '直接写结果，如「突破了」' },
  { pattern: /对([\u4e00-\u9fa5]{1,4})进行了([\u4e00-\u9fa5]{2,4})/g, suggestion: '改成「把 X 怎么了」' },
]

/** 抽象高频词：单章重复超过阈值即提示 */
const HOT_WORDS = ['气机', '气息', '威压', '法则波动', '涟漪', '能量波动', '气势']

/**
 * 套路化描写：跨章复读最容易被读者记住的“机械感”来源。
 * limit 为单章建议上限（按 2,400 字基准），篇幅更长时按比例放宽。
 */
export const CLICHE_PATTERNS: Array<{ term: string; pattern: RegExp; limit: number; suggestion: string }> = [
  {
    term: '摩挲食指骨节',
    pattern: /食指骨节[^。！？]{0,10}摩挲|摩挲[^。！？]{0,10}食指骨节/g,
    limit: 0,
    suggestion: '零容忍；改成具体受力点动作（指节抵在护目镜边缘、拇指压住刀柄）',
  },
  {
    term: '瞳孔骤缩',
    pattern: /瞳孔(?:骤缩|微缩|猛缩|缩成针尖)/g,
    limit: 0,
    suggestion: '零容忍；改成视线落点、后退时脚跟撞碎石、手电往下压',
  },
  {
    term: '七窍/血线/血丝',
    pattern: /七窍|血线|血丝/g,
    limit: 0,
    suggestion: '零容忍；受伤只写血落在哪、擦在什么上，不写“七窍/血线/血丝”套件',
  },
  {
    term: '后槽牙/牙龈',
    pattern: /后槽牙|牙龈/g,
    limit: 0,
    suggestion: '零容忍；咬牙改成腮帮鼓一下、把杯子往桌上一放',
  },
  {
    term: '百丈',
    pattern: /百丈/g,
    limit: 0,
    suggestion: '零容忍；改用可感知的具体距离（三十步、两节管廊）',
  },
  {
    term: '轰（拟声）',
    pattern: /轰(?=[—\-—!！，。])/g,
    limit: 0,
    suggestion: '零容忍；用震动、碎石落下、耳鸣等后果替代拟声',
  },
  {
    term: '火辣辣地疼',
    pattern: /(肺部|喉咙|胸口|伤口)?[^。！？]{0,6}火辣辣(地)?(疼|痛)/g,
    limit: 0,
    suggestion: '删掉或改成具体动作，如“吸气时胸口一抽”',
  },
  {
    term: '像灌满了铅',
    pattern: /(双腿|两条腿|腿|胳膊|身体)[^。！？]{0,8}(像|如同|仿佛)?灌(满)?了?铅/g,
    limit: 0,
    suggestion: '删掉比喻，直接写“腿抬不起来”或“每一步都要停半拍”',
  },
  {
    term: '血腥味',
    pattern: /血腥味/g,
    limit: 0,
    suggestion: '零容忍；写“血滴在鞋面上”“指缝里全是血”，不写“血腥味”',
  },
  {
    term: '耳膜生疼/发麻',
    pattern: /耳膜(生疼|发麻|嗡鸣|刺痛)/g,
    limit: 0,
    suggestion: '零容忍；写“只见对方嘴动，听不见声”这类后果',
  },
  {
    term: '高频震荡/蜂鸣',
    pattern: /高频(震荡|震动|蜂鸣)|(?:耳|颅内|脑袋|太阳穴|脑仁)[^。！？]{0,10}蜂鸣|蜂鸣[^。！？]{0,8}(?:耳|颅内)/g,
    limit: 0,
    suggestion: '零容忍；写“拍了拍耳朵，什么也没拍出来”这类动作',
  },
  {
    term: '坠腕',
    pattern: /坠腕/g,
    limit: 0,
    suggestion: '书面生造词，改成“手腕往下沉”',
  },
  {
    term: '翻江倒海',
    pattern: /翻江倒海/g,
    limit: 0,
    suggestion: '零容忍；改成扶墙站住、喉咙里咽了一下、把脸别开',
  },
  {
    term: '空气中弥漫…味',
    pattern: /(空气|空气里|空气中|鼻腔)[^。！？]{0,10}(弥漫|充斥|飘)[^。！？]{0,24}(味|气味|气息)/g,
    limit: 0,
    suggestion: '零容忍；气味要写出来源物件与位置（“烧焦的胶皮贴在墙根”），不用“空气中弥漫着…”起句',
  },
  {
    term: '环境气味三连/固定词',
    pattern: /(?:焦糊味|铁锈味|铁锈腥甜|腥臭味|土腥味|霉味|腐臭味|臭氧味|化工试剂味)[^。！？]{0,12}(混杂|混合|交织|夹杂|混着)|(混杂|混合|交织|夹杂|混着)[^。！？]{0,20}(?:焦糊味|铁锈味|铁锈腥甜|腥臭味|土腥味|霉味|腐臭味|臭氧味)/g,
    limit: 0,
    suggestion: '气味最多写一种，且必须有具体来源；禁止"X 味混着 Y 味"的堆叠',
  },
  {
    term: '气味生理后果套话',
    pattern: /(气味|味道|气息)[^。！？]{0,16}(钻进鼻腔|呛得|令人作呕|喘不过气)|(令人作呕|呛得[^。！？]{0,8})[^。！？]{0,12}(气味|味道|气息)/g,
    limit: 0,
    suggestion: '零容忍；删掉“钻进鼻腔/令人作呕”的尾巴，只保留气味来源本身',
  },
  {
    term: '废土滤镜词',
    pattern: /(阴冷|潮湿|斑驳|腐朽|破败|荒凉|死寂|灰败|狰狞|黏腻)(的)?/g,
    limit: 2,
    suggestion: '全章合计 ≤2 次；环境词要落在具体物件上，不要用来替人物写情绪',
  },
  {
    term: '浑身/全身＋状态',
    pattern: /(浑身|全身|四肢|整个人)[^。！？]{0,6}(肌肉|紧绷|发紧|发僵|僵硬|发凉|发麻|发抖|发颤)/g,
    limit: 0,
    suggestion: '零容忍；去掉总括，改成具体一处受力点（肩胛顶住门框、脚趾抓地、指节抵住扳机护圈）',
  },
  {
    term: '五指紧扣/指节发白',
    pattern: /五指(?:紧扣|攥紧|死死扣住)|指节(?:发白|泛白)/g,
    limit: 0,
    suggestion: '零容忍；改成动作结果：“指节抵在护圈上，压得金属边沿咯了一声”',
  },
  {
    term: '牙关咬紧',
    pattern: /牙关(?:咬紧|紧咬)|咬紧(?:牙关|牙)/g,
    limit: 0,
    suggestion: '零容忍；改成“腮帮鼓了一下”“把杯子往桌上一放，水晃出来”',
  },
  {
    term: '深吸一口气/喉结滚动',
    pattern: /深吸(?:了)?一口气|喉结(?:上下)?滚动|胸口(?:一阵)?发紧/g,
    limit: 0,
    suggestion: '零容忍；改成“把气停在半口”“喉咙里咽了一下”“手按在刀柄上没拔”',
  },
  // —— 06 清单 C 组：句式套话 ——
  {
    term: '哲理对举（不是…而是…）',
    pattern: /不是[^。！？]{1,24}而是/g,
    limit: 0,
    suggestion: '零容忍；拆成两句事实，或直接删掉转折后的判断',
  },
  {
    term: '“与其说…不如说”',
    pattern: /与其说[^。！？]{1,30}不如说/g,
    limit: 0,
    suggestion: '零容忍；改成两个并列的事实陈述，或只留后半句',
  },
  {
    term: '“这就够了/仅此而已”',
    pattern: /这就够了|仅此而已|如此而已/g,
    limit: 0,
    suggestion: '零容忍；删掉收束句，停在一个具体动作或决定上',
  },
  {
    term: '“事实上/本质上/毋庸置疑”',
    pattern: /事实上[，,、]|本质上[，,、]|客观上[，,、]|毋庸置疑|不容置疑/g,
    limit: 0,
    suggestion: '零容忍；论述腔改成人物的判断、动作或别人的原话',
  },
  {
    term: '形容词三连',
    pattern: /[\u4e00-\u9fa5]{1,4}的[\u4e00-\u9fa5]{1,4}的[\u4e00-\u9fa5]{1,4}的/g,
    limit: 0,
    suggestion: '零容忍；只留一个形容词，其余换成具体名词、器物或动作',
  },
  // —— D 组：动作与体感的句法模板（旧书对比里最扎眼的一类）——
  {
    term: '拟声词句首（X的一声）',
    pattern: /[\u4e00-\u9fa5]{1,3}的一声|一声[\u4e00-\u9fa5]{1,3}/g,
    limit: 1,
    suggestion: '每章 ≤1 次；声音事件写"金属撞上石棱"这类来源，不写"啪的一声"',
  },
  {
    term: '动词＋得＋部位＋生疼/发麻',
    pattern: /[\u4e00-\u9fa5]{1,4}得[\u4e00-\u9fa5]{1,2}(?:生疼|发麻|发僵|发沉|发紧|发烫|发冷)/g,
    limit: 1,
    suggestion: '每章 ≤1 次；改成具体受力与形变（"棱角顶进指肚，压出一道白痕"）',
  },
  {
    term: '整个人/浑身/全身',
    pattern: /(?:整个人|浑身|全身)/g,
    limit: 2,
    suggestion: '每章 ≤2 次；拆成具体部位与动作，不做总括主语',
  },
  {
    term: '“X感顺着Y”套式',
    pattern: /(?:感|力道|劲道)[\u4e00-\u9fa5]{0,4}顺着/g,
    limit: 1,
    suggestion: '每章 ≤1 次；写力的方向与结果，不写"阻滞感顺着刀柄撞上腕骨"',
  },
  {
    term: '带走体温/力气',
    pattern: /带走(?:了)?[\u4e00-\u9fa5]{0,6}(?:体温|力气|温度)/g,
    limit: 0,
    suggestion: '零容忍；直接写温度、湿度和发抖，不写"带走仅剩的体温"',
  },
  {
    term: '顺手/反手/下意识/本能地',
    pattern: /(?:顺手|反手|下意识|本能地|几乎是本能)/g,
    limit: 3,
    suggestion: '每章 ≤3 次；连续动作直接写动作，副词删掉',
  },
  {
    term: '恢复动作套餐（背靠坐下/胸膛起伏）',
    pattern: /(?:背靠(?:着)?[\u4e00-\u9fa5]{0,8}坐下|胸膛(?:剧烈)?起伏)/g,
    limit: 0,
    suggestion: '零容忍；改成具体的下一步动作（包扎、数口粮、看伤口）',
  },
  {
    term: '顺着X往里钻/灌进',
    pattern: /顺着[\u4e00-\u9fa5]{0,8}(?:往里钻|灌进|渗进|钻进)/g,
    limit: 1,
    suggestion: '每章 ≤1 次；写清是什么、从哪进、贴在什么上',
  },
  // —— F 组：参数腔（说明书式规格与数值）——
  {
    term: '材料牌号/规格（420 不锈钢式）',
    pattern: /(?:\d{2,4}\s*(?:不锈钢|钢|铝合金|钛合金|碳纤维|尼龙|聚酯|黄铜|紫铜))|(?:标号|型号|目数|纯度)\s*\d+/g,
    limit: 0,
    suggestion: '零容忍；器物只写能不能用、还能撑多久、坏了会怎样',
  },
  {
    term: '器物参数（净重/热值/摆幅）',
    pattern: /(?:净重|毛重|热值|摆幅|公差|厚度|口径|扭矩)\s*[:：]?\s*\d+/g,
    limit: 0,
    suggestion: '零容忍；删掉规格介绍，改成使用结果',
  },
  // —— G 组：伤口与疼痛模板 ——
  {
    term: '动作触发式疼痛（每一次…就…）',
    pattern: /(?:每(?:一)?次|每回|每[^。！？]{0,4}(?:步|次|回|口|下)|只要)[^。！？]{0,20}(?:就|便|都|会)[^。！？]{0,16}(?:疼|痛|酸|麻|抽痛|刺痛)/g,
    limit: 0,
    suggestion: '零容忍；疼只报一次，之后写绕开伤口的动作或代价，不跟着每个动作复述',
  },
  {
    term: '皮肉/神经牵扯（解剖词当痛源）',
    pattern: /(?:凝固的)?皮肉[^。！？]{0,8}(?:扯|牵|抽)[^。！？]{0,8}(?:神经|疼|痛)|(?:伤口|创口|伤处)[^。！？]{0,10}(?:扯动|牵动|牵扯)[^。！？]{0,10}(?:神经|疼|痛)|(?:扯动|牵动|牵扯|撕扯)(?:了|着|到)?(?:伤口|创口|伤处)/g,
    limit: 0,
    suggestion: '零容忍；删掉“皮肉扯动神经”，改成做不到什么（抬不过肩、握不紧、跑起来发空）',
  },
  {
    term: '阵阵钝痛/抽痛句式',
    pattern: /(?:传来|涌起|泛开)[^。！？]{0,6}(?:阵阵|一阵|一股)?[^。！？]{0,4}(?:钝痛|抽痛|刺痛|灼痛|酸痛|胀痛)|(?:阵阵|一阵|一股)[^。！？]{0,4}(?:钝痛|抽痛|刺痛|灼痛|酸痛|胀痛)/g,
    limit: 0,
    suggestion: '零容忍；删掉“传来阵阵钝痛”，疼痛改成一次性的功能损失或动作代价',
  },
  {
    term: '伤口被勒住/裹住',
    pattern: /(?:伤口|创口|伤处)[^。！？]{0,10}(?:被|用)[^。！？]{0,8}(?:布条|粗布|纱布|绷带|毛巾)[^。！？]{0,6}(?:勒住|缠住|裹住|扎紧)/g,
    limit: 1,
    suggestion: '每章 ≤1 次；包扎只在第一次处理时写，之后只写动作改法，不再描伤口',
  },
  {
    term: '疼痛反应套话（疼得直抽气/倒吸凉气/皱眉）',
    pattern: /(?:疼|痛)[^。！？]{0,4}得[^。！？]{0,6}(?:直抽气|抽冷气|冒冷汗|眼前发黑|打颤|发抖)|倒吸(?:了)?(?:一口)?(?:凉气|冷气)|(?:疼|痛)[^。！？]{0,6}(?:皱眉|脸色发白|脸白)/g,
    limit: 0,
    suggestion: '零容忍；删掉疼痛反应表演，改成做不到的动作（抬不过肩、握不紧、慢半拍）或直接删',
  },
  // —— H 组：面板分层（状态卡与信息仓库）——
  {
    term: '非固定面板状态卡（聊天/频道/交易面板/区域等级/边界线）',
    pattern: /【(?!系统[】：:]|系统】)[^】]{0,40}(?:聊天|频道|好友|系统商城|寄售|交易面板|区域等级|边界线|黑潮|门坐标|试炼|本星|在册|接入|额度)[^】]{0,40}】/g,
    limit: 0,
    suggestion: '零容忍；删掉状态卡，改成角色点开、看见、问价、决定，或告示、路牌、旧地图、人的嘴',
  },
  {
    term: '固定面板夹带非固定字段',
    pattern: /【(?!系统[】：:]|系统】)[^】]{0,60}(?:第\s*\d+\s*天|未接入|0\/3|0\/10|在册|黑潮|边界线|门坐标|交易站距离|伤势|负重|击杀|材料)[^】]{0,60}】/g,
    limit: 0,
    suggestion: '零容忍；属性/装备/道具/技能只放各自白名单字段，天数、坐标、区域等级、边界线移出面板',
  },
]

/** 非空白字符数，与生成链路 countWords 口径一致 */
export function countScanWords(text: string): number {
  return (text || '').replace(/\s/g, '').length
}

function countOccurrences(text: string, term: string): number {
  if (!term) return 0
  let count = 0
  let from = 0
  for (;;) {
    const idx = text.indexOf(term, from)
    if (idx < 0) break
    count++
    from = idx + term.length
  }
  return count
}

/** 中文数字转数值（只处理万以内的常见写法） */
function chineseNumeralValue(token: string): number {
  const digits: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }
  let section = 0
  let number = 0
  for (const ch of token) {
    if (ch in digits) number = digits[ch]
    else if (ch in units) {
      if (number === 0) number = 1
      section += number * units[ch]
      number = 0
    }
  }
  return section + number
}

/** 同一段内同一个中文数字（≥10）重复出现 */
export function scanNumericRepeats(text: string): Array<{ term: string; count: number; excerpt: string }> {
  const results: Array<{ term: string; count: number; excerpt: string }> = []
  for (const paragraph of (text || '').split(/\n{2,}/)) {
    const re = /[一二三四五六七八九十百千零两]{2,}/g
    const seen = new Set<string>()
    let m: RegExpExecArray | null
    while ((m = re.exec(paragraph)) !== null) {
      const token = m[0]
      if (chineseNumeralValue(token) < 10) continue
      if (seen.has(token)) {
        results.push({
          term: token,
          count: 1,
          excerpt: paragraph.slice(Math.max(0, m.index - 18), m.index + token.length + 18).replace(/\s+/g, ' '),
        })
        break
      }
      seen.add(token)
    }
  }
  return results
}

const SENSORY_PATTERN = /(疼|痛|酸|麻|胀|烫|冷|热|沉|抖|颤|发麻|发紧|发硬|发烫|发凉|发酸|发胀|抽痛|刺痛|灼痛|火辣辣|血腥味|耳鸣|眩晕|恶心|翻江倒海|粗糙|湿|黏|涩|僵硬|发僵)/g

/** 同一段里体感词过多（默认 ≥4 个） */
export function scanSensoryStack(text: string, threshold = 4): Array<{ count: number; excerpt: string }> {
  const results: Array<{ count: number; excerpt: string }> = []
  for (const paragraph of (text || '').split(/\n{2,}/)) {
    if (paragraph.length < 60) continue
    const count = (paragraph.match(SENSORY_PATTERN) ?? []).length
    if (count >= threshold) {
      results.push({
        count,
        excerpt: paragraph.slice(0, 120).replace(/\s+/g, ' '),
      })
    }
  }
  return results
}

/** 标点与比喻配额：破折号 ≤2/千字、感叹号 ≤3/章、省略号 ≤2/章、比喻 ≤2/千字 */
export function scanQuota(text: string): Array<{ term: string; count: number; limit: number; suggestion: string }> {
  const body = text || ''
  const wordCount = countScanWords(body)
  const per1000 = Math.max(1, wordCount / 1000)
  const items: Array<{ term: string; count: number; limit: number; suggestion: string }> = []
  const dash = (body.match(/——|—/g) ?? []).length
  const dashLimit = Math.floor(2 * per1000)
  if (dash > dashLimit) items.push({ term: '破折号超配额', count: dash, limit: dashLimit, suggestion: '每千字 ≤2 处；抒情式破折号直接删，改成句号断句' })
  const bang = (body.match(/！/g) ?? []).length
  if (bang > 3) items.push({ term: '感叹号超配额', count: bang, limit: 3, suggestion: '每章 ≤3 个；靠动作与短句制造力度，不靠叹号' })
  const ellipsis = (body.match(/……|…/g) ?? []).length
  if (ellipsis > 2) items.push({ term: '省略号超配额', count: ellipsis, limit: 2, suggestion: '每章 ≤2 处；不写“他沉默了…”，改成停住的动作用' })
  const metaphor = (body.match(/(仿佛|宛如|犹如|好似|如同|像是)/g) ?? []).length
  const metaphorLimit = Math.floor(2 * per1000)
  if (metaphor > metaphorLimit) items.push({ term: '比喻超配额', count: metaphor, limit: metaphorLimit, suggestion: '每千字 ≤2 处；比喻必须落在可验证的物理参照上' })
  // 精确数值：排除面板行后，全章 ≤3 处（材料牌号由 F 组单独零容忍）
  const noPanel = body.replace(/【[^】]*】/g, '')
  const numeric = (noPanel.match(/\d+(?:\.\d+)?\s*(?:毫米|厘米|千米|公里|公斤|千克|毫升|升|克|度|大卡|千卡|卡路里|kg|km|cm|mm|ml|%|％|秒)/gi) ?? []).length
  if (numeric > 3) items.push({ term: '精确数值超配额', count: numeric, limit: 3, suggestion: '全章 ≤3 处，且每处必须影响一个决定；删掉“净重/热值/摆幅”式说明' })
  const connectors = (body.match(/(?:于是|然后|接着|随即|紧接着)/g) ?? []).length
  if (connectors > 5) items.push({ term: '串联词超配额', count: connectors, limit: 5, suggestion: '用句号断开动作，不用“于是/然后/接着”串场' })
  // 疼痛与伤口：疼只报一次，伤口外观只写一次
  const painWords = (noPanel.match(/(?:钝痛|抽痛|刺痛|灼痛|酸痛|胀痛|疼痛|痛感|生疼|发疼|疼得)/g) ?? []).length
  if (painWords > 2) items.push({ term: '疼痛词超配额', count: painWords, limit: 2, suggestion: '全章 ≤2 处；疼只报一次，其余改成绕开伤口的动作或代价（换手、换肩、慢半拍、失手）' })
  const woundLook = (noPanel.match(/(?:伤口|创口|伤处|皮肉)[^。！？]{0,10}(?:翻卷|凝固|渗血|结痂|发白|发紫|勒住|扯动|牵扯|撕裂)/g) ?? []).length
  if (woundLook > 1) items.push({ term: '伤口外观复述', count: woundLook, limit: 1, suggestion: '全章只写 1 次伤口外观；之后不再描伤口，只写它让哪些动作做不成' })
  return items
}

export interface CadenceReport {
  wordCount: number
  sentenceCount: number
  /** 平均句长（非空白字符数 / 句数） */
  avgSentenceLength: number
  /** 短句（≤shortSentenceMax 字）占比 */
  shortSentenceRatio: number
  /** 引号对话内容占全文字数比例 */
  dialogueRatio: number
  issues: Array<{ term: string; value: number; limit: number; suggestion: string }>
}

export interface CadenceOptions {
  /** 平均句长上限，默认 26 字 */
  avgLimit?: number
  /** 短句比例下限，默认 0.22 */
  shortRatioMin?: number
  /** 短句判定字数，默认 12 */
  shortSentenceMax?: number
  /** 对话占比下限，默认 0.05（有第二人在场时应 ≥0.08，独场章 ≥0.03） */
  dialogueMin?: number
}

/**
 * 句法与信息载体体检：句长、短句拍点、对话占比。
 * 长句连缀 + 零对话，是“叙述者一个人讲完一章”的典型 AI 腔结构。
 */
export function scanCadence(text: string, options: CadenceOptions = {}): CadenceReport {
  const body = (text || '').replace(/\s/g, '')
  const wordCount = body.length
  const avgLimit = options.avgLimit ?? 26
  const shortRatioMin = options.shortRatioMin ?? 0.22
  const shortSentenceMax = options.shortSentenceMax ?? 12
  const dialogueMin = options.dialogueMin ?? 0.05
  const issues: CadenceReport['issues'] = []
  if (wordCount === 0) {
    return { wordCount: 0, sentenceCount: 0, avgSentenceLength: 0, shortSentenceRatio: 0, dialogueRatio: 0, issues }
  }

  const sentences = body.split(/[。！？!?]+/).filter(s => s.length > 1)
  const sentenceCount = sentences.length
  const avgSentenceLength = sentenceCount ? body.length / sentenceCount : wordCount
  const shortCount = sentences.filter(s => s.length <= shortSentenceMax).length
  const shortSentenceRatio = sentenceCount ? shortCount / sentenceCount : 0
  const dialogueChars = (body.match(/“[^”]*”|「[^」]*」|"[^"\n]*"/g) ?? []).join('').length
  const dialogueRatio = wordCount ? dialogueChars / wordCount : 0

  if (avgSentenceLength > avgLimit) {
    issues.push({
      term: `平均句长 ${avgSentenceLength.toFixed(1)} 字`,
      value: Number(avgSentenceLength.toFixed(1)),
      limit: avgLimit,
      suggestion: `建议 ≤${avgLimit} 字；长句拆成动作短句，别用逗号把三个动作串成一句`,
    })
  }
  if (shortSentenceRatio < shortRatioMin) {
    issues.push({
      term: `短句占比 ${(shortSentenceRatio * 100).toFixed(0)}%`,
      value: Math.round(shortSentenceRatio * 100),
      limit: Math.round(shortRatioMin * 100),
      suggestion: `≤${shortSentenceMax} 字的短句应占 ${Math.round(shortRatioMin * 100)}% 以上；在动作、判断、对白处断句`,
    })
  }
  if (dialogueRatio < dialogueMin) {
    issues.push({
      term: `对话占比 ${(dialogueRatio * 100).toFixed(1)}%`,
      value: Number((dialogueRatio * 100).toFixed(1)),
      limit: Math.round(dialogueMin * 100),
      suggestion: '有第二人在场时应 ≥8%（独场章 ≥3%）；规则与价格交给别人说、告示与旧地图写、商家私聊里问，叙述者不代讲',
    })
  }

  // 长句链：连续 3 句超过 30 字
  const longThreshold = 30
  let maxLongChain = 0
  let longChain = 0
  for (const s of sentences) {
    if (s.length > longThreshold) {
      longChain += 1
      maxLongChain = Math.max(maxLongChain, longChain)
    } else {
      longChain = 0
    }
  }
  if (maxLongChain >= 3) {
    issues.push({
      term: `长句链 ${maxLongChain} 句`,
      value: maxLongChain,
      limit: 3,
      suggestion: '连续 3 句超 30 字必须拆开：一句一个动作或一个判断，用句号断开',
    })
  }

  // 段首人称重复：连续 3 段以“他/她”开头
  const paragraphs = (text || '').split(/\n+/).map(p => p.trim()).filter(Boolean)
  let maxPronounRun = 0
  let pronounRun = 0
  for (const p of paragraphs) {
    if (/^[“「"]?\s*(?:他|她)/.test(p)) {
      pronounRun += 1
      maxPronounRun = Math.max(maxPronounRun, pronounRun)
    } else {
      pronounRun = 0
    }
  }
  if (maxPronounRun >= 3) {
    issues.push({
      term: `连续段首“他” ${maxPronounRun} 段`,
      value: maxPronounRun,
      limit: 3,
      suggestion: '连续 3 段以“他/她”开头就换主语、换段式，或改成对白/物件开头',
    })
  }

  return { wordCount, sentenceCount, avgSentenceLength, shortSentenceRatio, dialogueRatio, issues }
}

/**
 * 面板分层（H03/H04）：固定面板只有属性/装备/道具/技能四类。
 * - 合计 ≤8 行/章（标题行与字段行都算）
 * - 属性面板（四维行）≤2 次
 * - 连续 `【…｜…】` 字段卡 >3 行即报（装备面板最多 3 行字段，不受影响）
 */
export function scanPanelLayering(text: string): StyleScanHit[] {
  const hits: StyleScanHit[] = []
  const lines = (text || '').split(/\n/).map(l => l.trim())
  const bracketLine = /^【[^】]{1,60}】$/
  const fieldLine = /^【[^】]{1,60}｜[^】]{1,60}】$/
  const titleLine = /^【(?:装备|道具|技能|属性|状态)】$/

  const panelLines = lines.filter(l => bracketLine.test(l) && (fieldLine.test(l) || titleLine.test(l)))
  if (panelLines.length > 8) {
    hits.push({
      kind: 'panel',
      term: `固定面板 ${panelLines.length} 行`,
      count: panelLines.length - 8,
      suggestion: '固定面板合计 ≤8 行/章；删掉重复展示或合并同类字段',
    })
  }

  const attrPanels = lines.filter(l => /^【(?:力|力量)\s*[0-9]+\s*｜/.test(l)).length
  if (attrPanels > 2) {
    hits.push({
      kind: 'panel',
      term: `属性面板 ${attrPanels} 次`,
      count: attrPanels - 2,
      suggestion: '属性面板 ≤2 次/章；数值变化只更一次，结算不重复展示',
    })
  }

  let run = 0
  let maxRun = 0
  for (const line of lines) {
    if (fieldLine.test(line)) {
      run += 1
      maxRun = Math.max(maxRun, run)
    } else {
      run = 0
    }
  }
  if (maxRun > 3) {
    hits.push({
      kind: 'panel',
      term: `连续字段卡 ${maxRun} 行`,
      count: maxRun - 3,
      suggestion: '连续 3 行以上字段卡只保留四类固定面板的规定行数；其余信息改成动作、对白或载体',
    })
  }

  return hits
}

/** 统计正文的接地气问题；空文本返回全 0 报告 */
export function scanStyle(text: string, options: StyleScanOptions = {}): StyleScanReport {
  const content = text || ''
  const wordCount = countScanWords(content)
  const hits: StyleScanHit[] = []
  if (wordCount === 0) return { wordCount: 0, hits, totalHits: 0 }

  // 1) 项目词表禁用词
  const banned = Array.from(new Set((options.bannedTerms ?? []).map(t => t.trim()).filter(Boolean)))
  for (const term of banned) {
    const count = countOccurrences(content, term)
    if (count > 0) hits.push({ kind: 'banned', term, count, suggestion: options.replacements?.[term] })
  }

  // 2) 冗余修饰语
  for (const term of DECORATIONS) {
    const count = countOccurrences(content, term)
    if (count > 0) hits.push({ kind: 'decoration', term, count, suggestion: '删掉这个修饰语' })
  }

  // 3) 名词化句式
  for (const { pattern, suggestion } of NOUNIFIED_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags)
    const matched = content.match(re)
    if (matched && matched.length > 0) {
      hits.push({ kind: 'nounified', term: matched[0], count: matched.length, suggestion })
    }
  }

  // 4) 专名密度：【xxx】视为专名，每 500 字不超过 N 个
  const densityLimit = options.termDensityPer500 ?? 2
  const terms = content.match(/【[^】]{1,20}】/g) ?? []
  const uniqueTerms = new Set(terms)
  const allowed = Math.max(1, Math.ceil(wordCount / 500) * densityLimit)
  if (uniqueTerms.size > allowed) {
    hits.push({
      kind: 'density',
      term: `专名 ${uniqueTerms.size} 个`,
      count: uniqueTerms.size - allowed,
      suggestion: `每 500 字最多 ${densityLimit} 个新专名，首次出现请用动作/后果解释`,
    })
  }

  // 5) 抽象高频词：阈值随篇幅放宽（每 800 字 3 次）
  const hotLimit = Math.max(3, Math.round(wordCount / 800) * 3)
  for (const term of HOT_WORDS) {
    const count = countOccurrences(content, term)
    if (count > hotLimit) {
      hits.push({ kind: 'hot', term, count, suggestion: `本章出现 ${count} 次，改用具体动作或删除` })
    }
  }

  // 6) 套路化描写：单章上限随篇幅按 2,400 字基准放宽
  for (const rule of CLICHE_PATTERNS) {
    const count = (content.match(rule.pattern) ?? []).length
    const limit = Math.max(rule.limit, Math.ceil(wordCount / 2400) * rule.limit)
    if (count > limit) {
      hits.push({
        kind: 'cliche',
        term: rule.term,
        count,
        suggestion: `本章出现 ${count} 次（建议 ≤${limit}）：${rule.suggestion}`,
      })
    }
  }

  // 7) 同一段内数字复读
  for (const hit of scanNumericRepeats(content)) {
    hits.push({
      kind: 'numeric',
      term: `同一段重复“${hit.term}”`,
      count: 1,
      suggestion: '第二次出现改成约数（数十/十几/一片），避免节奏打结',
    })
  }

  // 8) 单段体感堆叠
  for (const hit of scanSensoryStack(content)) {
    hits.push({
      kind: 'sensory',
      term: '单段体感堆叠',
      count: 1,
      suggestion: `同一段出现 ${hit.count} 个体感词，删到 2 个以内：${hit.excerpt}`,
    })
  }

  // 9) 标点与比喻配额
  for (const hit of scanQuota(content)) {
    hits.push({
      kind: 'cliche',
      term: hit.term,
      count: hit.count,
      suggestion: `本章 ${hit.count} 处（建议 ≤${hit.limit}）：${hit.suggestion}`,
    })
  }

  // 10) 面板分层：固定面板 ≤8 行/章、属性 ≤2 次、连续字段卡 ≤3 行
  for (const hit of scanPanelLayering(content)) hits.push(hit)

  // 11) 句法与信息载体：平均句长、短句拍点、对话占比
  for (const issue of scanCadence(content).issues) {
    hits.push({
      kind: 'cadence',
      term: issue.term,
      count: 1,
      suggestion: issue.suggestion,
    })
  }

  const totalHits = hits.reduce((sum, h) => sum + h.count, 0)
  return { wordCount, hits, totalHits }
}

/**
 * 按项目词表做确定性替换（不调用 LLM）。
 * 长词优先，避免「灰雾」被「雾」抢先替换后留下半截。
 */
export function applyReplacements(text: string, replacements: Record<string, string> = {}): string {
  const keys = Object.keys(replacements)
    .map(k => k.trim())
    .filter(k => k && typeof replacements[k] === 'string')
    .sort((a, b) => b.length - a.length)
  let result = text || ''
  for (const key of keys) {
    const value = replacements[key]
    if (value === undefined) continue
    result = result.split(key).join(value)
  }
  return result
}
