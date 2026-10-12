// @vitest-environment happy-dom
// Render cost of 1,000 visible cells (100 rows × 10 columns) in <DataTable /> (T34: per-cell
// error boundaries must not add happy-path cost beyond what React requires).
// Run: pnpm vitest bench --run packages/react/src/data-table.bench.tsx
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { test } from 'vitest'
import { DataTable } from './data-table'

// biome-ignore lint/suspicious/noExplicitAny: React's act environment flag
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const COLS = 10
const rows = Array.from({ length: 100 }, (_, i) => {
  const r: Record<string, number | string> = { id: i }
  for (let c = 1; c < COLS; c++) r[`c${c}`] = c % 2 ? i * c : `v${i}-${c}`
  return r
})
const keys = ['id', ...Array.from({ length: COLS - 1 }, (_, c) => `c${c + 1}`)]
const plain = keys.map((key) => ({ key }))
const elements = keys.map((key) => ({
  key,
  cell: ({ value }: { value: unknown }): ReactNode => <span>{String(value)}</span>,
}))

function mountOnce(columns: readonly object[]) {
  const host = document.createElement('div')
  const root = createRoot(host)
  act(() => {
    root.render(<DataTable data={rows} columns={columns as never} features={[]} />)
  })
  act(() => root.unmount())
}

test('<DataTable /> mount + unmount, 1,000 cells', async ({ bench }) => {
  await bench.compare(
    bench('plain values (format)', () => mountOnce(plain)),
    bench('cell returns an element', () => mountOnce(elements)),
  )
})
