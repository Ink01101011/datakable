import { type DiagnosticMessages, defineDiagnostic } from '../diagnostics/catalog'
import { DEV } from '../diagnostics/env'
import type { Location } from '../diagnostics/types'

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_UNKNOWN_OPTION: {
      /** Option path as written (`colums`, `diagnostics.redcat`); option keys, never values. */
      path: string
      /** Set when the option was given to a feature factory. */
      feature?: string
      /** Close accepted names, best first (did-you-mean). */
      suggestions: string[]
      /** The accepted options at that level. */
      known: string[]
      /** An installed feature that has this option (it was passed to the table instead). */
      owner?: string
    }
    DK_INVALID_OPTION: {
      path: string
      feature?: string
      /** The accepted values in words. */
      expected: string
      /** What was given: a type, or a short constant (`"ful"`, `NaN`). */
      received: string
      /** Close accepted values (enums), best first. */
      suggestions: string[]
      /** A fix specific to this mistake, shown first. */
      hint?: string
      /** Where it was given: `createTable` (the table was not created) or `setOptions` (rejected). */
      phase: 'init' | 'setOptions'
    }
    DK_OPTION_NO_EFFECT: {
      path: string
      feature?: string
      /** Why the option is ignored. */
      reason: string
      /** `true` for a read-once option changed with `setOptions`. */
      once: boolean
    }
  }
}

const where = (d: { path: string; feature?: string }): Location =>
  d.feature === undefined ? { kind: 'option', path: d.path } : { kind: 'feature', name: d.feature }

/** `options.timeout` / `paging({ pageSize })`. */
const label = (d: { path: string; feature?: string }) =>
  d.feature === undefined ? `options.${d.path}` : `${d.feature}({ ${d.path} })`

const leaf = (path: string) => path.slice(path.lastIndexOf('.') + 1)

/** Message text (§8.2): development builds, or production via `@datakable/core/messages`. */
export const optionMessages: DiagnosticMessages<
  'DK_UNKNOWN_OPTION' | 'DK_INVALID_OPTION' | 'DK_OPTION_NO_EFFECT'
> = {
  DK_UNKNOWN_OPTION: {
    problem: (d) =>
      d.feature === undefined
        ? `unknown option "${d.path}"`
        : `feature "${d.feature}" got an unknown option "${d.path}"`,
    impact: () => 'the option is ignored',
    fix: (d) => {
      const out: string[] = []
      const s = d.suggestions[0]
      if (s !== undefined) out.push(`did you mean "${s}"? rename "${leaf(d.path)}" to "${s}"`)
      if (d.owner !== undefined) {
        out.push(
          `"${d.path}" is an option of feature "${d.owner}": pass it to the feature, ` +
            `${d.owner}({ ${d.path}: ... })`,
        )
      }
      out.push(
        `remove "${leaf(d.path)}"; accepted ${d.feature === undefined ? '' : `${d.feature} `}` +
          `options here: ${d.known.join(', ') || '(none)'}`,
      )
      return out
    },
  },
  DK_INVALID_OPTION: {
    problem: (d) => `${label(d)} must be ${d.expected}, got ${d.received}`,
    impact: (d) =>
      d.phase === 'init'
        ? 'the table was not created'
        : 'setOptions() was rejected; the previous options are kept',
    fix: (d) => {
      const out: string[] = []
      if (d.hint !== undefined) out.push(d.hint)
      const s = d.suggestions[0]
      if (s !== undefined) out.push(`use '${s}' (the closest accepted value) for ${label(d)}`)
      out.push(`pass ${d.expected} as ${label(d)}, or leave it out for the default`)
      return out
    },
  },
  DK_OPTION_NO_EFFECT: {
    problem: (d) =>
      d.once
        ? `setOptions({ ${d.path} }) has no effect: ${d.reason}`
        : `${label(d)} has no effect: ${d.reason}`,
    impact: (d) =>
      d.once
        ? 'the new value was ignored; the table keeps the value it was created with'
        : 'the option is ignored in this configuration',
    fix: (d) =>
      d.once
        ? [
            `pass ${d.path} to createTable() instead; to change it, create a new table ` +
              '(in React, change the component key)',
          ]
        : [`remove ${label(d)}, or change the configuration so that it applies (${d.reason})`],
  },
}

/** Codes owned by the options catalog (§3.5, §8.3). */
export const optionDiagnostics = [
  // Only the development option validator emits it: no definition in production.
  ...(DEV
    ? [
        defineDiagnostic(
          {
            code: 'DK_UNKNOWN_OPTION',
            level: 'warn',
            where,
          },
          DEV && optionMessages.DK_UNKNOWN_OPTION,
        ),
      ]
    : []),
  defineDiagnostic(
    {
      code: 'DK_INVALID_OPTION',
      level: 'error',
      config: true,
      where,
    },
    DEV && optionMessages.DK_INVALID_OPTION,
  ),
  defineDiagnostic(
    {
      code: 'DK_OPTION_NO_EFFECT',
      level: 'warn',
      where,
    },
    DEV && optionMessages.DK_OPTION_NO_EFFECT,
  ),
]
