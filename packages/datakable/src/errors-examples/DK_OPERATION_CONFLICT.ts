import { registerOperation } from '@datakable/core'

declare module '@datakable/core' {
  interface Operations {
    'export:csv': { kind: 'sync'; input: { rows: number }; output: string }
  }
}

// Two plugins register the same operation with different contracts.
registerOperation('export:csv', { kind: 'sync', hot: false }) // plugin A
registerOperation('export:csv', { kind: 'sync', hot: true }) // plugin B
