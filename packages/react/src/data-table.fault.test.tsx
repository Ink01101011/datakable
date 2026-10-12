import type { ColumnDef, Diagnostic, DiagnosticCode } from '@datakable/core'
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
 * `invalidCell` and `format` rendered by `<DataTable />`, and a component inside `cell` (the body
 * error boundary). Each case checks the code at the exact `where`, the `⚠` fallback, no row data in
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
    const schema = makeSchema((v) =>
      (v as Person).id === 'p1'
        ? { issues: [{ message: `bad ${SECRET}`, path: ['n'] }] }
        : { value: v },
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

  it('a component inside cell throws: DK_RENDER_FAILED, the body shows Error, the table survives', async () => {
    const { seen, onDiagnostic } = sink()
    let broken = true
    function Boom(): ReactNode {
      if (broken) throw new InjectedError()
      return 'ok'
    }
    function Table() {
      const t = useDataTable({
        data: people(),
        columns: [{ key: 'id' }, { key: 'name', cell: () => <Boom /> }] as readonly Col[],
        onDiagnostic,
        features: [],
      })
      return <DataTable table={t} />
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
    expect(cellsOf(0)).toEqual(['p0', 'ok'])
  })
})
