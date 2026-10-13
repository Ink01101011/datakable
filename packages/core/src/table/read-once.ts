import type { TableOptions } from './types'

/**
 * Options read once, at creation (§3.4): `setOptions` keeps their previous value. The option
 * validator (development) also reports a changed one as `DK_OPTION_NO_EFFECT`; a test pins this
 * list to the `once` rules of the table-options catalog.
 */
export const READ_ONCE: readonly (keyof TableOptions<unknown>)[] = [
  'name',
  'schema',
  'invalidRows',
  'features',
  'initialState',
  'timeout',
  'initialData',
  'strict',
  'diagnostics',
]

/** Restores in `next` the previous value of every read-once option `partial` sets. */
export function keepReadOnce(partial: object, next: object, previous: object): void {
  const n = next as Record<string, unknown>
  for (const k of READ_ONCE) {
    if (!(k in partial)) continue
    if (Object.hasOwn(previous, k)) n[k] = (previous as Record<string, unknown>)[k]
    else delete n[k]
  }
}
