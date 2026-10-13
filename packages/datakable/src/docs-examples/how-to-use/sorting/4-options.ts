import { createTable } from '@datakable/core'
import { sorting } from '@datakable/core/sorting'

type City = { id: number; name: string; population: number }
declare const cities: City[]

const table = createTable({
  data: cities,
  rowKey: 'id',
  features: [
    sorting({
      locale: 'th', // strings compare with Intl.Collator('th', { numeric: true })
      debug: true, // reports DK_SORT_STRATEGY (info): the algorithm chosen, why, n and the time
      // A custom algorithm sorts the row indices with the comparator DataKable built
      // (it must return a Uint32Array of the same length; typed-array sort is stable).
      algorithm: (indices, compare) => indices.sort(compare),
    }),
  ],
})

table.toggleSort('name')
