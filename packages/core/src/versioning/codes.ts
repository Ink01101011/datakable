import { type DiagnosticMessages, defineDiagnostic } from '../diagnostics/catalog'
import { DEV } from '../diagnostics/env'
import type { Location } from '../diagnostics/types'
import { compareVersions, parseVersion } from './semver'

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_DEPRECATED: {
      /** `options.<path>` for an option, else the method, e.g. `table.setGlobalFilter`. */
      api: string
      since: string
      removeIn: string
      replacement: string
      codemod?: string
    }
    DK_DUPLICATE_CORE: {
      /** Versions of every registered core copy, in registration order (this copy last). */
      versions: string[]
    }
    DK_DUPLICATE_CORE_SAME_VERSION: {
      version: string
      /** Copies of core registered so far (this copy included), all of `version`. */
      copies: number
    }
    DK_VERSION_MISMATCH: {
      /** The fixed-group package whose version differs, e.g. `@datakable/react`. */
      package: string
      version: string
      /** This core's version. */
      core: string
    }
    DK_DEP_INCOMPATIBLE: {
      /** The feature that uses the capability. */
      feature: string
      dependency: string
      capability: string
      /** The dependency range DataKable supports. */
      supported: string
      /** What is used instead. */
      fallback: string
    }
    DK_FEATURE_INCOMPATIBLE: {
      feature: string
      /** `requires.core` of the feature. */
      required: string
      core: string
      /** `true` when `required` is not a semver range. */
      invalid: boolean
    }
  }
}

/** The fixed release group (§12): always published with one version. */
export const FIXED_GROUP = ['@datakable/core', '@datakable/react', 'datakable'] as const

const OPTIONS = 'options.'
const CREATE: Location = { kind: 'operation', op: 'createTable' }

/** The newer of two versions (unparseable ones lose). */
const newest = (a: string, b: string): string => {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa) return b
  if (!pb) return a
  return compareVersions(pa, pb) < 0 ? b : a
}

/** Message text (§8.2): development builds, or production via `@datakable/core/messages`. */
export const versioningMessages: DiagnosticMessages<
  | 'DK_DEPRECATED'
  | 'DK_DUPLICATE_CORE'
  | 'DK_DUPLICATE_CORE_SAME_VERSION'
  | 'DK_VERSION_MISMATCH'
  | 'DK_DEP_INCOMPATIBLE'
  | 'DK_FEATURE_INCOMPATIBLE'
