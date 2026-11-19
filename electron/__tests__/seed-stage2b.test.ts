import { describe, expect, it } from 'vitest'
import { initProjectDatabase, closeProjectDatabase } from '../database'
import { AssetRepository, type AssetInput } from '../repositories/asset-repository'

const PROJECT = 'F:\\MSnovel\\开局误入高阶试炼'
const CANDIDATE = '候选池·未定章，卷一不主动引用'

const equipment: AssetInput[] = [
  {
    entityType: 'item', name: '废城面罩', firstChapter: 0, lastChapter: 0,
    summary: 'F 级头盔候选，滤尘防孢子。',
    description: '半覆面式面罩，两侧各一片可换滤片，镜片带一点低光增益。废城带与回生林区都用得上。',
    tags: ['装备', 'F级', '头盔', '候选'],
    typeData: {
      category: 'equipment', tier: 'F', slot: 'head', tierNote: CANDIDATE,
      attrReq: [{ attr: '体魄', value: 20 }, { attr: '心识', value: 20 }, { attr: '敏捷', value: 10 }],
      baseStats: { attack: 0, defense: 700, durability: 50 },
      integrity: 100, endurance: 100,
      affixes: [
        { type: 'passive', name: '滤尘', effect: '沙尘与灰烬环境视野不受影响' },
        { type: 'passive', name: '防孢子', effect: '孢子浓度低于阈值时不被吸入' },
        { type: 'passive', name: '低光镜片', effect: '暗处可视距离提升约 30%' },
      ],
      trigger: '永久', cooldown: '无',
      cost: ['占头盔位', '滤片需定期更换'],
      source: '野市二手', repair: '可换滤片与镜片', binding: 'tradeable',
      marketPrice: '约 1.5–2.5 万', unusable: ['强酸环境滤片会失效', '不防正面钝击'],
    },
  },
  {
    entityType: 'item', name: '拆解臂套', firstChapter: 0, lastChapter: 0,
    summary: 'F 级护臂候选，拆机专用。',
    description: '从肘到腕的硬质臂套，内侧嵌了防滑垫，外侧两个工具插槽。拆精密件时手腕不抖。',
    tags: ['装备', 'F级', '护臂', '候选'],
    typeData: {
      category: 'equipment', tier: 'F', slot: 'arm', tierNote: CANDIDATE,
      attrReq: [{ attr: '心识', value: 30 }, { attr: '敏捷', value: 20 }],
      baseStats: { attack: 0, defense: 600, durability: 55 },
      integrity: 100, endurance: 100,
      affixes: [
        { type: 'passive', name: '拆解稳定', effect: '精细拆解失误率降低 40%' },
        { type: 'passive', name: '挡划', effect: '碎片划伤降低 30%' },
        { type: 'passive', name: '工具插槽', effect: '可外挂 2 件小型工具，取用不额外耗时' },
      ],
      trigger: '永久', cooldown: '无',
      cost: ['占护臂位', '插槽满载时行动略受限'],
      source: '野市定制', repair: '普通修理箱可修', binding: 'tradeable',
      marketPrice: '约 1.2–2 万', unusable: ['不防钝击', '高温下防滑垫会软化'],
    },
  },
  {
    entityType: 'item', name: '静默耳坠', firstChapter: 0, lastChapter: 0,
    summary: 'F 级饰品候选，听觉增强。',
    description: '一枚贴耳的黑色小坠，戴上后远处的脚步与机械声会清楚一截，代价是近处的爆响会刺得耳朵发疼。',
    tags: ['装备', 'F级', '饰品', '候选'],
    typeData: {
      category: 'equipment', tier: 'F', slot: 'accessory', tierNote: CANDIDATE,
      attrReq: [{ attr: '心识', value: 40 }, { attr: '敏捷', value: 10 }],
      baseStats: { attack: 0, defense: 0, durability: 30 },
      integrity: 100, endurance: 100,
      affixes: [
        { type: 'passive', name: '听觉增强', effect: '可分辨 20 米内的脚步与机械运转声' },
        { type: 'passive', name: '风声过滤', effect: '风噪环境不干扰听觉判断' },
      ],
      trigger: '永久', cooldown: '无',
      cost: ['占饰品位', '强音环境会短暂耳鸣'],
      source: '野市', repair: '不可修', binding: 'tradeable',
      marketPrice: '约 1–1.8 万', unusable: ['爆炸与高频噪音会造成眩晕', '不提供战斗属性'],
    },
  },
  {
    entityType: 'item', name: '矿城护甲', firstChapter: 0, lastChapter: 0,
    summary: 'E 级甲胄候选，矿城旧制式。',
    description: '旧矿城的作业护甲，胸前一块厚复合板，肩背加了防落石护片。重，但扛得住矿井里的塌方碎块。',
    tags: ['装备', 'E级', '甲胄', '候选'],
    typeData: {
      category: 'equipment', tier: 'E', slot: 'chest', tierNote: CANDIDATE,
      attrReq: [{ attr: '体魄', value: 120 }, { attr: '心识', value: 120 }, { attr: '力量', value: 60 }],
      baseStats: { attack: 0, defense: 5200, durability: 130 },
      integrity: 100, endurance: 100,
      affixes: [
        { type: 'passive', name: '防落石', effect: '上方坠物伤害降低 40%' },
        { type: 'passive', name: '粉尘密封', effect: '粉尘环境呼吸与视线不受影响' },
        { type: 'passive', name: '硬壳', effect: '穿刺伤害降低 30%' },
        { type: 'passive', name: '配重均衡', effect: '负重增加但重心稳定，奔跑不晃' },
        { type: 'active', name: '撑架', effect: '3 秒内抗压能力翻倍，不能移动' },
        { type: 'active', name: '快脱', effect: '2 秒内脱开主扣' },
      ],
      trigger: '被动常驻；主动手动', cooldown: '撑架 10 分钟；快脱 5 分钟',
      cost: ['占甲胄位', '整套约 16 公斤', '心域占用 12'],
      source: '旧矿城遗留', repair: '需同级修理', binding: 'tradeable',
      marketPrice: '约 25–40 万', unusable: ['水下行动困难', '快脱后护甲散落'],
    },
  },
  {
    entityType: 'item', name: '废板盾', firstChapter: 0, lastChapter: 0,
    summary: '民用盾候选，废合金板拼的。',
    description: '两块废合金板铆在一起，边缘磨圆，背面焊了握把。挡一次正面重击就会变形，胜在随手可得。',
    tags: ['装备', '民用', '盾', '候选'],
    typeData: {
      category: 'equipment', tier: '民用（总属性门槛型）', slot: 'shield',
      tierNote: '民用件（总属性门槛型·零门槛），候选池',
      attrReq: [], attrTotalReq: 0,
      baseStats: { attack: 0, defense: 600, durability: 35 },
      integrity: 100, endurance: 100,
      affixes: [
        { type: 'passive', name: '挡正面', effect: '正面钝击伤害降低 45%' },
        { type: 'passive', name: '临时担架', effect: '拆下握把后可作短担架使用' },
      ],
      trigger: '手持', cooldown: '无',
      cost: ['占武器位（盾计入武器位）', '挡一次重击后变形'],
      source: '废城带自制品', repair: '可敲平，变形过度即报废', binding: 'tradeable',
      marketPrice: '约 0.1–0.3 万', unusable: ['挡不住穿刺', '变形后防御减半'],
    },
  },
  {
    entityType: 'item', name: '撬棍', firstChapter: 0, lastChapter: 0,
    summary: '民用工具候选，撬门拆箱两用。',
    description: '一米二长的钢撬棍，一头扁一头弯。撬门、拆箱、撬石板，急了也能抡人。',
    tags: ['装备', '民用', '武器', '候选'],
    typeData: {
      category: 'equipment', tier: '民用（总属性门槛型）', slot: 'weapon',
      tierNote: '民用工具（总属性门槛型·零门槛），候选池',
      attrReq: [], attrTotalReq: 0,
      baseStats: { attack: 400, defense: 0, durability: 70 },
      integrity: 100, endurance: 100,
      affixes: [
        { type: 'passive', name: '撬', effect: '可撬开铁门、箱盖与设备外壳' },
        { type: 'passive', name: '杠杆', effect: '撬动能力相当于三人合力' },
        { type: 'passive', name: '钝击', effect: '抡击可造成钝伤，对甲减半' },
      ],
      trigger: '手持', cooldown: '无',
      cost: ['占武器位', '撬动时无法持盾'],
      source: '蓝星五金店', repair: '磨头即可', binding: 'tradeable',
      marketPrice: '约 0.05–0.1 万', unusable: ['不是专业武器，对护甲伤害低', '过长，狭窄处不便'],
    },
  },
]

