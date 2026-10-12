import { formatWhere } from './build'
import type { Diagnostic } from './types'

const ICON = { error: '✖', warn: '⚠', info: 'ℹ' } as const

/** The §8.1 console text: header + aligned body. Also usable by explain() and tests. */
export function formatDiagnostic(d: Diagnostic): { header: string; body: string } {
  const header = `${ICON[d.level]} [DataKable ${d.context.table}] ${d.code}: ${d.problem}`
  const lines = [`  where   ${formatWhere(d.where)}`]
  if (d.impact) lines.push(`  impact  ${d.impact}`)
  d.fix.forEach((f, i) => {
    lines.push(`${i === 0 ? '  fix     ' : '          '}${i + 1}. ${f}`)
  })
  lines.push(`  docs    ${d.docs}`)
  const c = d.context
  lines.push(`  context trigger=${c.trigger} run=${c.run} phase=${c.phase}`)
  return { header, body: lines.join('\n') }
}

export interface ConsoleSinkOptions {
  table: string
  dev: boolean
  rateLimit: { max: number; windowMs: number }
  now: () => number
}

/**
 * Default console sink (§8.2): dev prints one collapsed group per diagnostic; prod prints
 * error level only, on one line. A fixed-window rate limit protects the console; what it holds back
 * is still in getDiagnostics() and onDiagnostic.
 */
export function createConsoleSink(o: ConsoleSinkOptions): (d: Diagnostic) => void {
  let windowStart = Number.NEGATIVE_INFINITY
  let printed = 0
  let suppressed = 0
  return (d) => {
    if (!o.dev && d.level !== 'error') return
    const t = o.now()
    if (t - windowStart >= o.rateLimit.windowMs) {
      if (suppressed > 0) {
        console.warn(
          `[DataKable ${o.table}] ${suppressed} diagnostics were not printed (rate limit); ` +
            'read them with getDiagnostics() or onDiagnostic',
        )
      }
      windowStart = t
      printed = 0
      suppressed = 0
    }
    if (printed >= o.rateLimit.max) {
      suppressed++
      return
    }
    printed++
    if (!o.dev) {
      console.error(`[DataKable ${o.table}] ${d.code} at ${formatWhere(d.where)} — ${d.docs}`)
      return
    }
    const { header, body } = formatDiagnostic(d)
    console.groupCollapsed(header)
    ;(d.level === 'error' ? console.error : d.level === 'warn' ? console.warn : console.info)(body)
    console.groupEnd()
  }
}
