// Bundle-size entries (spec §9.3), measured by `scripts/size.mjs` with the ONE standard method
// (R10): esbuild 0.27.7 `--bundle --minify --format=esm`, `process.env.NODE_ENV = "production"`,
// externals `ex-search`, `exsorted*`, `kk-debounce*`, `react`, `react-dom`; the entry is a one-line
// re-export of the named symbols from the BUILT dist; size = gzip -9 of the output. 1 KB = 1024 B.
//
// Each entry carries two numbers:
// - `budget`: the §9.3 spec budget. Not met today for any entry that has one: it is printed as
//   UNMET and raised with the user — it is never raised here silently (§9.3).
// - `limit`: the RATCHET that CI enforces = the size measured when it was set, rounded up to the
//   next 0.5 KB. Any growth past it fails `pnpm check:size`. Lower it when the bundle shrinks;
//   raising it needs a reason in the commit message.
//
// Ratchets set at develop ca610e9 + T37 (Node 25.2.1, esbuild 0.27.7). gzip is Node's zlib at level
// 9 (as size-limit's file plugin): deterministic across OSes, unlike the `gzip` CLI (macOS `gzip -9`
// reads ~70 B smaller, which is where the R10 numbers came from).

const KB = 1024

/** §9.3 "`@datakable/core` without search (gzip) ≤ 8 KB". */
const CORE = { budget: 8 * KB, spec: '§9.3 @datakable/core without search ≤ 8 KB' }
/** §9.3 "`datakable` default preset + react (gzip) ≤ 20 KB" (react itself is external). */
const PRESET = { budget: 20 * KB, spec: '§9.3 datakable default preset + react ≤ 20 KB' }

/** @type {{ name: string, pkg: 'core' | 'react' | 'datakable', import: string[], budget?: number, spec: string, limit: number }[]} */
export default [
  {
    name: '@datakable/core: createTable',
    pkg: 'core',
    import: ['createTable'],
    ...CORE,
    // F2: 23 → 23.5 KB for lazy `RowModel.rows` (§9.3 memory, unpaginated 7.47 → 1.94 MB): +261 B.
    limit: 23.5 * KB,
  },
  {
    name: '@datakable/core: createTable + columnFilters + sorting + pagination',
    pkg: 'core',
    import: ['createTable', 'columnFilters', 'sorting', 'pagination'],
    ...CORE,
    // F2: 30 → 30.5 KB, lazy `RowModel.rows` (§9.3 memory): +247 B.
    limit: 30.5 * KB,
  },
  {
    name: '@datakable/core: createTable + columnFilters + sorting + pagination + search',
    pkg: 'core',
    import: ['createTable', 'columnFilters', 'sorting', 'pagination', 'search'],
    // §9.3 budgets core *without* search only: recorded and ratcheted, no spec budget.
    spec: 'none (§9.3 budgets core without search)',
    limit: 34.5 * KB,
  },
  {
    name: 'datakable: createTable (default preset)',
    pkg: 'datakable',
    import: ['createTable'],
    ...PRESET,
    // F2: 34.5 → 35 KB, lazy `RowModel.rows` + chunked search projection (§9.3 memory): +307 B.
    limit: 35 * KB,
  },
  {
    name: 'datakable: useDataTable (default preset + react hook)',
    pkg: 'datakable',
    import: ['useDataTable'],
    ...PRESET,
    limit: 36.5 * KB,
  },
  {
    name: 'datakable: DataTable (default preset + <DataTable />)',
    pkg: 'datakable',
    import: ['DataTable'],
    ...PRESET,
    // R11: 39 → 39.5 KB for T34's per-cell error boundaries + the hook's inline-data loop fix.
    limit: 39.5 * KB,
  },
]
