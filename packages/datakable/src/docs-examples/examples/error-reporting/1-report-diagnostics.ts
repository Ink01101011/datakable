import type { Diagnostic } from 'datakable'

/** The part of an error tracker this uses; `@sentry/browser`'s `captureMessage` fits. */
export interface ErrorTracker {
  captureMessage(
    message: string,
    context: {
      level: 'error' | 'warning'
      fingerprint: string[]
      tags: Record<string, string>
      extra: Record<string, unknown>
    },
  ): void
}

// One `onDiagnostic` sink for every table. Diagnostics reach it already redacted.
export function reportDiagnostics(tracker: ErrorTracker) {
  return (d: Diagnostic) => {
    if (d.level === 'info') return // tracer hints: development only
    tracker.captureMessage(`${d.code} in ${d.context.table}`, {
      level: d.level === 'error' ? 'error' : 'warning',
      fingerprint: [d.fingerprint], // `code@where`: one issue per problem and location
      tags: { code: d.code, table: d.context.table },
      extra: { diagnostic: d.toJSON() }, // code, where, fix, docs, redacted details, context
    })
  }
}
