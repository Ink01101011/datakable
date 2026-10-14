---
'@datakable/core': patch
---

Fix the false `DK_DUPLICATE_CORE` error when one installed version of `@datakable/core` is
evaluated more than once in a process: its ESM and CJS builds both loaded, the layers of a
Next.js dev server (RSC, SSR, route handlers), or a hot reload. With `strict: true` that error was
thrown (a Next.js route returned 500). `DK_DUPLICATE_CORE` is now reported only when the loaded
copies have different versions. Copies of one version report the new
`DK_DUPLICATE_CORE_SAME_VERSION`, an info shown once per session (development only, never thrown
by `strict`), which explains that `instanceof DatakableError` does not hold across the copies and
to compare `err.code` instead. Fixes #14.
