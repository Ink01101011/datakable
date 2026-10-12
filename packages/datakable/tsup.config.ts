import { defineConfig } from 'tsup'

// Thin re-export layer — @datakable/* stay external so consumers dedupe them.
export default defineConfig({
  entry: ['src/index.ts', 'src/core.ts', 'src/messages.ts'],
  format: ['esm', 'cjs'],
  // tsup injects `baseUrl` for the dts pass, which TS 6 flags as deprecated.
  dts: { compilerOptions: { ignoreDeprecations: '6.0' } },
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  external: ['react', '@datakable/core', '@datakable/react'],
})
