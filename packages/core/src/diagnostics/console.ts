import { formatWhere } from './build'
import { DEV } from './env'
import type { Diagnostic } from './types'

const ICON = { error: '✖', warn: '⚠', info: 'ℹ' } as const

/**
 * Console text is printed with its C0 / C1 control characters, DEL and line breaks escaped
 * (`\u001b`, `\n`, ...): ids, keys and table names can come from URLs or data, and must not
 * forge a line or send terminal escapes (#104). The diagnostic object keeps the raw values.
 */
const printable = (s: string): string =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the characters to escape
  s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, (c) =>
    c === '\n' ? '\\n' : `\\u${(c.charCodeAt(0) + 0x10000).toString(16).slice(1)}`,
  )

/**
 * The §8.1 console text: header + aligned body, each line {@link printable}. Also usable by
 * explain() and tests.
 */
export function formatDiagnostic(d: Diagnostic): { header: string; body: string } {
  const header = printable(
    `${ICON[d.level]} [DataKable ${d.context.table}] ${d.code}: ${d.problem}`,
  )
  const lines = [`  where   ${formatWhere(d.where)}`]
  if (d.impact) lines.push(`  impact  ${d.impact}`)
  d.fix.forEach((f, i) => {
    lines.push(`${i === 0 ? '  fix     ' : '          '}${i + 1}. ${f}`)
  })
  lines.push(`  docs    ${d.docs}`)
  const c = d.context
  lines.push(`  context trigger=${c.trigger} run=${c.run} phase=${c.phase}`)
  return { header, body: lines.map(printable).join('\n') }
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
  // The grouped format is development-only: a production build prints one line (§8.2). `DEV` is
  // read inline so the bundler drops the grouped branch.
  return (d) => {
    if ((!DEV || !o.dev) && d.level !== 'error') return
    const t = o.now()
    if (t - windowStart >= o.rateLimit.windowMs) {
      if (suppressed > 0) {
        console.warn(
          `[DataKable ${printable(o.table)}] ${suppressed} diagnostics were not printed (rate limit); ` +
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
    // `DEV &&` first, not an early `if (!DEV) return`: a branch that folds to `false` is removed
    // while parsing, so a production bundle keeps no `formatDiagnostic` (code after a folded early
    // return is dropped only when printing, after tree shaking kept what it calls).
    if (DEV && o.dev) {
      const { header, body } = formatDiagnostic(d)
      const log = d.level === 'error' ? 'error' : d.level === 'warn' ? 'warn' : 'info'
      // Runtimes without console groups (the Edge Runtime: log/info/warn/error/debug only) get the
      // same text as one call.
      if (typeof console.groupCollapsed !== 'function' || typeof console.groupEnd !== 'function') {
        console[log](`${header}\n${body}`)
        return
      }
      console.groupCollapsed(header)
      console[log](body)
      console.groupEnd()
      return
    }
    console.error(
      printable(`[DataKable ${o.table}] ${d.code} at ${formatWhere(d.where)} — ${d.docs}`),
    )
  }
}
