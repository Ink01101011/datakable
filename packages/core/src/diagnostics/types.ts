import type { DiagnosticCode, DiagnosticDetails } from './catalog'

export type { DiagnosticCode, DiagnosticDetails } from './catalog'

export type DiagnosticLevel = 'error' | 'warn' | 'info'

export type Trigger = 'init' | 'data-change' | 'setOptions' | 'hydrate' | 'fetch' | `api:${string}`

export type Phase = 'ssr' | 'hydrate' | 'client'

/**
 * Where in the developer's code or data (§8.1). `interceptor` and `operation` are additions for
 * plugin-level codes the spec table does not locate (interceptors, op registry).
 */
export type Location =
  | { kind: 'column'; index: number; id: string }
  | { kind: 'feature'; name: string }
  | { kind: 'option'; path: string }
  | { kind: 'row'; index: number; key?: string }
  | { kind: 'interceptor'; name: string; op: string }
  | { kind: 'operation'; op: string; slot?: string }

/** A summary of table state — never raw input (§8.1). */
export interface DiagnosticStateSummary {
  searchLength: number
  activeFilters: string[]
  sort: string[]
  page: number
}

export interface DiagnosticContext {
  /** `options.name`, else `table#n`. */
  table: string
  /** Dev: creation site, e.g. `UsersPage.tsx:42`. */
  createdAt?: string
  /** `@datakable/core@x.y.z` */
  package: string
  trigger: Trigger
  /** Pipeline run id — joins explain() and other diagnostics. */
  run: number
  phase: Phase
  mode: Record<string, 'client' | 'server'>
  state: DiagnosticStateSummary
  occurrences: { count: number; first: number; last: number }
  /** e.g. `DK_SCHEMA_INVALID_ROW#run57` */
  causedBy?: string
  /** Original error (ES2022 cause). Reaches `onDiagnostic` only; `toJSON` and the console leave it out. */
  cause?: unknown
}

export interface Diagnostic {
  /** Stable public API; never reused or redefined. */
  code: DiagnosticCode
  level: DiagnosticLevel
  /** What happened, instance-specific. Empty in production unless messages are opted in. */
  problem: string
  where: Location
  /** Consequence + the fallback the system applied. */
  impact: string
  /** Concrete fixes, best first. */
  fix: string[]
  /** `docs/errors.md#<code>` (+ query params in production). */
  docs: string
  /** The catalog details. Redaction (T26) rewrites them before any sink sees them. */
  details: Record<string, unknown>
  context: DiagnosticContext
  /** `code@where` — grouping key (dedupe, Sentry). */
  fingerprint: string
  /** Safe serializer: bigint, cycles and Errors never throw; `context.cause` is left out. */
  toJSON(): object
}

/** Per-call additions to the live context. */
export interface EmitOptions {
  cause?: unknown
  causedBy?: string
  run?: number
  trigger?: Trigger
  phase?: Phase
  /**
   * Not printed by the default console sink (another table printed it in this process, #38). Still
   * stored and delivered to `onDiagnostic`.
   */
  quiet?: boolean
}

/** Emits a catalog diagnostic; `details` is typed by `code` (see `DiagnosticCatalog`). */
export type Emit = <C extends DiagnosticCode>(
  code: C,
  details: DiagnosticDetails<C>,
  options?: EmitOptions,
) => void