const cards: AssetInput[] = [
  {
    entityType: 'item', name: '硬壳卡', firstChapter: 0, lastChapter: 0,
    summary: 'F 级防御卡候选，短时硬化。',
    description: '捏碎后皮肤表面会浮起一层灰壳，硬扛几下钝击，但人动不了。',
    tags: ['道具卡', '防御', 'F级', '候选'],
    typeData: {
      category: 'card', cardType: '防御', tier: 'F', uses: 1, tierNote: CANDIDATE,
      effect: '10 秒内受到的钝击与穿刺伤害降低 30%，期间不能移动', duration: '10 秒', cooldown: '一次性',
      restrictions: ['不能移动', '结束后 5 秒内皮肤发麻'],
      source: '野市', marketPrice: '约 2–3 万/张',
      storyFunction: '候选池，用于需要临时硬扛的场面。',
    },
  },
  {
    entityType: 'item', name: '绊索卡', firstChapter: 0, lastChapter: 0,
    summary: 'F 级控制卡候选，布置隐形绊索。',
    description: '撕开后在地面布一根三米长的细索，颜色贴近地面。有人跑过就会绊倒。',
    tags: ['道具卡', '控制', 'F级', '候选'],
    typeData: {
      category: 'card', cardType: '控制', tier: 'F', uses: 1, tierNote: CANDIDATE,
      effect: '在 3 米范围内布置一根隐形绊索，触发者绊倒并短暂失衡', duration: '布置后 1 小时内有效', cooldown: '一次性',
      restrictions: ['只对移动中的目标有效', '对重型机械无效'],
      source: '野市', marketPrice: '约 1.5–2.5 万/张',
      storyFunction: '候选池，用于撤退与拖延。',
    },
  },
]

