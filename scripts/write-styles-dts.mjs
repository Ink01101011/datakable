// Runs after tsup in @datakable/react and datakable (`pnpm build`, cwd = the package): writes the
// declaration that the `./styles.css` export's `types` condition points at (#34). Without it,
// TypeScript 6 (`noUncheckedSideEffectImports`) rejects `import 'datakable/styles.css'` with
// TS2882. Written after tsup because tsup's dts pass deletes every .d.ts in dist.
import { writeFileSync } from 'node:fs'

const body = `// The optional stylesheet: a side-effect import (\`import '<package>/styles.css'\`). No exports.
export {}
`
// One per module format, so a CommonJS consumer does not get TS1479 for an ESM declaration.
writeFileSync('dist/styles.css.d.ts', body)
writeFileSync('dist/styles.css.d.cts', body)

console.log('styles.css: wrote dist/styles.css.d.ts and .d.cts')
