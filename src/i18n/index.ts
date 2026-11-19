import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// 中文是兜底语言：首屏只同步加载它，en / ru 在切换或检测到语言时按需加载
import zhCNCommon from './locales/zh-CN/common.json'
import zhCNDialogs from './locales/zh-CN/dialogs.json'
import zhCNEditors from './locales/zh-CN/editors.json'
import zhCNPanels from './locales/zh-CN/panels.json'
import zhCNLayout from './locales/zh-CN/layout.json'
import zhCNPages from './locales/zh-CN/pages.json'
import zhCNStores from './locales/zh-CN/stores.json'
import zhCNSettings from './locales/zh-CN/settings.json'
import zhCNCommands from './locales/zh-CN/commands.json'

export type SupportedLocale = 'zh-CN' | 'en' | 'ru'

export const SUPPORTED_LOCALES: SupportedLocale[] = ['zh-CN', 'en', 'ru']

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'

/** 每个语言一个动态 chunk，避免首屏加载其余语言 */
const localeLoaders: Record<Exclude<SupportedLocale, 'zh-CN'>, () => Promise<Record<string, unknown>>> = {
  en: async () => ({
    common: (await import('./locales/en/common.json')).default,
    dialogs: (await import('./locales/en/dialogs.json')).default,
    editors: (await import('./locales/en/editors.json')).default,
    panels: (await import('./locales/en/panels.json')).default,
    layout: (await import('./locales/en/layout.json')).default,
    pages: (await import('./locales/en/pages.json')).default,
    stores: (await import('./locales/en/stores.json')).default,
    settings: (await import('./locales/en/settings.json')).default,
    commands: (await import('./locales/en/commands.json')).default,
  }),
  ru: async () => ({
    common: (await import('./locales/ru/common.json')).default,
    dialogs: (await import('./locales/ru/dialogs.json')).default,
    editors: (await import('./locales/ru/editors.json')).default,
    panels: (await import('./locales/ru/panels.json')).default,
    layout: (await import('./locales/ru/layout.json')).default,
    pages: (await import('./locales/ru/pages.json')).default,
    stores: (await import('./locales/ru/stores.json')).default,
    settings: (await import('./locales/ru/settings.json')).default,
    commands: (await import('./locales/ru/commands.json')).default,
  }),
}

const loadedLocales = new Set<string>(['zh-CN'])

/** 按需加载某个语言的资源（幂等、可并发调用） */
export async function ensureLocale(lng: string): Promise<void> {
  if (loadedLocales.has(lng)) return
  const loader = localeLoaders[lng as Exclude<SupportedLocale, 'zh-CN'>]
  if (!loader) return
  try {
    const bundles = await loader()
    for (const [ns, resource] of Object.entries(bundles)) {
      i18n.addResourceBundle(lng, ns, resource, true, true)
    }
    loadedLocales.add(lng)
  } catch (err) {
    console.error('[i18n] failed to load locale', lng, err)
  }
}

/** 首屏语言：localStorage 优先，其次浏览器语言，兜底中文 */
export function resolveInitialLanguage(): SupportedLocale {
  if (!isBrowser) return 'zh-CN'
  const stored = window.localStorage.getItem('moshu-locale') ?? window.localStorage.getItem('vela-locale')
  if (stored === 'en' || stored === 'ru' || stored === 'zh-CN') return stored
  const nav = (navigator.language || '').toLowerCase()
  if (nav.startsWith('ru')) return 'ru'
  if (nav.startsWith('en')) return 'en'
  return 'zh-CN'
}

const i18nConfig: Parameters<typeof i18n.init>[0] = {
  resources: {
    'zh-CN': {
      common: zhCNCommon,
      dialogs: zhCNDialogs,
      editors: zhCNEditors,
      panels: zhCNPanels,
      layout: zhCNLayout,
      pages: zhCNPages,
      stores: zhCNStores,
      settings: zhCNSettings,
      commands: zhCNCommands,
    },
  },
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  ns: ['common', 'dialogs', 'editors', 'panels', 'layout', 'pages', 'stores', 'settings', 'commands'],
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
}

// Only use LanguageDetector and React i18next in browser environment
if (isBrowser) {
  // Dynamic import to avoid bundling browser-only code in tests
  import('i18next-browser-languagedetector').then(({ default: LanguageDetector }) => {
    i18n.use(LanguageDetector)
  }).catch(() => {
    // Ignore if not available
  })
  i18n.use(initReactI18next)

  i18nConfig.detection = {
    order: ['localStorage'],
    lookupLocalStorage: 'moshu-locale',
    caches: ['localStorage'],
  }
}

i18n.init(i18nConfig)

// 切换语言时按需拉取资源；加载完成后重新广播一次，保证界面立即刷新
i18n.on('languageChanged', (lng) => {
  if (!loadedLocales.has(lng)) {
    void ensureLocale(lng).then(() => {
      if (i18n.language === lng) i18n.emit('languageChanged', lng)
    })
  }
})

// Update HTML lang attribute when language changes (browser only)
if (isBrowser) {
  i18n.on('languageChanged', (lng) => {
    document.documentElement.lang = lng === 'ru' ? 'ru' : lng === 'en' ? 'en' : 'zh-CN'
    const titles: Record<string, string> = {
      'ru': 'MoShu — ИИ-редактор для написания романов',
      'en': 'MoShu — AI Novel Writing IDE',
      'zh-CN': '墨枢 MoShu — AI 小说创作 IDE',
    }
    document.title = titles[lng] || titles['zh-CN']
  })
}

export default i18n
