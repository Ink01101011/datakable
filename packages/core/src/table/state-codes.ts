import { suggest } from '../catalog/suggest'
import { type DiagnosticMessages, defineDiagnostic } from '../diagnostics/catalog'
import { DEV } from '../diagnostics/env'

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_STATE_UNKNOWN_KEY: {
      /** The state slice holding the key, e.g. `columnFilters`; `''` for a top-level state key. */
      slice: string
      /** The key that names no column (or `__proto__`, which is never applied, #102). */
      key: string
      /** The table's column ids (did-you-mean); empty for `__proto__`. */
      known: readonly string[]
    }
    DK_INVALID_STATE: {
      /** The feature slice, e.g. `sorting`. */
      slice: string
      /** What the slice was (`describeValue`), or what was wrong with it, e.g. `by[1] null`. */
      received: string
      /** What was stored instead. */
      fallback: string
    }
  }
}

/** The one key a plain `=` / `Object.assign` write turns into a prototype change (#102). */
export const PROTO_KEY = '__proto__'

/** Message text (§8.2): development builds, or production via `@datakable/core/messages`. */
export const stateMessages: DiagnosticMessages<'DK_STATE_UNKNOWN_KEY' | 'DK_INVALID_STATE'> = {
  DK_STATE_UNKNOWN_KEY: {
    problem: (d) =>
      d.key === PROTO_KEY
        ? `${d.slice ? `state.${d.slice}` : 'the state'} has a "__proto__" key`
        : `state.${d.slice} has an entry for "${d.key}", which is not a column`,
    impact: (d) =>
      d.key === PROTO_KEY
        ? 'the key is ignored: writing it would replace the prototype of the state object ' +
          '(JSON.parse of untrusted input creates such keys)'
        : 'the entry is ignored (the other entries still apply); it may come from an older URL or ' +
          'saved state, or the column was renamed or removed',
    fix: (d) => {
      if (d.key === PROTO_KEY) {
        return [`drop "__proto__" when parsing initialState / state (e.g. from the URL or storage)`]
      }
      const near = suggest(d.key, d.known)
      return [
        near.length > 0
          ? `did you mean "${near[0]}"? (state.${d.slice}["${near[0]}"])`
          : `use one of the column ids: ${d.known.map((k) => `"${k}"`).join(', ')}`,
        `drop "${d.key}" when parsing initialState / state (e.g. from the URL), or add the column`,
      ]
    },
  },
  DK_INVALID_STATE: {
    problem: (d) => `state.${d.slice} is malformed (${d.received})`,
    impact: (d) => `the slice was replaced with ${d.fallback}; the table keeps working`,
    fix: (d) => [
      `write state.${d.slice} in the shape the feature uses (check initialState, setState and ` +
        'the controlled options.state, e.g. a value restored from the URL or storage)',
      `validate restored state before passing it, or drop ${d.slice} when it does not parse`,
    ],
  },
}

/**
 * Codes about the state itself, shared by core and features (§7.2, §8.3). `DK_INVALID_STATE` is
 * reported by the development-only slice guard (`feature/slice-guard.ts`), which defines it.
 */
export const stateDiagnostics = [
  defineDiagnostic(
    {
      code: 'DK_STATE_UNKNOWN_KEY',
      level: 'warn',
      where: (d) => ({ kind: 'option', path: `state.${d.slice && `${d.slice}.`}${d.key}` }),
    },
    DEV && stateMessages.DK_STATE_UNKNOWN_KEY,
  ),
]
