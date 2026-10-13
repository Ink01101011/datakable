import {
  type ColumnDef,
  DataTable,
  type InvalidCellContext,
  useDataTable,
  withSchema,
} from 'datakable'
import type { ReactNode } from 'react'
import { type Account, AccountSchema } from './1-account-schema'

// A flagged cell shows its raw value and the schema's message.
const flagged = ({ value, issues }: InvalidCellContext) => (
  <span title={issues.map((i) => i.message).join('; ')}>{String(value)} ⚠</span>
)

const columns: ColumnDef<Account, ReactNode>[] = [
  { key: 'id', header: 'ID' },
  { key: 'email', header: 'Email', invalidCell: flagged },
  { key: 'balance', header: 'Balance', invalidCell: flagged },
]

// `json` is raw input, e.g. `await res.json()`: every row is validated.
export function AccountsTable({ json }: { json: unknown[] }) {
  const table = useDataTable({
    data: json,
    schema: withSchema(AccountSchema), // the row type is the schema's output: Account
    invalidRows: 'flag', // keep invalid rows, marked; 'drop' (default) removes them
    rowKey: 'id',
    columns,
  })
  const invalid = table.getInvalidRows().length

  return (
    <section>
      <label>
        <input
          type="checkbox"
          checked={table.state.validity === 'invalid'}
          onChange={(e) => table.setValidity(e.target.checked ? 'invalid' : 'all')}
        />
        Show only the {invalid} invalid rows
      </label>
      {/* Flagged rows get data-invalid / aria-invalid; style them, or use styles.css. */}
      <DataTable table={table} caption="Accounts" />
    </section>
  )
}
