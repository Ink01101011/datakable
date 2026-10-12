import { createDiagnostics, type Diagnostics } from '../diagnostics/hub'
import type { Emit } from '../diagnostics/types'

let hub: Diagnostics | undefined

/**
 * Emits outside any table (e.g. a deprecated helper called before `createTable`): a lazily created
 * table-less hub with the default console sink. Tables pass their own `emit` instead, so their
 * `onDiagnostic` sees the diagnostic.
 */
export const globalEmit: Emit = (code, details, options) => {
  hub ??= createDiagnostics({ name: 'datakable' })
  hub.emit(code, details, options)
}
