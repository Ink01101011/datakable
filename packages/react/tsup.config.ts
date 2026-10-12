import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    // tsup injects `baseUrl` for the dts pass, which TS 6 flags as deprecated.
    dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
    // styles.css is written by the config below, in parallel: keep it out of the clean.
    clean: ['!styles.css'],
    sourcemap: true,
    target: 'es2022',
    external: ['react', 'react/jsx-runtime', '@datakable/core'],
    // RSC: mark the whole bundle as a client module. (treeshake is off because
    // rollup would strip the directive.)
    banner: { js: '"use client";' },
  },
  // The optional stylesheet (§10): dist/styles.css, minified. No JS imports it.
  { entry: { styles: 'src/styles.css' }, minify: true },
])
