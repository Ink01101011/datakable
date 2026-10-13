import { defineConfig } from 'tsup'
import { preserveModules } from '../core/scripts/preserve-modules.mjs'

export default defineConfig([
  {
    // One output file per source module, like core (T37): a hook-only import no longer pulls in
    // `<DataTable />`'s module, whose top-level `keepDiagnostics(...)` a single-file bundle kept.
    entry: [
      'src/**/*.{ts,tsx}',
      '!src/**/*.test.{ts,tsx}',
      '!src/**/*.test-d.{ts,tsx}',
      '!src/**/*.bench.{ts,tsx}',
    ],
    format: ['esm', 'cjs'],
    // tsup injects `baseUrl` for the dts pass, which TS 6 flags as deprecated.
    dts: { entry: { index: 'src/index.ts' }, compilerOptions: { ignoreDeprecations: '6.0' } },
    // styles.css is written by the config below, in parallel: keep it out of the clean.
    clean: ['!styles.css'],
    sourcemap: true,
    target: 'es2022',
    splitting: false,
    external: ['react', 'react/jsx-runtime', '@datakable/core'],
    esbuildPlugins: [preserveModules],
    // RSC: only the modules that use React hooks (data-table, use-data-table) are client modules;
    // their source starts with 'use client' and esbuild keeps it per output file. The index stays
    // a plain module: Next's webpack rejects `export *` in a client boundary (#8), and core's
    // exports (`createTable`, …) must stay callable on the server. (treeshake is off because
    // rollup would strip the directive.)
  },
  // The optional stylesheet (§10): dist/styles.css, minified. No JS imports it.
  { entry: { styles: 'src/styles.css' }, minify: true },
])
