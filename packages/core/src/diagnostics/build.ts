import { VERSION } from '../version'
import {
  type DiagnosticCode,
  type DiagnosticDefinition,
  type DiagnosticDetails,
  type DiagnosticText,
  getDiagnosticDefinition,
  getDiagnosticText,
  hasMessages,
} from './catalog'
import { coreDiagnostics } from './codes'
import { DEV } from './env'
import {
  type RedactField,
  type Redactor,
  redactDetails,
  redactLocation,
  resolveRedaction,
} from './redact'
import { toSafeJson } from './safe-json'
import type {
  Diagnostic,
  DiagnosticContext,
  DiagnosticLevel,
  DiagnosticStateSummary,
  Location,
  Phase,
  Trigger,
} from './types'

export const PACKAGE = `@datakable/core@${VERSION}`
const DOCS = 'https://github.com/Ink01101011/datakable/blob/main/docs/errors.md'

// Referencing the core entries keeps them in the bundle (`sideEffects: false`).
const INTERNAL = coreDiagnostics.find((d) => d.code === 'DK_INTERNAL') as DiagnosticDefinition

/** Everything the enrich step adds; all optional so a diagnostic can be built outside a table. */
export interface BuildInput {
  table?: string
  createdAt?: string
  trigger?: Trigger
  run?: number
  phase?: Phase
  mode?: Record<string, 'client' | 'server'>
  state?: DiagnosticStateSummary
  /** Timestamp for `occurrences`. Default `Date.now()`. */
  now?: number
  cause?: unknown
  causedBy?: string
  /** Build the problem / impact / fix text. Default: development builds only (§8.2); production
   * builds also build it once `@datakable/core/messages` is installed. */
  dev?: boolean
  /** Redaction policy (§8.2). Default: `'keys'` when `dev`, else `'safe'`. */
  redaction?: Redactor
}

export const defaultPhase = (): Phase => (typeof document === 'undefined' ? 'ssr' : 'client')

export function formatWhere(where: Location): string {
  switch (where.kind) {
    case 'column':
      return `columns[${where.index}] (id "${where.id}")`
    case 'feature':
      return `feature "${where.name}"`
    case 'option':
      return `options.${where.path}`
    case 'row':
      return where.key === undefined
        ? `row #${where.index}`
        : `row #${where.index} (key ${where.key})`
    case 'interceptor':
      return `interceptor "${where.name}" on ${where.op}`
    case 'operation':
      return where.slot ? `operation ${where.op} at ${where.slot}` : `operation ${where.op}`
  }
}

class DiagnosticRecord implements Diagnostic {
  constructor(
    public code: DiagnosticCode,
    public level: DiagnosticLevel,
    public problem: string,
    public where: Location,
    public impact: string,
    public fix: string[],
    public docs: string,
    public details: Record<string, unknown>,
    public context: DiagnosticContext,
    public fingerprint: string,
  ) {}

  toJSON(): object {
    const { cause: _cause, ...context } = this.context
    return {
      code: this.code,
      level: this.level,
      problem: this.problem,
      where: toSafeJson(this.where),
      impact: this.impact,
      fix: this.fix,
      docs: this.docs,
      details: toSafeJson(this.details),
      context: toSafeJson(context),
      fingerprint: this.fingerprint,
    }
  }
}

/**
 * Builds a diagnostic from a catalog code + details (the `enrich` step). Never throws for an unknown
 * code: that becomes `DK_INTERNAL`, so a typo in a plugin cannot take the logger down.
 */
