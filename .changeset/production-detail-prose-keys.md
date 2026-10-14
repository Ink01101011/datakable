---
'@datakable/core': minor
'@datakable/react': minor
'datakable': minor
---

Smaller production bundles: diagnostic details that are sentences in development (`fallback`,
`reason`, `problem`, `expected`) are now short keys in production, e.g.
`fallback: 'cells-undefined'` instead of `'the failed cells read as undefined'`, or
`reason: 'page-size|10'` (a key and its arguments) instead of `'pageSize was replaced by 10'`.
Codes, `where`, levels and every other detail are unchanged, and development builds read exactly
as before. To get the sentences back in production, import the messages once in the app entry:
`import 'datakable/messages'` (or `@datakable/core/messages`); the details then read exactly as in
development. The keys are listed in `packages/core/src/diagnostics/prose.ts`.
