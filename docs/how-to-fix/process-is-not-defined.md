# `process is not defined`

The browser throws `ReferenceError: process is not defined` when the page loads, from a
DataKable file. DataKable reads `process.env.NODE_ENV` so that a bundler can replace it with a
constant and remove development-only code from production builds — the same convention React and
Redux use. Code that reaches the browser without that replacement fails on the first read.

## Confirm: who runs the code unbundled?

The error comes from a setup that does not replace `process.env.NODE_ENV`:

- ES modules loaded straight from a CDN or an import map, with no bundler;
- esbuild without `--define`, Rollup without `@rollup/plugin-replace`, or a custom bundler
  pipeline;
- a test runner or a sandbox (a web worker, an iframe) that loads the source as is.

Vite, webpack and Next.js replace it with no setup. Node needs nothing: `process` exists there.

## Fix: replace it at build time

Tell the bundler the value. For a production build:

```sh
esbuild src/main.tsx --bundle --minify --define:process.env.NODE_ENV='"production"' --outfile=dist/main.js
```

With Rollup, add `@rollup/plugin-replace` with
`values: { 'process.env.NODE_ENV': JSON.stringify('production') }` and `preventAssignment: true`.
Use `"development"` for development builds: they keep the diagnostic text and the development
checks.

Without a bundler at all, define the value before the first module is loaded. The checks then run
as configured, but nothing is removed from what the browser downloads:

```html
<script>
  globalThis.process = { env: { NODE_ENV: 'production' } }
</script>
<script type="module" src="/main.js"></script>
```

## See also

- [The bundle is too big](bundle-too-big.md) — what a production build removes.
- [Diagnostics have no text in production](diagnostics-without-text-in-production.md)
- Guide: [the bundler requirement](../how-to-use/getting-started.md#bundler-requirement).
- [How to fix](README.md) — every symptom.
