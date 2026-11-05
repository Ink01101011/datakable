/**
 * Internal (#98), not exported: a feature's `[RELEASE]()` drops its per-instance caches. The table
 * calls it on `destroy()`, so a destroyed table still referenced (a ref, a store, StrictMode's
 * double mount) does not keep them.
 */
export const RELEASE = /* @__PURE__ */ Symbol()

/** Development only, for tests (#98): `[PROBE]()` returns what a feature / the table still holds. */
export const PROBE = /* @__PURE__ */ Symbol()

export interface Releasable {
  [RELEASE]?: () => void
  [PROBE]?: () => Record<string, unknown>
}
