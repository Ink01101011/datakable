import { createTable, defineFeature } from '@datakable/core'

const users = [
  { id: 1, active: true },
  { id: 2, active: false },
]

// rowModel must return a Uint32Array of row indices, not a plain array.
const onlyActive = defineFeature({
  name: 'onlyActive',
  stage: 'filter',
  initialState: () => ({}),
  createApi: () => ({}),
  rowModel: (indices) =>
    Array.from(indices).filter((i) => users[i]?.active) as unknown as Uint32Array,
})

createTable({ data: users, features: [onlyActive] }).getRowModel()
