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

// Every measured bundle is also RUN (`smoke`, #5): a size read off a bundle that throws is not a
// size. `smoke` is the body of an async function over the entry's imports (and `React`, `server` =
// react-dom/server); what it returns must equal `expect`. The rows are given unsorted (b, a).
const rows = `[{ id: 2, n: 'b' }, { id: 1, n: 'a' }]`
const sorted = `t.toggleSort('n'); return t.getRowModel().rows.map((r) => r.original.id).join(',')`
const coreFeatures = (extra = '') =>
  `const t = createTable({ data: ${rows}, rowKey: 'id', features: [columnFilters(), sorting(), pagination()${extra}] }); ${sorted}`
const initialSort = `initialState: { sorting: { by: [{ id: 'n', desc: false }] } }`

/**
 * §9.3 per-entry budgets (gzip; changed 2026-10-13, user decision after the F2–F4 measured
 * reductions; were core without search ≤ 15 KB for every core entry and preset + react ≤ 20 KB).
 * The entries with features changed again after #5 (user decision 2026-10-13): their earlier
 * budgets were measured on bundles that threw; they are now the measured working sizes.
 */
const budget = (kb, what) => ({ budget: kb * KB, spec: `§9.3 ${what} ≤ ${kb} KB` })

/** @type {{ name: string, pkg: 'core' | 'react' | 'datakable', import: string[], budget?: number, spec: string, limit: number, smoke: string, expect: string }[]} */
export default [
  {
    name: '@datakable/core: createTable',
    pkg: 'core',
    import: ['createTable'],
    ...budget(15, '@datakable/core createTable'),
    smoke: `const t = createTable({ data: ${rows}, rowKey: 'id' }); return t.getRowModel().rows.map((r) => r.original.id).join(',')`,
    expect: '2,1',
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
    smoke: coreFeatures(),
    expect: '1,2',
    ...budget(24, '@datakable/core createTable + columnFilters + sorting + pagination'),
    // F3: 30 → 22 KB (22,198 B). RA merged: 22,394 B; stays 22 KB.
    // F4: 22 → 21.5 KB (21,662 B): option schemas and DK_DEP_INCOMPATIBLE in development only.
    // RB: 21,790 B with the production unwrapped-option guard; stays 21.5 KB.
    // #5 (user decision 2026-10-13): 21.5 → 24 KB (24,405 B). The earlier sizes were measured on a
    // bundle that threw (esbuild --minify dropped the feature runtime); this one runs (`smoke`).
    limit: 24 * KB,
  },
  {
    name: '@datakable/core: createTable + columnFilters + sorting + pagination + search',
    pkg: 'core',
    import: ['createTable', 'columnFilters', 'sorting', 'pagination', 'search'],
    smoke: coreFeatures(', search()'),
    expect: '1,2',
    // §9.3 budgets core *without* search only: recorded and ratcheted, no spec budget.
    spec: 'none (§9.3 budgets core without search)',
    // F3: 34.5 → 27 KB (27,205 B). RA merged: 27,465 B; stays 27 KB.
    // F4: 27 → 23.5 KB (23,990 B): searchFn opt-in (withSearchFn), dev-only option schemas.
    // RB: 23.5 → 24 KB (24,152 B): the production guard for an unwrapped schema / fetcher /
    // searchFn (never silent, §8.6; user decision 2026-10-13): +162 B.
    // #5 (user decision 2026-10-13): 24 → 26.5 KB (26,785 B). The earlier sizes were measured on a
    // bundle that threw (esbuild --minify dropped the feature runtime); this one runs (`smoke`).
    limit: 26.5 * KB,
  },
  {
    name: 'datakable: createTable (default preset)',
    pkg: 'datakable',
    import: ['createTable'],
    ...budget(27, 'datakable createTable'),
    smoke: `const t = createTable({ data: ${rows}, rowKey: 'id' }); ${sorted}`,
    expect: '1,2',
    // F3: 34.5 → 27.5 KB (27,697 B). RA merged: 27,966 B; stays 27.5 KB.
    // F4: 27.5 → 24 KB (24,419 B): searchFn opt-in (withSearchFn), dev-only option schemas,
    // version registry and DK_DEP_INCOMPATIBLE in development only.
    // RB: 24 → 24.5 KB (24,599 B): the production guard for an unwrapped schema / fetcher /
    // searchFn (never silent, §8.6; user decision 2026-10-13): +180 B.
    // #5 (user decision 2026-10-13): 24.5 → 27 KB (27,227 B). The earlier sizes were measured on a
    // bundle that threw (esbuild --minify dropped the feature runtime); this one runs (`smoke`).
    limit: 27 * KB,
  },
  {
    name: 'datakable: useDataTable (default preset + react hook)',
    pkg: 'datakable',
    import: ['useDataTable'],
    ...budget(28.5, 'datakable useDataTable'),
    smoke: `const C = () => useDataTable({ data: ${rows}, rowKey: 'id', ${initialSort} }).rowModel.rows.map((r) => r.original.id).join(','); return server.renderToString(React.createElement(C))`,
    expect: '1,2',
    // F3: 36.5 → 29 KB (29,436 B). RA merged: 29 → 29.5 KB (29,708 B): F2's lazy `RowModel.rows`
    // + search without a kept projection (§9.3 memory, every 100k-row scenario ≤ 5 MB): +272 B.
    // F4: 29.5 → 26 KB (26,141 B): as createTable, and createDeferred no longer imports the
    // request machinery.
    // RB: 26,317 B with the production unwrapped-option guard (+176 B); stays 26 KB.
    // #5 (user decision 2026-10-13): 26 → 28.5 KB (28,938 B). The earlier sizes were measured on a
    // bundle that threw (esbuild --minify dropped the feature runtime); this one runs (`smoke`).
    limit: 28.5 * KB,
  },
  {
    name: 'datakable: DataTable (default preset + <DataTable />)',
    pkg: 'datakable',
    import: ['DataTable'],
    ...budget(32.5, 'datakable DataTable'),
    smoke: `const html = server.renderToString(React.createElement(DataTable, { data: ${rows}, rowKey: 'id', ${initialSort} })); return html.indexOf('>a<') < html.indexOf('>b<') && html.includes('>b<') ? 'a before b' : html`,
    expect: 'a before b',
    // R11: 39 → 39.5 KB for T34's per-cell error boundaries + the hook's inline-data loop fix.
    // F3: 39.5 → 32 KB (32,675 B). RA merged: 32 → 32.5 KB (32,925 B): F2's lazy `RowModel.rows`
    // (§9.3 memory): +250 B.
    // F4: 32.5 → 29 KB (29,393 B): as useDataTable.
    // RB: 29,506 B with the production unwrapped-option guard (+113 B); stays 29 KB.
    // #5 (user decision 2026-10-13): 29 → 31.5 KB (31,916 B). The earlier sizes were measured on a
    // bundle that threw (esbuild --minify dropped the feature runtime); this one runs (`smoke`).
    // Issues #14-#62 (user decision 2026-10-14): 31.5 → 32.5 KB (32,863 B). After the SIZE savings
    // and moving production diagnostic prose to the messages, the remaining growth is the a11y,
    // hydration and render-fault fixes (#16 #18 #23 #26 #54-#60); cutting every a11y fix would
    // still leave it ~180 B over.
    limit: 32.5 * KB,
  },
]
