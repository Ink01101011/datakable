import { defineConfig } from 'tsup'
import { preserveModules } from '../core/scripts/preserve-modules.mjs'

export default defineConfig({
  // One output file per source module, like core (T37): a hook-only import no longer pulls in
  // `<DataTable />`'s module, whose top-level `keepDiagnostics(...)` a single-file bundle kept.
  entry: ['src/**/*.{ts,tsx}', '!src/**/*.test.{ts,tsx}', '!src/**/*.test-d.{ts,tsx}'],
  format: ['esm', 'cjs'],
  // tsup injects `baseUrl` for the dts pass, which TS 6 flags as deprecated.
  dts: { entry: { index: 'src/index.ts' }, compilerOptions: { ignoreDeprecations: '6.0' } },
  clean: true,
  sourcemap: true,
  target: 'es2022',
  splitting: false,
  external: ['react', 'react/jsx-runtime', '@datakable/core'],
  esbuildPlugins: [preserveModules],
  // RSC: mark every module as a client module. (treeshake is off because rollup would strip the
  // directive.)
  banner: { js: '"use client";' },
})
