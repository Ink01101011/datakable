import type { Emit } from '../diagnostics/types'
import { globalEmit } from './global'
import { firstInSession } from './registry'

/** One deprecated API (§8.5). Keep `@deprecated` JSDoc on the API itself as well. */
export interface Deprecation {
  /** `options.<path>` for an option, else the method, e.g. `table.setGlobalFilter`. */
  readonly api: string
  /** Version that deprecated it. */
  readonly since: string
  /** Major that removes it (≥ 1 minor after `since`). */
  readonly removeIn: string
  /** What to use instead; the changeset must name it too. */
  readonly replacement: string
  /** Optional codemod command. */
  readonly codemod?: string
}

const REQUIRED = ['api', 'since', 'removeIn', 'replacement'] as const

/** Declares a deprecation (catalog entry, §3.5). Throws at definition time if a field is empty. */
export function defineDeprecation<const D extends Deprecation>(deprecation: D): Readonly<D> {
  for (const k of REQUIRED) {
    if (typeof deprecation[k] !== 'string' || deprecation[k] === '') {
      throw new Error(
        `[DataKable] defineDeprecation(${String(deprecation.api)}): "${k}" is required — ` +
          'deprecations carry since, removeIn and the replacement',
      )
    }
  }
  return Object.freeze({ ...deprecation })
}

/**
 * Reports `DK_DEPRECATED` once per API per session (shared by every core copy). Pass the table's
 * (or feature ctx's) `emit` so `onDiagnostic` sees it; without one it goes to the console.
 */
export function warnDeprecated(deprecation: Deprecation, emit: Emit = globalEmit): void {
  if (!firstInSession(`DK_DEPRECATED:${deprecation.api}`)) return
  const { api, since, removeIn, replacement, codemod } = deprecation
  emit('DK_DEPRECATED', {
    api,
    since,
    removeIn,
    replacement,
    ...(codemod === undefined ? {} : { codemod }),
  })
}
