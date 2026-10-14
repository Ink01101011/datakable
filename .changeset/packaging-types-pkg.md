---
'@datakable/core': patch
'@datakable/react': patch
'datakable': patch
---

Packaging and type-resolution fixes:

- The `./styles.css` exports of `datakable` and `@datakable/react` now carry a `types` condition
  (an empty declaration per module format), so `import 'datakable/styles.css'` type-checks under
  TypeScript 6, which checks side-effect imports by default. Fixes #34.
- A `typesVersions` fallback maps every subpath entry (`datakable/core`, `datakable/messages`,
  `@datakable/core/pagination`, …, and the stylesheets) for `moduleResolution: node10`, which ignores
  `exports`. Fixes #33.
- All three packages declare `engines.node: ">=18.18.0"` (the floor set by the runtime dependency
  `kk-debounce`; the code itself targets ES2022). Fixes #37.
- The minimum TypeScript version, 5.4 (the types use `NoInfer`), is now documented, and the
  published declarations are checked against it. Fixes #32.
- Every published `.js` / `.cjs` file carries exactly one `sourceMappingURL` comment (fixed in
  1.0.1, now checked on every build). Fixes #35.
