import { DEV } from './env'
import type { RedactField } from './redact'
import type { DiagnosticLevel, Location } from './types'

/**
 * Code → details type, one entry per diagnostic code. Open for declaration merging, like
 * `Operations`: the module that owns a code declares its details next to its `defineDiagnostic`
 * (`declare module '@datakable/core' { interface DiagnosticCatalog { DK_X: {...} } }`).
 */
// biome-ignore lint/suspicious/noEmptyInterface: filled by declaration merging
export interface DiagnosticCatalog {}

export type DiagnosticCode = keyof DiagnosticCatalog & string
export type DiagnosticDetails<C extends DiagnosticCode> = DiagnosticCatalog[C]

/**
 * The human-readable half of a catalog entry (§8.2). The builders get the emitted details and must
 * compute their text from that real data. They run only in development, or in production after
 * `import '@datakable/core/messages'` (`datakable/messages`), so keep them pure and cheap.
 */
export interface DiagnosticText<C extends DiagnosticCode = DiagnosticCode> {
  problem(details: DiagnosticDetails<C>): string
  /** Consequence + the fallback applied. */
  impact(details: DiagnosticDetails<C>): string
  /** Concrete fixes, best first; never empty. */
  fix(details: DiagnosticDetails<C>): string[]
}

/** Text for several codes, keyed by code (one object per owning module). */
export type DiagnosticMessages<C extends DiagnosticCode> = { readonly [K in C]: DiagnosticText<K> }

/**
 * One catalog entry (§3.5, §8.3). `where` runs always; the text builders (`DiagnosticText`) only in
 * development or with messages opted in.
 */
export interface DiagnosticDefinition<C extends DiagnosticCode = DiagnosticCode>
  extends DiagnosticText<C> {
  readonly code: C
  readonly level: DiagnosticLevel
  /** `error (config)` codes: thrown as `DatakableConfigError` at creation (§8.6). */
  readonly config?: boolean
  where(details: DiagnosticDetails<C>): Location
  /** Overrides the default `docs/errors.md#<code>` URL. */
  readonly docs?: string
  /**
   * Detail fields that carry user data (row keys, cell values, schema issues, thrown errors), so
   * redaction (§8.2) rewrites them before `where`, the text builders or any sink see them. See
   * `RedactField`. Fields not listed are logged as-is.
   */
  readonly redact?: { readonly [K in keyof DiagnosticDetails<C>]?: RedactField }
}

/** A definition without its text: the part a production bundle keeps. */
export type DiagnosticMeta<C extends DiagnosticCode = DiagnosticCode> = Omit<
  DiagnosticDefinition<C>,
  keyof DiagnosticText
>

const registry = new Map<string, DiagnosticDefinition>()

/**
 * Adds a code to the catalog and returns the definition. A code may be defined again only with the
 * same level (module re-evaluation); a code is never redefined with another meaning (§8.5).
 *
 * Core passes the text separately as `DEV && messages.DK_X` (§8.2): a production bundle folds that
 * to `false`, drops the module's message object, and keeps only `code`, `level`, `where` and
 * `redact`. The same message object is what `@datakable/core/messages` installs.
 */
export function defineDiagnostic<const C extends DiagnosticCode>(
  definition: DiagnosticDefinition<C>,
): DiagnosticDefinition<C>
export function defineDiagnostic<const C extends DiagnosticCode>(
  meta: DiagnosticMeta<C>,
  text: DiagnosticText<C> | false,
): DiagnosticDefinition<C>
export function defineDiagnostic<const C extends DiagnosticCode>(
  meta: DiagnosticMeta<C> & Partial<DiagnosticText<C>>,
  text?: DiagnosticText<C> | false,
): DiagnosticDefinition<C> {
  const definition = (text ? { ...meta, ...text } : meta) as DiagnosticDefinition<C>
  // Development check: codes are fixed at build time, a production bundle skips it.
  const prev = DEV ? registry.get(definition.code) : undefined
  if (DEV && prev && prev.level !== definition.level) {
    throw new Error(
      `[DataKable] diagnostic code ${definition.code} is already defined as level ` +
        `"${prev.level}"; codes are never redefined — pick a new code`,
    )
  }
  registry.set(definition.code, definition as unknown as DiagnosticDefinition)
  return definition
}

const messages = new Map<string, DiagnosticText>()

/**
 * Installs full message text for production builds (§8.2); called by `@datakable/core/messages`.
 * Development builds already carry the text on each definition.
 */
export function installMessages(...all: ReadonlyArray<Readonly<Record<string, unknown>>>): void {
  for (const m of all) {
    for (const code of Object.keys(m)) messages.set(code, m[code] as DiagnosticText)
  }
}

/** `true` once `installMessages` ran: production diagnostics then build their text too. */
export const hasMessages = (): boolean => messages.size > 0

/** The text builders for a code: from its definition (development) or installed messages. */
export function getDiagnosticText(code: string): DiagnosticText | undefined {
  const def = registry.get(code)
  return def && typeof def.problem === 'function' ? def : messages.get(code)
}

/**
 * Uses the definitions of the codes a module emits, so a bundler keeps them. `@datakable/core` is
 * built one file per module with `sideEffects: false`: a codes module that is only referenced
 * (`void defs`) is dropped from a consumer's bundle together with its `defineDiagnostic` calls, and
 * the codes would then emit as unknown. Call this at the top level of the emitting module. It
 * (re-)registers the definitions, which is idempotent. `pnpm check:catalog` verifies it per bundle.
 */
export function keepDiagnostics(
  ...lists: ReadonlyArray<readonly { readonly code: string }[]>
): void {
  for (const list of lists) {
    for (const def of list) registry.set(def.code, def as unknown as DiagnosticDefinition)
  }
}

export function getDiagnosticDefinition(code: string): DiagnosticDefinition | undefined {
  return registry.get(code)
}

export function listDiagnosticCodes(): string[] {
  return [...registry.keys()]
}
