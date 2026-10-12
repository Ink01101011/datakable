import { describe, it } from 'vitest'
import { createTable, pagination, withFetcher } from '../index'

type User = { id: number; name: string }
declare const fetchUsers: () => Promise<{ rows: User[]; rowCount: number }>

describe('fetcher: opt in with withFetcher() (changed 2026-10-13 for §9.3)', () => {
  it('a raw fetcher is a compile error; a wrapped one types the rows', () => {
    // @ts-expect-error: fetcher takes withFetcher(fetchUsers) from @datakable/core/server
    createTable({ fetcher: fetchUsers, features: [pagination({ mode: 'server' })] })
    const t = createTable({
      fetcher: withFetcher(fetchUsers),
      features: [pagination({ mode: 'server' })],
      columns: [{ key: 'name' }],
    })
    t.getRowModel().rows[0]?.original.name satisfies string | undefined
  })
})
