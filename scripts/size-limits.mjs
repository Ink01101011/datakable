// Bundle-size entries (spec §9.3), measured by `scripts/size.mjs` with the ONE standard method
// (R10): esbuild 0.27.7 `--bundle --minify --format=esm`, `process.env.NODE_ENV = "production"`,
// externals `ex-search`, `exsorted*`, `kk-debounce*`, `react`, `react-dom`; the entry is a one-line
// re-export of the named symbols from the BUILT dist; size = gzip -9 of the output. 1 KB = 1024 B.
//
// Each entry carries two numbers:
// - `budget`: the §9.3 spec budget of that entry. An entry over it is printed as UNMET and raised
//   with the user — it is never raised here silently (§9.3 has per-entry budgets since 2026-10-13,
//   user decision after the F2–F4 measured reductions; spec §14).
// - `limit`: the RATCHET that CI enforces = the size measured when it was set, rounded up to the
//   next 0.5 KB. Any growth past it fails `pnpm check:size`. Lower it when the bundle shrinks;
//   raising it needs a reason in the commit message.
//
// Ratchets set at develop ca610e9 + T37 (Node 25.2.1, esbuild 0.27.7). gzip is Node's zlib at level
// 9 (as size-limit's file plugin): deterministic across OSes, unlike the `gzip` CLI (macOS `gzip -9`
// reads ~70 B smaller, which is where the R10 numbers came from).

const KB = 1024

/**
 * §9.3 per-entry budgets (gzip; changed 2026-10-13, user decision after the F2–F4 measured
 * reductions; were core without search ≤ 15 KB for every core entry and preset + react ≤ 20 KB).
 */
const budget = (kb, what) => ({ budget: kb * KB, spec: `§9.3 ${what} ≤ ${kb} KB` })

/** @type {{ name: string, pkg: 'core' | 'react' | 'datakable', import: string[], budget?: number, spec: string, limit: number }[]} */
export default [
  {
    name: '@datakable/core: createTable',
    pkg: 'core',
    import: ['createTable'],
    ...budget(15, '@datakable/core createTable'),
    // F3: 23 → 14.5 KB (14,553 B): schema / fetcher opt-in, dev-only option validation, version
    // and data checks, the feature runtime brought by defineFeature (§9.3, 2026-10-13).
    // RA (F1+F2+F3 merged): 14,759 B, F2's lazy `RowModel.rows`; stays 14.5 KB.
    // RB: 14.5 → 15 KB (14,981 B; F4 14,765 B): the production DK_INVALID_OPTION guard for an
    // unwrapped schema / fetcher (never silent, §8.6; user decision 2026-10-13): +216 B.
    limit: 15 * KB,
  },
  {
    name: '@datakable/core: createTable + columnFilters + sorting + pagination',
    pkg: 'core',
    import: ['createTable', 'columnFilters', 'sorting', 'pagination'],
    ...budget(22, '@datakable/core createTable + columnFilters + sorting + pagination'),
    // F3: 30 → 22 KB (22,198 B). RA merged: 22,394 B; stays 22 KB.
    // F4: 22 → 21.5 KB (21,662 B): option schemas and DK_DEP_INCOMPATIBLE in development only.
    // RB: 21,790 B with the production unwrapped-option guard; stays 21.5 KB.
    limit: 21.5 * KB,
  },
  {
    name: '@datakable/core: createTable + columnFilters + sorting + pagination + search',
    pkg: 'core',
    import: ['createTable', 'columnFilters', 'sorting', 'pagination', 'search'],
    // §9.3 budgets core *without* search only: recorded and ratcheted, no spec budget.
    spec: 'none (§9.3 budgets core without search)',
    // F3: 34.5 → 27 KB (27,205 B). RA merged: 27,465 B; stays 27 KB.
    // F4: 27 → 23.5 KB (23,990 B): searchFn opt-in (withSearchFn), dev-only option schemas.
    // RB: 23.5 → 24 KB (24,152 B): the production guard for an unwrapped schema / fetcher /
    // searchFn (never silent, §8.6; user decision 2026-10-13): +162 B.
    limit: 24 * KB,
  },
  {
    name: 'datakable: createTable (default preset)',
    pkg: 'datakable',
    import: ['createTable'],
    ...budget(24.5, 'datakable createTable'),
    // F3: 34.5 → 27.5 KB (27,697 B). RA merged: 27,966 B; stays 27.5 KB.
    // F4: 27.5 → 24 KB (24,419 B): searchFn opt-in (withSearchFn), dev-only option schemas,
    // version registry and DK_DEP_INCOMPATIBLE in development only.
    // RB: 24 → 24.5 KB (24,599 B): the production guard for an unwrapped schema / fetcher /
    // searchFn (never silent, §8.6; user decision 2026-10-13): +180 B.
    limit: 24.5 * KB,
  },
  {
    name: 'datakable: useDataTable (default preset + react hook)',
    pkg: 'datakable',
    import: ['useDataTable'],
    ...budget(26.5, 'datakable useDataTable'),
    // F3: 36.5 → 29 KB (29,436 B). RA merged: 29 → 29.5 KB (29,708 B): F2's lazy `RowModel.rows`
    // + search without a kept projection (§9.3 memory, every 100k-row scenario ≤ 5 MB): +272 B.
    // F4: 29.5 → 26 KB (26,141 B): as createTable, and createDeferred no longer imports the
    // request machinery.
    // RB: 26,317 B with the production unwrapped-option guard (+176 B); stays 26 KB.
    limit: 26 * KB,
  },
  {
    name: 'datakable: DataTable (default preset + <DataTable />)',
    pkg: 'datakable',
    import: ['DataTable'],
    ...budget(29.5, 'datakable DataTable'),
    // R11: 39 → 39.5 KB for T34's per-cell error boundaries + the hook's inline-data loop fix.
    // F3: 39.5 → 32 KB (32,675 B). RA merged: 32 → 32.5 KB (32,925 B): F2's lazy `RowModel.rows`
    // (§9.3 memory): +250 B.
    // F4: 32.5 → 29 KB (29,393 B): as useDataTable.
    // RB: 29,506 B with the production unwrapped-option guard (+113 B); stays 29 KB.
    limit: 29 * KB,
  },
]
