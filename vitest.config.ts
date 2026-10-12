import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url))
const coreSrc = (path: string) =>
  fileURLToPath(new URL(`./packages/core/src/${path}`, import.meta.url))

export default defineConfig({
  // Tests run against source, not dist — no build needed for `pnpm test`.
  resolve: {
    alias: [
      // Subpath entries first (§12): `@datakable/core/sorting`, `@datakable/core/messages`, ...
      {
        find: /^@datakable\/core\/(column-filters|validity|search|sorting|pagination)$/,
        replacement: coreSrc('features/$1/index.ts'),
      },
      { find: /^@datakable\/core\/messages$/, replacement: coreSrc('messages/index.ts') },
      { find: /^@datakable\/core$/, replacement: src('core') },
      { find: /^@datakable\/react$/, replacement: src('react') },
    ],
  },
  test: {
    // Each project owns its own *.test-d files; a root-level typecheck.include
    // would be inherited via `extends: true` and run every type test twice.
    typecheck: { enabled: true },
    projects: [
      {
        extends: true,
        test: {
          name: 'core',
          environment: 'node',
          include: ['packages/core/**/*.test.ts'],
          typecheck: { include: ['packages/core/**/*.test-d.ts'] },
        },
      },
      {
        extends: true,
        test: {
          name: 'react',
          environment: 'happy-dom',
          include: ['packages/react/**/*.test.{ts,tsx}', 'packages/datakable/**/*.test.{ts,tsx}'],
          typecheck: {
            include: [
              'packages/react/**/*.test-d.{ts,tsx}',
              'packages/datakable/**/*.test-d.{ts,tsx}',
            ],
          },
        },
      },
      {
        extends: true,
        // The playground (apps/docs) imports `datakable`: map it to source like the packages.
        resolve: {
          alias: [{ find: /^datakable$/, replacement: src('datakable') }],
        },
        test: {
          name: 'docs',
          environment: 'happy-dom',
          include: ['apps/docs/**/*.test.{ts,tsx}'],
        },
      },
    ],
  },
})
