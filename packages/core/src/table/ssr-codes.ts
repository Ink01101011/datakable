import { type DiagnosticMessages, defineDiagnostic } from '../diagnostics/catalog'
import { DEV } from '../diagnostics/env'

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_SSR_ASYNC_DEFERRED: {
      /** The async work that waits for the client: the fetcher, or the search feature's searchFn. */
      source: 'fetcher' | 'searchFn'
    }
    DK_HYDRATION_MISMATCH: {
      /**
       * What differs between the snapshot React hydrated with and the table's live one: state
       * slice names, then `rows` when the state is equal but the row model is not (data, columns).
       */
      slices: string[]
    }
  }
}

const list = (s: readonly string[]) => s.map((k) => `"${k}"`).join(', ')

/** Message text (§8.2): development builds, or production via `@datakable/core/messages`. */
export const ssrMessages: DiagnosticMessages<'DK_SSR_ASYNC_DEFERRED' | 'DK_HYDRATION_MISMATCH'> = {
  DK_SSR_ASYNC_DEFERRED: {
    problem: (d) =>
      d.source === 'fetcher'
        ? 'the fetcher did not run during the server render (async work is deferred to the client)'
        : 'searchFn did not run for the initial query during the server render (async work is ' +
          'deferred to the client)',
    impact: (d) =>
      d.source === 'fetcher'
        ? "the server HTML has status 'pending' and no fetched rows; the fetch starts after hydration"
        : "the server HTML has status 'pending' and the rows unsearched; the search runs after " +
          'hydration',
    fix: (d) =>
      d.source === 'fetcher'
        ? [
            'fetch on the server and pass the result as initialData (with rowCount for server ' +
              'pagination): the HTML then has the rows, and hydration does not re-fetch',
            'or keep it: the client shows its loading state until the first fetch applies',
          ]
        : [
            'search on the server and pass the result as initialData: it is used as the result of ' +
              'the initial query, and hydration does not search again',
            'or use client matching (no searchFn), which runs during the server render',
          ],
  },
  DK_HYDRATION_MISMATCH: {
    problem: (d) =>
      `the table changed while React hydrated it: ${list(d.slices)} differ from the server snapshot`,
    impact: () =>
      'React hydrated with the server snapshot and re-renders with the live one at once: the server ' +
      'HTML is replaced (a visible flash)',
    fix: (d) => [
      `give the server and the client the same initial ${list(d.slices)} (initialState / state / ` +
        'data / initialData), e.g. parse them from the same URL',
      'apply client-only changes (localStorage, window size, …) after mount, in useEffect, not ' +
        'while rendering',
    ],
  },
}

/** SSR codes (§7.2, §8.3): kept by `createDeferred` (ssr.ts) and `@datakable/react`. */
export const ssrDiagnostics = [
  defineDiagnostic(
    {
      code: 'DK_SSR_ASYNC_DEFERRED',
      level: 'info',
      where: (d) =>
        d.source === 'fetcher'
          ? { kind: 'option', path: 'fetcher' }
          : { kind: 'feature', name: 'search' },
    },
    DEV && ssrMessages.DK_SSR_ASYNC_DEFERRED,
  ),
  defineDiagnostic(
    {
      code: 'DK_HYDRATION_MISMATCH',
      level: 'warn',
      where: (d) => ({ kind: 'operation', op: 'hydrate', slot: d.slices[0] ?? 'rows' }),
    },
    DEV && ssrMessages.DK_HYDRATION_MISMATCH,
  ),
]
