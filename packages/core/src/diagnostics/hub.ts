import { createContext } from '../intercept/context'
import type { InterceptorRuntime } from '../intercept/runtime'
import { buildDiagnostic, DatakableError, defaultPhase, formatWhere } from './build'
import type { DiagnosticCode, DiagnosticDetails } from './catalog'
import { createConsoleSink } from './console'
import { DEV } from './env'
import {
  DK_UNSAFE_REDACTION,
  type RedactionOptions,
  type RedactLevel,
  resolveRedaction,
} from './redact'
import { RingBuffer } from './ring-buffer'
import type { Diagnostic, DiagnosticStateSummary, EmitOptions, Phase, Trigger } from './types'

/** Live values the store supplies at emit time (T07+). Missing ones use defaults. */
export interface LiveDiagnosticContext {
  trigger?: Trigger
  run?: number
  phase?: Phase
  mode?: Record<string, 'client' | 'server'>
  state?: DiagnosticStateSummary
}

export interface DiagnosticsOptions {
  /** `options.name` of the table; default `table#n`. */
  name?: string
  /** The table instance, put on the `diagnostic:emit` ctx. */
  table?: unknown
  /** Dev: the table's creation site. */
  createdAt?: string
  getContext?: () => LiveDiagnosticContext
  /** Dedupe is per data reference: a new reference reports known diagnostics again. */
  getDataRef?: () => unknown
  /** User sink (e.g. Sentry). Throwing is swallowed with one console.error. */
  onDiagnostic?: (d: Diagnostic) => void
  /** Rethrow error-level diagnostics as `DatakableError`. */
  strict?: boolean
  /** Default console sink. Default `true`. */
  console?: boolean
  /** Text builders + dev console format. Default: `process.env.NODE_ENV !== 'production'`. */
  dev?: boolean
  /**
   * Redaction policy (§8.2, `diagnostics.redact`): a level or `{ level, redact(path, value),
   * sensitiveColumns, rowKeySensitive }`. Default `'keys'` in development, `'safe'` in production.
   * Applied while the diagnostic is built, so `diagnostic:emit` interceptors, the `redact` seam and
   * every sink only see redacted data. `'full'` in production warns (`DK_UNSAFE_REDACTION`).
   */
  redaction?: RedactLevel | RedactionOptions
  /**
   * Extra whole-diagnostic rewrite after the `diagnostic:emit` interceptors, before dedupe and
   * sinks. It receives already-redacted data; `fingerprint` is not recomputed.
   */
  redact?: (d: Diagnostic) => Diagnostic
  /** Ring buffer size behind getDiagnostics(). Default 100. */
  bufferSize?: number
  /** Max fingerprints remembered for dedupe. Default 500. */
  dedupeLimit?: number
  /** Console rate limit. Default 20 per 1000 ms. */
  rateLimit?: { max: number; windowMs: number }
  now?: () => number
}

export interface Diagnostics {
  /** Resolved table name (`context.table`). */
  readonly table: string
  /**
   * Emits a catalog diagnostic through `diagnostic:emit`. Returns the stored diagnostic (the
   * aggregated one on a dedupe hit), or `undefined` if an interceptor dropped it. Never throws,
   * except `DatakableError` under `strict: true`.
   */
  emit<C extends DiagnosticCode>(
    code: C,
    details: DiagnosticDetails<C>,
    options?: EmitOptions,
  ): Diagnostic | undefined
  /** Oldest first; at most `bufferSize` entries. */
  getDiagnostics(): Diagnostic[]
  /** Runs emits through this runtime's `diagnostic:emit` chain (user interceptors can redact/drop). */
  attach(runtime: InterceptorRuntime): void
  clear(): void
}

let tableSeq = 0

/**
 * One per table. Pipeline (§8.2): enrich + redact (build: context, policy redaction, then text,
 * where, fingerprint and docs from the redacted data) → `diagnostic:emit` interceptors → `redact`
 * seam → dedupe (aggregates `occurrences`) → ring buffer → sinks (onDiagnostic, console) → strict.
 */