export function buildDiagnostic<C extends DiagnosticCode>(
  code: C,
  details: DiagnosticDetails<C>,
  input: BuildInput = {},
): Diagnostic {
  let def = getDiagnosticDefinition(code)
  let d = details as Record<string, unknown>
  if (!def) {
    def = INTERNAL
    d = {
      op: 'diagnostic:emit',
      problem: `unknown diagnostic code "${code}": define it with defineDiagnostic() first`,
    }
  }
  const b = def as unknown as DiagnosticDefinition<'DK_INTERNAL'>
  const dev = input.dev ?? DEV
  // Redact first: `where`, the text builders, the fingerprint and the docs URL only ever see
  // redacted data, so no consumer downstream (interceptors, sinks, strict errors) can leak it.
  const r = input.redaction ?? resolveRedaction(undefined, dev)
  const where = redactLocation(b.where(d as DiagnosticDetails<'DK_INTERNAL'>), r)
  d = redactDetails(
    d,
    def.redact as Readonly<Record<string, RedactField | undefined>> | undefined,
    where,
    r,
  )
  const dd = d as DiagnosticDetails<'DK_INTERNAL'>
  // Text: development builds, or production with `@datakable/core/messages` installed (§8.2).
  const t =
    dev || hasMessages()
      ? (getDiagnosticText(def.code) as DiagnosticText<'DK_INTERNAL'> | undefined)
      : undefined
  const whereText = formatWhere(where)
  const now = input.now ?? Date.now()
  const context: DiagnosticContext = {
    table: input.table ?? '(global)',
    package: PACKAGE,
    trigger: input.trigger ?? 'init',
    run: input.run ?? 0,
    phase: input.phase ?? defaultPhase(),
    mode: input.mode ?? {},
    state: input.state ?? { searchLength: 0, activeFilters: [], sort: [], page: 0 },
    occurrences: { count: 1, first: now, last: now },
  }
  if (input.createdAt !== undefined) context.createdAt = input.createdAt
  if (input.causedBy !== undefined) context.causedBy = input.causedBy
  if (input.cause !== undefined) context.cause = input.cause
  let docs = def.docs ?? `${DOCS}#${def.code.toLowerCase()}`
  if (!dev) {
    const hash = docs.indexOf('#')
    const params = `?v=${VERSION}&where=${encodeURIComponent(whereText)}`
    docs = hash < 0 ? docs + params : docs.slice(0, hash) + params + docs.slice(hash)
  }
  return new DiagnosticRecord(
    def.code,
    def.level,
    t ? t.problem(dd) : '',
    where,
    t ? t.impact(dd) : '',
    t ? t.fix(dd) : [],
    docs,
    d,
    context,
    `${def.code}@${whereText}`,
  )
}

/** Thrown under `strict: true` for error-level diagnostics, and for core invariants (§8.2). */
export class DatakableError extends Error {
  override name = 'DatakableError'
  readonly code: DiagnosticCode
  readonly level: DiagnosticLevel
  readonly problem: string
  readonly where: Location
  readonly impact: string
  readonly fix: string[]
  readonly docs: string
  readonly diagnostic: Diagnostic

  constructor(d: Diagnostic) {
    const lines = [`${d.code}: ${d.problem || '(see docs)'}`, `  where   ${formatWhere(d.where)}`]
    d.fix.forEach((f, i) => {
      lines.push(`${i === 0 ? '  fix     ' : '          '}${i + 1}. ${f}`)
    })
    lines.push(`  docs    ${d.docs}`)
    super(lines.join('\n'), d.context.cause === undefined ? undefined : { cause: d.context.cause })
    this.code = d.code
    this.level = d.level
    this.problem = d.problem
    this.where = d.where
    this.impact = d.impact
    this.fix = d.fix
    this.docs = d.docs
    this.diagnostic = d
  }
}

/** Deterministic programmer errors thrown at creation (`error (config)` codes, §8.6). */
export class DatakableConfigError extends DatakableError {
  override name = 'DatakableConfigError'
}

export function throwConfigError<C extends DiagnosticCode>(
  code: C,
  details: DiagnosticDetails<C>,
  input?: BuildInput,
): never {
  throw new DatakableConfigError(buildDiagnostic(code, details, input))
}

/** A core invariant broke (unregistered op, boundary installed twice): `DK_INTERNAL`. */
export function internalError(op: string, problem: string): DatakableError {
  return new DatakableError(buildDiagnostic('DK_INTERNAL', { op, problem }))
}
