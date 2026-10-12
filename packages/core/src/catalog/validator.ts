import { throwConfigError } from '../diagnostics/build'
import type { Emit, Trigger } from '../diagnostics/types'
import { STAGES } from '../feature/order'
import type { AnyFeature } from '../feature/types'
import { optionDiagnostics } from './codes'
import {
  isOptionsDefinition,
  type OptionRule,
  type OptionsSchema,
  type OptionType,
} from './options'
import { suggest } from './suggest'
import { tableOptions } from './table-options'

// Referencing the definitions keeps them in the bundle (`sideEffects: false`).
void optionDiagnostics

type Values = Readonly<Record<string, unknown>>

export interface OptionCheckContext {
  /** The table name for config errors' context. */
  readonly table: string
  readonly emit: Emit
}

interface Level {
  readonly ctx: OptionCheckContext
  readonly phase: 'init' | 'setOptions'
  readonly feature?: string
  /** Features to search when a table option is unknown (`owner`). */
  readonly features?: readonly AnyFeature[]
}

const ARTICLE: Record<OptionType, string> = {
  string: 'a string',
  number: 'a number',
  boolean: 'a boolean',
  function: 'a function',
  object: 'an object',
  array: 'an array',
}

const typeOf = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v)

const types = (rule: OptionRule): readonly OptionType[] =>
  typeof rule.type === 'string' ? [rule.type] : rule.type

const isPrimitive = (v: unknown): v is string | number | boolean =>
  typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

const quote = (v: string | number | boolean) => (typeof v === 'string' ? `'${v}'` : String(v))

function expected(rule: OptionRule): string {
  if (rule.expected !== undefined) return rule.expected
  if (rule.oneOf) return rule.oneOf.map(quote).join(' | ')
  return types(rule)
    .map((t) => ARTICLE[t])
    .join(' or ')
}

/** Option values are developer constants: short ones are shown, long strings only by length. */
function received(v: unknown): string {
  if (typeof v === 'string') return v.length <= 32 ? JSON.stringify(v) : `string(${v.length})`
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `array(${v.length})`
  return typeOf(v)
}

function valid(rule: OptionRule, v: unknown): boolean {
  if (!(types(rule) as readonly string[]).includes(typeOf(v))) return false
  if (rule.oneOf && isPrimitive(v) && !rule.oneOf.includes(v)) return false
  if (rule.check && !rule.check(v)) return false
  return true
}

const join = (prefix: string, key: string) => (prefix === '' ? key : `${prefix}.${key}`)

function invalid(
  level: Level,
  path: string,
  rule: OptionRule,
  v: unknown,
  hint?: string,
  missing = false,
): never {
  const enumMiss = rule.oneOf && typeof v === 'string'
  return throwConfigError(
    'DK_INVALID_OPTION',
    {
      path,
      ...(level.feature === undefined ? {} : { feature: level.feature }),
      expected: expected(rule),
      received: missing ? 'nothing (it is required)' : received(v),
      suggestions: enumMiss
        ? suggest(v, rule.oneOf?.filter((o) => typeof o === 'string') ?? [])
        : [],
      ...(hint === undefined ? {} : { hint }),
      phase: level.phase,
    },
    { table: level.ctx.table, trigger: level.phase as Trigger },
  )
}

function ownerOf(key: string, features: readonly AnyFeature[] | undefined): string | undefined {
  for (const f of features ?? []) {
    const o = f?.options
    if (isOptionsDefinition(o) && Object.hasOwn(o.schema, key)) return f.name
  }
  return undefined
}

/**
 * Checks `values` against `schema`: unknown keys warn, invalid values throw, and (when `all` is
 * given) `noEffect` rules run against `all`, the complete options of the same level.
 */
function checkLevel(
  level: Level,
  schema: OptionsSchema,
  values: Values,
  all: Values,
  prefix: string,
) {
  for (const key of Object.keys(values)) {
    const v = values[key]
    const path = join(prefix, key)
    const rule = Object.hasOwn(schema, key) ? schema[key] : undefined
    if (rule === undefined) {
      const known = Object.keys(schema)
      const owner =
        prefix === '' && level.feature === undefined ? ownerOf(key, level.features) : undefined
      level.ctx.emit('DK_UNKNOWN_OPTION', {
        path,
        ...(level.feature === undefined ? {} : { feature: level.feature }),
        suggestions: suggest(key, known),
        known,
        ...(owner === undefined ? {} : { owner }),
      })
      continue
    }
    if (v === undefined) continue
    if (!valid(rule, v)) invalid(level, path, rule, v)
    if (rule.shape && typeOf(v) === 'object') {
      checkLevel(level, rule.shape, v as Values, v as Values, path)
    }
    const reason = rule.noEffect?.(v, all)
    if (reason !== undefined) {
      level.ctx.emit('DK_OPTION_NO_EFFECT', {
        path,
        ...(level.feature === undefined ? {} : { feature: level.feature }),
        reason,
        once: false,
      })
    }
  }
}

