import { describe, expectTypeOf, it } from 'vitest'
import {
  createTable,
  type FlaggedRow,
  type InvalidRow,
  type Row,
  type RowIssue,
  type StandardSchemaV1,
} from '../index'

type User = { id: number; name: string; age: number; joined: Date }
declare const userSchema: StandardSchemaV1<{ id: number; name: string; age: string }, User>
declare const json: unknown[]

describe('schema: T is inferred from InferOutput<schema> (§5.1)', () => {
  it('rows, columns and getData() are typed by the schema output; data is unknown input', () => {
    const t = createTable({
      schema: userSchema,
      data: json,
      columns: [
        { key: 'age', filter: { type: 'range' } },
        { id: 'label', accessor: (u) => u.name.toUpperCase() },
      ],
    })
    expectTypeOf(t.getData()).toEqualTypeOf<readonly User[]>()
    expectTypeOf(t.getRowModel().rows).toEqualTypeOf<readonly Row<User>[]>()
    expectTypeOf(t.getInvalidRows()).toEqualTypeOf<readonly InvalidRow[]>()
    expectTypeOf<InvalidRow['raw']>().toEqualTypeOf<unknown>()
    expectTypeOf<InvalidRow['issues']>().toEqualTypeOf<readonly RowIssue[]>()
  })

  it('column keys are checked against the schema output', () => {
    createTable({
      schema: userSchema,
      data: json,
      // @ts-expect-error: 'nmae' is not a path of the schema output
      columns: [{ key: 'nmae' }],
    })
    createTable({
      schema: userSchema,
      // @ts-expect-error: range is not a string filter
      columns: [{ key: 'name', filter: { type: 'range' } }],
    })
  })

  it('without a schema, T is still inferred from data (and explicit type args still work)', () => {
    const users: User[] = []
    expectTypeOf(createTable({ data: users }).getData()).toEqualTypeOf<readonly User[]>()
    expectTypeOf(createTable<User>({}).getRowModel().rows).toEqualTypeOf<readonly Row<User>[]>()
  })

  it("invalidRows: 'drop' / 'throw' keep Row<T>", () => {
    const d = createTable({ schema: userSchema, data: json, invalidRows: 'drop' })
    expectTypeOf(d.getRowModel().rows).toEqualTypeOf<readonly Row<User>[]>()
    const t = createTable({ schema: userSchema, data: json, invalidRows: 'throw' })
    expectTypeOf(t.getRowModel().rows).toEqualTypeOf<readonly Row<User>[]>()
  })
})

describe("invalidRows: 'flag' makes Row<T> a union narrowed on valid", () => {
  it('rows are FlaggedRow<T>', () => {
    const t = createTable({ schema: userSchema, data: json, invalidRows: 'flag' })
    expectTypeOf(t.getRowModel().rows).toEqualTypeOf<readonly FlaggedRow<User>[]>()
  })

  it('valid narrows original to T; invalid rows have original: unknown and issues', () => {
    const t = createTable({ schema: userSchema, data: json, invalidRows: 'flag' })
    const row = t.getRowModel().rows[0]
    if (!row) return
    // Not narrowed: original could be either.
    expectTypeOf(row.original).toEqualTypeOf<unknown>()
    if (row.valid) {
      expectTypeOf(row.original).toEqualTypeOf<User>()
      expectTypeOf(row.original.joined).toEqualTypeOf<Date>()
    } else {
      expectTypeOf(row.original).toEqualTypeOf<unknown>()
      expectTypeOf(row.issues).toEqualTypeOf<readonly RowIssue[]>()
      expectTypeOf(row.getCellIssues('age')).toEqualTypeOf<readonly RowIssue[]>()
      // @ts-expect-error: an invalid row's original is unknown
      void row.original.name
    }
  })
})
