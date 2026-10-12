import { defineDiagnostic } from './catalog'

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
    DK_INTERNAL: { op: string; problem: string }
  }
}

const ISSUES = 'https://github.com/Ink01101011/datakable/issues/new'

// Measured by intercept/chain.bench.ts (Apple M4 Pro, Node 25.2.1): one pass-through interceptor
// adds ~10 ns per call; spec §9.2 measured +15% when the same wrapping is done per cell.
export const HOT_COST =
  '~10 ns per call per interceptor (+15% on a per-cell format call, spec §9.2) on top of ' +
  'the interceptor body, which runs columns × pipeline runs times'

/** Codes owned by core plumbing (interceptor runtime, op registry). Features define their own. */
export const coreDiagnostics = [
  defineDiagnostic({
    code: 'DK_INTERCEPTOR_FAILED',
    level: 'error',
    where: (d) => ({ kind: 'interceptor', name: d.interceptor, op: d.op }),
    problem: (d) => `interceptor "${d.interceptor}" threw on ${d.op} (at ${d.slot})`,
    impact: () => 'the interceptor was skipped for this call; the operation ran without it',
    fix: (d) => [
      `catch errors inside "${d.interceptor}" and always return next() (or a valid result)`,
      `see context.cause for the original error`,
    ],
  }),
  defineDiagnostic({
    code: 'DK_HOT_INTERCEPTOR',
    level: 'warn',
    where: (d) => ({ kind: 'interceptor', name: d.interceptor, op: d.op }),
    problem: (d) =>
      `interceptor "${d.interceptor}" is attached to hot op "${d.op}" without hot: true`,
    impact: () =>
      `it runs once per column per pipeline run; measured cost: ${HOT_COST}. ` +
      'It still runs (dev-only warning).',
    fix: (d) => [
      `set hot: true on "${d.interceptor}" to accept the cost, and never loop per cell inside it`,
      `attach "${d.interceptor}" to cold ops only (list them in \`on\` instead of '*' / '${d.op}')`,
    ],
  }),
  defineDiagnostic({
    code: 'DK_OPERATION_CONFLICT',
    level: 'error',
    config: true,
    where: (d) => ({ kind: 'operation', op: d.op }),
    problem: (d) =>
      `operation "${d.op}" is already registered as ${d.previousKind}` +
      `${d.previousHot ? ' (hot)' : ''}; got ${d.kind}${d.hot ? ' (hot)' : ''}`,
    impact: () => 'the registration was rejected; the first one stays in effect',
    fix: (d) => [
      `register "${d.op}" with the same kind and hot flag (${d.previousKind}, hot: ${d.previousHot})`,
      `or give the new operation its own name, e.g. "myplugin:${d.op.split(':').pop()}"`,
    ],
  }),
  // Minimal entry for core-internal invariants; T06 adds the classification and issue details.
  defineDiagnostic({
    code: 'DK_INTERNAL',
    level: 'error',
    where: (d) => ({ kind: 'operation', op: d.op }),
    problem: (d) => d.problem,
    impact: () => 'the call was aborted',
    fix: () => [
      'this is likely a DataKable bug or a plugin wiring error',
      `report it at ${ISSUES} with the diagnostic JSON`,
    ],
  }),
]
