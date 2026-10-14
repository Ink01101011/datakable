// Runs after tsup (`pnpm build`): checks and fixes that need every output file, .d.ts included.
import { execFileSync } from 'node:child_process'
import { checkDevInlined, fixDtsAugmentations } from './preserve-modules.mjs'

await checkDevInlined('dist')
const n = await fixDtsAugmentations('dist')
console.log(`postbuild: DEV inlined; ${n} DiagnosticCatalog augmentations point at @datakable/core`)

// #36: loaded without a bundler (no `process`), dist throws the DataKable error naming the fix,
// not the engine's bare "process is not defined" from whichever module reads it first.
for (const [file, load] of [
  ['dist/index.js', 'await import(f)'],
  ['dist/index.cjs', "require('node:module').createRequire(import.meta.url)(f)"],
]) {
  const script =
    `const f = ${JSON.stringify(new URL(`../${file}`, import.meta.url).pathname)}; ` +
    'const p = globalThis.process; delete globalThis.process; let out = "loaded"; ' +
    `try { ${load.replace('require(', 'p.getBuiltinModule(')} } catch (e) { out = String(e) } ` +
    'p.stdout.write(out)'
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
  })
  if (!out.startsWith('ReferenceError: [DataKable] process is not defined')) {
    throw new Error(`${file} without process: expected the DataKable error, got: ${out}`)
  }
}
console.log('postbuild: without process, dist (esm + cjs) throws the DataKable process error')