const materials: AssetInput[] = [
  {
    entityType: 'item', name: '尾矿精粉', firstChapter: 0, lastChapter: 0,
    summary: '尾矿带提纯的金属粉末候选材料。',
    description: '从尾矿里筛出来再提纯的细粉，装在小袋里，压手。财团按品位收。',
    tags: ['材料', '金属', '候选'],
    typeData: {
      category: 'material', materialType: '金属粉末', rarity: '少见', tierNote: CANDIDATE,
      source: '旧矿城试炼星·尾矿带', processing: '筛选、去杂、按品位分袋',
      use: ['合金原料', '财团收购'], marketPrice: '约 2–4 万/袋',
      storyFunction: '候选池，蓝色采集场的产出。',
    },
  },
  {
    entityType: 'item', name: '风蚀齿轮组', firstChapter: 0, lastChapter: 0,
    summary: '裂谷风道拆出的齿轮组候选材料。',
    description: '一套咬合还算完整的旧齿轮，齿面被风沙磨得发亮。修理行喜欢这种成套件。',
    tags: ['材料', '机械', '候选'],
    typeData: {
      category: 'material', materialType: '机械件', rarity: '常见', tierNote: CANDIDATE,
      source: '裂谷试炼星·风道', processing: '拆解、清沙、成套打包',
      use: ['设备修理', '野市出货'], marketPrice: '约 1.5–3 万/组',
      storyFunction: '候选池，黄色竞速场的副产物。',
    },
  },
  {
    entityType: 'item', name: '熔渣结晶', firstChapter: 0, lastChapter: 0,
    summary: '熔渣坑冷却后结出的耐高温结晶候选材料。',
    description: '熔渣慢冷时析出的黑绿色结晶，耐高温，敲下来像碎玻璃。做隔热层的好料。',
    tags: ['材料', '耐高温', '候选'],
    typeData: {
      category: 'material', materialType: '耐高温材料', rarity: '少见', tierNote: CANDIDATE,
      source: '裂谷试炼星·熔渣坑', processing: '冷却后敲取，避免骤冷开裂',
      use: ['隔热层', '护具改件'], marketPrice: '约 2–4 万/块',
      storyFunction: '候选池，熔渣坑的副产物。',
    },
  },
  {
    entityType: 'item', name: '活性滤芯', firstChapter: 0, lastChapter: 0,
    summary: '菌毯区净水滤芯候选材料。',
    description: '从旧净水设备里拆出的滤芯，还带着湿气。晾干就废，必须密封保湿带走。',
    tags: ['材料', '净水', '候选'],
    typeData: {
      category: 'material', materialType: '净水件', rarity: '少见', tierNote: CANDIDATE,
      source: '灰烬试炼星·旧净水厂 / 菌毯区', processing: '密封保湿，禁止晾晒',
      use: ['净水设备', '野市出货'], marketPrice: '约 6–10 万/支',
      storyFunction: '候选池，净水厂与水源线的关键件。',
    },
  },
  {
    entityType: 'item', name: '菌毯纤维', firstChapter: 0, lastChapter: 0,
    summary: '回生林区菌毯抽出的纤维候选材料。',
    description: '菌毯晒干后能抽出韧性纤维，搓成绳、编成垫都行。有轻微孢味，用前要处理。',
    tags: ['材料', '纤维', '候选'],
    typeData: {
      category: 'material', materialType: '生物纤维', rarity: '常见', tierNote: CANDIDATE,
      source: '静默环星·回生林区', processing: '晒干、抽丝、灭活残留孢子',
      use: ['绳索', '绷带', '填充'], marketPrice: '约 0.5–1 万/捆',
      storyFunction: '候选池，私路补给自制的原料。',
    },
  },
]

