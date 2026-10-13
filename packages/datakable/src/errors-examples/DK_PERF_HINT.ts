import { createTable, defineFeature } from '@datakable/core'

// A filter step that blocks the main thread for ~60 ms (over the 50 ms budget of one task).
const slowFilter = defineFeature({
  name: 'slowFilter',
  stage: 'filter',
  initialState: () => ({}),
  createApi: () => ({}),
  rowModel: (indices) => {
    const end = performance.now() + 60
    while (performance.now() < end) {
      // e.g. a regex or Intl call per row on a large table
    }
    return indices
  },
})

createTable({ data: [{ id: 1 }, { id: 2 }], features: [slowFilter] }).getRowModel()
