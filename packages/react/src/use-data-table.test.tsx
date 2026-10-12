import {
  type ColumnDef,
  type Diagnostic,
  type FetchParams,
  type FetchResult,
  pagination,
  REGISTRY_KEY,
  type SortingState,
  search,
  sorting,
  type VersionRegistry,
} from '@datakable/core'
import { act, render, renderHook } from '@testing-library/react'
import { Activity, type ReactNode, StrictMode, useState } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { version } from '../package.json'
import { type UseDataTableResult, useDataTable } from './use-data-table'

type User = { id: number; name: string; age: number }
const users: User[] = [
  { id: 1, name: 'Mali', age: 31 },
  { id: 2, name: 'Anan', age: 25 },
  { id: 3, name: 'Ploy', age: 40 },
]

const ids = (rows: readonly { original: User }[]) => rows.map((r) => r.original.id)
const flush = () => act(async () => {})

/** The table behind a view (the view's prototype). */
const tableOf = <V extends object>(view: V) => Object.getPrototypeOf(view) as V

let consoleError: MockInstance
let consoleWarn: MockInstance
beforeEach(() => {
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
  consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  consoleError.mockRestore()
  consoleWarn.mockRestore()
})
/** No React warning (setState in render, act, max update depth, …) was logged. */
const noReactWarnings = () => {
  const react = (m: MockInstance) =>
    m.mock.calls.filter((c) => !/DK_|datakable/i.test(c.map(String).join(' ')))
  expect(react(consoleError)).toEqual([])
  expect(react(consoleWarn)).toEqual([])
}

describe('useDataTable', () => {
  it('returns rows from data', () => {
    const data = [{ id: 1 }, { id: 2 }]
    const { result } = renderHook(() => useDataTable({ data }))
    expect(result.current.rowModel.rows.map((r) => r.original)).toEqual(data)
    expect(result.current.getData()).toBe(data)
  })
})