const skills: AssetInput[] = [
  {
    entityType: 'skill', name: '缚足', firstChapter: 0, lastChapter: 0,
    summary: '控制系 F 级技能候选。',
    description: '脚下一片地面突然发黏，抬脚要多花两秒。只绊得住人，绊不住机械。',
    tags: ['技能', '控制', 'F级', '候选'],
    typeData: {
      system: '控制', tier: 'F', brainReq: '2–3%', slotReq: 1, tierNote: CANDIDATE,
      effect: '指定 3 米内一片地面，踏入者移动速度降低 70%，持续 3 秒', cost: '微量体力',
      cooldown: '90 秒', sideEffect: '对机械与无脚目标无效',
      learnReq: ['F 阶', '心域剩余 ≥3%', '技能槽空位 1'],
      owner: '黄色场对手（未具名）', source: '黄色池实战', storyFunction: '候选池，用来写黄场对手的控场手段。',
    },
  },
  {
    entityType: 'skill', name: '锈犬哨', firstChapter: 0, lastChapter: 0,
    summary: '召唤系 F 级技能候选。',
    description: '一声尖哨能招来附近的锈犬。它们不认主人，只认哨声和血腥味。',
    tags: ['技能', '召唤', 'F级', '候选'],
    typeData: {
      system: '召唤', tier: 'F', brainReq: '2–3%', slotReq: 1, tierNote: CANDIDATE,
      effect: '召来 1–2 只野生锈犬，持续 1 分钟，不完全可控', cost: '中量体力',
      cooldown: '10 分钟', sideEffect: '哨声也会暴露自身位置',
      learnReq: ['F 阶', '心域剩余 ≥3%', '技能槽空位 1'],
      owner: '锈犬巢穴旧主人（已死）', source: '巢穴遗留记录', storyFunction: '候选池，锈犬巢穴场的敌方手段。',
    },
  },
  {
    entityType: 'skill', name: '创口闭合', firstChapter: 0, lastChapter: 0,
    summary: '治疗系 E 级技能候选。',
    description: '把手按在伤口上，皮肉会自己合拢。合得快，但合得糙，疤会留得很明显。',
    tags: ['技能', '治疗', 'E级', '候选'],
    typeData: {
      system: '治疗', tier: 'E', brainReq: '5%', slotReq: 1, tierNote: CANDIDATE,
      effect: '5 秒内闭合皮肉创口，止血并恢复轻伤', cost: '体力与精力中量消耗',
      cooldown: '30 分钟', sideEffect: '不能接断肢与内出血；使用后 10 分钟内体力恢复变慢',
      learnReq: ['E 阶或心识 300', '心域剩余 ≥5%', '技能槽空位 1'],
      owner: '试炼厅医疗组（未具名）', source: '官方医疗培训', storyFunction: '候选池，解释官方场次的急救能力。',
    },
  },
  {
    entityType: 'skill', name: '孢衣', firstChapter: 0, lastChapter: 0,
    summary: '被动系 F 级技能候选。',
    description: '皮肤表面会浮起一层极薄的菌膜，挡住孢子与霉菌。走路时有点痒。',
    tags: ['技能', '被动', 'F级', '候选'],
    typeData: {
      system: '被动', tier: 'F', brainReq: '2–3%', slotReq: 1, tierNote: CANDIDATE,
      effect: '孢子与霉菌侵染抗性提升 30%，菌毯地形移动不受黏滞影响', cost: '无',
      cooldown: '无', sideEffect: '干燥环境下皮肤易裂',
      learnReq: ['F 阶', '心域剩余 ≥3%', '技能槽空位 1'],
      owner: '蓝色池老手（未具名）', source: '菌毯区实战摸索', storyFunction: '候选池，解释别人为什么敢在菌毯里久待。',
    },
  },
  {
    entityType: 'skill', name: '短阵', firstChapter: 0, lastChapter: 0,
    summary: '辅助系 E 级技能候选。',
    description: '在脚下画出一个三米见方的临时阵位，站进去的人防御会硬一截。阵不跟人走。',
    tags: ['技能', '辅助', 'E级', '候选'],
    typeData: {
      system: '辅助', tier: 'E', brainReq: '5%（功能型 9%）', slotReq: 1, tierNote: CANDIDATE,
      effect: '在 3×3 米范围布阵，阵内队友防御提升 15%，持续 10 秒', cost: '中量精力',
      cooldown: '5 分钟', sideEffect: '阵位固定，离开即失效',
      learnReq: ['E 阶或心识 300', '心域剩余 ≥5%', '技能槽空位 1'],
      owner: '赤羽战队（未登场）', source: '战队训练体系', storyFunction: '候选池，团队场的防守手段。',
    },
  },
]

