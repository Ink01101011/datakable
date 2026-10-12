import type { BuildInput } from '@datakable/core'

/**
 * Examples for codes that no snippet can trigger in a test (T38): a second copy of core, a
 * production build, a DataKable bug, a dependency overridden at install time. Each is built with
 * the details its fault-injection test asserts (named per entry), through the real definition.
 */
export interface Fixture {
  /** Why a runnable example is not possible. */
  why: string
  details: Record<string, unknown>
  input?: Omit<BuildInput, 'table'>
}

export const FIXTURES: Record<string, Fixture> = {
  DK_DEP_INCOMPATIBLE: {
    why: 'needs exsorted overridden to a version without the API (versioning.test.ts)',
    details: {
      feature: 'sorting',
      dependency: 'exsorted',
      capability: 'timSort / mergeSort / radixSort / countingSort',
      supported: '^1.2.3',
      fallback: 'Array.prototype.sort (native, stable)',
    },
    input: { trigger: 'api:toggleSort', run: 1 },
  },
  DK_DUPLICATE_CORE: {
    why: 'needs two copies of @datakable/core in one bundle (versioning.test.ts loads core twice)',
    details: { versions: ['1.2.0', '1.3.1'] },
  },
  DK_HYDRATION_MISMATCH: {
    why: 'needs a server render, then a hydration whose state differs (react/src/hydrate.test.tsx)',
    details: { slices: ['sorting'] },
    input: { trigger: 'hydrate', phase: 'hydrate', run: 1 },
  },
  DK_INTERNAL: {
    why: 'a bug in DataKable itself (intercept/boundary.test.ts injects a throw from core code)',
    details: {
      op: 'state:dispatch',
      problem: '',
      slot: 'setState',
      errorName: 'TypeError',
      fallback: 'the update was dropped (state unchanged)',
      message: "Cannot read properties of undefined (reading 'by')",
    },
    input: { trigger: 'api:toggleSort', run: 3 },
  },
  DK_UNKNOWN: {
    why: 'a throw no classifier recognises (intercept/boundary.test.ts); stack paths decide it',
    details: {
      op: 'pipeline:step',
      slot: 'features.sorting',
      errorName: 'TypeError',
      fallback: 'the step passed its input through',
    },
    input: { trigger: 'api:toggleSort', run: 2 },
  },
  DK_UNSAFE_REDACTION: {
    why: "emitted only by a production build with diagnostics.redact 'full' (redact.test.ts)",
    details: { level: 'full' },
  },
  DK_VERSION_MISMATCH: {
    why: 'needs two installed versions of the release group (versioning.test.ts registers one)',
    details: { package: '@datakable/react', version: '1.3.0', core: '1.2.0' },
  },
}
