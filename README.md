# DataKable

Type-safe generic DataTable for React — zero-config by default, headless when you need it.

> Early development. API is being designed; nothing here is stable yet.

## Packages

| Package | Path | Purpose |
| --- | --- | --- |
| `datakable` | `packages/datakable` | Main entry — re-exports `@datakable/react`; `datakable/core` re-exports core |
| `@datakable/react` | `packages/react` | `useDataTable` hook + component (`"use client"` bundle) |
| `@datakable/core` | `packages/core` | Headless state / sort / filter / types, no React dependency |
| `@datakable/docs` | `apps/docs` | Vite playground (private) |

## Development

Requires Node `>=22.12` and pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm docs          # playground, resolves packages from source (HMR)
pnpm dev           # tsup --watch for all packages
pnpm test          # vitest: unit + type tests (*.test-d.ts), runs on source
pnpm build         # tsup → dual ESM/CJS + .d.ts/.d.cts
pnpm typecheck     # per-package tsc (needs `pnpm build` first — packages resolve each other via dist)
pnpm lint          # biome
pnpm check:pkg     # publint --strict + are-the-types-wrong
```

## Conventions

- **Build**: tsup, `format: ['esm','cjs']`, `exports` map with per-condition `types`, `sideEffects: false`.
- **TypeScript**: pinned to `~6.0`. TS 7 (native port) has no JS compiler API yet, which tsup's dts build needs.
- **Type tests**: put them in `*.test-d.ts` and use `expectTypeOf`. They are first-class, because type-safety is the product.
- **Versioning**: Changesets with a **fixed** group, so core/react/datakable always share one version.

## Releasing

1. `pnpm changeset` → describe the change → commit.
2. On `main`, the Release workflow opens a "Version Packages" PR; merging it publishes to npm.
3. Publishing uses **npm Trusted Publishing (OIDC)** with provenance, so no `NPM_TOKEN` secret is needed.
   Configure it per package on npmjs.com → Settings → Trusted Publisher (GitHub Actions, workflow `release.yml`).
   Each package must exist on npm first, so do the first publish of `@datakable/core` / `@datakable/react` manually with `--access public`.

## License

MIT © Supakit Kitjanabumrungsak
