import { throwConfigError } from '../diagnostics/build'
import { describeValue } from '../diagnostics/redact'
import { STAGES } from '../feature/order'
import type { AnyFeature } from '../feature/types'
import type { TableState } from '../table/types'
import { type BadResponse, fetchDiagnostics } from './fetch-codes'

// Referencing the definitions keeps them in the bundle (`sideEffects: false`).
void fetchDiagnostics

/**
 * What `options.fetcher` receives (§7.1): only the state of the server-mode steps, plus the
 * request's `signal` (aborted when superseded, timed out or the table is destroyed).
 */
export interface FetchParams {
  /** The applied search query (`search({ mode: 'server' })`). */
  query?: string
  /** The `columnFilters` slice (`columnFilters({ mode: 'server' })`). */
  filters?: Readonly<Record<string, unknown>>
  /** The sort entries, first key first (`sorting({ mode: 'server' })`). */
  sort?: readonly { readonly id: string; readonly desc: boolean }[]
  /** `pagination({ mode: 'server' })`. */
  pageIndex?: number
  pageSize?: number
  signal: AbortSignal
}

/**
 * What the fetcher resolves with: the rows to show and the total number of matching rows on the
 * server (required with server-mode pagination; else `rows.length`).
 */
export interface FetchResult<T> {
  rows: readonly T[]
  rowCount?: number
}

/**
 * What `table.refetch()` resolves to; it never rejects. `'applied'`: the rows were loaded;
 * `'superseded'`: a newer request (or `destroy()`) replaced it; `'error'`: it failed
 * (`DK_FETCH_FAILED`, `DK_FETCH_BAD_RESPONSE`, `DK_ASYNC_TIMEOUT`) and the previous rows are kept.
 */
export interface FetchOutcome {
  status: 'applied' | 'superseded' | 'error'
}

/** The server source (§7.1). Runs through `async:request`: latest wins, abort, `timeout`. */
export type Fetcher<T> = (params: FetchParams) => FetchResult<T> | PromiseLike<FetchResult<T>>

export const isServer = (f: AnyFeature) => f.stage !== 'none' && f.mode === 'server'

const rank = (f: AnyFeature) => STAGES.indexOf(f.stage)

/**
 * Config checks of the data modes (§7.1), at creation and on `setOptions({ fetcher })`:
 * - `DK_MODE_ORDER`: server steps must form a prefix of the pipeline. Steps of the same stage
 *   commute (filters AND together), so only a client step of an earlier stage is a violation.
 * - `DK_FETCHER_WITHOUT_SERVER_MODE`: a `fetcher` needs at least one server-mode feature.
 */
export function checkModes(
  features: readonly AnyFeature[],
  fetcher: unknown,
  table: string,
  phase: 'init' | 'setOptions' = 'init',
): void {
  let client: AnyFeature | undefined
  let server = false
  for (const f of features) {
    if (f.stage === 'none') continue
    if (f.mode !== 'server') {
      client ??= f
      continue
    }
    server = true
    if (client && rank(client) < rank(f)) {
      throwConfigError(
        'DK_MODE_ORDER',
        { client: client.name, clientStage: client.stage, server: f.name, serverStage: f.stage },
        { table },
      )
    }
  }
  if (fetcher !== undefined && !server) {
    throwConfigError(
      'DK_FETCHER_WITHOUT_SERVER_MODE',
      { features: features.filter((f) => f.stage !== 'none').map((f) => f.name), phase },
      { table, trigger: phase },
    )
  }
}

/** The fetcher params without `signal`. */
export type FetchKey = Omit<FetchParams, 'signal'>

/**
 * The state of the server-mode built-ins as fetcher params. Only `search.query` counts for the
 * search slice, so typing (`input`, `status`) never refetches.
 */
export function fetchParams(server: readonly AnyFeature[], state: TableState): FetchKey {
  const p: FetchKey = {}
  for (const f of server) {
    const s = state[f.name] as Record<string, unknown> | undefined
    if (f.name === 'search') p.query = typeof s?.query === 'string' ? s.query : ''
    else if (f.name === 'columnFilters') p.filters = s ?? {}
    else if (f.name === 'sorting') p.sort = (s?.by as FetchParams['sort']) ?? []
    else if (f.name === 'pagination') {
      p.pageIndex = s?.pageIndex as number
      p.pageSize = s?.pageSize as number
    }
  }
  return p
}

export function sameParams(a: FetchKey, b: FetchKey): boolean {
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  for (const k in x) if (!Object.is(x[k], y[k])) return false
  for (const k in y) if (!(k in x)) return false
  return true
}

/** A fetcher that rejected or threw: resolved as a value so asyncControl reports 'applied'. */
export class FetchFailure {
  constructor(readonly error: unknown) {}
}

const isAbortError = (e: unknown) =>
  e != null && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError'

/**
 * Calls the fetcher. A failure resolves as a {@link FetchFailure} (reported as `DK_FETCH_FAILED`
 * by the caller once it is known to be the latest request); an abort rejects, so asyncControl
 * classifies it as `'aborted'`.
 */
export async function callFetcher<T>(
  fetcher: Fetcher<T>,
  params: FetchKey,
  signal: AbortSignal,
): Promise<unknown> {
  try {
    return await fetcher({ ...params, signal })
  } catch (e) {
    if (signal.aborted || isAbortError(e)) throw e
    return new FetchFailure(e)
  }
}

export interface BadResponseDetails {
  problem: BadResponse
  received?: string
  rows?: number
  rowCount?: number
}

/** Validates a fetcher result (§7.1); `needCount`: pagination is in server mode. */
export function checkResponse(v: unknown, needCount: boolean): BadResponseDetails | undefined {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) {
    return { problem: 'not-an-object', received: describeValue(v) }
  }
  const { rows, rowCount } = v as { rows?: unknown; rowCount?: unknown }
  if (!Array.isArray(rows)) return { problem: 'rows-not-an-array', received: describeValue(rows) }
  if (rowCount === undefined) return needCount ? { problem: 'rowCount-missing' } : undefined
  if (!Number.isInteger(rowCount) || (rowCount as number) < 0) {
    return {
      problem: 'rowCount-invalid',
      received: typeof rowCount === 'number' ? String(rowCount) : describeValue(rowCount),
    }
  }
  if ((rowCount as number) < rows.length) {
    return { problem: 'rowCount-too-small', rows: rows.length, rowCount: rowCount as number }
  }
  return undefined
}
