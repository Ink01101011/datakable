import {
  type ColumnDef,
  type Diagnostic,
  type DiagnosticCode,
  getOperation,
  pagination,
  search,
  sorting,
} from '@datakable/core'
import { withSchema } from '@datakable/core/schema'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import * as harness from '../../core/src/fault-injection/harness'
import {
  fail,
  InjectedError,
  useHarness as installHarness,
  type Person,
  people,
  SECRET,
} from '../../core/src/fault-injection/harness'
import { makeSchema } from '../../core/src/ingest/test-schemas'
import { DataTable } from './data-table'
import { useDataTable } from './use-data-table'

/**
 * The React render slots × injection (§11 fault injection, §8.6, T30 carry-over): `cell`,
 * `invalidCell` and `format` rendered by `<DataTable />`, a component inside `cell` / `invalidCell`
 * (the per-cell boundaries) and one outside the cells (the body boundary). Each case checks the code at the exact `where`, the `⚠` fallback, no row data in
 * any diagnostic, and that the rest of the table keeps working.
 */
installHarness()
afterEach(cleanup)

// The harness is typed against core's source; this package typechecks against core's dist (whose
// catalog also holds this package's codes), so its diagnostic helpers are re-typed here.
const sink = harness.sink as unknown as () => {
  seen: Diagnostic[]
  onDiagnostic: (d: Diagnostic) => void
}
const expectDiagnostic = harness.expectDiagnostic as unknown as (
  seen: readonly Diagnostic[],
  code: DiagnosticCode,
  where: string,
) => Diagnostic
const expectNoRowData = harness.expectNoRowData as unknown as (seen: readonly Diagnostic[]) => void

type Col = ColumnDef<Person, ReactNode>
const cellsOf = (row: number) => {
  const body = screen.getAllByRole('rowgroup')[1] as HTMLElement
  const tr = within(body).getAllByRole('row')[row] as HTMLElement
  return within(tr)
    .getAllByRole('cell')
    .map((c) => c.textContent)
}

function Sorted(props: { columns: readonly Col[]; onDiagnostic: (d: Diagnostic) => void }) {
  const t = useDataTable({
    data: people(),
    columns: props.columns,
    onDiagnostic: props.onDiagnostic,
  })
  return <DataTable table={t} />
}

interface RenderCase {
  slot: string
  code: DiagnosticCode
  where: string
  columns: readonly Col[]
  /** The cells of the first body row. */
  cells: string[]
}

const throwOn = (id: string) => (p: { row: Person }) => (p.row.id === id ? fail() : p.row.name)

const cases: RenderCase[] = [
  {
    slot: 'columns[i].cell (throw)',
    code: 'DK_CALLBACK_FAILED',
    where: 'options.columns[1].cell',
    columns: [{ key: 'id' }, { key: 'name', cell: throwOn('p0') }],
    cells: ['p0', '⚠'],
  },
  {
    slot: 'columns[i].cell (returns a Promise)',
    code: 'DK_CALLBACK_BAD_RETURN',
    where: 'options.columns[1].cell',
    columns: [{ key: 'id' }, { key: 'name', cell: () => Promise.resolve(SECRET) as never }],
    cells: ['p0', '⚠'],
  },
  {
    slot: 'columns[i].format (throw)',
    code: 'DK_CALLBACK_FAILED',
    where: 'options.columns[0].format',
    columns: [{ key: 'name', format: fail }, { key: 'n' }],
    cells: ['⚠', '3'],
  },
]

