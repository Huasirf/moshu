import React from 'react'
import ReactDOM from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import i18n, { ensureLocale, resolveInitialLanguage } from './i18n'
import App from './App'
import './index.css'

/** 先加载首屏语言资源再挂载，避免先闪一下中文再变成目标语言 */
async function bootstrap() {
  const lng = resolveInitialLanguage()
  if (lng !== 'zh-CN') {
    await ensureLocale(lng)
    await i18n.changeLanguage(lng)
  }

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>
    </React.StrictMode>,
  )
}

void bootstrap()
