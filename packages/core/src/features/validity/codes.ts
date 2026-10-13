import { type DiagnosticMessages, defineDiagnostic } from '../../diagnostics/catalog'
import { DEV } from '../../diagnostics/env'

declare module '../../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_INVALID_VALIDITY: {
      /** The API method that received the value, or `'state'` for a slice written to the store. */
      source: 'setValidity' | 'state'
      /** A short constant (`"broken"`) or the value's type only. */
      received: string
      /** What was done instead. */
      fallback: string
    }
  }
}

const ACCEPTED = "'all' | 'valid' | 'invalid'"

/** Message text (§8.2): development builds, or production via `@datakable/core/messages`. */
export const validityMessages: DiagnosticMessages<'DK_INVALID_VALIDITY'> = {
  DK_INVALID_VALIDITY: {
    problem: (d) =>
      d.source === 'state'
        ? `the validity state is ${d.received}; it must be ${ACCEPTED}`
        : `setValidity() received ${d.received}; it must be ${ACCEPTED}`,
    impact: (d) => d.fallback,
    fix: (d) => [
      d.source === 'state'
        ? `write validity as ${ACCEPTED} (check initialState, setState and the controlled ` +
          'options.state)'
        : `pass ${ACCEPTED} to setValidity()`,
    ],
  },
}

/** Codes owned by the `validity` feature (§6.2). */
export const validityDiagnostics = [
  defineDiagnostic(
    {
      code: 'DK_INVALID_VALIDITY',
      level: 'warn',
      where: (d) =>
        d.source === 'state'
          ? { kind: 'option', path: 'state.validity' }
          : { kind: 'operation', op: 'table.setValidity' },
    },
    DEV && validityMessages.DK_INVALID_VALIDITY,
  ),
]
