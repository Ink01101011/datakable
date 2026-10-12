import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const src = (p: string) => fileURLToPath(new URL(`../../packages/${p}`, import.meta.url))

// Playground resolves workspace packages from source for instant HMR.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^datakable\/core$/, replacement: src('datakable/src/core.ts') },
      { find: /^datakable$/, replacement: src('datakable/src/index.ts') },
      { find: /^@datakable\/react$/, replacement: src('react/src/index.ts') },
      { find: /^@datakable\/core$/, replacement: src('core/src/index.ts') },
    ],
  },
})
