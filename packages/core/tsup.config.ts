import { defineConfig } from 'tsup'
import { checkDevInlined, preserveModules } from './scripts/preserve-modules.mjs'

/**
 * Public entry points (§12): the root plus one per feature. Only these get a bundled `.d.ts`; the
 * JavaScript is emitted one file per source module (`preserveModules`), so every module is its
 * own tree-shakable unit for the consumer's bundler.
 */
const entries = {
  index: 'src/index.ts',
}

export default defineConfig({
  entry: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.test-d.ts',
    '!src/**/*.bench.ts',
    '!src/column/test-utils.ts',
    '!src/pipeline/test-features.ts',
  ],
  format: ['esm', 'cjs'],
  // tsup injects `baseUrl` for the dts pass, which TS 6 flags as deprecated.
  dts: { entry: entries, compilerOptions: { ignoreDeprecations: '6.0' } },
  clean: true,
  sourcemap: true,
  target: 'es2022',
  splitting: false,
  esbuildPlugins: [preserveModules],
  onSuccess: () => checkDevInlined('dist'),
})
