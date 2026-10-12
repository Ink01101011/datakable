import { isStandardSchema } from '../ingest/schema'
import { SCHEMA_INGEST } from '../ingest/schema-brand'
import type { TableOptions } from '../table/types'
import { defineOptions, type OptionRule } from './options'

const hasServerPagination = (features: unknown) =>
  Array.isArray(features) &&
  features.some(
    (f) =>
      (f as { stage?: unknown })?.stage === 'paginate' &&
      (f as { mode?: unknown }).mode === 'server',
  )

const REDACT_LEVELS = ['safe', 'keys', 'full'] as const
const INVALID_ROWS = ['drop', 'flag', 'throw'] as const

/**
 * The table's options (§3.5). Typed against `TableOptions`: a new table option without an entry
 * here is a compile error, so the validator never reports a real option as unknown.
 */
const schema = {
  name: { type: 'string', once: true },
  data: { type: 'array' },
  columns: { type: 'array' },
  schema: {
    // arktype schemas are functions.
    type: ['object', 'function'],
    check: (v: object) =>
      isStandardSchema(v) &&
      typeof (v as { [SCHEMA_INGEST]?: unknown })[SCHEMA_INGEST] === 'function',
    expected:
      "a Standard Schema v1 (an object with '~standard': { version: 1, validate }, e.g. a zod, " +
      "valibot or arktype schema) wrapped with withSchema() from '@datakable/core/schema': " +
      'schema: withSchema(UserSchema)',
    once: true,
  },
  invalidRows: {
    type: 'string',
    oneOf: INVALID_ROWS,
    once: true,
    noEffect: (v: string, all) =>
      v !== 'drop' && all.schema === undefined
        ? `invalidRows: '${v}' applies to rows that fail options.schema, and no schema is set`
        : undefined,
  },
  rowKey: { type: ['string', 'function'] },
  features: { type: 'array', once: true },
  initialState: { type: 'object', once: true },
  state: { type: 'object' },
  onStateChange: { type: 'function' },
  interceptors: { type: 'array' },
  onDiagnostic: { type: 'function' },
  // `<= 0` or NaN would silently disable the timer; only Infinity does that, explicitly.
  timeout: {
    type: 'number',
    check: (v: number) => v > 0,
    expected: 'a number of milliseconds > 0, or Infinity to disable the timeout',
    once: true,
  },
  fetcher: { type: 'function' },
  rowCount: {
    type: 'number',
    check: (v: number) => Number.isInteger(v) && v >= 0,
    expected: 'an integer ≥ 0 (the total number of rows on the server)',
    noEffect: (_v: number, all) =>
      // With initialData, rowCount is its server total until a fetch applies (§7.2).
      typeof all.fetcher === 'function' && all.initialData === undefined
        ? 'with a fetcher, the row count comes from the fetcher result (rowCount)'
        : !hasServerPagination(all.features)
          ? "only pagination({ mode: 'server' }) reads rowCount"
          : undefined,
  },
  initialData: {
    type: 'array',
    once: true,
    noEffect: (_v: readonly unknown[], all) =>
      all.data !== undefined
        ? 'data is given: initialData is used only without data (SSR / server mode, §7.2)'
        : undefined,
  },
  strict: { type: 'boolean', once: true },
  diagnostics: {
    type: 'object',
    once: true,
    shape: {
      redact: {
        type: ['string', 'function'],
        oneOf: REDACT_LEVELS,
        expected: `${REDACT_LEVELS.map((l) => `'${l}'`).join(' | ')}, or a function (path, value) => string | undefined`,
      },
    },
  },
} as const satisfies { readonly [K in keyof Required<TableOptions<unknown>>]: OptionRule }

export const tableOptions = defineOptions(schema)
