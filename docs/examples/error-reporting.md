# Report diagnostics to an error tracker, redacted

Every problem DataKable detects is a diagnostic with a stable `DK_*` code, a location and a fix.
In production you want the serious ones in your error tracker (Sentry, Bugsnag, Datadog, …),
grouped by problem, and without your users' data in them.

## Goal

Send error- and warning-level diagnostics from every table to a Sentry-style tracker, one issue per
problem and location, with sensitive values never leaving the browser.

## The code

The sink, shared by all your tables:

```ts
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
```

A table that uses it:

```ts
import { createTable } from 'datakable'
import { type ErrorTracker, reportDiagnostics } from './1-report-diagnostics' // './report-diagnostics'

type Customer = { id: number; name: string; email: string }

export function customersTable(customers: Customer[], tracker: ErrorTracker) {
  return createTable({
    name: 'CustomersTable', // names the table in every diagnostic
    data: customers,
    rowKey: 'id',
    columns: [{ key: 'name' }, { key: 'email', sensitive: true }], // never logged, at any level
    // 'safe' (the production default): paths, indices, counts, value types, hashed row keys.
    diagnostics: { redact: 'safe' },
    onDiagnostic: reportDiagnostics(tracker),
  })
}
```

## What you will see

With two customers sharing `id: 1`, the tracker receives one message:

- `DK_DUPLICATE_ROW_KEY in CustomersTable`, level `error`, fingerprint
  `DK_DUPLICATE_ROW_KEY@…` (the code and the location), tagged with the code and the table name.
- `extra.diagnostic` holds the code, `where`, `fix`, the `docs` URL, the context (table, trigger,
  run, phase) and the details, redacted at `'safe'`: row keys hashed, values reduced to their
  types. No name or email appears in it, and the `email` column is never logged at any level
  (`sensitive: true`).
- A repeat of the same problem on the same data does not reach the sink again: it is counted on
  the first diagnostic (`context.occurrences`). Across data changes, the fingerprint groups the
  repeats into one issue in the tracker.

## Variations

- **With `@sentry/browser`:** `reportDiagnostics(Sentry)` works as is. To attach the original
  error of a failed fetch, call `Sentry.captureException(d.context.cause)` when it is set:
  `toJSON()` leaves `cause` out, and the fetch error is otherwise logged by name only.
- **A custom redaction rule:** `diagnostics: { redact: (path, value) => … }` returns the string to
  log instead of `value`, or `undefined` for the built-in policy; `path` names the field
  (`where.key`, `details.value`, …).
- **Full text in production:** production builds keep `code`, `where`, `context` and the docs URL
  but drop the `problem` / `impact` / `fix` text; `import 'datakable/messages'` once in your app
  entry keeps it.
- **Fail fast in tests:** `strict: true` throws `DatakableError` on error-level diagnostics.
- **Find the cause yourself:** `table.getDiagnostics()` keeps the last 100; `table.explain()` and
  `table.explainRow(key)` show where rows went.

## See also

- [Diagnostics](../../packages/core/README.md#diagnostics) in `@datakable/core` — sinks, levels
  and redaction.
- [Diagnostics in production](../../packages/datakable/README.md#diagnostics-in-production).
- [How to fix](../how-to-fix/README.md) — what each `DK_*` code means.
- [Examples](README.md)
