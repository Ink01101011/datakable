import {
  type AnyFeature,
  type ApiOf,
  type CreateTableOptions,
  createTable as createCoreTable,
  createDefaultFeatures,
  type DefaultFeatures,
  type InvalidRowsMode,
  type SchemaRow,
  type Table,
  type TableSchema,
  type TableState,
  type TableStateFor,
} from '@datakable/core'
import { registerDatakable } from './register'

/**
 * Creates a table with the default preset (§3.3): `createTable({ data })` alone sorts, filters,
 * searches and paginates, typed against the row type (inferred, or `createTable<User>(…)`).
 * Passing `features` replaces the preset entirely. Each table gets fresh preset instances.
 *
 * `@datakable/core`'s `createTable` (also `datakable/core`) installs no features by default, so a
 * bare import there stays small; pass `features: defaultFeatures` to opt in.
 */
export function createTable<
  T,
  S extends TableState = never,
  const Fs extends readonly AnyFeature[] = DefaultFeatures,
  const Sch extends TableSchema | undefined = undefined,
  const M extends InvalidRowsMode = 'drop',
>(
  options: CreateTableOptions<T, TableStateFor<S, Fs, SchemaRow<T, Sch>>, Sch, M> & {
    features?: Fs
  },
): Table<
  SchemaRow<T, Sch>,
  TableStateFor<S, Fs, SchemaRow<T, Sch>>,
  M,
  [Sch] extends [TableSchema] ? unknown : T
> &
  ApiOf<Fs, SchemaRow<T, Sch>>
export function createTable(options: { features?: readonly AnyFeature[] | undefined }): unknown {
  registerDatakable()
  const create = createCoreTable as (o: typeof options) => unknown
  return create(
    options.features === undefined ? { ...options, features: createDefaultFeatures() } : options,
  )
}
