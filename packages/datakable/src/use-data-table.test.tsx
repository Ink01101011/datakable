import { pagination, sorting } from '@datakable/core'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useDataTable } from './index'

type User = { id: number; name: string; age: number }
const users: User[] = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1,
  name: `${['Mali', 'Anan', 'Ploy', 'Nok', 'Somchai'][i % 5]} ${i + 1}`,
  age: 20 + ((i * 7) % 30),
}))

describe("datakable's useDataTable (default preset)", () => {
  it('installs the preset: sort, filter, search, paginate with no other options', async () => {
    const { result } = renderHook(() => useDataTable({ data: users }))
    expect(Object.keys(result.current.state)).toEqual([
      'columnFilters',
      'validity',
      'search',
      'sorting',
      'pagination',
    ])
    expect(result.current.rowModel.rows).toHaveLength(10)
    act(() => result.current.toggleSort('age'))
    expect(result.current.rowModel.rows[0]?.original.age).toBe(20)
    act(() => result.current.nextPage())
    expect(result.current.state.pagination.pageIndex).toBe(1)
    await act(() => result.current.setSearch('Somchai'))
    expect(result.current.state.search.query).toBe('Somchai')
    expect(result.current.rowModel.filteredCount).toBe(5)
  })

  it('one preset per component instance, kept across re-renders', () => {
    const a = renderHook(() => useDataTable({ data: users }))
    const b = renderHook(() => useDataTable({ data: users }))
    const fa = a.result.current.getOptions().features ?? []
    a.rerender()
    expect(a.result.current.getOptions().features).toBe(fa)
    const fb = b.result.current.getOptions().features ?? []
    for (let i = 0; i < fa.length; i++) expect(fa[i]).not.toBe(fb[i])
  })

  it('features replaces the preset', () => {
    const { result } = renderHook(() =>
      useDataTable({ data: users, features: [sorting(), pagination()] }),
    )
    expect(Object.keys(result.current.state)).toEqual(['sorting', 'pagination'])
  })
})
