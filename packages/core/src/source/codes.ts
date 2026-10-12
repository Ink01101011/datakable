import { defineDiagnostic } from '../diagnostics/catalog'

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_ASYNC_TIMEOUT: {
      /** The option that ran too long (`fetcher`, `searchFn`); a closed set, never row data. */
      source: string
      /** The timeout that was exceeded, in ms. */
      timeout: number
    }
  }
}

/** Codes owned by asyncControl (spec §3.4, §7.1, §8.3). */
export const asyncDiagnostics = [
  defineDiagnostic({
    code: 'DK_ASYNC_TIMEOUT',
    level: 'error',
    where: (d) => ({ kind: 'option', path: d.source }),
    problem: (d) => `${d.source} did not settle within the timeout (${d.timeout} ms)`,
    impact: () =>
      'the request was aborted and its late result is ignored; the previous results were kept ' +
      "(status: 'error')",
    fix: (d) => [
      `make ${d.source} answer faster (smaller pages, a server-side index), or raise \`timeout\` ` +
        `(now ${d.timeout} ms)`,
      `pass ctx.signal to fetch() inside ${d.source} so the timed-out request is cancelled on the ` +
        'network too',
    ],
  }),
]
