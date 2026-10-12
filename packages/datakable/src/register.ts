import { registerPackage } from '@datakable/core'
import { version } from '../package.json'

let registered = false

/**
 * Registers `datakable` in the version registry (§8.5, `DK_VERSION_MISMATCH`) on the first table or
 * hook call — not at import, so the package keeps `sideEffects: false`.
 */
export function registerDatakable(): void {
  if (registered) return
  registered = true
  registerPackage('datakable', version)
}
