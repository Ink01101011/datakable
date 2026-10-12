import { registerPackage } from '@datakable/core'
import { version } from '../package.json'

// No @types/node here: declare just what is read.
declare const process: { env: { NODE_ENV?: string } }

let registered = false

/**
 * Registers `datakable` in the version registry (§8.5, `DK_VERSION_MISMATCH`) on the first table or
 * hook call — not at import, so the package keeps `sideEffects: false`. Development only: the
 * version checks are (§8.5), so production bundles no registry.
 */
export function registerDatakable(): void {
  // Written out (not a module-level flag) so bundlers fold it while parsing (§8.2).
  if (process.env.NODE_ENV === 'production' || registered) return
  registered = true
  registerPackage('datakable', version)
}
