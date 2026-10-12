import { VERSION } from '../version'
import { type DiagnosticMessages, defineDiagnostic } from './catalog'
import { DEV } from './env'

declare module './catalog' {
  interface DiagnosticCatalog {
    DK_INTERCEPTOR_FAILED: { interceptor: string; op: string; slot: string }
    DK_HOT_INTERCEPTOR: { interceptor: string; op: string }
    DK_OPERATION_CONFLICT: {
      op: string
      kind: string
      hot: boolean
      previousKind: string
      previousHot: boolean
    }
    DK_INTERNAL: {
      op: string
      problem: string
      /** The ctx `where` of the failed call (errorBoundary). */
      slot?: string
      /** `error.name` of the classified throw (errorBoundary). */
      errorName?: string
      /** The registry fallback applied (errorBoundary); invariant callers abort instead. */
      fallback?: string
      /**
       * `error.message` of the classified throw (errorBoundary). Engine messages embed row values
       * (`Cannot create property 'x' on string '<value>'`), so it is redacted as a cell value.
       */
      message?: unknown
    }
  }
}

const ISSUES = 'https://github.com/Ink01101011/datakable/issues/new'

/** Prefilled GitHub issue (§8.3): version, op, slot and error name — never values. */
function issueLink(d: { op: string; slot?: string; errorName?: string }): string {
  const title = `DK_INTERNAL in ${d.op}${d.errorName ? ` (${d.errorName})` : ''}`
  const body = [
    `package: @datakable/core@${VERSION}`,
    `operation: ${d.op}`,
    `slot: ${d.slot ?? '-'}`,
    `error: ${d.errorName ?? '-'}`,
    '',
    'diagnostic.toJSON():',
    '',
    'table.explain():',
    '',
  ].join('\n')
  return `${ISSUES}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`
}

// Measured by intercept/chain.bench.ts (Apple M4 Pro, Node 25.2.1): one pass-through interceptor
// adds ~10 ns per call; spec §9.2 measured +15% when the same wrapping is done per cell.
export const HOT_COST =
  '~10 ns per call per interceptor (+15% on a per-cell format call, spec §9.2) on top of ' +
  'the interceptor body, which runs columns × pipeline runs times'

/** Message text (§8.2): development builds, or production via `@datakable/core/messages`. */
export const coreMessages: DiagnosticMessages<
  'DK_INTERCEPTOR_FAILED' | 'DK_HOT_INTERCEPTOR' | 'DK_OPERATION_CONFLICT' | 'DK_INTERNAL'
> = {
  DK_INTERCEPTOR_FAILED: {
    problem: (d) => `interceptor "${d.interceptor}" threw on ${d.op} (at ${d.slot})`,
    impact: () => 'the interceptor was skipped for this call; the operation ran without it',
    fix: (d) => [
      `catch errors inside "${d.interceptor}" and always return next() (or a valid result)`,
      `see context.cause for the original error`,
    ],
  },
  DK_HOT_INTERCEPTOR: {
    problem: (d) =>
      `interceptor "${d.interceptor}" is attached to hot op "${d.op}" without hot: true`,
    impact: () =>
      `it runs once per column per pipeline run; measured cost: ${HOT_COST}. ` +
      'It still runs (dev-only warning).',
    fix: (d) => [
      `set hot: true on "${d.interceptor}" to accept the cost, and never loop per cell inside it`,
      `attach "${d.interceptor}" to cold ops only (list them in \`on\` instead of '*' / '${d.op}')`,
    ],
  },
  DK_OPERATION_CONFLICT: {
    problem: (d) =>
      `operation "${d.op}" is already registered as ${d.previousKind}` +
      `${d.previousHot ? ' (hot)' : ''}; got ${d.kind}${d.hot ? ' (hot)' : ''}`,
    impact: () => 'the registration was rejected; the first one stays in effect',
    fix: (d) => [
      `register "${d.op}" with the same kind and hot flag (${d.previousKind}, hot: ${d.previousHot})`,
      `or give the new operation its own name, e.g. "myplugin:${d.op.split(':').pop()}"`,
    ],
  },
  DK_INTERNAL: {
    problem: (d) =>
      d.errorName
        ? `${d.errorName} thrown inside DataKable code during ${d.op}` +
          `${d.message === undefined ? '' : ` (message: ${String(d.message)})`} — likely a DataKable bug`
        : d.problem,
    impact: (d) => (d.fallback ? `${d.fallback}; the table keeps working` : 'the call was aborted'),
    fix: (d) => [
      `this is likely a DataKable bug or a plugin wiring error — report it: ${issueLink(d)}`,
      'attach diagnostic.toJSON() and table.explain() (both redacted) to the issue',
      'meanwhile, check plugins / interceptors registered on this operation',
    ],
  },
}

/** Codes owned by core plumbing (interceptor runtime, op registry). Features define their own. */
export const coreDiagnostics = [
  defineDiagnostic(
    {
      code: 'DK_INTERCEPTOR_FAILED',
      level: 'error',
      where: (d) => ({ kind: 'interceptor', name: d.interceptor, op: d.op }),
    },
    DEV && coreMessages.DK_INTERCEPTOR_FAILED,
  ),
  defineDiagnostic(
    {
      code: 'DK_HOT_INTERCEPTOR',
      level: 'warn',
      where: (d) => ({ kind: 'interceptor', name: d.interceptor, op: d.op }),
    },
    DEV && coreMessages.DK_HOT_INTERCEPTOR,
  ),
  defineDiagnostic(
    {
      code: 'DK_OPERATION_CONFLICT',
      level: 'error',
      config: true,
      where: (d) => ({ kind: 'operation', op: d.op }),
    },
    DEV && coreMessages.DK_OPERATION_CONFLICT,
  ),
  // Core invariants (unknown op, boundary installed twice) and throws that errorBoundary traced to
  // DataKable's own code (top stack frame in a datakable path).
  defineDiagnostic(
    {
      code: 'DK_INTERNAL',
      level: 'error',
      where: (d) =>
        d.slot ? { kind: 'operation', op: d.op, slot: d.slot } : { kind: 'operation', op: d.op },
      redact: { message: 'value' },
    },
    DEV && coreMessages.DK_INTERNAL,
  ),
]
