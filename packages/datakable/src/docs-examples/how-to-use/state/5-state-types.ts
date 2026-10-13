import {
  type ColumnFiltersState,
  createTable,
  type PaginationState,
  type SearchState,
  type SortingState,
  type ValidityState,
} from 'datakable'

type User = { id: number; name: string; age: number }
declare const users: User[]

const table = createTable({ data: users, rowKey: 'id' })

// The state type is built from the installed features, typed against User:
type State = ReturnType<typeof table.getState>
const state: State = table.getState()

const filters: ColumnFiltersState<User> = state.columnFilters
const validity: ValidityState = state.validity
const search: SearchState = state.search
const sorting: SortingState<User> = state.sorting
const pagination: PaginationState = state.pagination
console.log(filters, validity, search.query, sorting.by, pagination.pageSize)
