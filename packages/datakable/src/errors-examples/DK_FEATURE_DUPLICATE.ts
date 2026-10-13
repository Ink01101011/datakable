import { createTable, defaultFeatures, sorting } from '@datakable/core'

createTable({
  data: [{ id: 1, name: 'Ada' }],
  // defaultFeatures already has sorting(): this adds a second one.
  features: [...defaultFeatures, sorting({ locale: 'de' })],
})
