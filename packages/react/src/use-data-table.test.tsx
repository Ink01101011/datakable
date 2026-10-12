import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useDataTable } from './use-data-table'

describe('useDataTable', () => {
  it('returns rows from data', () => {
    const data = [{ id: 1 }, { id: 2 }]
    const { result } = renderHook(() => useDataTable({ data }))
    expect(result.current.rows).toBe(data)
  })
})
