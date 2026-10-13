import { createTable } from '@datakable/core'

const users = [{ id: 1, name: 'Ada' }]

// @ts-expect-error `colums` is not an option: TypeScript catches the typo too
createTable({ data: users, colums: [{ key: 'name' }] })
