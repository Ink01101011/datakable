import { throwConfigError } from '../diagnostics/build'
import { keepDiagnostics } from '../diagnostics/catalog'
import type { Emit } from '../diagnostics/types'
import type { AnyFeature } from '../feature/types'
import { VERSION } from '../version'
import { FIXED_GROUP, versioningDiagnostics } from './codes'
import { satisfies } from './semver'

keepDiagnostics(versioningDiagnostics)

/** `globalThis[Symbol.for('datakable')]`: shared by every copy of core in the process (§8.5). */
export const REGISTRY_KEY: unique symbol = Symbol.for('datakable') as never

interface CoreEntry {
  readonly version: string
}

/** Version 1 of the registry shape. Later cores must keep these fields readable. */
export interface VersionRegistry {
  v: number
  /** One entry per core copy that created a table, in registration order. */
  cores: CoreEntry[]
  /** Fixed-group package → version (`registerPackage`). */
  packages: Record<string, string>
  /** Once-per-session keys (deprecations, dependency capabilities). */
  reported: Set<string>
}

/** This copy of core; its identity tells copies apart even when their versions are equal. */
const self: CoreEntry = { version: VERSION }
/** `package@version` pairs this copy already reported as mismatched. */
const mismatched = new Set<string>()
let local: VersionRegistry | undefined

const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object'

/**
 * The global registry, created on first use. Fields are read defensively: a registry left by
 * another core version (or anything else under the symbol) is repaired, never trusted to throw.
 */
export function getVersionRegistry(): VersionRegistry {
  const g = globalThis as unknown as Record<symbol, unknown>
  try {
    let r = g[REGISTRY_KEY]
    if (!isObject(r)) {
      r = {}
      g[REGISTRY_KEY] = r
    }
    const reg = r as Partial<VersionRegistry>
    if (typeof reg.v !== 'number') reg.v = 1
    if (!Array.isArray(reg.cores)) reg.cores = []
    if (!isObject(reg.packages)) reg.packages = {}
    if (!(reg.reported instanceof Set)) reg.reported = new Set()
    return reg as VersionRegistry
  } catch {
    // Frozen / non-writable global: fall back to a per-copy registry (no cross-copy detection).
    local ??= { v: 1, cores: [], packages: {}, reported: new Set() }
    return local
  }
}

/**
 * Records a fixed-group package's version (`@datakable/react`, `datakable`) so `createTable` can
 * report `DK_VERSION_MISMATCH`. Called once by each binding when it is first used.
 */
export function registerPackage(name: string, version: string): void {
  getVersionRegistry().packages[name] = version
}

/** `true` the first time `key` is seen in this session (across core copies). */
export function firstInSession(key: string): boolean {
  const reported = getVersionRegistry().reported
  if (reported.has(key)) return false
  reported.add(key)
  return true
}

/**
 * Version checks of one `createTable` (§8.5), cold path:
 * - feature `requires.core` against this core → `DatakableConfigError` `DK_FEATURE_INCOMPATIBLE`;
 * - registers this copy on its first table; a copy finding another one → `DK_DUPLICATE_CORE` (once);
 * - fixed-group packages with another version → `DK_VERSION_MISMATCH` (once per package version).
 */
export function checkVersions(features: readonly AnyFeature[], emit: Emit, table: string): void {
  for (const f of features) {
    const required = f.requires?.core
    if (required === undefined) continue
    const ok = typeof required === 'string' ? satisfies(VERSION, required) : undefined
    if (ok === true) continue
    throwConfigError(
      'DK_FEATURE_INCOMPATIBLE',
      { feature: f.name, required: String(required), core: VERSION, invalid: ok === undefined },
      { table },
    )
  }
  const reg = getVersionRegistry()
  if (!reg.cores.includes(self)) {
    reg.cores.push(self)
    if (reg.cores.length > 1) {
      emit('DK_DUPLICATE_CORE', { versions: reg.cores.map((c) => String(c?.version)) })
    }
  }
  for (const name of FIXED_GROUP) {
    const version = reg.packages[name]
    if (typeof version !== 'string' || version === VERSION) continue
    const key = `${name}@${version}`
    if (mismatched.has(key)) continue
    mismatched.add(key)
    emit('DK_VERSION_MISMATCH', { package: name, version, core: VERSION })
  }
}
