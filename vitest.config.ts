import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url))

export default defineConfig({
  // Tests run against source, not dist — no build needed for `pnpm test`.
  resolve: {
    alias: {
      '@datakable/core': src('core'),
      '@datakable/react': src('react'),
    },
  },
  test: {
    typecheck: {
      enabled: true,
      include: ['packages/**/*.test-d.{ts,tsx}'],
    },
    projects: [
      {
        extends: true,
        test: { name: 'core', environment: 'node', include: ['packages/core/**/*.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'react',
          environment: 'happy-dom',
          include: ['packages/react/**/*.test.{ts,tsx}', 'packages/datakable/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
})
