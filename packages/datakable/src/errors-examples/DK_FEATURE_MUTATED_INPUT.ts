import { createTable, defineFeature } from '@datakable/core'

// Sorts its input in place: the input is the previous step's (memoised) output.
const newestFirst = defineFeature({
  name: 'newestFirst',
  stage: 'sort',
  initialState: () => ({}),
  createApi: () => ({}),
  rowModel: (indices) => indices.sort((a, b) => b - a),
})

createTable({ data: [{ id: 1 }, { id: 2 }, { id: 3 }], features: [newestFirst] }).getRowModel()
