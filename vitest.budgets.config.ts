import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// §9.3 budgets against the BUILT packages (T37): `pnpm check:budgets`, after `pnpm build`. Not part
// of `pnpm test` (which runs against source with no build).
//
// - production mode (`NODE_ENV=production`): the code a user ships, dev checks off;
// - one fork, files one after another, each file in a fresh process (`isolate`): the timing
//   budgets never share a heap or JIT state with the memory budgets (#130);
// - `--expose-gc`: memory is measured after full collections.
const dist = (path: string) => fileURLToPath(new URL(`./packages/${path}`, import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@datakable\/core$/, replacement: dist('core/dist/index.js') },
      { find: /^@datakable\/react$/, replacement: dist('react/dist/index.js') },
      { find: /^datakable$/, replacement: dist('datakable/dist/index.js') },
    ],
  },
  test: {
    name: 'budgets',
    include: ['budgets/**/*.budget.test.ts'],
    environment: 'node',
    env: { NODE_ENV: 'production' },
    pool: 'forks',
    execArgv: ['--expose-gc'],
    fileParallelism: false,
    isolate: true,
    testTimeout: 60_000,
    // The measurements are the point: print them for passing tests too.
    silent: false,
  },
})
