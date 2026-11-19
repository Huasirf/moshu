import { describe, it, expect } from 'vitest'
import { checkDraftIntegrity, countDraftWords } from '../text-integrity'

/** 造一段 200 字以上的正常正文（不重复） */
function makeParagraph(seed: string, length = 220): string {
  let s = ''
  while (s.length < length) s += `${seed}夜色压在盐滩上，他数着脚下的盐晶，一步一步往前挪。`
  return s.slice(0, length)
}

const HEAD = '墨砚把手按在断名刀的刀柄上，黑潮正从远处的潮渊边缘蔓延过来，像一层会呼吸的锈。'

function makeChapter(): string {
  const scenes = [
    `${HEAD}他记得父亲的叮嘱，却没有退。`,
    makeParagraph('第一场：'),
    '“你确定要下去？”阿箬的声音发紧，手指攥着鱼皮册子的边角。',
    makeParagraph('第二场：', 260),
    '断名刀出鞘，刀身上浮现出细密的盐晶纹路。',
    '他听见潮声在耳边炸开，又归于死寂。',
    '远处的灯塔熄了，只剩一盏昏黄的灯芯在风里摇晃。',
    '这一夜，盐滩上没有人睡着。',
  ]
  return scenes.join('\n\n')
}

describe('checkDraftIntegrity', () => {
  it('正常整章应当通过', () => {
    const report = checkDraftIntegrity(makeChapter())
    expect(report.issues).toEqual([])
    expect(report.ok).toBe(true)
  })

  it('同一章被拼接多份时应报 REPEATED_HEAD', () => {
    const ch = makeChapter()
    const report = checkDraftIntegrity(`${ch}\n\n${ch}\n\n${ch}`)
    expect(report.ok).toBe(false)
    expect(report.issues.some((i) => i.code === 'REPEATED_HEAD')).toBe(true)
  })

  it('整段重复（非开头）应报 REPEATED_BLOCK', () => {
    const ch = makeChapter()
    const block = makeParagraph('重复段：', 300)
    const report = checkDraftIntegrity(`${ch}\n\n${block}\n\n中间插一段无关的过渡。\n\n${block}`)
    expect(report.ok).toBe(false)
    expect(report.issues.some((i) => i.code === 'REPEATED_BLOCK')).toBe(true)
  })

  it('末尾半句截断应报 TRUNCATED', () => {
    const report = checkDraftIntegrity('他走到盐滩尽头，抬头看见灯塔，然后')
    expect(report.ok).toBe(false)
    expect(report.issues.some((i) => i.code === 'TRUNCATED')).toBe(true)
  })

  it('末尾半个引号（对白未闭合）应报 TRUNCATED', () => {
    const report = checkDraftIntegrity('“你确定要下去？”阿箬的声音发紧，他却只说了一句：“走')
    expect(report.ok).toBe(false)
    expect(report.issues.some((i) => i.code === 'TRUNCATED')).toBe(true)
  })

  it('正常以引号收尾的对白不应误报', () => {
    const report = checkDraftIntegrity('阿箬把灯递给他，说：“走。”')
    expect(report.issues).toEqual([])
  })

  it('传入阈值时给出 TOO_SHORT / TOO_LONG', () => {
    const short = checkDraftIntegrity('短稿。', { minWords: 100 })
    expect(short.issues.some((i) => i.code === 'TOO_SHORT')).toBe(true)

    const long = checkDraftIntegrity(`${makeChapter()}${makeChapter()}`, { hardMax: 100 })
    expect(long.issues.some((i) => i.code === 'TOO_LONG')).toBe(true)
  })

  it('字数口径忽略空白字符', () => {
    expect(countDraftWords(' 一 二\n三\t四 ')).toBe(4)
    expect(countDraftWords('')).toBe(0)
  })

  it('空稿不应误报截断', () => {
    expect(checkDraftIntegrity('').issues).toEqual([])
  })
})
