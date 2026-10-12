import {
  type AnyFeature,
  type ApiOf,
  createDefaultFeatures,
  type DefaultFeatures,
  type InvalidRowsMode,
  type SchemaRow,
  type StandardSchemaV1,
  type TableState,
  type TableStateFor,
} from '@datakable/core'
import {
  type UseDataTableOptions,
  type UseDataTableResult,
  useDataTable as useBareDataTable,
} from '@datakable/react'
import { useRef } from 'react'
import { registerDatakable } from './register'

/**
 * `useDataTable` with the default preset (§3.3, §10): `useDataTable({ data })` alone sorts,
 * filters, searches and paginates. Each component instance gets fresh preset instances; passing
 * `features` replaces the preset entirely. Same signature as `datakable`'s `createTable`.
 */
export function useDataTable<
  T,
  S extends TableState = never,
  const Fs extends readonly AnyFeature[] = DefaultFeatures,
  const Sch extends StandardSchemaV1 | undefined = undefined,
  const M extends InvalidRowsMode = 'drop',
>(
  options: UseDataTableOptions<T, TableStateFor<S, Fs, SchemaRow<T, Sch>>, Sch, M> & {
    features?: Fs
  },
): UseDataTableResult<
  SchemaRow<T, Sch>,
  TableStateFor<S, Fs, SchemaRow<T, Sch>>,
  M,
  [Sch] extends [StandardSchemaV1] ? unknown : T,
  ApiOf<Fs, SchemaRow<T, Sch>>
>
export function useDataTable(options: { features?: readonly AnyFeature[] | undefined }): unknown {
  registerDatakable()
  const preset = useRef<readonly AnyFeature[] | null>(null)
  // `features` is read once, at creation: the preset is built once per component instance.
  if (options.features === undefined) preset.current ??= createDefaultFeatures()
  const use = useBareDataTable as (o: typeof options) => unknown
  const features = options.features ?? (preset.current as readonly AnyFeature[])
  return use(features === options.features ? options : { ...options, features })
}
