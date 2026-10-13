import { keepDiagnostics } from '../diagnostics/catalog'
import type { InterceptorContext } from '../intercept/context'
import type { Interceptor } from '../intercept/define'
import { FALLBACK } from '../intercept/fallbacks'
import { asyncDiagnostics } from './codes'

keepDiagnostics(asyncDiagnostics)

/** Spec §7.1: a request that has not settled after 30 s is aborted (`DK_ASYNC_TIMEOUT`). */
export const DEFAULT_ASYNC_TIMEOUT = 30_000

/** Longest delay `setTimeout` honours; anything above it fires at once, so it means "no timer". */
const MAX_TIMER = 2_147_483_647

/**
 * `ctx.meta` key holding how an `async:request` ended. Callers apply the result only when it is
 * `'applied'`; every other status resolves with the caller's `FALLBACK` (the previous results).
 */
export const ASYNC_STATUS = 'datakable:asyncStatus'

/**
 * - `applied`: the callback's own result, from the latest request of its source.
 * - `superseded`: a newer request of the same source started (latest wins).
 * - `timeout`: `timeout` elapsed (`DK_ASYNC_TIMEOUT`).
 * - `aborted`: the caller's signal aborted, the callback rejected with an `AbortError`, or the table
 *   was destroyed. Not an error (§6.3).
 * - `error`: the callback failed; the rejection goes on to the errorBoundary.
 */
export type AsyncStatus = 'applied' | 'superseded' | 'timeout' | 'aborted' | 'error'

export interface AsyncControlOptions {
  /** ms before a request is aborted. Default 30 000; `Infinity` disables the timer. */
  timeout?: number
}

export type AsyncControl = Interceptor<'async:request' | 'table:destroy'>

type RequestCtx = InterceptorContext<'async:request'>

const abortReason = (status: AsyncStatus): DOMException =>
  status === 'timeout'
    ? new DOMException('The request timed out.', 'TimeoutError')
    : new DOMException(`The request was ${status}.`, 'AbortError')

const isAbortError = (e: unknown) =>
  e != null && typeof e === 'object' && (e as { name?: unknown }).name === 'AbortError'

/**
 * The `asyncControl` interceptor (§3.4, §6.3, §7.1). Create one per table (it holds that table's
 * in-flight requests) and install it first in the interceptor list, right inside the errorBoundary,
 * so inner interceptors and the core see the controlled `ctx.signal`.
 *
 * Per `async:request`: one AbortController (linked to the caller's `ctx.signal`), latest-wins per
 * `input.source`, a timeout. The `run` promise settles as soon as the outcome is known — a
 * superseded or timed-out request resolves with `FALLBACK` at once, and whatever its callback does
 * later (resolve or reject) is dropped, so a callback that ignores the signal can never apply a
 * stale result or cause an unhandled rejection. The outcome is `ctx.meta.get(ASYNC_STATUS)`.
 * `table:destroy` aborts every in-flight request.
 */
export function asyncControl(options: AsyncControlOptions = {}): AsyncControl {
  const timeout = options.timeout ?? DEFAULT_ASYNC_TIMEOUT
  /** source → how to end its in-flight request. */
  const inflight = new Map<string, (status: AsyncStatus) => void>()

  function request(ctx: RequestCtx, next: () => Promise<unknown>): Promise<unknown> {
    const source: string = ctx.input.source
    inflight.get(source)?.('superseded')
    const controller = new AbortController()
    const outer = ctx.signal
    ctx.signal = controller.signal

    return new Promise((resolve, reject) => {
      let done = false
      let timer: ReturnType<typeof setTimeout> | undefined

      const settle = (status: AsyncStatus) => {
        done = true
        if (timer !== undefined) clearTimeout(timer)
        outer?.removeEventListener('abort', onOuterAbort)
        if (inflight.get(source) === end) inflight.delete(source)
        ctx.meta.set(ASYNC_STATUS, status)
      }
      /** Ends the request without its result: abort it and keep the previous results. */
      const end = (status: AsyncStatus) => {
        if (done) return
        settle(status)
        controller.abort(abortReason(status))
        if (status === 'timeout') {
          ctx.emit(
            'DK_ASYNC_TIMEOUT',
            { source, timeout },
            { run: ctx.run, trigger: ctx.trigger, phase: ctx.phase },
          )
        }
        resolve(ctx.meta.get(FALLBACK))
      }
      function onOuterAbort() {
        end('aborted')
      }

      inflight.set(source, end)
      if (outer?.aborted) return end('aborted')
      outer?.addEventListener('abort', onOuterAbort, { once: true })
      if (timeout > 0 && timeout <= MAX_TIMER) timer = setTimeout(() => end('timeout'), timeout)

      let out: Promise<unknown>
      try {
        out = next()
      } catch (e) {
        if (done) return
        settle('error')
        return reject(e)
      }
      Promise.resolve(out).then(
        (value) => {
          if (done) return
          settle('applied')
          resolve(value)
        },
        (e: unknown) => {
          if (done) return
          if (isAbortError(e)) return end('aborted')
          settle('error')
          reject(e)
        },
      )
    })
  }

  return {
    name: 'asyncControl',
    on: ['async:request', 'table:destroy'],
    intercept(ctx, next) {
      if (ctx.op === 'table:destroy') {
        for (const end of [...inflight.values()]) end('aborted')
        return next()
      }
      return request(ctx, next as () => Promise<unknown>) as never
    },
  }
}
