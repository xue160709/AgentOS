/// <reference types="vite-plugin-electron/electron-env" />

/**
 * 渲染进程全局 Window 类型：对齐 preload 暴露的 API。
 * Augment `Window` with APIs mirrored from `preload.ts`.
 */

import type { ClaudeChatAPI } from '../src/claude-chat-types'
import type { DesktopAPI } from '../src/desktop-api'
import type { ProjectChatAPI } from '../src/project-chat-contract'

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      /**
       * The built directory structure
       *
       * ```tree
       * ├─┬─┬ dist
       * │ │ └── index.html
       * │ │
       * │ ├─┬ dist-electron
       * │ │ ├── main.js
       * │ │ └── preload.js
       * │
       * ```
       */
      APP_ROOT: string
      /** /dist/ or /public/ */
      VITE_PUBLIC: string
    }
  }

  // preload.ts 注入的类型扩展 / Augmented via preload script
  interface Window {
    claudeChat?: ClaudeChatAPI
    desktop?: DesktopAPI
    projectChat?: ProjectChatAPI
  }
}

export {}
