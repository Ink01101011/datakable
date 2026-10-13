import { defineConfig } from 'tsup'
import { preserveModules } from '../core/scripts/preserve-modules.mjs'

// Thin re-export layer — @datakable/* stay external so consumers dedupe them.
export default defineConfig([
  {
    // One output file per source module, like core and react (#9): `createTable` no longer shares
    // a file with `<DataTable />` / `useDataTable`, so a bundler drops React when only
    // `createTable` is used, and a server module that imports `datakable` gets client references
    // for the two React modules (their source starts with 'use client', kept per output file).
    entry: [
      'src/index.ts',
      'src/core.ts',
      'src/messages.ts',
      'src/create-table.ts',
      'src/data-table.tsx',
      'src/use-data-table.ts',
      'src/register.ts',
    ],
    format: ['esm', 'cjs'],
    // tsup injects `baseUrl` for the dts pass, which TS 6 flags as deprecated.
    dts: {
      entry: { index: 'src/index.ts', core: 'src/core.ts', messages: 'src/messages.ts' },
      compilerOptions: { ignoreDeprecations: '6.0' },
    },
    // styles.css is written by the config below, in parallel: keep it out of the clean.
    clean: ['!styles.css'],
    sourcemap: true,
    // treeshake is off because rollup would strip the 'use client' directives.
    target: 'es2022',
    splitting: false,
    external: ['react', 'react/jsx-runtime', '@datakable/core', '@datakable/react'],
    esbuildPlugins: [preserveModules],
  },
  // `datakable/styles.css`: @datakable/react's stylesheet inlined into one plain file (§10).
  { entry: { styles: 'src/styles.css' }, minify: true, noExternal: ['@datakable/react'] },
])
