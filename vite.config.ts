/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import electron from 'vite-plugin-electron/simple';
import electronRenderer from 'vite-plugin-electron-renderer';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

// ESM 中不存在 __dirname，需要用 import.meta.url 来模拟
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 从 package.json 读取版本号，构建时注入到前端
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

/**
 * 生产构建的内容安全策略：只允许加载应用自身的脚本（禁止内联脚本、远程脚本与 eval），
 * 渲染进程也不直接联网（LLM / Embedding / 文生图请求都经主进程发出）。
 * 即使模型输出或导入内容里混进了恶意 HTML，也无法在页面里执行脚本或把数据发到外部。
 * 样式保留 'unsafe-inline'：CodeMirror 等库会动态插入 <style>。
 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/** 只在 vite build 时注入 CSP：开发模式下 HMR / React Refresh 依赖内联脚本与 ws 连接 */
function contentSecurityPolicy(): Plugin {
  return {
    name: 'moshu-content-security-policy',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: PRODUCTION_CSP },
          injectTo: 'head-prepend',
        },
      ],
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react(), contentSecurityPolicy(), electron({
    main: {
      // Shortcut of `build.lib.entry`.
      entry: 'electron/main.ts',
      vite: {
        build: {
          // 强制输出 CommonJS，保证 better-sqlite3 等 native 模块能正常加载
          rollupOptions: {
            external: ['better-sqlite3', '@lancedb/lancedb'],
            output: {
              format: 'cjs'
            }
          }
        }
      }
    },
    preload: {
      // Shortcut of `build.rollupOptions.input`.
      // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
      input: path.join(__dirname, 'electron/preload.ts')
    }
  }), process.env.NODE_ENV !== 'test' && electronRenderer()],
  publicDir: 'public',
  server: {
    watch: {
      ignored: ['**/docs/**']
    }
  },
  define: {
    // 构建时将 package.json 版本注入为全局常量，避免 StatusBar 硬编码版本号
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  optimizeDeps: {
    // 只扫描页面入口。src 里的单测会直接 import electron/database，
    // 预构建若跟进去会把 LanceDB 的 .node 当文本读，开发服务直接退出。
    entries: [
      'index.html',
      'src/**/*.{ts,tsx}',
      '!src/**/__tests__/**',
      '!src/**/*.test.ts',
      '!src/**/*.test.tsx',
    ],
    exclude: ['@lancedb/lancedb', 'better-sqlite3'],
  },
  build: {
    rollupOptions: {
      output: {
        // 把变化频率低的第三方库拆成稳定 chunk，避免每次业务改动都让用户重下整包。
        // Vite 8 / rolldown 只接受函数形式，不能用对象映射。
        manualChunks(id) {
          const key = id.replace(/\\/g, '/')
          if (!key.includes('/node_modules/')) return undefined
          if (/\/node_modules\/(react|react-dom|scheduler|zustand|react-resizable-panels)\//.test(key)) {
            return 'react-vendor'
          }
          if (/\/node_modules\/(i18next|react-i18next|i18next-browser-languagedetector)\//.test(key)) {
            return 'i18n-vendor'
          }
          // 只收 CodeMirror 核心；语言包（@codemirror/lang-*、language-data）保留动态加载，
          // 否则会把按需语言语法全部塞进首屏 chunk
          if (/\/node_modules\/(@codemirror\/(state|view|language|commands|search)|@uiw\/react-codemirror|@lezer\/(common|highlight|lr))\//.test(key)) {
            return 'codemirror-vendor'
          }
          if (/\/node_modules\/@radix-ui\//.test(key)) {
            return 'radix-vendor'
          }
          return undefined
        },
      },
      onwarn(warning, defaultHandler) {
        // 过滤掉已知的无害警告
        if (warning.code === 'INEFFECTIVE_DYNAMIC_IMPORT') return;
        if (warning.message?.includes('Invalid key')) return;
        defaultHandler(warning);
      }
    }
  }
});