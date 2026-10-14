---
'@datakable/core': patch
'datakable': patch
---

New development-only warning `DK_CONTROLLED_SLICE_DROPPED`: feeding a change back with only the
slice that changed (`table.setOptions({ state: { sorting } })`) while you control several slices
used to release the others silently, because `setOptions` replaces the whole `state` option. It
now names the dropped slice and the fix (`setOptions({ state: { ...current, sorting } })`, or pass
the slice as `undefined` to release it on purpose). Deliberate releases (`state: {}`, an explicit
`undefined`, React's `state` prop dropping a slice outside a feed-back) stay silent. Nothing changes
in production builds. Fixes #49.
