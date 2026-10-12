/**
 * Diagnostics (spec §8). Every error / warning DataKable reports is a catalog code.
 *
 * Adding a code (in the module that owns it):
 *
 * ```ts
 * declare module '../diagnostics/catalog' {          // '@datakable/core' outside core
 *   interface DiagnosticCatalog {
 *     DK_DUPLICATE_ROW_KEY: { key: string; rows: number[]; column: string }
 *   }
 * }
 * export const DK_DUPLICATE_ROW_KEY = defineDiagnostic({
 *   code: 'DK_DUPLICATE_ROW_KEY',
 *   level: 'error',
 *   where: (d) => ({ kind: 'row', index: d.rows[0] ?? 0, key: d.key }),  // always runs
 *   problem: (d) => `rowKey "${d.column}" is not unique`,                 // dev-only text
 *   impact: (d) => `rendered with fallback keys ${d.key}#1, ${d.key}#2`,
 *   fix: (d) => [`rowKey: 'uuid'`, `rowKey: (row) => \`\${row.${d.column}}-…\``],
 * })
 * ```
 *
 * Emitting: `ctx.emit('DK_DUPLICATE_ROW_KEY', { key, rows, column })` inside an interceptor or
 * feature (details are type-checked against the catalog), or `diagnostics.emit(...)` on the
 * table's hub. Pass `{ cause }` for the original error. Data and runtime problems never throw;
 * `error (config)` codes are thrown at creation with `throwConfigError(code, details)`.
 *
 * Reference the exported definition from the emitting module so bundlers keep it
 * (`sideEffects: false`).
 *
 * Redaction (§8.2): declare every detail field that carries user data on the definition, e.g.
 * `redact: { key: 'rowKey', value: 'value', issues: 'schemaIssues', error: 'error' }`. The builders
 * then receive redacted values, and `where`, fingerprint and docs URL are built after redaction.
 */
export {
  type BuildInput,
  buildDiagnostic,
  DatakableConfigError,
  DatakableError,
  formatWhere,
  throwConfigError,
} from './build'
export {
  type DiagnosticCatalog,
  type DiagnosticDefinition,
  defineDiagnostic,
  getDiagnosticDefinition,
  listDiagnosticCodes,
} from './catalog'
export { coreDiagnostics } from './codes'
export { formatDiagnostic } from './console'
export {
  createDiagnostics,
  type Diagnostics,
  type DiagnosticsOptions,
  type LiveDiagnosticContext,
} from './hub'
export {
  DK_UNSAFE_REDACTION,
  describeValue,
  hashRowKey,
  REDACTED,
  type RedactField,
  type RedactFn,
  type RedactionOptions,
  type RedactLevel,
  type Redactor,
  resolveRedaction,
  SENSITIVE,
  scrubError,
  scrubSchemaIssue,
} from './redact'
export { toSafeJson } from './safe-json'
export type {
  Diagnostic,
  DiagnosticCode,
  DiagnosticContext,
  DiagnosticDetails,
  DiagnosticLevel,
  DiagnosticStateSummary,
  Emit,
  EmitOptions,
  Location,
  Phase,
  Trigger,
} from './types'