describe('React render slots × injection (§11)', () => {
  it.each(cases.map((c) => [c.slot, c] as const))('%s', async (_, c) => {
    const { seen, onDiagnostic } = sink()
    render(<Sorted columns={c.columns} onDiagnostic={onDiagnostic} />)
    await act(async () => {})
    expect(cellsOf(0)).toEqual(c.cells)
    // The other rows still render.
    expect(screen.getAllByRole('row')).toHaveLength(4)
    const d = expectDiagnostic(seen, c.code, c.where)
    if (c.code === 'DK_CALLBACK_FAILED') {
      expect(d.details).toMatchObject({ errorName: 'InjectedError' })
      expect(d.context.cause).toBeInstanceOf(InjectedError)
    }
    expectNoRowData(seen)
    // Re-renders do not report again (deduped per column + data).
    const n = seen.filter((x) => x.code === c.code).length
    expect(n).toBe(1)
  })

  it('columns[i].invalidCell (throw): ⚠ in the broken cell, DK_CALLBACK_FAILED', async () => {
    const { seen, onDiagnostic } = sink()
    const schema = withSchema(
      makeSchema((v) =>
        (v as Person).id === 'p1'
          ? { issues: [{ message: `bad ${SECRET}`, path: ['n'] }] }
          : { value: v },
      ),
    )
    render(
      <DataTable
        data={people()}
        schema={schema}
        invalidRows="flag"
        onDiagnostic={onDiagnostic}
        columns={[{ key: 'name' }, { key: 'n', invalidCell: fail }] as never}
      />,
    )
    await act(async () => {})
    expect(cellsOf(1)).toEqual(['Ada', '⚠'])
    expectDiagnostic(seen, 'DK_CALLBACK_FAILED', 'options.columns[1].invalidCell')
    expectNoRowData(seen)
  })

  it('a component inside cell throws: ⚠ in that cell only, DK_RENDER_FAILED, the table survives', async () => {
    const { seen, onDiagnostic } = sink()
    let broken = true
    function Boom({ id, name }: { id: string; name: string }): ReactNode {
      if (broken && id === 'p0') throw new InjectedError()
      return name
    }
    let api: { setOptions(o: object): void; toggleSort(id: string): void } | undefined
    const data = people()
    function Table() {
      const t = useDataTable({
        data,
        columns: [
          { key: 'id' },
          { key: 'name', cell: ({ row }) => <Boom id={row.id} name={row.name} /> },
        ] as readonly Col[],
        onDiagnostic,
        features: [sorting()],
      })
      api = t as never
      return <DataTable table={t} />
    }
    render(<Table />)
    await act(async () => {})
    // Only the broken cell falls back; every other cell and row renders.
    expect(cellsOf(0)).toEqual(['p0', '⚠'])
    expect(cellsOf(1)).toEqual(['p1', 'Ada'])
    expect(cellsOf(2)).toEqual(['p2', 'Bob'])
    expect(screen.queryByRole('alert')).toBeNull()
    const d = expectDiagnostic(seen, 'DK_RENDER_FAILED', 'operation render:cell at columns[1].cell')
    expect(d.level).toBe('error')
    expect(d.details).toMatchObject({ column: 'name', row: 0, errorName: 'InjectedError' })
    expect(d.context.cause).toBeInstanceOf(InjectedError)
    expect(seen.filter((x) => x.code === 'DK_RENDER_FAILED')).toHaveLength(1)
    expectNoRowData(seen)
    // The table API keeps working: sort by name (Ada, Bob, Cleo) keeps the ⚠ on its row.
    await act(async () => api?.toggleSort('name'))
    expect(cellsOf(0)).toEqual(['p1', 'Ada'])
    expect(cellsOf(2)).toEqual(['p0', '⚠'])
    // Fixed + new data: the cell renders again.
    broken = false
    await act(async () => api?.setOptions({ data: people() }))
    expect(cellsOf(2)).toEqual(['p0', 'Cleo'])
  })

  it('a component inside invalidCell throws: ⚠ in that cell, DK_RENDER_FAILED at invalidCell', async () => {
    const { seen, onDiagnostic } = sink()
    function Boom(): ReactNode {
      throw new InjectedError()
    }
    const schema = withSchema(
      makeSchema((v) =>
        (v as Person).id === 'p1'
          ? { issues: [{ message: `bad ${SECRET}`, path: ['n'] }] }
          : { value: v },
      ),
    )
    render(
      <DataTable
        data={people()}
        schema={schema}
        invalidRows="flag"
        onDiagnostic={onDiagnostic}
        columns={[{ key: 'name' }, { key: 'n', invalidCell: () => <Boom /> }] as never}
      />,
    )
    await act(async () => {})
    expect(cellsOf(0)).toEqual(['Cleo', '3'])
    expect(cellsOf(1)).toEqual(['Ada', '⚠'])
    const d = expectDiagnostic(
      seen,
      'DK_RENDER_FAILED',
      'operation render:cell at columns[1].invalidCell',
    )
    expect(d.details).toMatchObject({ column: 'n', row: 1 })
    expectNoRowData(seen)
  })

  it('a component outside the cells throws (components.Empty): DK_RENDER_FAILED render:table, the body shows Error, the table survives', async () => {
    const { seen, onDiagnostic } = sink()
    let broken = true
    function BoomEmpty(): ReactNode {
      if (broken) throw new InjectedError()
      return 'nothing here'
    }
    function Table() {
      const t = useDataTable({
        data: [] as Person[],
        columns: [{ key: 'id' }, { key: 'name' }] as readonly Col[],
        onDiagnostic,
        features: [],
      })
      return <DataTable table={t} components={{ Empty: BoomEmpty }} />
    }
    render(<Table />)
    await act(async () => {})
    const d = expectDiagnostic(seen, 'DK_RENDER_FAILED', 'operation render:table')
    expect(d.level).toBe('error')
    expect(d.context.cause).toBeInstanceOf(InjectedError)
    expectNoRowData(seen)
    // Header survives; the body shows the error state with a retry.
    expect(screen.getAllByRole('columnheader')).toHaveLength(2)
    const alert = screen.getByRole('alert')
    broken = false
    await act(async () => {
      fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }))
    })
    expect(screen.getByText('nothing here')).toBeTruthy()
  })

  // #26: the search and pager parts render outside the body; a throw there unmounted the root.
  it.each([
    ['SearchInput', { features: [search()] }, 'searchbox'],
    ['Pagination', { features: [pagination()] }, 'navigation'],
  ] as const)(
    'a components.%s that throws: the default part, DK_RENDER_FAILED, the page survives',
    async (part, options, role) => {
      const { seen, onDiagnostic } = sink()
      const Boom = (): ReactNode => {
        throw new InjectedError()
      }
      render(
        <main>
          <h1>app shell</h1>
          <DataTable
            data={people()}
            rowKey="id"
            {...options}
            onDiagnostic={onDiagnostic}
            components={{ [part]: Boom }}
          />
        </main>,
      )
      await act(async () => {})
      expect(screen.getByRole('heading').textContent).toBe('app shell')
      const d = expectDiagnostic(
        seen,
        'DK_RENDER_FAILED',
        `operation render:table at components.${part}`,
      )
      expect(d.context.cause).toBeInstanceOf(InjectedError)
      expect(d.problem).toBe(`the components.${part} component threw InjectedError`)
      expectNoRowData(seen)
      // The default part stands in, bound to the table.
      expect(screen.getByRole(role)).toBeTruthy()
      expect(screen.getAllByRole('row')).toHaveLength(4)
    },
  )

  it('registers the render:* operations (§3.4) on the first render: sync, not hot', () => {
    render(<DataTable data={people()} />)
    expect(getOperation('render:table')).toEqual({ kind: 'sync', hot: false })
    expect(getOperation('render:cell')).toEqual({ kind: 'sync', hot: false })
  })
})
