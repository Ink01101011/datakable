// No @types/node in core: declare just what is read.
declare const process: { env: { NODE_ENV?: string } }

/*
 * Code run without a bundler (CDN, import map) has no `process`: say so and name the fix, instead
 * of the engine's bare "process is not defined" (#36).
 *
 * Every module that reads `DEV` imports this module first (the build rewrites `import { DEV } from
 * './env'` to `import './process-guard'`, see scripts/preserve-modules.mjs), so it is evaluated
 * before any `process.env.NODE_ENV` read. It is listed in `sideEffects`, so a bundler run without
 * the replacement (esbuild without --define) keeps it too. Once `process.env.NODE_ENV` is replaced
 * with a literal the `try` body is empty and a minifier removes the statement: production bundles
 * pay nothing (`pnpm check:size`).
 */
try {
  process.env.NODE_ENV
} catch {
  throw new ReferenceError(
    '[DataKable] process is not defined: replace process.env.NODE_ENV at build time (e.g. ' +
      `esbuild --define:process.env.NODE_ENV='"production"'), or set globalThis.process = ` +
      "{ env: { NODE_ENV: 'production' } } before DataKable loads. See " +
      'https://github.com/Ink01101011/datakable/blob/main/docs/how-to-fix/process-is-not-defined.md',
  )
}

// A module, not a script: keeps the `process` declaration above local to this file.
export {}