> = {
  DK_DEPRECATED: {
    problem: (d) => `${d.api} is deprecated since ${d.since}`,
    impact: (d) =>
      `it still works in this version and is removed in ${d.removeIn}; this warning is shown ` +
      'once per session',
    fix: (d) => [
      `use ${d.replacement} instead`,
      ...(d.codemod ? [`run the codemod: ${d.codemod}`] : []),
    ],
  },
  DK_DUPLICATE_CORE: {
    problem: (d) =>
      `${d.versions.length} copies of @datakable/core are loaded (${d.versions.join(', ')}); ` +
      'features, interceptors and types from one copy do not match the other',
    impact: () =>
      'each table works with its own copy, but plugins built against the other copy may be ' +
      'ignored or fail instanceof / registry checks, and the bundle ships core twice',
    fix: () => [
      'find who pulls the second copy: pnpm why @datakable/core (npm ls @datakable/core / yarn why)',
      'dedupe it: pnpm dedupe (npm dedupe), and align @datakable/react and datakable to one version',
      'or force one version: "pnpm": { "overrides": { "@datakable/core": "<version>" } } in ' +
        'package.json (npm "overrides", yarn "resolutions")',
    ],
  },
  DK_DUPLICATE_CORE_SAME_VERSION: {
    problem: (d) =>
      `@datakable/core ${d.version} is loaded ${d.copies} times, all this version: its ESM and ` +
      "CJS builds, a bundler's layers (Next.js dev: RSC, SSR, route handlers), a hot reload, or " +
      'two installs of it',
    impact: () =>
      'tables work, each with its own copy; a DatakableError thrown by one copy is not an ' +
      'instanceof the classes of the other, and a browser bundle with both ships core twice',
    fix: () => [
      'compare errors by their .code (e.g. err.code === "DK_INVALID_OPTION"), not instanceof',
      'mixed import and require of @datakable/core in one Node process: use one of them',
      'in a browser bundle, find the second install: pnpm why @datakable/core, then pnpm dedupe',
    ],
  },
  DK_VERSION_MISMATCH: {
    problem: (d) =>
      `${d.package}@${d.version} is used with @datakable/core@${d.core}; ` +
      'these packages are released together and must have the same version',
    impact: () => 'it may work, but APIs and types between the two can disagree',
    fix: (d) => {
      const v = newest(d.version, d.core)
      return [
        `pnpm add ${FIXED_GROUP.map((p) => `${p}@${v}`).join(' ')} (install only the ones you use)`,
        `or with npm: npm install ${FIXED_GROUP.map((p) => `${p}@${v}`).join(' ')}`,
      ]
    },
  },
  DK_DEP_INCOMPATIBLE: {
    problem: (d) =>
      `${d.dependency} has no usable ${d.capability}; it was probably overridden to a version ` +
      `outside ${d.supported}`,
    impact: (d) => `feature "${d.feature}" uses ${d.fallback} instead; results stay correct`,
    fix: (d) => [
      `install a supported version: pnpm add ${d.dependency}@"${d.supported}" (check pnpm why ${d.dependency})`,
      `remove the override / resolution of ${d.dependency} from package.json`,
    ],
  },
  DK_FEATURE_INCOMPATIBLE: {
    problem: (d) =>
      d.invalid
        ? `feature "${d.feature}" declares requires.core "${d.required}", which is not a semver range`
        : `feature "${d.feature}" requires @datakable/core ${d.required}, but this is ${d.core}`,
    impact: () => 'the table was not created',
    fix: (d) =>
      d.invalid
        ? [
            `the feature author must set requires: { core: '^1.0' } (a semver range such as ` +
              `'^1.0', '>=1.2 <2' or '1.x')`,
            `meanwhile, remove feature "${d.feature}" from options.features`,
          ]
        : [
            `upgrade core: pnpm add @datakable/core@"${d.required}" (and @datakable/react / ` +
              'datakable to the same version)',
            `or use a version of feature "${d.feature}" that supports @datakable/core ${d.core}`,
          ],
  },
}

/** Codes owned by versioning (§8.5). */
export const versioningDiagnostics = [
  defineDiagnostic(
    {
      code: 'DK_DEPRECATED',
      level: 'warn',
      where: (d) =>
        d.api.startsWith(OPTIONS)
          ? { kind: 'option', path: d.api.slice(OPTIONS.length) }
          : { kind: 'operation', op: d.api },
    },
    DEV && versioningMessages.DK_DEPRECATED,
  ),
  defineDiagnostic(
    {
      code: 'DK_DUPLICATE_CORE',
      level: 'error',
      where: () => CREATE,
    },
    DEV && versioningMessages.DK_DUPLICATE_CORE,
  ),
  defineDiagnostic(
    {
      code: 'DK_DUPLICATE_CORE_SAME_VERSION',
      level: 'info',
      where: () => CREATE,
    },
    DEV && versioningMessages.DK_DUPLICATE_CORE_SAME_VERSION,
  ),
  defineDiagnostic(
    {
      code: 'DK_VERSION_MISMATCH',
      level: 'warn',
      where: () => CREATE,
    },
    DEV && versioningMessages.DK_VERSION_MISMATCH,
  ),
  defineDiagnostic(
    {
      code: 'DK_DEP_INCOMPATIBLE',
      level: 'warn',
      where: (d) => ({ kind: 'feature', name: d.feature }),
    },
    DEV && versioningMessages.DK_DEP_INCOMPATIBLE,
  ),
  defineDiagnostic(
    {
      code: 'DK_FEATURE_INCOMPATIBLE',
      level: 'error',
      config: true,
      where: (d) => ({ kind: 'feature', name: d.feature }),
    },
    DEV && versioningMessages.DK_FEATURE_INCOMPATIBLE,
  ),
]