const locations: AssetInput[] = [
  {
    entityType: 'location', name: '西陆远征前线试炼星', firstChapter: 0, lastChapter: 0,
    summary: '西陆远征司控制的高危试炼星候选地点。',
    description: '一处被远征司划作前线的高危试炼星，防卫与怪物密度都按红级以上配置。卷一不进入。',
    tags: ['试炼星', '西陆', '候选'],
    typeData: {
      region: '西陆远征前线', access: '红级以上凭证 + 远征司许可', danger: '高',
      hazards: ['高密度敌对目标', '无补给', '远征司管制'], resources: ['高阶材料', '星图'],
      storyFunction: '候选池，卷二之后的高阶场次舞台。', mapNodes: ['登陆点', '前线营地'], firstEnterChapter: 0, tierNote: CANDIDATE,
    },
  },
  {
    entityType: 'location', name: '南陆潮汐港', firstChapter: 0, lastChapter: 0,
    summary: '南陆最大的凭证与物资港口候选地点。',
    description: '潮汐涨落间开闭的港城，凭证、装备与情报在码头上明码标价。卷一不进入。',
    tags: ['港口', '南陆', '候选'],
    typeData: {
      region: '南陆', access: '公开', danger: '中',
      hazards: ['帮派抽成', '情报贩子', '假货'], resources: ['凭证', '航运情报'],
      storyFunction: '候选池，后期凭证流通与出海线的舞台。', mapNodes: ['码头', '交易行', '船坞'], firstEnterChapter: 0, tierNote: CANDIDATE,
    },
  },
  {
    entityType: 'location', name: '北陆冻土矿脉', firstChapter: 0, lastChapter: 0,
    summary: '北陆资源联合体控制的重工矿脉候选地点。',
    description: '冻土下的深层矿脉，合金产能的核心。卷一不进入。',
    tags: ['矿区', '北陆', '候选'],
    typeData: {
      region: '北陆', access: '联合体许可', danger: '中—高',
      hazards: ['冻伤', '矿道坍塌', '联合体管制'], resources: ['高阶合金', '矿材'],
      storyFunction: '候选池，装备材料线的上游。', mapNodes: ['矿区入口', '深层矿道'], firstEnterChapter: 0, tierNote: CANDIDATE,
    },
  },
  {
    entityType: 'location', name: '中陆理事会中立城', firstChapter: 0, lastChapter: 0,
    summary: '跨文明试炼理事会所在地候选地点。',
    description: '一座不设城墙的中立城，理事会、档案院与各国代表处都在这里。卷一不进入。',
    tags: ['中立城', '中陆', '候选'],
    typeData: {
      region: '中陆', access: '公开（需报备）', danger: '低',
      hazards: ['规则审查', '身份核验'], resources: ['勘界数据', '规则解释'],
      storyFunction: '候选池，勘界度与终局副本的规则来源。', mapNodes: ['理事会', '档案院'], firstEnterChapter: 0, tierNote: CANDIDATE,
    },
  },
  {
    entityType: 'location', name: '海外群岛自由港', firstChapter: 0, lastChapter: 0,
    summary: '海外群岛的走私与自由交易港候选地点。',
    description: '不挂任何大陆旗帜的港，走私线与旧文明遗迹的入口都在这一带。卷一不进入。',
    tags: ['自由港', '群岛', '候选'],
    typeData: {
      region: '海外群岛', access: '船只', danger: '中',
      hazards: ['走私火并', '无管辖', '遗迹异常'], resources: ['走私货', '遗迹信息'],
      storyFunction: '候选池，卷二出海线的舞台。', mapNodes: ['自由港', '旧遗迹入口'], firstEnterChapter: 0, tierNote: CANDIDATE,
    },
  },
  {
    entityType: 'location', name: '第二卷红门试炼星', firstChapter: 0, lastChapter: 0,
    summary: '卷二开篇的高阶红色试炼星候选地点。',
    description: '一道横在地平线上的红色光门，是卷二开篇的高阶场次入口。卷一不出现。',
    tags: ['试炼星', '红色场', '候选'],
    typeData: {
      region: '公共试炼星网络·深层', access: '红色凭证 + 红场准入', danger: '高',
      hazards: ['红级敌对目标', '同池老手', '死亡即真死'], resources: ['高阶属性点', '红级装备'],
      storyFunction: '候选池，卷二开篇的升级舞台。', mapNodes: ['红门', '场内营地'], firstEnterChapter: 0, tierNote: CANDIDATE,
    },
  },
]

