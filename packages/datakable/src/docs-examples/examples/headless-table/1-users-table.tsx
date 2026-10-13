import { useDataTable } from 'datakable'

export type User = { id: number; name: string; age: number; city: string }

const COLUMNS = [
  { id: 'name', label: 'Name' },
  { id: 'age', label: 'Age' },
  { id: 'city', label: 'City' },
] as const

const ariaSort = (dir: 'asc' | 'desc' | false) =>
  dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'

export function UsersTable({ users, cities }: { users: User[]; cities: string[] }) {
  // The default preset: column filters, validity, search, sorting and pagination.
  const table = useDataTable({ data: users, rowKey: 'id' })
  const { rows, filteredCount, totalCount } = table.rowModel
  const { pageIndex } = table.state.pagination
  const city = table.state.columnFilters.city

  return (
    <section>
      <input
        type="search"
        aria-label="Search users"
        placeholder="Search"
        value={table.state.search.input}
        onChange={(e) => void table.setSearch(e.target.value)}
      />
      <select
        aria-label="City"
        value={city?.type === 'equals' ? (city.value ?? '') : ''}
        onChange={(e) =>
          table.setColumnFilter(
            'city',
            e.target.value === '' ? undefined : { type: 'equals', value: e.target.value },
          )
        }
      >
        <option value="">All cities</option>
        {cities.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>

      <table>
        <thead>
          <tr>
            {COLUMNS.map(({ id, label }) => (
              <th key={id} aria-sort={ariaSort(table.getSortDirection(id))}>
                {/* Shift+click adds a second sort key. */}
                <button type="button" onClick={(e) => table.toggleSort(id, { multi: e.shiftKey })}>
                  {label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.original.name}</td>
              <td>{row.original.age}</td>
              <td>{row.original.city}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer>
        <button type="button" disabled={!table.canPrevPage()} onClick={table.prevPage}>
          Previous
        </button>
        <span>
          Page {pageIndex + 1} of {Math.max(table.getPageCount(), 1)} · {filteredCount} of{' '}
          {totalCount} users
        </span>
        <button type="button" disabled={!table.canNextPage()} onClick={table.nextPage}>
          Next
        </button>
      </footer>
    </section>
  )
}
