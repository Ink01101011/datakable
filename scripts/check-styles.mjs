// The optional stylesheet (§10, §12), checked against the BUILT packages from a consumer bundle:
// - `import 'datakable/styles.css'` (and `@datakable/react/styles.css`) resolves through the
//   exports map and bundles the stylesheet;
// - a JS-only import of `<DataTable />` pulls in no CSS: no .css input, no .css output.
// Prints the stylesheet size (raw + gzip). Run after `pnpm build`.
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const root = fileURLToPath(new URL('..', import.meta.url))
// esbuild is tsup's dependency (not a root one): resolve it from there.
const esbuild = createRequire(createRequire(join(root, 'package.json')).resolve('tsup'))('esbuild')

const dir = join(root, 'node_modules/.cache/consumer-styles')
rmSync(dir, { recursive: true, force: true })
mkdirSync(join(dir, 'node_modules/@datakable'), { recursive: true })
const link = (target, name) => symlinkSync(target, join(dir, 'node_modules', name), 'dir')
link(join(root, 'packages/react'), '@datakable/react')
link(join(root, 'packages/datakable'), 'datakable')
link(join(root, 'node_modules/react'), 'react')
writeFileSync(join(dir, 'styled.js'), "import 'datakable/styles.css'\n")
writeFileSync(join(dir, 'styled-react.js'), "import '@datakable/react/styles.css'\n")
writeFileSync(
  join(dir, 'plain.jsx'),
  "import { DataTable } from 'datakable'\nexport const App = () => <DataTable data={[]} />\n",
)

const bundle = (entry) =>
  esbuild.build({
    absWorkingDir: dir,
    entryPoints: [entry],
    bundle: true,
    write: false,
    outdir: 'out',
    metafile: true,
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    external: ['react', 'react/*', 'react-dom'],
    logLevel: 'silent',
  })

const fail = (msg) => {
  console.error(`check-styles: ${msg}`)
  process.exit(1)
}
const isCss = (p) => p.endsWith('.css')

for (const entry of ['styled.js', 'styled-react.js']) {
  const r = await bundle(entry)
  const css = r.outputFiles.find((f) => isCss(f.path))
  if (!css?.text.includes('[data-datakable]')) fail(`${entry}: no stylesheet in the bundle`)
  console.log(`${entry}: bundles ${css.text.length} B of CSS`)
}

const plain = await bundle('plain.jsx')
const cssIn = Object.keys(plain.metafile.inputs).filter(isCss)
const cssOut = plain.outputFiles.filter((f) => isCss(f.path)).map((f) => f.path)
if (cssIn.length > 0 || cssOut.length > 0) {
  fail(`a JS-only import of DataTable pulled in CSS: ${[...cssIn, ...cssOut].join(', ')}`)
}
console.log(
  `plain.jsx: DataTable bundled with ${Object.keys(plain.metafile.inputs).length} inputs, 0 CSS`,
)

const built = readFileSync(join(root, 'packages/datakable/dist/styles.css'))
console.log(`styles.css: ${built.length} B raw, ${gzipSync(built, { level: 9 }).length} B gzip`)
