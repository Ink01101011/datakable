import { afterEach, describe, expect, it, vi } from 'vitest'
import { columnFilters } from '../features/column-filters'
import { createTable } from '../table/create-table'
import { buildDiagnostic } from './build'
import { formatDiagnostic } from './console'
import type { Diagnostic } from './types'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('development console sink', () => {
  // The Edge Runtime (Next middleware, Vercel Edge) console has log/info/warn/error/debug only.
  it('prints the grouped text without console.groupCollapsed / groupEnd (#53)', () => {
    const c = console as unknown as Record<string, unknown>
    const saved = { groupCollapsed: c.groupCollapsed, groupEnd: c.groupEnd }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})
    c.groupCollapsed = undefined
    c.groupEnd = undefined
    try {
      const t = createTable({ data: [{ id: 1 }], rowKey: 'id', columns: [{ key: 'zzz' as never }] })
      t.getRowModel()
    } finally {
      c.groupCollapsed = saved.groupCollapsed
      c.groupEnd = saved.groupEnd
    }
    expect(error).not.toHaveBeenCalled()
    const printed = warn.mock.calls.map((args) => String(args[0]))
    const block = printed.find((s) => s.includes('DK_COLUMN_PATH_NOT_FOUND'))
    // Header and body in one call, in the §8.1 layout.
    expect(block).toMatch(/^⚠ \[DataKable table#\d+\] DK_COLUMN_PATH_NOT_FOUND: .*\n {2}where /)
    expect(block).toContain('\n  fix     1. ')
  })
})

describe('development console sink: control characters (#104)', () => {
  // The audit's PoC: a URL-restored filter key carrying a forged header line, ANSI colours and an
  // OSC-8 hyperlink.
  const KEY =
    'x\n✖ [DataKable table#1] DK_FAKE: forged line\u001b[31m RED \u001b[0m' +
    '\u001b]8;;https://evil.example\u0007link\u001b]8;;\u0007\r\u0085\u009b\u007f\u2028'

  it('escapes C0/C1 controls, DEL and line breaks in what it prints; onDiagnostic keeps the raw key', () => {
    const out: string[] = []
    const capture = (...args: unknown[]) => {
      out.push(args.map(String).join(' '))
    }
    for (const m of ['warn', 'error', 'info', 'log', 'groupCollapsed'] as const) {
      vi.spyOn(console, m).mockImplementation(capture)
    }
    const seen: Diagnostic[] = []
    const t = createTable({
      data: [{ id: 1 }],
      rowKey: 'id',
      columns: [{ key: 'id' }],
      features: [columnFilters()],
      initialState: { columnFilters: { [KEY]: { type: 'equals', value: 1 } } as never },
      onDiagnostic: (d) => seen.push(d),
    })
    t.getRowModel()
    expect(seen.map((d) => d.code)).toContain('DK_STATE_UNKNOWN_KEY')
    const text = out.join('\n')
    expect(text).toContain('DK_STATE_UNKNOWN_KEY')
    // No raw control byte reaches the console, and no printed line starts with the forged header.
    // (Bodies are multi-line by design, so count lines that start a diagnostic.)
    expect(text.split('\u001b')).toHaveLength(1)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the characters under test
    expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/)
    expect(text.split('\n').filter((l) => l.includes('DK_FAKE') && /^\s*✖/.test(l))).toEqual([])
    // Visible escapes instead.
    expect(text).toContain('x\\n✖ [DataKable table#1] DK_FAKE')
    expect(text).toContain('\\u001b[31m')
    expect(text).toContain('\\u0007')
    expect(text).toContain('\\u000d\\u0085\\u009b\\u007f\\u2028')
    // The structured diagnostic is unchanged.
    const d = seen.find((x) => x.code === 'DK_STATE_UNKNOWN_KEY')
    expect(d?.details.key).toBe(KEY)
  })

  it('formatDiagnostic escapes the table name, problem and where', () => {
    const d = buildDiagnostic(
      'DK_STATE_UNKNOWN_KEY',
      { slice: 'columnFilters', key: 'a\u001bb', known: [] },
      { dev: true, table: 't\nu' },
    )
    const { header, body } = formatDiagnostic(d)
    expect(header).not.toContain('\n')
    expect(header).not.toContain('\u001b')
    expect(header).toContain('[DataKable t\\nu]')
    expect(`${header}\n${body}`).not.toContain('\u001b')
    expect(body).toContain('a\\u001bb')
  })
})
