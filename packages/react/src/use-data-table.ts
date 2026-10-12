import type { RowData } from '@datakable/core'
import { useMemo } from 'react'

export interface UseDataTableOptions<T extends RowData> {
  data: readonly T[]
}

export interface UseDataTableResult<T extends RowData> {
  rows: readonly T[]
}

/** Placeholder hook — wires the package graph end-to-end until the real API lands. */
export function useDataTable<T extends RowData>(
  options: UseDataTableOptions<T>,
): UseDataTableResult<T> {
  const { data } = options
  return useMemo(() => ({ rows: data }), [data])
}