export function createDiagnostics(options: DiagnosticsOptions = {}): Diagnostics {
  const table = options.name ?? `table#${++tableSeq}`
  const dev = options.dev ?? DEV
  const now = options.now ?? Date.now
  const dedupeLimit = options.dedupeLimit ?? 500
  const buffer = new RingBuffer<Diagnostic>(options.bufferSize ?? 100)
  const seen = new Map<string, Diagnostic>()
  const { onDiagnostic, getContext, getDataRef, redact, strict } = options
  const toConsole =
    options.console === false
      ? undefined
      : createConsoleSink({
          table,
          dev,
          now,
          rateLimit: options.rateLimit ?? { max: 20, windowMs: 1000 },
        })

  let runtime: InterceptorRuntime | undefined
  let depth = 0
  let lastRef: unknown
  let failed = false

  const fail = (e: unknown) => {
    // The logger never kills the table: one console.error, then silence.
    if (failed) return
    failed = true
    console.error(`[DataKable ${table}] diagnostics pipeline failed; later failures are silent`, e)
  }

  function deliver(input: Diagnostic): Diagnostic {
    const d = redact ? redact(input) : input
    if (getDataRef) {
      const ref = getDataRef()
      if (ref !== lastRef) {
        seen.clear()
        lastRef = ref
      }
    }
    const prev = seen.get(d.fingerprint)
    if (prev) {
      prev.context.occurrences.count++
      prev.context.occurrences.last = d.context.occurrences.last
      return prev
    }
    seen.set(d.fingerprint, d)
    if (seen.size > dedupeLimit) seen.delete(seen.keys().next().value as string)
    buffer.push(d)
    if (onDiagnostic) {
      try {
        onDiagnostic(d)
      } catch (e) {
        fail(e)
      }
    }
    toConsole?.(d)
    return d
  }

  // Resolved per emit: sensitive columns and the rowKey can change with setOptions.
  const redactor = () => {
    const r = resolveRedaction(options.redaction, dev)
    r.onError = fail
    return r
  }

  const emit: Diagnostics['emit'] = (code, details, opts = {}) => {
    let out: Diagnostic | undefined
    try {
      const live = getContext?.() ?? {}
      const d = buildDiagnostic(code, details, {
        table,
        ...(options.createdAt === undefined ? {} : { createdAt: options.createdAt }),
        trigger: opts.trigger ?? live.trigger ?? 'init',
        run: opts.run ?? live.run ?? 0,
        phase: opts.phase ?? live.phase ?? defaultPhase(),
        ...(live.mode ? { mode: live.mode } : {}),
        ...(live.state ? { state: live.state } : {}),
        now: now(),
        ...(opts.cause === undefined ? {} : { cause: opts.cause }),
        ...(opts.causedBy === undefined ? {} : { causedBy: opts.causedBy }),
        dev,
        redaction: redactor(),
      })
      // Emits made while the chain runs (e.g. DK_INTERCEPTOR_FAILED for an interceptor on
      // diagnostic:emit) skip the chain, so a broken logger cannot recurse.
      if (runtime && depth === 0) {
        const c = d.context
        const ctx = createContext('diagnostic:emit', { diagnostic: d }, formatWhere(d.where), {
          table: options.table,
          run: c.run,
          trigger: c.trigger,
          phase: c.phase,
          emit,
        })
        depth++
        try {
          runtime.run('diagnostic:emit', ctx, (x) => {
            out = deliver(x.input.diagnostic)
          })
        } finally {
          depth--
        }
      } else {
        out = deliver(d)
      }
    } catch (e) {
      // strict: an error-level emit nested in the chain (e.g. DK_INTERCEPTOR_FAILED) still throws.
      if (strict && e instanceof DatakableError) throw e
      fail(e)
      return undefined
    }
    if (strict && out?.level === 'error') throw new DatakableError(out)
    return out
  }

  if (!dev && resolveRedaction(options.redaction, dev).level === 'full') {
    emit(DK_UNSAFE_REDACTION.code, { level: 'full' })
  }

  return {
    table,
    emit,
    getDiagnostics: () => buffer.toArray(),
    attach(rt) {
      runtime = rt
    },
    clear() {
      buffer.clear()
      seen.clear()
    },
  }
}
