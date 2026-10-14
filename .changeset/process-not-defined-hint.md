---
'@datakable/core': patch
---

Loading `@datakable/core` where `process.env.NODE_ENV` was not replaced and `process` does not
exist (a page without a bundler: CDN, import map) now throws
`ReferenceError: [DataKable] process is not defined: replace process.env.NODE_ENV at build time …`
with the fix and a link to docs/how-to-fix/process-is-not-defined.md, instead of the engine's
bare `process is not defined` from an internal file. The check lives in a small module every
reader of the flag imports first; a production bundle removes it (bundle sizes unchanged), and
`pnpm build` now verifies the ESM and CJS builds throw this error without `process`. Fixes #36.
