import type { TableOptions } from '../table/types'
import { defineOptions, type OptionRule } from './options'

const REDACT_LEVELS = ['safe', 'keys', 'full'] as const

/**
 * The table's options (§3.5). Typed against `TableOptions`: a new table option without an entry
 * here is a compile error, so the validator never reports a real option as unknown.
 */
const schema = {
  name: { type: 'string', once: true },
  data: { type: 'array' },
  columns: { type: 'array' },
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
