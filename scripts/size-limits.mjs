// Bundle-size entries (spec §9.3), measured by `scripts/size.mjs` with the ONE standard method
// (R10): esbuild 0.27.7 `--bundle --minify --format=esm`, `process.env.NODE_ENV = "production"`,
// externals `ex-search`, `exsorted*`, `kk-debounce*`, `react`, `react-dom`; the entry is a one-line
// re-export of the named symbols from the BUILT dist; size = gzip -9 of the output. 1 KB = 1024 B.
//
// Each entry carries two numbers:
// - `budget`: the §9.3 spec budget. An entry over it is printed as UNMET and raised with the user —
//   it is never raised here silently (§9.3; the core budget was changed by the user, 2026-10-13).
// - `limit`: the RATCHET that CI enforces = the size measured when it was set, rounded up to the
//   next 0.5 KB. Any growth past it fails `pnpm check:size`. Lower it when the bundle shrinks;
//   raising it needs a reason in the commit message.
//
// Ratchets set at develop ca610e9 + T37 (Node 25.2.1, esbuild 0.27.7). gzip is Node's zlib at level
// 9 (as size-limit's file plugin): deterministic across OSes, unlike the `gzip` CLI (macOS `gzip -9`
// reads ~70 B smaller, which is where the R10 numbers came from).

const KB = 1024

/**
 * §9.3 "`@datakable/core` without search (gzip) ≤ 15 KB" (changed 2026-10-13, user decision; was
 * 8 KB: F3 measured 14.5 KB, the remainder is spec-required production behaviour).
 */
const CORE = { budget: 15 * KB, spec: '§9.3 @datakable/core without search ≤ 15 KB' }
/** §9.3 "`datakable` default preset + react (gzip) ≤ 20 KB" (react itself is external). */
const PRESET = { budget: 20 * KB, spec: '§9.3 datakable default preset + react ≤ 20 KB' }

/** @type {{ name: string, pkg: 'core' | 'react' | 'datakable', import: string[], budget?: number, spec: string, limit: number }[]} */
export default [
  {
    name: '@datakable/core: createTable',
    pkg: 'core',
    import: ['createTable'],
    ...CORE,
    // F3: 23 → 14.5 KB (14,553 B): schema / fetcher opt-in, dev-only option validation, version
    // and data checks, the feature runtime brought by defineFeature (§9.3, 2026-10-13).
    // RA (F1+F2+F3 merged): 14,759 B, F2's lazy `RowModel.rows`; stays 14.5 KB.
    limit: 14.5 * KB,
  },
  {
    name: '@datakable/core: createTable + columnFilters + sorting + pagination',
    pkg: 'core',
    import: ['createTable', 'columnFilters', 'sorting', 'pagination'],
    ...CORE,
    // F3: 30 → 22 KB (22,198 B). RA merged: 22,394 B; stays 22 KB.
    limit: 22 * KB,
  },
  {
    name: '@datakable/core: createTable + columnFilters + sorting + pagination + search',
    pkg: 'core',
    import: ['createTable', 'columnFilters', 'sorting', 'pagination', 'search'],
    // §9.3 budgets core *without* search only: recorded and ratcheted, no spec budget.
    spec: 'none (§9.3 budgets core without search)',
    // F3: 34.5 → 27 KB (27,205 B). RA merged: 27,465 B; stays 27 KB.
    limit: 27 * KB,
  },
  {
    name: 'datakable: createTable (default preset)',
    pkg: 'datakable',
    import: ['createTable'],
    ...PRESET,
    // F3: 34.5 → 27.5 KB (27,697 B). RA merged: 27,966 B; stays 27.5 KB.
    limit: 27.5 * KB,
  },
  {
    name: 'datakable: useDataTable (default preset + react hook)',
    pkg: 'datakable',
    import: ['useDataTable'],
    ...PRESET,
    // F3: 36.5 → 29 KB (29,436 B). RA merged: 29 → 29.5 KB (29,708 B): F2's lazy `RowModel.rows`
    // + search without a kept projection (§9.3 memory, every 100k-row scenario ≤ 5 MB): +272 B.
    limit: 29.5 * KB,
  },
  {
    name: 'datakable: DataTable (default preset + <DataTable />)',
    pkg: 'datakable',
    import: ['DataTable'],
    ...PRESET,
    // R11: 39 → 39.5 KB for T34's per-cell error boundaries + the hook's inline-data loop fix.
    // F3: 39.5 → 32 KB (32,675 B). RA merged: 32 → 32.5 KB (32,925 B): F2's lazy `RowModel.rows`
    // (§9.3 memory): +250 B.
    limit: 32.5 * KB,
  },
]
