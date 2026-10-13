import { defineConfig } from 'tsup'

// Thin re-export layer — @datakable/* stay external so consumers dedupe them.
export default defineConfig([
  {
    entry: ['src/index.ts', 'src/core.ts', 'src/messages.ts'],
    format: ['esm', 'cjs'],
    // tsup injects `baseUrl` for the dts pass, which TS 6 flags as deprecated.
    dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
    // styles.css is written by the config below, in parallel: keep it out of the clean.
    clean: ['!styles.css'],
    sourcemap: true,
    treeshake: true,
    target: 'es2022',
    external: ['react', '@datakable/core', '@datakable/react'],
  },
  // `datakable/styles.css`: @datakable/react's stylesheet inlined into one plain file (§10).
  { entry: { styles: 'src/styles.css' }, minify: true, noExternal: ['@datakable/react'] },
])
