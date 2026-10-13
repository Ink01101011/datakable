import { createTable, defineFeature } from '@datakable/core'

type Density = 'compact' | 'comfortable'

// State and API do not depend on the row type: no type arguments, both are inferred.
// `stage: 'none'`: state and API only, no pipeline step.
const density = () =>
  defineFeature({
    name: 'density',
    stage: 'none',
    initialState: (): Density => 'comfortable',
    createApi: (ctx) => ({
      setDensity: (value: Density) => ctx.setState(value),
      toggleDensity: () => ctx.setState((d) => (d === 'compact' ? 'comfortable' : 'compact')),
    }),
  })

type User = { id: number; name: string }
declare const users: User[]

const table = createTable({ data: users, features: [density()] })
table.toggleDensity()
const value: Density = table.getState().density
console.log(value)
