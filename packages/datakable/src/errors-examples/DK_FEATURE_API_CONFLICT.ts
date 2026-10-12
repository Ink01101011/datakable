import { createTable, defineFeature, sorting } from '@datakable/core'

// A plugin that adds its own toggleSort: sorting() already has one.
const quickSort = defineFeature({
  name: 'quickSort',
  stage: 'none',
  initialState: () => ({}),
  createApi: () => ({ toggleSort: (id: string) => void id }),
})

createTable({ data: [{ id: 1, name: 'Ada' }], features: [sorting(), quickSort] })
