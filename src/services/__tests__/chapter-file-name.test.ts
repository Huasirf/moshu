import { describe, expect, it } from 'vitest'
import {
  chapterSummaryFileName,
  finalizedChapterFileName,
} from '../workflows/chapter-file-name'

/** 与 electron/knowledge-base.ts 的 parseChapterMetaFromFileName 保持同一口径 */
const KB_FILE_PATTERN = /^第(\d+)章(?:\s+(.+?))?(?:\s+(?:正文|要点|蓝图|剧情摘要))?\.(?:md|txt)$/i

describe('chapter-file-name（P2-5 统一命名）', () => {
  it('定稿正文为「第N章 标题.txt」', () => {
    expect(finalizedChapterFileName(18, '盐潮')).toBe('第18章 盐潮.txt')
    expect(finalizedChapterFileName(3, ' 归墟 ')).toBe('第3章 归墟.txt')
  })

  it('无标题时退化为「第N章.txt」', () => {
    expect(finalizedChapterFileName(7, '')).toBe('第7章.txt')
    expect(finalizedChapterFileName(7, undefined)).toBe('第7章.txt')
    expect(finalizedChapterFileName(7, '   ')).toBe('第7章.txt')
  })

  it('非法文件名字符替换为下划线', () => {
    expect(finalizedChapterFileName(5, 'a/b\\c:d*e?f"g<h>i|j'))
      .toBe('第5章 a_b_c_d_e_f_g_h_i_j.txt')
  })

  it('摘要固定带「剧情摘要」后缀', () => {
    expect(chapterSummaryFileName(18, '盐潮')).toBe('第18章 盐潮 剧情摘要.txt')
    expect(chapterSummaryFileName(18)).toBe('第18章 剧情摘要.txt')
  })

  it('生成的文件名都能解析出章节号（范围检索依赖）', () => {
    for (const name of [
      finalizedChapterFileName(12, '潮起'),
      finalizedChapterFileName(12, ''),
      chapterSummaryFileName(12, '潮起'),
    ]) {
      expect(name.match(KB_FILE_PATTERN)?.[1]).toBe('12')
    }
  })
})
