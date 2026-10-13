import { createTable, defineFeature } from '@datakable/core'

// A plugin whose filter step throws on rows it did not expect.
const onlyActive = defineFeature({
  name: 'onlyActive',
  stage: 'filter',
  initialState: () => ({}),
  createApi: () => ({}),
  rowModel: (indices) => {
    throw new TypeError(`cannot read 'active' of ${indices.length} rows`)
  },
})

const table = createTable({ data: [{ id: 1 }, { id: 2 }], features: [onlyActive] })
table.getRowModel() // both rows: the step passed its input through
