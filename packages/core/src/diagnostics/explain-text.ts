import type { RowExplanation, RowStep, TableExplanation } from './explain'

// Console text of explain() / explainRow() (§8.4). Development only: production `toString()` is the
// JSON of the structured result, so bundlers drop this module (§8.2 prod stripping).

const ms = (v: number | undefined) => (v === undefined ? '' : ` ${v.toFixed(1)} ms`)

/** `run 57 · trigger api:setSearch · 1203 rows → schema 1198 (5 dropped) → … → page 1/2 (10)` */
export function formatTableExplanation(e: TableExplanation): string {
  const parts: string[] = []
  if (e.schema) {
    const { mode, invalid } = e.schema
    const before = mode === 'flag' ? e.rows : e.rows + invalid
    parts.push(`${before} rows`)
    parts.push(`schema ${e.rows} (${invalid} ${mode === 'flag' ? 'flagged' : 'dropped'})`)
  } else parts.push(`${e.rows} rows`)
  for (const s of e.steps) {
    if (s.stage === 'paginate' && e.page) continue
    if (s.mode === 'server') {
      parts.push(`${s.feature} (server)`)
      continue
    }
    const flag = s.failed ? ' failed' : s.cached ? ' cached' : ''
    parts.push(`${s.feature} ${s.output}${flag}${ms(s.ms)}`)
  }
  if (e.page) parts.push(`page ${e.page.index + 1}/${e.page.count} (${e.visible})`)
  const open = e.diagnostics === 1 ? '1 open diagnostic' : `${e.diagnostics} open diagnostics`
  return (
    `run ${e.run}${ms(e.ms)} · trigger ${e.trigger} · ${parts.join(' → ')} · status ${e.status}` +
    ` · ${open}`
  )
}

const fmt = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v))

/** What a removing step did, in words. */
function reason(s: RowStep): string {
  const d = s.detail ?? {}
  if (s.stage === 'paginate' && typeof d.page === 'number') {
    return `on page ${d.page} of ${d.pageCount}, page ${d.currentPage} is shown`
  }
  if (s.stage === 'search') {
    const q = `query (${d.queryLength} chars)`
    return d.searchFn
      ? `${q}: not in the searchFn result`
      : `${q} did not match (threshold ${d.threshold})`
  }
  if (Array.isArray(d.filters)) {
    return (d.filters as Record<string, unknown>[])
      .map((f) => `${f.column} ${f.type} ${fmt(f.value)} → ${fmt(f.cell)} fails`)
      .join('; ')
  }
  if (d.validity !== undefined) {
    return `validity '${String(d.validity)}' hides ${d.flagged ? 'flagged' : 'valid'} rows`
  }
  return 'its rowModel did not return the row'
}

/** The fix for the removing step, best first. */
function fix(e: RowExplanation, s: RowStep | undefined): string {
  if (e.removedBy === 'schema') {
    return "correct the data at the issue paths, or invalidRows: 'flag' to keep invalid rows"
  }
  if (!s) return ''
  const d = s.detail ?? {}
  if (s.stage === 'paginate' && typeof d.page === 'number') return `setPageIndex(${d.page - 1})`
  if (s.stage === 'search') {
    if (d.searchFn) return 'check what searchFn returns for this query'
    const lower = Math.max(0, Math.round(((d.threshold as number) - 0.1) * 10) / 10)
    return `search({ threshold: ${lower} }) or check the query spelling`
  }
  if (Array.isArray(d.filters)) {
    const cols = (d.filters as { column: string }[]).map((f) => `'${f.column}'`)
    return `setColumnFilter(${cols[0]}, undefined) or resetColumnFilters()`
  }
  if (d.validity !== undefined) return "setValidity('all')"
  return `check table.getState().${s.feature}`
}

const pad = (name: string, width: number) => name.padEnd(width)

/** `✓ schema valid` / `✗ search query (8 chars) …  ← removed here` / `fix …` */
export function formatRowExplanation(e: RowExplanation): string {
  const key = fmt(e.key)
  if (!e.found) {
    return (
      `row ${key}: not found in the data (${e.rows} rows, run ${e.run})\n` +
      '  fix        check the key against rowKey (without rowKey the key is the row index)'
    )
  }
  const width = Math.max(8, ...e.steps.map((s) => s.feature.length)) + 1
  const where = e.index === undefined ? `options.data[${e.rawIndex}]` : `data index ${e.index}`
  const lines = [`row ${key} · ${where} · run ${e.run}${e.visible ? ' · visible' : ''}`]
  const issues = e.issues?.map((i) => `${i.path || '(root)'}: ${i.message}`).join('; ')
  if (e.schema === 'none') lines.push(`  – ${pad('schema', width)}no schema`)
  else if (e.schema === 'valid') lines.push(`  ✓ ${pad('schema', width)}valid`)
  else if (e.schema === 'flagged')
    lines.push(`  ✓ ${pad('schema', width)}flagged (kept): ${issues}`)
  else lines.push(`  ✗ ${pad('schema', width)}invalid: ${issues}   ← removed here`)
  let removing: RowStep | undefined
  for (const s of e.steps) {
    const name = pad(s.feature, width)
    if (s.outcome === 'removed') {
      removing = s
      lines.push(`  ✗ ${name}${reason(s)}   ← removed here`)
    } else if (s.outcome === 'kept' || s.outcome === 'failed') {
      const at = `position ${(s.position ?? 0) + 1} of ${s.of}`
      lines.push(
        s.outcome === 'kept'
          ? `  ✓ ${name}${at}`
          : `  ! ${name}failed in this run (input passed through); ${at}`,
      )
    } else if (s.outcome === 'skipped') lines.push(`  – ${name}skipped (server mode)`)
    else lines.push(`  · ${name}not reached`)
  }
  const f = fix(e, removing)
  if (f) lines.push(`  ${pad('fix', width + 2)}${f}`)
  return lines.join('\n')
}
