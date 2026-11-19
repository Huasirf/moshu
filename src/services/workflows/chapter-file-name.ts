/**
 * 章节文件命名统一（P2-5）
 *
 * 定稿正文、章节摘要与知识库导入文档共用同一套命名规则：`第N章 标题.txt`。
 * 章节号必须保留，`parseChapterMetaFromFileName` 依赖它做「只检索本章之前」的过滤；
 * 标题缺省时退化为 `第N章.txt`，不留空标题段。
 */

/** Windows/macOS 都不允许出现在文件名里的字符 */
const ILLEGAL_FILENAME_CHARS = /[/\\:*?"<>|]/g

/** 标题清洗：去非法字符并 trim，供文件名与日志复用 */
export function safeChapterTitle(title?: string | null): string {
  return (title ?? '').replace(ILLEGAL_FILENAME_CHARS, '_').trim()
}

/** 定稿正文文件名：`第N章 标题.txt` / `第N章.txt` */
export function finalizedChapterFileName(chapterNumber: number, title?: string | null): string {
  const safe = safeChapterTitle(title)
  return safe ? `第${chapterNumber}章 ${safe}.txt` : `第${chapterNumber}章.txt`
}

/** 章节剧情摘要文件名：`第N章 标题 剧情摘要.txt` / `第N章 剧情摘要.txt` */
export function chapterSummaryFileName(chapterNumber: number, title?: string | null): string {
  const safe = safeChapterTitle(title)
  return safe ? `第${chapterNumber}章 ${safe} 剧情摘要.txt` : `第${chapterNumber}章 剧情摘要.txt`
}
