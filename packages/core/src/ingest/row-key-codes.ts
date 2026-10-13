import { type DiagnosticMessages, defineDiagnostic } from '../diagnostics/catalog'
import { DEV } from '../diagnostics/env'

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_DUPLICATE_ROW_KEY: {
      /** The `rowKey` path; absent for a `rowKey` function. */
      path?: string
      /** The first repeated key value (hashed under `'safe'`). */
      key: string | number
      /** A sample of the rows sharing `key` (first few, in order; the first keeps its key). */
      rows: readonly number[]
      /** How many rows share `key`. */
      shared: number
      /** How many rows got a fallback key (all repeated values). */
      count: number
      /** How many distinct key values repeat. */
      groups: number
      /** `data.length`. */
      total: number
      /** Fields unique across all rows (computed by a scan). */
      unique: readonly string[]
      /** No unique field: a field that, with the `rowKey` path, makes a unique composite key. */
      pair?: string
    }
    DK_MISSING_ROW_KEY: {
      /** The `rowKey` path; absent for a `rowKey` function. */
      path?: string
      /** A sample of the rows without a usable key (first few, in order). */
      rows: readonly number[]
      count: number
      /** `data.length`. */
      total: number
      /** The type of the first unusable value: `undefined`, `null`, `object`, `number(NaN)`, … */
      valueType: string
      /** Fields unique across all rows (computed by a scan). */
      unique: readonly string[]
    }
  }
}

const n = (x: number) => x.toLocaleString('en-US')
const rowList = (rows: readonly number[], total: number) =>
  rows.map((r) => `#${r}`).join(', ') + (total > rows.length ? ', …' : '')
const uniqueFixes = (unique: readonly string[], total: number) =>
  unique.map((f) => `rowKey: '${f}' (unique in all ${n(total)} rows)`)

/** Message text (§8.2): development builds, or production via `@datakable/core/messages`. */
export const rowKeyMessages: DiagnosticMessages<'DK_DUPLICATE_ROW_KEY' | 'DK_MISSING_ROW_KEY'> = {
  DK_DUPLICATE_ROW_KEY: {
    problem: (d) => {
      const head =
        d.path === undefined
          ? 'the rowKey function returns repeated keys'
          : `rowKey "${d.path}" is not unique`
      const more = d.groups > 1 ? `${n(d.groups)} values are repeated; ` : ''
      const what = d.path === undefined ? `key ${d.key}` : `${d.path} = ${d.key}`
      return `${head}: ${more}rows ${rowList(d.rows, d.shared)} share ${what}`
    },
    impact: (d) => {
      const shown = Math.min(d.shared - 1, 2)
      const keys = Array.from({ length: shown }, (_, i) => `${d.key}#${i + 1}`).join(', ')
      const rows = d.count === 1 ? '1 row renders' : `${n(d.count)} rows render`
      return `${rows} with fallback keys (${keys}${d.count > shown ? ', …' : ''}) — updates may hit the wrong row`
    },
    fix: (d) => {
      const fixes = uniqueFixes(d.unique, d.total)
      if (d.pair !== undefined && d.path !== undefined) {
        fixes.push(
          `rowKey: (row) => \`\${row.${d.path}}-\${row.${d.pair}}\` (unique in all ${n(d.total)} rows)`,
        )
      }
      if (fixes.length === 0) {
        fixes.push(
          `no field is unique across all ${n(d.total)} rows: add a unique id to each row, ` +
            'or remove the duplicate rows at the source',
        )
      }
      if (d.path === undefined) fixes.push('or make the rowKey function return a unique value')
      return fixes
    },
  },
  DK_MISSING_ROW_KEY: {
    problem: (d) => {
      const rows = `rows ${rowList(d.rows, d.count)}`
      if (d.path === undefined) {
        return (
          `the rowKey function returned no usable key for ${d.count === 1 ? '1 row' : `${n(d.count)} rows`} ` +
          `(${rows}; the first is ${d.valueType})`
        )
      }
      const has = d.count === 1 ? '1 row has' : `${n(d.count)} rows have`
      return `${has} no usable key at "${d.path}" (${rows}; the first is ${d.valueType})`
    },
    impact: () =>
      "those rows use the fallback key '#<index>', which changes when rows are added or removed",
    fix: (d) => [
      ...uniqueFixes(d.unique, d.total),
      d.path === undefined
        ? 'return a string or a number for every row from the rowKey function'
        : `give every row a string or a number at "${d.path}"`,
    ],
  },
}

/** Codes owned by row-key resolution (§5.2, §8.3). */
export const rowKeyDiagnostics = [
  defineDiagnostic(
    {
      code: 'DK_DUPLICATE_ROW_KEY',
      level: 'error',
      redact: { key: 'rowKey' },
      where: (d) => ({ kind: 'row', index: d.rows[1] ?? d.rows[0] ?? 0, key: String(d.key) }),
    },
    DEV && rowKeyMessages.DK_DUPLICATE_ROW_KEY,
  ),
  defineDiagnostic(
    {
      code: 'DK_MISSING_ROW_KEY',
      level: 'error',
      where: (d) => ({ kind: 'row', index: d.rows[0] ?? 0 }),
    },
    DEV && rowKeyMessages.DK_MISSING_ROW_KEY,
  ),
]
