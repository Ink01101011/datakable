/** Runtime types an option can accept (`'array'` is checked before `'object'`). */
export type OptionType = 'string' | 'number' | 'boolean' | 'function' | 'object' | 'array'

/**
 * One option in a catalog (§3.5). `undefined` always passes: it means "not set". Every other value
 * must match `type`, then `oneOf` and `check`, else `DK_INVALID_OPTION` (a config error).
 */
export interface OptionRule {
  /** Accepted runtime types. */
  readonly type: OptionType | readonly OptionType[]
  /** Accepted primitive values (enums). Values of another type (e.g. a function) skip it. */
  readonly oneOf?: readonly (string | number | boolean)[]
  /** Extra check once the type matched (ranges, integers); `false` → `DK_INVALID_OPTION`. */
  // biome-ignore lint/suspicious/noExplicitAny: each rule types its own value
  readonly check?: (value: any) => boolean
  /** The accepted values in words, for the problem and fix text (default: from `type` / `oneOf`). */
  readonly expected?: string
  /** Nested options of an object option; their unknown keys are `DK_UNKNOWN_OPTION` too. */
  readonly shape?: OptionsSchema
  /**
   * Read once, at creation: a changed value given to `setOptions` is ignored (the previous value is
   * kept) and reported as `DK_OPTION_NO_EFFECT`.
   */
  readonly once?: boolean
  /**
   * Why the option has no effect in this configuration (`DK_OPTION_NO_EFFECT`), or `undefined`.
   * `options` are all the options of the same level (the table's, or the feature's values).
   */
  // biome-ignore lint/suspicious/noExplicitAny: each rule types its own value
  readonly noEffect?: (value: any, options: Readonly<Record<string, unknown>>) => string | undefined
}

export type OptionsSchema = { readonly [option: string]: OptionRule }

const BRAND = Symbol.for('datakable.options')

/** A schema plus, for a feature, the values its factory was called with. */
export interface OptionsDefinition<S extends OptionsSchema = OptionsSchema> {
  readonly [BRAND]: true
  readonly schema: S
  /** The values to validate (a feature's factory options); `undefined` for a bare schema. */
  readonly values: Readonly<Record<string, unknown>> | undefined
}

/**
 * Declares options (§3.5). A feature passes its factory options as `values`, and the generic option
 * validator checks them at `createTable` (unknown / invalid / no-effect):
 *
 * ```ts
 * const sortingOptions = { multi: { type: 'boolean' } } as const
 * export const sorting = (opts: SortingOptions = {}) =>
 *   defineFeature({ name: 'sorting', stage: 'sort', options: defineOptions(sortingOptions, opts), ... })
 * ```
 *
 * Hoist the schema (as above) so it is built once, not per call.
 */
export function defineOptions<const S extends OptionsSchema>(
  schema: S,
  values?: object,
): OptionsDefinition<S> {
  return { [BRAND]: true, schema, values: values as Record<string, unknown> | undefined }
}

export function isOptionsDefinition(v: unknown): v is OptionsDefinition {
  return v != null && typeof v === 'object' && (v as Record<symbol, unknown>)[BRAND] === true
}
