// @vitest-environment node
import { REGISTRY_KEY, type VersionRegistry } from '@datakable/core'
import { renderToString } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { version } from '../package.json'
import { createTable, useDataTable } from './index'

type User = { id: number; name: string; age: number }
const users: User[] = [
  { id: 1, name: 'Ada Lovelace', age: 36 },
  { id: 2, name: 'Grace Hopper', age: 45 },
  { id: 3, name: 'Linus Torvalds', age: 28 },
  { id: 4, name: 'Ada Yonath', age: 70 },
]

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

/** A page that parses its URL into `initialState` (§7.2). */
function UsersPage({ url }: { url: string }) {
  const params = new URL(url).searchParams
  const q = params.get('q') ?? ''
  const t = useDataTable({
    data: users,
    columns: [{ key: 'name' }, { key: 'age' }],
    initialState: {
      search: { input: q, query: q, status: 'idle' },
      sorting: { by: params.get('sort') === 'age' ? [{ id: 'age', desc: true }] : [] },
    },
  })
  return (
    <ul>
      {t.rowModel.rows.map((r) => (
        <li key={r.key}>{r.original.name}</li>
      ))}
    </ul>
  )
}

describe('datakable SSR (§7.2, default preset)', () => {
  it('renderToString with ?q= is pre-filtered (and sorted), with no timer left', () => {
    expect(renderToString(<UsersPage url="https://x.test/users" />)).toBe(
      '<ul><li>Ada Lovelace</li><li>Grace Hopper</li><li>Linus Torvalds</li><li>Ada Yonath</li></ul>',
    )
    expect(renderToString(<UsersPage url="https://x.test/users?q=ada&sort=age" />)).toBe(
      '<ul><li>Ada Yonath</li><li>Ada Lovelace</li></ul>',
    )
    expect(vi.getTimerCount()).toBe(0)
  })

  it("registers 'datakable' in the version registry", () => {
    createTable({ data: users })
    const reg = (globalThis as unknown as Record<symbol, VersionRegistry | undefined>)[REGISTRY_KEY]
    expect(reg?.packages.datakable).toBe(version)
  })
})
