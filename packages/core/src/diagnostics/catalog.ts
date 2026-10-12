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
 * One catalog entry (§3.5, §8.3). The builders get the emitted details and must compute their text
 * from that real data. They run only in development (or with messages opted in), so keep them pure
 * and cheap; `where` runs always.
 */
export interface DiagnosticDefinition<C extends DiagnosticCode = DiagnosticCode> {
  readonly code: C
  readonly level: DiagnosticLevel
  /** `error (config)` codes: thrown as `DatakableConfigError` at creation (§8.6). */
  readonly config?: boolean
  where(details: DiagnosticDetails<C>): Location
  problem(details: DiagnosticDetails<C>): string
  /** Consequence + the fallback applied. */
  impact(details: DiagnosticDetails<C>): string
  /** Concrete fixes, best first; never empty. */
  fix(details: DiagnosticDetails<C>): string[]
  /** Overrides the default `docs/errors.md#<code>` URL. */
  readonly docs?: string
  /**
   * Detail fields that carry user data (row keys, cell values, schema issues, thrown errors), so
   * redaction (§8.2) rewrites them before `where`, the text builders or any sink see them. See
   * `RedactField`. Fields not listed are logged as-is.
   */
  readonly redact?: { readonly [K in keyof DiagnosticDetails<C>]?: RedactField }
}

const registry = new Map<string, DiagnosticDefinition>()

/**
 * Adds a code to the catalog and returns the definition. A code may be defined again only with the
 * same level (module re-evaluation); a code is never redefined with another meaning (§8.5).
 */
export function defineDiagnostic<const C extends DiagnosticCode>(
  definition: DiagnosticDefinition<C>,
): DiagnosticDefinition<C> {
  const prev = registry.get(definition.code)
  if (prev && prev.level !== definition.level) {
    throw new Error(
      `[DataKable] diagnostic code ${definition.code} is already defined as level ` +
        `"${prev.level}"; codes are never redefined — pick a new code`,
    )
  }
  registry.set(definition.code, definition as unknown as DiagnosticDefinition)
  return definition
}

export function getDiagnosticDefinition(code: string): DiagnosticDefinition | undefined {
  return registry.get(code)
}

export function listDiagnosticCodes(): string[] {
  return [...registry.keys()]
}
