import { defineInterceptor, sorting } from '@datakable/core'
import { act, StrictMode, version } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { DataTable } from './data-table'
import { useDataTable } from './use-data-table'

// React 18 (the `react18` vitest project): its development StrictMode discards the first mount
// render's hooks, refs included (React 19 keeps them), so that render's table never mounts (#25).
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const users = [
  { id: 1, age: 30 },
  { id: 2, age: 20 },
]

function lifecycle() {
  const counts = { init: 0, destroy: 0 }
  const interceptor = defineInterceptor({
    name: 'lifecycle',
    on: ['table:init', 'table:destroy'],
    intercept(ctx, next) {
      counts[ctx.op === 'table:init' ? 'init' : 'destroy']++
      return next()
    },
  })
  return { counts, interceptors: [interceptor] }
}

const flush = () => act(async () => await new Promise((r) => setTimeout(r, 0)))

let container: HTMLElement
afterEach(() => container?.remove())

async function mountUnmount(el: React.ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => root.render(<StrictMode>{el}</StrictMode>))
  await flush()
  const mounted = container.innerHTML
  await act(async () => root.unmount())
  await flush()
  return mounted
}

describe('React 18 StrictMode (development): no table leaks (#25)', () => {
  it('runs on React 18', () => {
    expect(version).toMatch(/^18\./)
  })

  it('useDataTable: every table created is destroyed after unmount, across remounts', async () => {
    const { counts, interceptors } = lifecycle()
    function T() {
      const t = useDataTable({ data: users, rowKey: 'id', interceptors })
      return <p>{t.rowModel.rows.length}</p>
    }
    expect(await mountUnmount(<T />)).toBe('<p>2</p>')
    expect(counts.destroy).toBe(counts.init)
    await mountUnmount(<T />)
    expect(counts.destroy).toBe(counts.init)
  })

  it('the committed table keeps working (not destroyed by the orphan sweep)', async () => {
    const { counts, interceptors } = lifecycle()
    let sort: (() => void) | undefined
    function T() {
      const t = useDataTable({ data: users, rowKey: 'id', features: [sorting()], interceptors })
      sort = () => t.toggleSort('age')
      return <p>{t.rowModel.rows.map((r) => r.key).join(',')}</p>
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () =>
      root.render(
        <StrictMode>
          <T />
        </StrictMode>,
      ),
    )
    await flush()
    expect(counts.init - counts.destroy).toBe(1)
    expect(container.textContent).toBe('1,2')
    await act(async () => sort?.())
    expect(container.textContent).toBe('2,1')
    await act(async () => root.unmount())
    await flush()
    expect(counts.destroy).toBe(counts.init)
  })

  it('<DataTable data>: every table created is destroyed after unmount', async () => {
    const { counts, interceptors } = lifecycle()
    const html = await mountUnmount(
      <DataTable data={users} rowKey="id" columns={[{ key: 'age' }]} interceptors={interceptors} />,
    )
    expect(html).toContain('<td>30</td>')
    expect(counts.destroy).toBe(counts.init)
  })
})
