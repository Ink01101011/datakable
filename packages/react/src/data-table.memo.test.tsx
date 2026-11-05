// Render counts of <DataTable /> body cells (#99): rows are memoised on their data, the data array
// and the column set, so typing in the search box and identical-props parent renders leave the cells alone.
import { type ColumnDef, pagination, search } from '@datakable/core'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { type ReactNode, useMemo, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataTable } from './data-table'

type User = { id: number; name: string }
const users: User[] = Array.from({ length: 30 }, (_, i) => ({ id: i, name: `name${i}` }))

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Columns whose `name` cell counts its calls. */
function counted() {
  const calls = { n: 0 }
  const columns: ColumnDef<User, ReactNode>[] = [
    { key: 'id' },
    {
      key: 'name',
      cell: ({ value }) => {
        calls.n++
        return value
      },
    },
  ]
  return { calls, columns }
}

describe('<DataTable /> memoised rows (#99)', () => {
  it('a parent re-render with identical props renders no cell', () => {
    const { calls, columns } = counted()
    let bump = () => {}
    function Parent() {
      const [n, setN] = useState(0)
      bump = () => setN(n + 1)
      return (
        <>
          <span>{n}</span>
          <DataTable data={users} columns={columns} features={[pagination()]} />
        </>
      )
    }
    render(<Parent />)
    expect(calls.n).toBe(10)
    calls.n = 0
    act(() => bump())
    expect(calls.n).toBe(0)
  })

  it('a keystroke renders the body once, when the rows change (not for the input change)', async () => {
    const { calls, columns } = counted()
    render(
      <DataTable
        data={users}
        columns={columns}
        features={[search({ typing: { strategy: 'debounce', wait: 50 } }), pagination()]}
      />,
    )
    calls.n = 0
    const box = screen.getByRole('searchbox') as HTMLInputElement
    // The input changes (state.search.input); the rows do not change until the debounce fires.
    act(() => {
      fireEvent.change(box, { target: { value: 'name1' } })
    })
    expect(box.value).toBe('name1')
    expect(calls.n).toBe(0)
    await act(() => new Promise((r) => setTimeout(r, 80)))
    // name1, name10…name19: 11 matches, 10 on the first page. Rows already shown (name1) keep their
    // cells; each new visible row renders once.
    expect(screen.getAllByRole('row')).toHaveLength(11)
    expect(calls.n).toBe(9)
  })

  it('a new columns reference re-renders the cells (renderers closing over parent state update)', () => {
    let bump = () => {}
    function Parent() {
      const [suffix, setSuffix] = useState('a')
      bump = () => setSuffix('b')
      const columns = useMemo<ColumnDef<User, ReactNode>[]>(
        () => [{ key: 'id' }, { key: 'name', cell: ({ value }) => `${value}-${suffix}` }],
        [suffix],
      )
      return <DataTable data={users.slice(0, 2)} columns={columns} />
    }
    render(<Parent />)
    expect(screen.getByText('name0-a')).toBeTruthy()
    act(() => bump())
    expect(screen.getByText('name0-b')).toBeTruthy()
    expect(screen.getByText('name1-b')).toBeTruthy()
  })

  it('an inline columns array with a new cell fn updates the cells', () => {
    let bump = () => {}
    function Parent() {
      const [suffix, setSuffix] = useState('a')
      bump = () => setSuffix('b')
      return (
        <DataTable
          data={users.slice(0, 2)}
          columns={[{ key: 'id' }, { key: 'name', cell: ({ value }) => `${value}-${suffix}` }]}
        />
      )
    }
    render(<Parent />)
    expect(screen.getByText('name0-a')).toBeTruthy()
    act(() => bump())
    expect(screen.getByText('name0-b')).toBeTruthy()
  })

  // A new data array renders every visible row again: a row object may have been changed in place
  // (the docs only ask for a new array), so its identity says nothing about its cells (2.0.x
  // behaviour). Was `calls.n === 1` (unchanged rows skipped), which showed stale cells for rows
  // mutated in place (review finding F1).
  it('new data re-renders the visible rows, with the changed row', () => {
    const { calls, columns } = counted()
    let swap = () => {}
    function Parent() {
      const [data, setData] = useState(users.slice(0, 3))
      swap = () => setData((d) => [d[0] as User, { id: 1, name: 'changed' }, d[2] as User])
      return <DataTable data={data} columns={columns} />
    }
    render(<Parent />)
    calls.n = 0
    act(() => swap())
    expect(screen.getByText('changed')).toBeTruthy()
    expect(calls.n).toBe(3)
  })

  it('a row object changed in place and passed in a new array renders its new values', () => {
    const columns: ColumnDef<User, ReactNode>[] = [
      { key: 'id' },
      { key: 'name', cell: ({ value }) => `${value}!` },
    ]
    let edit = () => {}
    function Parent() {
      const [rows, setRows] = useState(() => users.slice(0, 2).map((u) => ({ ...u })))
      edit = () => {
        ;(rows[0] as User).name = 'edited'
        setRows([...rows])
      }
      return <DataTable data={rows} columns={columns} />
    }
    render(<Parent />)
    expect(screen.getByText('name0!')).toBeTruthy()
    act(() => edit())
    expect(screen.getByText('edited!')).toBeTruthy()
    expect(screen.queryByText('name0!')).toBeNull()
  })
})
