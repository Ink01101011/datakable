import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const src = (pkg: string) =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url))
/** React 18 (apps/react18): for the behaviours React 19 changed (StrictMode keeps refs, #25). */
const react18 = (path: string) =>
  fileURLToPath(new URL(`./apps/react18/node_modules/${path}`, import.meta.url))
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
      { find: /^@datakable\/core\/schema$/, replacement: coreSrc('ingest/schema-entry.ts') },
      { find: /^@datakable\/core\/server$/, replacement: coreSrc('source/server-entry.ts') },
      {
        find: /^@datakable\/core\/search-async$/,
        replacement: coreSrc('features/search/search-async-entry.ts'),
      },
      { find: /^@datakable\/core$/, replacement: src('core') },
      { find: /^@datakable\/react$/, replacement: src('react') },
      // The docs examples (packages/datakable/src/docs-examples) import what a consumer writes.
      { find: /^datakable$/, replacement: src('datakable') },
      {
        find: /^datakable\/messages$/,
        replacement: fileURLToPath(
          new URL('./packages/datakable/src/messages.ts', import.meta.url),
        ),
      },
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
          exclude: ['packages/core/**/*.gc.test.ts', '**/node_modules/**'],
          typecheck: { include: ['packages/core/**/*.test-d.ts'] },
        },
      },
      {
        extends: true,
        test: {
          // Memory tests (§9.3): their own forked worker with --expose-gc, so no other file shares
          // the heap they measure (T37).
          name: 'core-memory',
          environment: 'node',
          include: ['packages/core/**/*.gc.test.ts'],
          pool: 'forks',
          execArgv: ['--expose-gc'],
          typecheck: { enabled: false },
        },
      },
      {
        extends: true,
        test: {
          name: 'react',
          environment: 'happy-dom',
          include: ['packages/react/**/*.test.{ts,tsx}', 'packages/datakable/**/*.test.{ts,tsx}'],
          exclude: ['**/*.react18.test.{ts,tsx}', '**/node_modules/**'],
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
        // The same sources rendered by React 18 (its StrictMode discards the first mount render).
        resolve: {
          alias: [
            { find: /^react$/, replacement: react18('react/index.js') },
            { find: /^react\/(jsx-runtime|jsx-dev-runtime)$/, replacement: react18('react/$1.js') },
            { find: /^react-dom$/, replacement: react18('react-dom/index.js') },
            { find: /^react-dom\/(client|server)$/, replacement: react18('react-dom/$1.js') },
          ],
        },
        test: {
          name: 'react18',
          environment: 'happy-dom',
          include: ['packages/react/**/*.react18.test.{ts,tsx}'],
          typecheck: { enabled: false },
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