describe('useDataTable (§10)', () => {
  it('returns the table API, the state and the row model', () => {
    const { result } = renderHook(() => useDataTable({ data: users, features: [sorting()] }))
    expect(result.current.state).toEqual({ sorting: { by: [] } })
    expect(ids(result.current.rowModel.rows)).toEqual([1, 2, 3])
    expect(result.current.getState()).toBe(result.current.state)
    expect(result.current.getRowModel()).toBe(result.current.rowModel)
    expect(typeof result.current.toggleSort).toBe('function')
  })

  it('re-renders on table changes (uSES) with a new view; the same view while nothing changed', () => {
    let renders = 0
    const { result, rerender } = renderHook(() => {
      renders++
      return useDataTable({ data: users, features: [sorting()] })
    })
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
    act(() => result.current.toggleSort('age'))
    expect(result.current).not.toBe(first)
    expect(ids(result.current.rowModel.rows)).toEqual([2, 1, 3])
    expect(result.current.state.sorting).toEqual({ by: [{ id: 'age', desc: false }] })
    expect(renders).toBe(3)
    noReactWarnings()
  })

  it('creates the table once; a new inline features array does not recreate it', () => {
    const { result, rerender } = renderHook(() =>
      useDataTable({ data: users, features: [sorting(), pagination()] }),
    )
    const table = tableOf(result.current)
    act(() => result.current.toggleSort('age'))
    rerender()
    rerender()
    expect(tableOf(result.current)).toBe(table)
    expect(result.current.state.sorting.by).toHaveLength(1)
  })

  it("registers '@datakable/react' in the version registry (DK_VERSION_MISMATCH)", () => {
    renderHook(() => useDataTable({ data: users }))
    const reg = (globalThis as unknown as Record<symbol, VersionRegistry | undefined>)[REGISTRY_KEY]
    expect(reg?.packages['@datakable/react']).toBe(version)
  })

  it('syncs options through setOptions in a layout effect, never during render', () => {
    let rendering = false
    const { result, rerender } = renderHook(
      ({ data }: { data: readonly User[] }) => {
        rendering = true
        const t = useDataTable({ data, features: [sorting()] })
        rendering = false
        return t
      },
      { initialProps: { data: users } },
    )
    const table = tableOf(result.current)
    const original = table.setOptions
    const duringRender: boolean[] = []
    const spy = vi.spyOn(table, 'setOptions').mockImplementation((o) => {
      duringRender.push(rendering)
      original(o)
    })
    const next = users.slice(0, 2)
    rerender({ data: next })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({ data: next })
    expect(duringRender).toEqual([false])
    expect(ids(result.current.rowModel.rows)).toEqual([1, 2])
    // Unchanged options: no setOptions call at all.
    rerender({ data: next })
    expect(spy).toHaveBeenCalledTimes(1)
    noReactWarnings()
  })

  it('does not forward read-once options (no DK_OPTION_NO_EFFECT for inline objects)', () => {
    const codes: string[] = []
    const { rerender } = renderHook(() =>
      useDataTable({
        data: users,
        initialState: { sorting: { by: [] } },
        diagnostics: { redact: 'keys' },
        features: [sorting()],
        onDiagnostic: (d) => codes.push(d.code),
      }),
    )
    rerender()
    rerender()
    expect(codes).not.toContain('DK_OPTION_NO_EFFECT')
  })

  it('controlled slice: changes go to onStateChange and come back through state (§3.2)', () => {
    const { result } = renderHook(() => {
      const [sort, setSort] = useState<SortingState<User>>({ by: [] })
      const table = useDataTable({
        data: users,
        features: [sorting()],
        state: { sorting: sort },
        onStateChange: (updater) => setSort((prev) => updater({ sorting: prev }).sorting ?? prev),
      })
      return { table, sort }
    })
    act(() => result.current.table.toggleSort('age'))
    expect(result.current.sort).toEqual({ by: [{ id: 'age', desc: false }] })
    expect(result.current.table.state.sorting).toBe(result.current.sort)
    expect(ids(result.current.table.rowModel.rows)).toEqual([2, 1, 3])
    noReactWarnings()
  })

  it('keeps an inline fetcher stable: re-renders never refetch; the latest one is called', async () => {
    const calls: string[] = []
    const { result, rerender } = renderHook(
      ({ tag }: { tag: string }) =>
        useDataTable({
          features: [sorting({ mode: 'server' })],
          fetcher: (p: FetchParams): FetchResult<User> => {
            calls.push(`${tag}:${p.sort?.length ?? 0}`)
            return { rows: users, rowCount: users.length }
          },
          onDiagnostic: () => {},
        }),
      { initialProps: { tag: 'a' } },
    )
    await flush()
    expect(calls).toEqual(['a:0'])
    rerender({ tag: 'b' })
    rerender({ tag: 'c' })
    await flush()
    expect(calls).toEqual(['a:0'])
    // A server state change and refetch() call the latest fetcher.
    act(() => result.current.toggleSort('age'))
    await flush()
    expect(calls).toEqual(['a:0', 'c:1'])
    await act(() => result.current.refetch())
    expect(calls).toEqual(['a:0', 'c:1', 'c:1'])
    expect(result.current.rowModel.status).toBe('idle')
  })

  it('status is never silent: fetching + isInitialLoad, then idle (§6.6)', async () => {
    let resolve: (r: FetchResult<User>) => void = () => {}
    const fetcher = () =>
      new Promise<FetchResult<User>>((r) => {
        resolve = r
      })
    const { result } = renderHook(() =>
      useDataTable({ features: [sorting({ mode: 'server' })], fetcher }),
    )
    expect(result.current.rowModel.status).toBe('fetching')
    expect(result.current.rowModel.isInitialLoad).toBe(true)
    await act(async () => resolve({ rows: users, rowCount: 3 }))
    expect(result.current.rowModel.status).toBe('idle')
    expect(result.current.rowModel.isInitialLoad).toBe(false)
    expect(ids(result.current.rowModel.rows)).toEqual([1, 2, 3])
  })

  it('a fetcher added or removed later is forwarded (its presence matters)', async () => {
    const fetcher = vi.fn(() => ({ rows: users, rowCount: 3 }))
    const { result, rerender } = renderHook(
      ({ on }: { on: boolean }) =>
        useDataTable({
          // A new empty array every render: never forwarded again (nothing to ingest).
          data: [] as User[],
          rowCount: 0,
          features: [sorting({ mode: 'server' })],
          ...(on ? { fetcher } : {}),
        }),
      { initialProps: { on: false } },
    )
    expect(fetcher).not.toHaveBeenCalled()
    rerender({ on: true })
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result.current.rowModel.totalCount).toBe(3)
    rerender({ on: false })
    expect(result.current.getOptions().fetcher).toBeUndefined()
  })

  it('inline columns / data do not loop; DK_UNSTABLE_COLUMNS + DK_UNSTABLE_OPTION in dev', () => {
    const diags: Diagnostic[] = []
    let renders = 0
    const { result, rerender } = renderHook(() => {
      renders++
      return useDataTable({
        data: users.filter((u) => u.age > 0),
        columns: [{ key: 'id' }, { key: 'name', format: (v) => v.toUpperCase() }],
        features: [sorting()],
        onDiagnostic: (d) => diags.push(d),
      })
    })
    rerender()
    rerender()
    act(() => result.current.toggleSort('id'))
    expect(renders).toBeLessThan(15)
    expect(ids(result.current.rowModel.rows)).toEqual([1, 2, 3])
    const codes = diags.map((d) => d.code)
    expect(codes.filter((c) => c === 'DK_UNSTABLE_COLUMNS')).toHaveLength(1)
    const unstable = diags.filter((d) => d.code === 'DK_UNSTABLE_OPTION')
    expect(unstable.map((d) => (d.details as { option: string }).option)).toEqual(['data'])
    const cols = diags.find((d) => d.code === 'DK_UNSTABLE_COLUMNS')
    expect(cols?.where).toEqual({ kind: 'option', path: 'columns' })
    expect(cols?.fix.join(' ')).toMatch(/useMemo/)
    noReactWarnings()
  })

  it('a real columns change is forwarded (new functions or a new shape)', () => {
    const fmtA = (v: string) => `a:${v}`
    const fmtB = (v: string) => `b:${v}`
    const { result, rerender } = renderHook(
      ({ columns }: { columns: readonly ColumnDef<User, ReactNode>[] }) =>
        useDataTable({ data: users, columns }),
      {
        initialProps: { columns: [{ key: 'name', format: fmtA }] as ColumnDef<User, ReactNode>[] },
      },
    )
    const next: ColumnDef<User, ReactNode>[] = [{ key: 'name', format: fmtB }]
    rerender({ columns: next })
    expect(result.current.getOptions().columns).toBe(next)
    const wider: ColumnDef<User, ReactNode>[] = [{ key: 'name', format: fmtB }, { key: 'age' }]
    rerender({ columns: wider })
    expect(result.current.getOptions().columns).toBe(wider)
  })

  it('DK_UNSTABLE_OPTION for a feature function option (features are read once)', () => {
    const diags: Diagnostic[] = []
    const { rerender } = renderHook(() =>
      useDataTable({
        data: users,
        features: [search<User>({ searchFn: ({ rows }) => rows })],
        onDiagnostic: (d) => diags.push(d),
      }),
    )
    rerender()
    rerender()
    const d = diags.filter((x) => x.code === 'DK_UNSTABLE_OPTION')
    expect(d.map((x) => (x.details as { option: string }).option)).toEqual(['features[0].searchFn'])
  })

  it('delivers onDiagnostic calls made while rendering after the commit (no setState in render)', () => {
    function Child({ onDiagnostic }: { onDiagnostic: (d: Diagnostic) => void }) {
      // `bogus` is an unknown option: DK_UNKNOWN_OPTION is emitted at creation (in render).
      useDataTable({ data: users, bogus: 1, onDiagnostic } as never)
      return null
    }
    function Parent() {
      const [codes, setCodes] = useState<string[]>([])
      return (
        <>
          <span data-testid="codes">{codes.join(',')}</span>
          <Child onDiagnostic={(d) => setCodes((c) => [...c, d.code])} />
        </>
      )
    }
    const view = render(<Parent />)
    expect(view.getByTestId('codes').textContent).toContain('DK_UNKNOWN_OPTION')
    noReactWarnings()
  })

  it('StrictMode: one table, one initial fetch, destroyed once after unmount', async () => {
    const fetcher = vi.fn(() => ({ rows: users, rowCount: 3 }))
    const diags: string[] = []
    const { result, unmount } = renderHook(
      () =>
        useDataTable({
          features: [sorting({ mode: 'server' })],
          fetcher,
          onDiagnostic: (d) => diags.push(d.code),
        }),
      { wrapper: StrictMode },
    )
    await flush()
    expect(fetcher).toHaveBeenCalledTimes(1)
    const destroy = vi.spyOn(tableOf(result.current), 'destroy')
    // Still alive after the StrictMode effect re-run.
    act(() => result.current.toggleSort('age'))
    await flush()
    expect(diags).not.toContain('DK_TABLE_DESTROYED')
    expect(fetcher).toHaveBeenCalledTimes(2)
    unmount()
    await flush()
    expect(destroy).toHaveBeenCalledTimes(1)
  })

  it('a table destroyed while hidden (<Activity>) is re-created when shown again', async () => {
    let view: UseDataTableResult<User> | undefined
    const codes: string[] = []
    function C() {
      view = useDataTable({
        data: users,
        features: [sorting()],
        onDiagnostic: (d) => codes.push(d.code),
      }) as never
      return null
    }
    const r = render(
      <Activity mode="visible">
        <C />
      </Activity>,
    )
    const first = tableOf(view as object)
    r.rerender(
      <Activity mode="hidden">
        <C />
      </Activity>,
    )
    await flush()
    r.rerender(
      <Activity mode="visible">
        <C />
      </Activity>,
    )
    await flush()
    const current = view as unknown as UseDataTableResult<User> & { toggleSort(id: 'age'): void }
    expect(tableOf(current)).not.toBe(first)
    act(() => current.toggleSort('age'))
    expect(codes).not.toContain('DK_TABLE_DESTROYED')
    expect(ids((view as UseDataTableResult<User>).rowModel.rows)).toEqual([2, 1, 3])
  })

  it('SSR: renderToString renders the server snapshot (initialState applied)', () => {
    function C() {
      const t = useDataTable({
        data: users,
        features: [sorting()],
        initialState: { sorting: { by: [{ id: 'age', desc: true }] } },
      })
      return (
        <ul>
          {t.rowModel.rows.map((r) => (
            <li key={r.key}>{r.original.name}</li>
          ))}
        </ul>
      )
    }
    expect(renderToString(<C />)).toBe('<ul><li>Ploy</li><li>Mali</li><li>Anan</li></ul>')
  })
})
