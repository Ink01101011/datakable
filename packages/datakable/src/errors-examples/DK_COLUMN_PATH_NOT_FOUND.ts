import { createTable } from '@datakable/core'

const users = [
  { id: 1, name: 'Ada', age: 36 },
  { id: 2, name: 'Grace', age: 45 },
]

// A typo, or a column written for another API shape (untyped data hides it from TypeScript).
// @ts-expect-error 'agee' is not a path of the row: TypeScript catches the typo too
createTable({ data: users, columns: [{ key: 'name' }, { key: 'agee' }] })
