import { createTable, defineFeature } from '@datakable/core'

// A plugin built for a future major version of core.
const heatmap = defineFeature({
  name: 'heatmap',
  stage: 'none',
  requires: { core: '^2.0.0' },
  initialState: () => ({}),
  createApi: () => ({}),
})

createTable({ data: [], features: [heatmap] })
