import { createDefaultFeatures, createTable, defaultFeatures } from '@datakable/core'

type User = { id: number; name: string }
declare const users: User[]
declare const admins: User[]

// One table: the shared `defaultFeatures` instances are fine.
const single = createTable({ data: users, features: defaultFeatures })

// Several tables: give each its own instances, so they do not share a feature's caches.
const left = createTable({ data: users, features: createDefaultFeatures() })
const right = createTable({ data: admins, features: createDefaultFeatures() })

single.toggleSort('name')
left.toggleSort('name')
right.toggleSort('name')
