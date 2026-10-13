import type { AnyFeature } from '../feature/types'
import { type ExplainHost, pageCount, pageOf, shownPage } from './explain'
import { type Redactor, redactDetails } from './redact'
import type { Location } from './types'

/**
 * Why step `f` removed row `index` (redacted), per stage; `undefined` when nothing more is known.
 * Part of the feature runtime (`feature/runtime.ts`): a table without features never needs it.
 */
export function explainDetail(
  host: ExplainHost,
  f: AnyFeature,
  input: Uint32Array,
  index: number,
  r: Redactor,
  where: Location,
): Record<string, unknown> | undefined {
  const slice = host.state()[f.name]
  if (f.stage === 'paginate') {
    const p = pageOf(host)
    if (!p) return undefined
    const count = pageCount(input.length, p.size)
    return {
      page: Math.floor(input.indexOf(index) / p.size) + 1,
      pageCount: count,
      currentPage: shownPage(p.index, count) + 1,
    }
  }
  if (f.stage === 'search') {
    const s = slice as { query?: unknown } | undefined
    const values = f.options?.values
    return {
      queryLength: typeof s?.query === 'string' ? s.query.trim().length : 0,
      ...(typeof values?.searchFn === 'function'
        ? { searchFn: true }
        : { threshold: typeof values?.threshold === 'number' ? values.threshold : 0.3 }),
    }
  }
  if (f.name === 'validity') return { validity: slice, flagged: host.schema()?.flagged?.has(index) }
  if (f.name !== 'columnFilters' || slice === null || typeof slice !== 'object') return undefined
  // Each column filter replayed alone on this row names the ones that reject it. The step is pure
  // (other features may keep caches, so only this one is replayed); the replay context drops
  // diagnostics and runs batches without interceptors.
  const rowModel = f.rowModel as NonNullable<AnyFeature['rowModel']>
  const ctx = host.replay(f.name)
  const one = Uint32Array.of(index)
  const filters: Record<string, unknown>[] = []
  for (const [column, filter] of Object.entries(slice as Record<string, unknown>)) {
    if (filter === undefined) continue
    let kept: number
    try {
      kept = rowModel(one, { [column]: filter }, ctx).length
    } catch {
      kept = 0
    }
    if (kept > 0) continue
    const value = (filter as { value?: unknown } | null)?.value
    const cell = ctx.getColumnValues(column)?.[index]
    const shown = redactDetails(
      { column, value, cell },
      { value: 'value', cell: 'value' },
      where,
      r,
    )
    filters.push({
      column,
      type: String((filter as { type?: unknown } | null)?.type),
      value: shown.value,
      cell: shown.cell,
    })
  }
  return filters.length > 0 ? { filters } : undefined
}
