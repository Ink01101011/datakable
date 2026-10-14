# Diagnostics have no text in production

In production, the console shows one line per error such as `[DataKable table#1] DK_FETCH_FAILED
at options.fetcher — https://…`, and `onDiagnostic` receives diagnostics whose `problem`,
`impact` and `fix` are empty. That is by design: the message text is development-only, to keep
the production bundle small.

## What production keeps

A production diagnostic keeps its `code`, `level`, `where`, `context` and `docs` URL; the URL
carries the version and `where` (`?v=<version>&where=options.fetcher`) and opens the code's
section in the [diagnostics reference](errors.md). The console prints **error** level only, on
one line:

```text
[DataKable table#1] DK_FETCH_FAILED at options.fetcher — https://github.com/Ink01101011/datakable/blob/main/docs/errors.md?v=<version>&where=options.fetcher#dk_fetch_failed
```

That is usually enough to group errors in a logger and look them up:

```ts
import { createTable, type Diagnostic, type FetchResult, pagination, withFetcher } from 'datakable'

type User = { id: number; name: string }
declare const logger: { error(message: string, data: object): void }

// Production diagnostics always keep code, level, where, context and the docs URL (which carries
// the version and `where`): enough to group and look up an error without the text. toJSON() is a
// safe serialisation (no original error, no cycles).
const report = (d: Diagnostic) => {
  if (d.level === 'error') logger.error(d.code, d.toJSON())
}

export const table = createTable({
  rowKey: 'id',
  features: [pagination({ mode: 'server' })],
  fetcher: withFetcher(async (): Promise<FetchResult<User>> => {
    throw new TypeError('Failed to fetch')
  }),
  onDiagnostic: report,
})
```

Some codes are never emitted in production at all (development-only checks such as
`DK_UNSTABLE_COLUMNS`, the option validator, the version checks); the list is in
[production builds](errors.md#production-builds).

## Fix: keep the text

Import the messages once in the app entry. Every diagnostic then has its full text in production,
in `onDiagnostic` and `toJSON()`; it adds the message text to your bundle.

```ts
// In the app entry (main.tsx, the pages router's _app.tsx, …), once, before any table is created.
// Production builds then keep the full problem / impact / fix text of every diagnostic.
import 'datakable/messages'
```

With `@datakable/core` alone, import `@datakable/core/messages` instead.

The import must be in a module of the bundle that creates the tables: the browser bundle for
tables in client components, the server bundle for tables created on the server.

### Next.js app router

`app/layout.tsx` is a server component: an import there runs only in the server bundle, so the
tables of client components still have no text in the browser. Import the messages in a
`'use client'` module and render it once from the root layout:

```tsx
'use client'
// app/datakable-messages.tsx — a client module: the import reaches the browser bundle (and the
// server render of client components). An import in app/layout.tsx, a server component, does not.
import 'datakable/messages'

export function DatakableMessages() {
  return null
}
```

```tsx
// app/layout.tsx — the root layout (a server component) renders the client module once.
import type { ReactNode } from 'react'
import { DatakableMessages } from './3-datakable-messages' // './datakable-messages' in your app

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DatakableMessages />
        {children}
      </body>
    </html>
  )
}
```

A table created in a server component (`createTable` in server code) needs the import in a server
module too: add `import 'datakable/messages'` to the module that creates it. With the pages
router, `pages/_app.tsx` is shared by the server and the browser, and one import there covers both.

## Related codes

Every code: see the [diagnostics reference](errors.md#index).
[`DK_UNSAFE_REDACTION`](errors.md#dk_unsafe_redaction) is the one code only production reports.

## See also

- [Where diagnostics go](errors.md#where-diagnostics-go) — sinks, redaction, rate limits.
- [`process is not defined`](process-is-not-defined.md) — how a build becomes a production build.
- Guide: [diagnostics](../how-to-use/diagnostics.md).
- [Report diagnostics to an error tracker](../examples/error-reporting.md) — the recipe.
- [How to fix](README.md) — every symptom.
