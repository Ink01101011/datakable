/**
 * A user callback threw. Core code calls user callbacks through {@link callUser} (or throws this
 * itself) so the errorBoundary can report `DK_CALLBACK_FAILED` with the slot as `where` (§8.6).
 */
export class CallbackError extends Error {
  override name = 'CallbackError'
  constructor(
    /** Option path of the callback, e.g. `columns[2].sortFn`, `fetcher`. */
    readonly slot: string,
    cause: unknown,
    /** Row index the callback ran for, if any. */
    readonly row?: number,
  ) {
    super(`${slot} threw`, { cause })
  }
}

/**
 * Calls a user callback on a cold path; a throw becomes a {@link CallbackError} carrying the slot.
 * Hot per-cell loops use `runCells` (cell-batch.ts) instead, which never throws per cell.
 */
export function callUser<A, R>(slot: string, fn: (arg: A) => R, arg: A, row?: number): R {
  try {
    return fn(arg)
  } catch (e) {
    throw new CallbackError(slot, e, row)
  }
}

export type ErrorClass = 'DK_CALLBACK_FAILED' | 'DK_INTERNAL' | 'DK_UNKNOWN'

/**
 * A stack frame in DataKable's own code: the `@datakable/*` packages (also their bundled chunks and
 * CDN URLs), `node_modules/datakable/`, and Vite optimized deps (`.vite/deps/@datakable_core.js`,
 * `.vite/deps/datakable.js`). A user folder named `datakable*` is not DataKable code. A Vite shared
 * chunk (`.vite/deps/chunk-*.js`) or an app bundle that inlined DataKable cannot be attributed.
 */
const OWN_FRAME =
  /@datakable[\\/_]|[\\/]node_modules[\\/]datakable[\\/]|[\\/]\.vite[\\/]deps[\\/]datakable[._]/i
/** A stack line that is a frame: V8 `    at fn (file:1:2)` or SpiderMonkey/JSC `fn@file:1:2`. */
const FRAME = /:\d+:\d+\)?\s*$/

/** The first stack frame of `error`, or `undefined` when there is none. */
export function topFrame(error: unknown): string | undefined {
  const stack = (error as { stack?: unknown } | null | undefined)?.stack
  if (typeof stack !== 'string') return undefined
  for (const line of stack.split('\n')) if (FRAME.test(line)) return line
  return undefined
}

/**
 * Classifies an error caught by the errorBoundary (§8.6): a wrapped user callback →
 * `DK_CALLBACK_FAILED`; thrown from DataKable code (top frame) → `DK_INTERNAL`; else `DK_UNKNOWN`.
 */
export function classifyError(error: unknown): ErrorClass {
  if (error instanceof CallbackError) return 'DK_CALLBACK_FAILED'
  const frame = topFrame(error)
  return frame !== undefined && OWN_FRAME.test(frame) ? 'DK_INTERNAL' : 'DK_UNKNOWN'
}

/** `error.name` (safe to log); the message may embed user values (§8.2). */
export function errorName(error: unknown): string | undefined {
  if (error instanceof Error) return error.name
  if (error === null) return 'null'
  return typeof error === 'object' ? 'non-Error object' : `non-Error ${typeof error}`
}
