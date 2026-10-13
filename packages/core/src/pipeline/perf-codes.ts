import { defineDiagnostic } from '../diagnostics/catalog'
import { DEV } from '../diagnostics/env'
import { envMessages } from './env-codes'

// Apart from env-codes.ts: only the tracer uses this definition, and the tracer is off in
// production unless installed (`interceptors: [tracer()]`), so a production bundle without it
// carries no DK_PERF_HINT.

/** `DK_PERF_HINT` (§8.3): a traced step over its budget (the tracer reports it). */
export const perfDiagnostics = [
  defineDiagnostic(
    {
      code: 'DK_PERF_HINT',
      level: 'info',
      where: (d) => ({ kind: 'feature', name: d.feature }),
    },
    DEV && envMessages.DK_PERF_HINT,
  ),
]
