/**
 * Declarative catalogs (spec §3.5). `defineDiagnostic` lives in `diagnostics/`; this module holds
 * the options catalog and its generic validator (`DK_UNKNOWN_OPTION`, `DK_INVALID_OPTION`,
 * `DK_OPTION_NO_EFFECT`).
 *
 * A feature declares its options once and passes the factory's values:
 *
 * ```ts
 * const pagingOptions = {
 *   pageSize: { type: 'number', check: (v: number) => Number.isInteger(v) && v > 0,
 *               expected: 'a positive integer' },
 *   mode: { type: 'string', oneOf: ['client', 'server'] },
 *   rowCount: { type: 'number',
 *               noEffect: (_, o) => (o.mode === 'server' ? undefined : "only read in mode: 'server'") },
 * } as const
 * export const pagination = (opts: PaginationOptions = {}) =>
 *   defineFeature({ name: 'pagination', stage: 'paginate',
 *                   options: defineOptions(pagingOptions, opts), ... })
 * ```
 *
 * `createTable` validates the table options, each feature definition's shape and each feature's
 * values; `setOptions` validates the changed options and reports read-once ones (`once: true`).
 * A new table option needs an entry in `table-options.ts` (enforced by the compiler).
 */
export { optionDiagnostics } from './codes'
export {
  defineOptions,
  isOptionsDefinition,
  type OptionRule,
  type OptionsDefinition,
  type OptionsSchema,
  type OptionType,
} from './options'
export {
  defineSlot,
  describeReturn,
  formatSlot,
  getSlot,
  matchesSlot,
  type SlotDefinition,
  type SlotReturns,
  slotDiagnostics,
} from './slots'
