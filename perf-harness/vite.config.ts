/**
 * 只用于 render 计数的临时配置：把 JSX 工厂换成会统计「父组件创建了哪个子组件元素」的 shim。
 * 不改动仓库的 vite.config.ts，也不需要在组件里插桩，因此可以在 git stash 前后跑同一份。
 */
import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const root = path.resolve(__dirname, '..')

export default defineConfig({
  root,
  resolve: {
    alias: { 'perf-jsx': path.join(__dirname, 'jsx-shim') },
  },
  plugins: [react({ jsxImportSource: 'perf-jsx' })],
  server: { port: 5199, strictPort: true },
})
