import { type CompiledPath, compilePath } from '../column/get-value'

/** The runtime view of a column definition (types are checked at compile time, §4.1). */
export interface ColumnLike {
  readonly key?: unknown
  readonly id?: unknown
  readonly accessor?: unknown
  readonly format?: unknown
  readonly cell?: unknown
}

/** A column with its id, position and value reader prepared once per `columns` reference. */
export interface ResolvedColumn {
  readonly def: ColumnLike
  /** Position in `options.columns` (diagnostic `where`). */
  readonly index: number
  /** `key` for key columns, `id` for accessor columns. */
  readonly id: string
  /** Key columns: the compiled dot-path. */
  readonly path: CompiledPath | undefined
  /** Accessor columns: the user accessor. */
  readonly accessor: ((row: unknown) => unknown) | undefined
  /** `format` if the column has one. */
  readonly format: ((value: unknown) => unknown) | undefined
  /** The column renders itself (`cell`): no DK_UNRENDERABLE_VALUE for its formatted values. */
  readonly hasCell: boolean
}

export interface ResolvedColumns {
  readonly list: readonly ResolvedColumn[]
  readonly byId: ReadonlyMap<string, ResolvedColumn>
}

const resolved = new WeakMap<readonly unknown[], ResolvedColumns>()

const fn = (v: unknown) => (typeof v === 'function' ? (v as (x: unknown) => unknown) : undefined)

/**
 * Resolves `columns` once per array reference. Entries without a string `key` or `id` are skipped
 * (the option validator reports them). The first column with a given id wins.
 */
export function resolveColumns(columns: readonly unknown[]): ResolvedColumns {
  let r = resolved.get(columns)
  if (r) return r
  const list: ResolvedColumn[] = []
  const byId = new Map<string, ResolvedColumn>()
  for (let index = 0; index < columns.length; index++) {
    const def = columns[index] as ColumnLike | null | undefined
    if (def === null || typeof def !== 'object') continue
    const isKey = typeof def.key === 'string'
    const id = isKey ? (def.key as string) : def.id
    if (typeof id !== 'string') continue
    const col: ResolvedColumn = {
      def,
      index,
      id,
      path: isKey ? compilePath(id) : undefined,
      accessor: isKey ? undefined : fn(def.accessor),
      format: fn(def.format),
      hasCell: def.cell !== undefined,
    }
    list.push(col)
    if (!byId.has(id)) byId.set(id, col)
  }
  r = { list, byId }
  resolved.set(columns, r)
  return r
}
