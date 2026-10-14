import { defineDiagnostic } from '../diagnostics/catalog'
import { DEV } from '../diagnostics/env'

/** What a callback slot must return: a type, or `'sync'` (anything but a thenable). */
export type SlotReturns = 'string' | 'number' | 'boolean' | 'sync'

/** A callback return contract (§3.5): read by the slot checks to report `DK_CALLBACK_BAD_RETURN`. */
export interface SlotDefinition {
  /** The slot name, as in `columns[i].<name>` (`format`, `cell`). */
  readonly name: string
  readonly returns: SlotReturns
  /** What DataKable does with a bad return (the diagnostic's impact). */
  readonly fallback?: string
}

const slots = new Map<string, SlotDefinition>()

/**
 * Adds a callback return contract to the slot catalog and returns it. Like a diagnostic code, a slot
 * is never redefined with another contract (module re-evaluation with the same one is fine).
 */
export function defineSlot<const S extends SlotDefinition>(slot: S): S {
  const prev = slots.get(slot.name)
  // Development check: slots are fixed at build time, a production bundle skips it.
  if (DEV && prev && prev.returns !== slot.returns) {
    throw new Error(
      `[DataKable] slot "${slot.name}" is already defined to return ${prev.returns}; ` +
        'a slot contract is never redefined — pick a new slot name',
    )
  }
  slots.set(slot.name, slot)
  return slot
}

export function getSlot(name: string): SlotDefinition | undefined {
  return slots.get(name)
}

const isThenable = (v: unknown) =>
  v != null &&
  (typeof v === 'object' || typeof v === 'function') &&
  typeof (v as { then?: unknown }).then === 'function'

/** Whether `value` meets the slot's contract. */
export function matchesSlot(slot: Pick<SlotDefinition, 'returns'>, value: unknown): boolean {
  return slot.returns === 'sync' ? !isThenable(value) : typeof value === slot.returns
}

const article = (word: string) => (/^[AEIOUaeiou]/.test(word) ? `an ${word}` : `a ${word}`)

/** The type of a returned value in words (`a number`, `an Array`, `a Promise`); never the value. */
export function describeReturn(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  const type = typeof value
  if (type !== 'object' && type !== 'function') return article(type)
  if (Array.isArray(value)) return 'an Array'
  if (isThenable(value)) return 'a Promise'
  const proto = Object.getPrototypeOf(value) as { constructor?: { name?: unknown } } | null
  const name = proto?.constructor?.name
  return typeof name === 'string' && name !== '' ? article(name) : article(type)
}

const expectedText: Record<SlotReturns, string> = {
  string: 'a string',
  number: 'a number',
  boolean: 'a boolean',
  sync: 'a value (not a Promise)',
}

/** `expected` of a `DK_CALLBACK_BAD_RETURN` for `slot`. */
export const expectedReturn = (slot: Pick<SlotDefinition, 'returns'>) => expectedText[slot.returns]

/** `columns[i].format` (§4.1): its value is coerced with the default formatter when not a string. */
export const formatSlot = defineSlot({
  name: 'format',
  returns: 'string',
  fallback: 'cells-coerced', // prose key (diagnostics/prose.ts)
})

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_CALLBACK_BAD_RETURN: {
      /** The callback's option path, e.g. `columns[2].format`. */
      slot: string
      /** Column id, for cell slots. */
      column?: string
      /** The contract, in words (`a string`). */
      expected: string
      /** The type of the first bad return (`a number`); never the value. */
      received: string
      /** How many calls returned a bad value. */
      count: number
      /** A sample of the row indices (first few, in order). */
      rows?: readonly number[]
      /** The fallback that was applied. */
      fallback: string
    }
  }
}

const rowList = (rows: readonly number[] | undefined, count: number) => {
  if (!rows || rows.length === 0) return ''
  const list = rows.map((r) => `#${r}`).join(', ')
  return ` (${count > rows.length ? `first: ${list}, …` : `rows ${list}`})`
}

/**
 * The slot contract check (§3.4 `slotContract`). Dev only: the definition, its text and every call
 * site sit behind `DEV`, so a production bundle has none of it. It runs inside the existing
 * `column:batch` loop (per batch, never an interceptor per cell).
 */
export const slotDiagnostics = DEV
  ? [
      defineDiagnostic({
        code: 'DK_CALLBACK_BAD_RETURN',
        level: 'warn',
        where: (d) => ({ kind: 'option', path: d.slot }),
        problem: (d) =>
          `${d.slot}${d.column === undefined ? '' : ` (column "${d.column}")`} returned ` +
          `${d.received} instead of ${d.expected} for ` +
          `${d.count === 1 ? '1 row' : `${d.count} rows`}${rowList(d.rows, d.count)}`,
        impact: (d) => d.fallback,
        fix: (d) => [
          d.expected === 'a string'
            ? `return a string from ${d.slot}, e.g. (v) => String(v) or (v) => v.toFixed(2)`
            : `return ${d.expected} from ${d.slot}`,
          `if ${d.slot} is async or returns markup, compute the value before the table ` +
            '(or render it with cell)',
        ],
      }),
    ]
  : []