// --- feature definitions ---------------------------------------------------------------------------

const FEATURE_SHAPE: Readonly<Record<string, OptionRule & { required?: boolean }>> = {
  name: {
    type: 'string',
    check: (s: string) => s.length > 0,
    expected: 'a non-empty string',
    required: true,
  },
  stage: { type: 'string', oneOf: STAGES, required: true },
  mode: { type: 'string', oneOf: ['client', 'server'] },
  initialState: { type: 'function', required: true },
  createApi: { type: 'function', required: true },
  rowModel: { type: 'function' },
  interceptors: { type: 'array' },
  options: {
    type: 'object',
    check: isOptionsDefinition,
    expected: 'an options definition',
  },
  requires: { type: 'object' },
}

/** Runtime shape of each `options.features` entry (JS callers, wrong builds), then its options. */
function checkFeatures(ctx: OptionCheckContext, features: readonly unknown[]) {
  const level: Level = { ctx, phase: 'init' }
  for (let i = 0; i < features.length; i++) {
    const f = features[i]
    const at = `features[${i}]`
    if (typeOf(f) !== 'object') {
      const fn = f as { name?: string }
      invalid(
        level,
        at,
        { type: 'object', expected: 'a feature (the result of defineFeature)' },
        f,
        typeof f === 'function'
          ? `call the factory: features: [${fn.name || 'feature'}()] instead of ` +
              `[${fn.name || 'feature'}]`
          : undefined,
      )
    }
    const def = f as Record<string, unknown>
    for (const key of Object.keys(FEATURE_SHAPE)) {
      const rule = FEATURE_SHAPE[key] as OptionRule & { required?: boolean }
      const v = def[key]
      if (v === undefined) {
        if (rule.required) invalid(level, `${at}.${key}`, rule, v, undefined, true)
        continue
      }
      if (!valid(rule, v)) {
        invalid(
          level,
          `${at}.${key}`,
          rule,
          v,
          key === 'options'
            ? 'build feature options with defineOptions(schema, values), not a plain object'
            : undefined,
        )
      }
    }
  }
  for (const f of features as readonly AnyFeature[]) {
    const o = f.options
    if (!isOptionsDefinition(o) || o.values === undefined) continue
    const values = o.values
    if (typeOf(values) !== 'object') continue
    checkLevel({ ctx, phase: 'init', feature: f.name }, o.schema, values, values, '')
  }
}

// --- entry points ----------------------------------------------------------------------------------

/**
 * The option validator at creation (`table:init`, §3.4): the table options, the shape of every
 * feature definition and each feature's options. Invalid values throw `DatakableConfigError`
 * (`DK_INVALID_OPTION`); unknown and no-effect options are reported through `ctx.emit`.
 */
export function validateOptions(input: object, ctx: OptionCheckContext): void {
  const options = input as Values
  const features = options.features
  const level: Level = {
    ctx,
    phase: 'init',
    ...(Array.isArray(features) ? { features: features as AnyFeature[] } : {}),
  }
  checkLevel(level, tableOptions.schema, options, options, '')
  if (Array.isArray(features)) checkFeatures(ctx, features)
}

/** Same values for a read-once option (an object with a `shape` is compared one level deep). */
function same(rule: OptionRule, a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!rule.shape || typeOf(a) !== 'object' || typeOf(b) !== 'object') return false
  const x = a as Values
  const y = b as Values
  const keys = new Set([...Object.keys(x), ...Object.keys(y)])
  for (const k of keys) if (!Object.is(x[k], y[k])) return false
  return true
}

/**
 * The option validator on `setOptions` (`table:setOptions`, §3.4): checks `partial` (throws on an
 * invalid value before anything changes), then restores the previous value of every read-once
 * option in `next` and reports the changed ones as `DK_OPTION_NO_EFFECT`.
 */
export function validateOptionChange(
  changes: object,
  merged: object,
  before: object,
  ctx: OptionCheckContext,
): void {
  const partial = changes as Values
  const next = merged as Record<string, unknown>
  const previous = before as Values
  const features = previous.features
  checkLevel(
    {
      ctx,
      phase: 'setOptions',
      ...(Array.isArray(features) ? { features: features as AnyFeature[] } : {}),
    },
    tableOptions.schema,
    partial,
    next,
    '',
  )
  const schema = tableOptions.schema as OptionsSchema
  for (const key of Object.keys(partial)) {
    const rule = Object.hasOwn(schema, key) ? schema[key] : undefined
    if (!rule?.once) continue
    if (Object.hasOwn(previous, key)) next[key] = previous[key]
    else delete next[key]
    if (same(rule, partial[key], previous[key])) continue
    ctx.emit('DK_OPTION_NO_EFFECT', {
      path: key,
      reason: `${key} is read once, when the table is created`,
      once: true,
    })
  }
}
