import type { Emit } from '../diagnostics/types'
import { globalEmit } from './global'
import { firstInSession } from './registry'

/** A capability a feature needs from a runtime dependency (`exsorted`, `ex-search`, `kk-debounce`). */
export interface DependencyCapability {
  /** The feature that uses it (diagnostic `where`). */
  readonly feature: string
  readonly dependency: string
  /** e.g. `timSort`, `autoAbort`. */
  readonly capability: string
  /** The supported dependency range, e.g. `^1.2.3`. */
  readonly supported: string
  /** What the feature uses instead, e.g. `Array.prototype.sort (native, stable)`. */
  readonly fallback: string
}

/**
 * `probe()` returned `true` (a throw counts as missing). Production callers use it alone: the
 * report (`detectCapability`) is a development check (§8.5), the fallback is not.
 */
export function hasCapability(probe: () => boolean): boolean {
  try {
    return probe() === true
  } catch {
    return false
  }
}

/**
 * Feature-detects a dependency capability (§8.5): `probe` returns `true` when it is usable; a throw
 * counts as missing. A missing one is reported once per session (`DK_DEP_INCOMPATIBLE`) and the
 * caller takes its fallback. Run it once per feature instance, not per call.
 */
export function detectCapability(
  probe: () => boolean,
  info: DependencyCapability,
  emit: Emit = globalEmit,
): boolean {
  if (hasCapability(probe)) return true
  if (firstInSession(`DK_DEP_INCOMPATIBLE:${info.dependency}:${info.capability}`)) {
    const { feature, dependency, capability, supported, fallback } = info
    emit('DK_DEP_INCOMPATIBLE', { feature, dependency, capability, supported, fallback })
  }
  return false
}
