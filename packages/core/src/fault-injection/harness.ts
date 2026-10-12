import { afterEach, beforeEach, expect, vi } from 'vitest'
import { type Diagnostic, type DiagnosticCode, formatWhere, type RowModelStatus } from '../index'

/**
 * Fault-injection harness (§11, T30): shared helpers for the slot × injection and the method ×
 * slot suites. Test-only; not exported from the package.
 *
 * The sentinel is planted in row values and in every injected error message: no diagnostic may
 * carry it (§8.2: raw row data and error messages never reach a diagnostic under the default
 * redaction; the original error is `context.cause`, passed to `onDiagnostic` only).
 */
export const SECRET = 'SECRET-123'

/** The error every injected throw / rejection uses: its message carries the sentinel. */
export class InjectedError extends Error {
  override name = 'InjectedError'
  constructor() {
    super(`injected failure for ${SECRET}`)
  }
}

export const fail = (): never => {
  throw new InjectedError()
}
export const reject = (): Promise<never> => Promise.reject(new InjectedError())

export interface Person {
  id: string
  name: string
  n: number
  secret: string
}

/** Fresh rows: unique `id`, sortable `n` (unsorted input order), the sentinel in `secret`. */
export const people = (): Person[] => [
  { id: 'p0', name: 'Cleo', n: 3, secret: SECRET },
  { id: 'p1', name: 'Ada', n: 1, secret: SECRET },
  { id: 'p2', name: 'Bob', n: 2, secret: SECRET },
]

/** A table with every method typed loosely: the suites call feature APIs by name. */
export type AnyTable = {
  getState(): Record<string, unknown>
  setState(u: unknown): void
  subscribe(l: (...a: unknown[]) => void): () => void
  setOptions(o: Record<string, unknown>): void
  getOptions(): Record<string, unknown>
  getData(): readonly unknown[]
  getRowModel(): {
    rows: readonly {
      key: unknown
      index: number
      original: unknown
      getValue(id: string): unknown
    }[]
    filteredCount: number
    totalCount: number
    status: RowModelStatus
    isInitialLoad: boolean
  }
  getInvalidRows(): readonly unknown[]
  getDiagnostics(): Diagnostic[]
  refetch(): Promise<{ status: string }>
  explain(): object
  explainRow(key: unknown): { found: boolean }
  destroy(): void
} & { [M in FeatureMethod]: Method }

// biome-ignore lint/suspicious/noExplicitAny: the suites call feature APIs with loose arguments
type Method = (...args: any[]) => any

/** The API methods of the built-in features, plus the test features' (`probe*`). */
type FeatureMethod =
  | 'setColumnFilter'
  | 'resetColumnFilters'
  | 'setValidity'
  | 'setSearch'
  | 'flushSearch'
  | 'cancelSearch'
  | 'clearSearch'
  | 'toggleSort'
  | 'setSorting'
  | 'clearSorting'
  | 'getSortDirection'
  | 'setPageIndex'
  | 'setPageSize'
  | 'nextPage'
  | 'prevPage'
  | 'getPageCount'
  | 'canNextPage'
  | 'canPrevPage'
  | 'probeOn'
  | 'probeSet'

export const loose = (t: unknown) => t as AnyTable

/** Diagnostics delivered to `onDiagnostic`, in order. */
export function sink() {
  const seen: Diagnostic[] = []
  return { seen, onDiagnostic: (d: Diagnostic) => void seen.push(d) }
}

/** Lets microtasks and zero-delay timers run (async ingest, fetcher, searchFn settle). */
export const settle = async (rounds = 3) => {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0))
}

/**
 * The diagnostic `code` at exactly `where` (`formatWhere`). Checks the §8.3 shape every code must
 * have: non-empty `problem`, `impact`, `fix` (each entry non-empty) and the docs anchor.
 */
export function expectDiagnostic(
  seen: readonly Diagnostic[],
  code: DiagnosticCode,
  where: string,
): Diagnostic {
  const wheres = seen.map((d) => `${d.code} @ ${formatWhere(d.where)}`)
  const d = seen.find((x) => x.code === code && formatWhere(x.where) === where)
  expect(d, `${code} @ ${where} not in [${wheres.join(' | ')}]`).toBeDefined()
  const found = d as Diagnostic
  expect(found.problem.length).toBeGreaterThan(0)
  expect(found.impact.length).toBeGreaterThan(0)
  expect(found.fix.length).toBeGreaterThan(0)
  for (const f of found.fix) expect(f.length).toBeGreaterThan(0)
  expect(found.docs).toMatch(new RegExp(`#${code.toLowerCase()}`))
  return found
}

/** No diagnostic carries the sentinel: not in its JSON, text, `where` or details. */
export function expectNoRowData(seen: readonly Diagnostic[]) {
  for (const d of seen) {
    const text = [
      JSON.stringify(d),
      d.problem,
      d.impact,
      ...d.fix,
      formatWhere(d.where),
      d.fingerprint,
      d.docs,
    ].join('\n')
    expect(text, `${d.code} leaks row data`).not.toContain(SECRET)
  }
}

/** Every diagnostic has a non-empty `where` and `fix` (§8.3), whatever its code. */
export function expectWellFormed(seen: readonly Diagnostic[]) {
  for (const d of seen) {
    expect(formatWhere(d.where).length, d.code).toBeGreaterThan(0)
    expect(d.fix.length, d.code).toBeGreaterThan(0)
    for (const f of d.fix) expect(f.length, d.code).toBeGreaterThan(0)
  }
}

const STATUSES: readonly RowModelStatus[] = [
  'idle',
  'validating',
  'pending',
  'searching',
  'fetching',
  'error',
]

/** A usable row model: rows are `Row`s with keys, counts are consistent, status is known. */
export function expectUsable(table: AnyTable) {
  const m = table.getRowModel()
  expect(Array.isArray(m.rows)).toBe(true)
  expect(STATUSES).toContain(m.status)
  expect(m.totalCount).toBeGreaterThanOrEqual(m.filteredCount)
  expect(m.filteredCount).toBeGreaterThanOrEqual(0)
  for (const r of m.rows) {
    expect(r.key).toBeDefined()
    expect(typeof r.getValue).toBe('function')
  }
  return m
}

/**
 * Mutes the console sinks and records unhandled rejections for the current test (§8.6: every
 * promise DataKable creates is handled). Call once per suite file.
 */
/** Node's `process` (the core tsconfig has no Node types). */
const nodeProcess = (
  globalThis as unknown as {
    process: {
      on(event: 'unhandledRejection', fn: (reason: unknown) => void): void
      off(event: 'unhandledRejection', fn: (reason: unknown) => void): void
    }
  }
).process

export function useHarness() {
  const rejections: unknown[] = []
  const onRejection = (reason: unknown) => void rejections.push(reason)
  beforeEach(() => {
    rejections.length = 0
    nodeProcess.on('unhandledRejection', onRejection)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  })
  afterEach(async () => {
    await settle()
    nodeProcess.off('unhandledRejection', onRejection)
    vi.restoreAllMocks()
    expect(rejections, 'unhandled rejections').toEqual([])
  })
  return { rejections }
}
