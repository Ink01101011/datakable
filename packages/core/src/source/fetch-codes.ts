import { defineDiagnostic } from '../diagnostics/catalog'

/** Why a fetcher result was rejected (`DK_FETCH_BAD_RESPONSE`); a closed set, never row data. */
export type BadResponse =
  | 'not-an-object'
  | 'rows-not-an-array'
  | 'rowCount-missing'
  | 'rowCount-invalid'
  | 'rowCount-too-small'

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_MODE_ORDER: {
      /** The client-mode feature that runs before a server-mode one. */
      client: string
      clientStage: string
      /** The server-mode feature after it. */
      server: string
      serverStage: string
    }
    DK_FETCHER_WITHOUT_SERVER_MODE: {
      /** The installed pipeline features (all client mode). */
      features: string[]
      phase: 'init' | 'setOptions'
    }
    DK_FETCH_FAILED: {
      /** `error.name` only; the full error is `context.cause`. */
      errorName?: string
      /** Whether rows were shown before (`false`: the first request failed). */
      hadRows: boolean
    }
    DK_FETCH_ABORTED: Record<string, never>
    DK_FETCH_BAD_RESPONSE: {
      problem: BadResponse
      /** The type of what was returned (`describeValue`), for the shape problems. */
      received?: string
      rows?: number
      rowCount?: number
    }
  }
}

const BAD: Record<
  BadResponse,
  (d: { received?: string; rows?: number; rowCount?: number }) => string
> = {
  'not-an-object': (d) => `fetcher resolved with ${d.received}, not { rows, rowCount }`,
  'rows-not-an-array': (d) => `fetcher result.rows is ${d.received}, not an array`,
  'rowCount-missing': () =>
    'fetcher result has no rowCount, and pagination is in server mode (it needs the total)',
  'rowCount-invalid': (d) => `fetcher result.rowCount is ${d.received}, not an integer ≥ 0`,
  'rowCount-too-small': (d) =>
    `fetcher result.rowCount (${d.rowCount}) is smaller than rows.length (${d.rows})`,
}

const FETCHER = { kind: 'option', path: 'fetcher' } as const

/** Codes owned by the data modes and the server source (spec §7.1, §8.3). */
export const fetchDiagnostics = [
  defineDiagnostic({
    code: 'DK_MODE_ORDER',
    level: 'error',
    config: true,
    where: (d) => ({ kind: 'feature', name: d.server }),
    problem: (d) =>
      `feature "${d.server}" (${d.serverStage}) is in server mode, but "${d.client}" ` +
      `(${d.clientStage}) runs before it in client mode; server steps must come first`,
    impact: () =>
      'the table was not created: the client step would only see the rows the server returned',
    fix: (d) => [
      `move "${d.client}" to the server too: ${d.client}({ mode: 'server' })`,
      `or handle "${d.server}" in the client: ${d.server}({ mode: 'client' }) (the default)`,
    ],
  }),
  defineDiagnostic({
    code: 'DK_FETCHER_WITHOUT_SERVER_MODE',
    level: 'error',
    config: true,
    where: () => FETCHER,
    problem: () => 'options.fetcher is set, but no feature is in server mode',
    impact: (d) =>
      d.phase === 'init'
        ? 'the table was not created: nothing would tell the fetcher what to load'
        : 'setOptions() was rejected; the previous options are kept',
    fix: (d) => [
      `set mode: 'server' on the features the server handles` +
        (d.features.length > 0 ? ` (installed: ${d.features.join(', ')})` : '') +
        `, e.g. pagination({ mode: 'server' })`,
      'or remove fetcher and pass the rows as options.data (client mode)',
    ],
  }),
  defineDiagnostic({
    code: 'DK_FETCH_FAILED',
    level: 'error',
    where: () => FETCHER,
    problem: (d) => `fetcher rejected or threw${d.errorName ? ` ${d.errorName}` : ''}`,
    impact: (d) =>
      d.hadRows
        ? "the previous rows are kept (status: 'error')"
        : "nothing is shown yet (status: 'error', isInitialLoad: true)",
    fix: () => [
      'check the request the fetcher sends (the original error is context.cause, passed to ' +
        'onDiagnostic)',
      'retry from the UI with table.refetch(); the next state change (page, sort, filter, ' +
        'query) or a new fetcher also runs it again',
    ],
  }),
  defineDiagnostic({
    code: 'DK_FETCH_ABORTED',
    level: 'info',
    where: () => FETCHER,
    problem: () => 'a fetcher request was superseded by a newer one (latest wins)',
    impact: () => 'its result is ignored; the request was aborted through ctx.signal',
    fix: () => [
      'nothing to fix; pass params.signal to fetch() so superseded requests stop on the network',
    ],
  }),
  defineDiagnostic({
    code: 'DK_FETCH_BAD_RESPONSE',
    level: 'error',
    where: () => FETCHER,
    problem: (d) => BAD[d.problem](d),
    impact: () => "the result was ignored and the previous rows are kept (status: 'error')",
    fix: (d) => [
      d.problem === 'rowCount-too-small'
        ? 'return rowCount as the total number of matching rows on the server, not the page size'
        : 'resolve the fetcher with { rows: T[], rowCount: number } (rowCount = the total ' +
          'number of matching rows on the server)',
      'map your API response in the fetcher: async (p) => { const r = await api(p); ' +
        'return { rows: r.items, rowCount: r.total } }',
    ],
  }),
]