const all: AssetInput[] = [...equipment, ...cards, ...materials, ...skills, ...locations]

describe('stage2b candidate assets', () => {
  it('seeds candidate pool', () => {
    initProjectDatabase(PROJECT)
    try {
      for (const input of all) AssetRepository.upsert(input)
      const counts = {
        item: AssetRepository.getAll('item').length,
        location: AssetRepository.getAll('location').length,
        skill: AssetRepository.getAll('skill').length,
      }
      console.log('STAGE2B', JSON.stringify(counts), 'added=', all.length)

      // 每个候选资产都能按名称查到（upsert 生效）
      for (const entityType of ['item', 'location', 'skill'] as const) {
        const names = new Set(AssetRepository.getAll(entityType).map(a => a.name))
        for (const input of all.filter(a => a.entityType === entityType)) {
          expect(names.has(input.name)).toBe(true)
        }
      }
      // 名称在候选池内唯一
      const inputNames = new Set(all.map((a) => `${a.entityType}:${a.name}`))
      expect(inputNames.size).toBe(all.length)

      // 幂等：重复 upsert 不会新增资产（项目库已有多少条不再是硬编码断言）
      for (const input of all) AssetRepository.upsert(input)
      expect(AssetRepository.getAll('item').length).toBe(counts.item)
      expect(AssetRepository.getAll('location').length).toBe(counts.location)
      expect(AssetRepository.getAll('skill').length).toBe(counts.skill)
    } finally {
      closeProjectDatabase()
    }
  })
})
