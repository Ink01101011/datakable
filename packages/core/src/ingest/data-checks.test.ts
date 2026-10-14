import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listDiagnosticCodes } from '../diagnostics/catalog'
import type { Diagnostic } from '../diagnostics/types'
import * as pkg from '../index'
import { createTable } from '../table/create-table'
import { createDerivedColumns, deriveColumns, INGEST_SAMPLE } from './derive-columns'

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

type Anyish = Record<string, unknown>

/** A table over `data` (and `columns`) collecting its diagnostics with the given codes. */
function collect(options: { data?: unknown[]; columns?: unknown[] }, prefix = 'DK_') {
  const seen: Diagnostic[] = []
  const t = createTable<Anyish>({
    ...(options as { data?: Anyish[] }),
    ...(options.columns ? { columns: options.columns as never } : {}),
    onDiagnostic: (d) => {
      if (d.code.startsWith(prefix)) seen.push(d)
    },
  })
  return { t, seen }
}

const codes = (seen: Diagnostic[]) => seen.map((d) => d.code)

describe('deriveColumns (zero-config, §4.1)', () => {
  it('is the union of top-level keys over the first rows, in first-seen order', () => {
    const cols = deriveColumns([
      { id: 1, name: 'a' },
      { id: 2, email: 'e' },
      { name: 'c', age: 3 },
    ])
    expect(cols).toEqual([{ key: 'id' }, { key: 'name' }, { key: 'email' }, { key: 'age' }])
  })

  it('skips function-valued keys (in any sampled row)', () => {
    const cols = deriveColumns([
      { id: 1, greet: () => 'hi' },
      { id: 2, greet: 'not a fn here', run() {} },
    ])
    expect(cols).toEqual([{ key: 'id' }])
  })

  it('reads only the first N rows (default 50)', () => {
    const data: Anyish[] = Array.from({ length: 100 }, (_, i) => ({ id: i }))
    data[INGEST_SAMPLE] = { id: 50, late: true }
    expect(deriveColumns(data)).toEqual([{ key: 'id' }])
    expect(deriveColumns(data, INGEST_SAMPLE + 1)).toEqual([{ key: 'id' }, { key: 'late' }])
  })

  it('ignores non-object rows, arrays rows and keys containing a dot', () => {
    expect(deriveColumns([null, 3, 'x', [1, 2], { a: 1, 'b.c': 2 }])).toEqual([{ key: 'a' }])
  })

  it('never throws on a throwing getter or Proxy trap', () => {
    const bad = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('trap')
        },
      },
    )
    const getter = Object.defineProperty({ ok: 1 }, 'boom', {
      enumerable: true,
      get() {
        throw new Error('getter')
      },
    })
    expect(deriveColumns([bad, getter])).toEqual([{ key: 'ok' }, { key: 'boom' }])
  })

  it('createDerivedColumns keeps the same array while the key list is unchanged', () => {
    const derive = createDerivedColumns()
    const a = derive([{ id: 1 }])
    expect(derive([{ id: 2 }])).toBe(a)
    expect(derive([{ id: 2, x: 1 }])).not.toBe(a)
  })
})

describe('zero-config columns in createTable', () => {
  it('rows read derived columns when columns is omitted', () => {
    const { t } = collect({ data: [{ id: 1, name: 'Ada', hello: () => 'x' }] })
    const row = t.getRowModel().rows[0]
    expect(row?.getValue('name')).toBe('Ada')
    expect(row?.getValue('hello')).toBeUndefined()
  })

  it('explicit columns win over derivation', () => {
    const { t } = collect({ data: [{ id: 1, name: 'Ada' }], columns: [{ key: 'id' }] })
    expect(t.getRowModel().rows[0]?.getValue('name')).toBeUndefined()
  })
})

describe('DK_COLUMN_PATH_NOT_FOUND (§5.3)', () => {
  it('a typo key: warn, column where, did-you-mean in details and fix', () => {
    const { seen } = collect({
      data: [{ name: 'a', age: 1 }],
      columns: [{ key: 'age' }, { key: 'nmae' }],
    })
    expect(codes(seen)).toEqual(['DK_COLUMN_PATH_NOT_FOUND'])
    const d = seen[0] as Diagnostic
    expect(d.level).toBe('warn')
    expect(d.where).toEqual({ kind: 'column', index: 1, id: 'nmae' })
    expect(d.details).toMatchObject({ column: 'nmae', index: 1, sampled: 1, suggestions: ['name'] })
    expect(d.problem).toContain('"nmae"')
    expect(d.fix[0]).toContain("key: 'name'")
    expect(d.context.trigger).toBe('data-change')
  })

  it('a nested typo suggests the nested path', () => {
    const { seen } = collect({
      data: [{ address: { city: 'X', geo: { lat: 1 } } }],
      columns: [{ key: 'address.ctiy' }, { key: 'address.geo.lta' }],
    })
    expect(seen.map((d) => (d.details.suggestions as string[])[0])).toEqual([
      'address.city',
      'address.geo.lat',
    ])
  })

  it('did-you-mean: transposition, case, one edit; best first', () => {
    const { seen } = collect({
      data: [{ email: 'e', userName: 'u', status: 's' }],
      columns: [{ key: 'emial' }, { key: 'username' }, { key: 'statu' }],
    })
    expect(seen.map((d) => (d.details.suggestions as string[])[0])).toEqual([
      'email',
      'userName',
      'status',
    ])
  })

  it('no suggestion when nothing is close: fix still concrete', () => {
    const { seen } = collect({ data: [{ id: 1 }], columns: [{ key: 'zzzzzz' }] })
    expect(seen[0]?.details).toMatchObject({ suggestions: [] })
    expect(seen[0]?.fix.length).toBeGreaterThan(0)
    expect(seen[0]?.fix.join(' ')).toContain('accessor')
  })

  it('text reads as English for one sampled row and no suggestion (#44)', () => {
    const one = collect({ data: [{ id: 1 }], columns: [{ key: 'zzz' }] }).seen[0] as Diagnostic
    expect(one.problem).toBe('columns[0] key "zzz" does not exist in the first row')
    expect(one.fix[0]).toBe("compute the value: columns[0]: { id: 'zzz', accessor: (row) => … }")
    const two = collect({ data: [{ id: 1 }, { id: 2 }], columns: [{ key: 'zzz' }] })
      .seen[0] as Diagnostic
    expect(two.problem).toBe('columns[0] key "zzz" does not exist in any of the first 2 rows')
    // With a suggestion first, the alternative keeps its "or".
    const typo = collect({ data: [{ name: 'a' }], columns: [{ key: 'nmae' }] })
      .seen[0] as Diagnostic
    expect(typo.fix[1]).toMatch(/^or compute the value/)
  })

  it('a path through a primitive is absent', () => {
    const { seen } = collect({ data: [{ name: 'Ada' }], columns: [{ key: 'name.first' }] })
    expect(codes(seen)).toEqual(['DK_COLUMN_PATH_NOT_FOUND'])
  })

  it('nullable intermediates are allowed (§4.1): no diagnostic', () => {
    const { seen } = collect({
      data: [{ manager: null }, { manager: { name: 'x' } }, { manager: undefined }],
      columns: [{ key: 'manager.name' }],
    })
    expect(seen).toEqual([])
  })

  it('a key that exists with value undefined is present', () => {
    const { seen } = collect({ data: [{ a: undefined }], columns: [{ key: 'a' }] })
    expect(seen).toEqual([])
  })

  it('array index paths and inherited getters count as present', () => {
    class P {
      get full() {
        return 'x'
      }
    }
    const { seen } = collect({
      data: [{ tags: ['a'], p: new P() }],
      columns: [{ key: 'tags.0' }, { key: 'p.full' }, { key: 'tags.length' }],
    })
    expect(seen).toEqual([])
  })

  it('accessor columns are not checked', () => {
    const { seen } = collect({ data: [{ a: 1 }], columns: [{ id: 'x', accessor: () => 1 }] })
    expect(seen).toEqual([])
  })

  it('empty data: nothing to check', () => {
    const { seen } = collect({ data: [], columns: [{ key: 'nope' }] })
    expect(seen).toEqual([])
  })
})

describe('inherited Object.prototype members are not row data (#42)', () => {
  it('a column key or rowKey naming one is not found and reads undefined', () => {
    const seen: Diagnostic[] = []
    const t = createTable({
      data: [{ id: 1 }] as Record<string, unknown>[],
      rowKey: 'constructor',
      columns: [{ key: 'id' }, { key: 'constructor' }, { key: 'toString' }, { key: '__proto__' }],
      onDiagnostic: (d) => seen.push(d),
    })
    const row = t.getRowModel().rows[0]
    expect(['constructor', 'toString', '__proto__'].map((k) => row?.getValue(k))).toEqual([
      undefined,
      undefined,
      undefined,
    ])
    expect(seen.filter((d) => d.code === 'DK_COLUMN_PATH_NOT_FOUND').length).toBe(3)
    const missing = seen.find((d) => d.code === 'DK_MISSING_ROW_KEY')
    expect(missing?.details).toMatchObject({ path: 'constructor', valueType: 'undefined' })
    expect(row?.key).toBe('#0')
  })
})

describe('DK_COLUMN_PATH_PARTIAL (§5.3)', () => {
  it('info with count + sample indices of the rows that lack it', () => {
    const data = Array.from({ length: 10 }, (_, i) => (i % 3 === 0 ? { id: i } : { id: i, e: 'x' }))
    const { seen } = collect({ data, columns: [{ key: 'id' }, { key: 'e' }] })
    expect(codes(seen)).toEqual(['DK_COLUMN_PATH_PARTIAL'])
    const d = seen[0] as Diagnostic
    expect(d.level).toBe('info')
    expect(d.where).toEqual({ kind: 'column', index: 1, id: 'e' })
    expect(d.details).toMatchObject({ column: 'e', count: 4, sampled: 10, rows: [0, 3, 6, 9] })
    expect(d.problem).toContain('4 of the first 10 rows')
    expect(d.fix.join(' ')).toContain('format')
  })

  it('caps the sample row list at 5', () => {
    const data = Array.from({ length: 20 }, (_, i) => (i < 12 ? { id: i } : { id: i, e: 1 }))
    const { seen } = collect({ data, columns: [{ key: 'e' }] })
    expect(seen[0]?.details).toMatchObject({ count: 12, rows: [0, 1, 2, 3, 4] })
  })
})

describe('DK_INCONSISTENT_ROW_SHAPE (§5.3, zero-config)', () => {
  it('lists the differing keys with their missing counts', () => {
    const { seen } = collect({
      data: [{ id: 1, name: 'a' }, { id: 2 }, { id: 3, name: 'c', extra: true }],
    })
    expect(codes(seen)).toEqual(['DK_INCONSISTENT_ROW_SHAPE'])
    const d = seen[0] as Diagnostic
    expect(d.level).toBe('info')
    expect(d.where).toEqual({ kind: 'option', path: 'columns' })
    expect(d.details).toMatchObject({
      sampled: 3,
      keys: [
        { key: 'name', missing: 1 },
        { key: 'extra', missing: 2 },
      ],
      rows: [0, 1],
    })
    expect(d.problem).toContain('"name"')
    expect(d.fix.join(' ')).toContain('columns')
  })

  it('consistent rows, or explicit columns: no shape diagnostic', () => {
    expect(collect({ data: [{ a: 1 }, { a: 2 }] }).seen).toEqual([])
    expect(
      collect({ data: [{ a: 1 }, { b: 2 }], columns: [{ id: 'x', accessor: () => 1 }] }).seen,
    ).toEqual([])
  })
})

describe('checks are bounded and never throw', () => {
  it('reads only the first rows of large data', () => {
    let reads = 0
    const data = Array.from({ length: 100_000 }, (_, i) =>
      i < INGEST_SAMPLE
        ? { a: 1 }
        : Object.defineProperty({}, 'a', {
            enumerable: true,
            get() {
              reads++
              return 1
            },
          }),
    )
    const late = new Proxy(
      {},
      {
        has() {
          reads++
          return true
        },
        ownKeys() {
          reads++
          return []
        },
      },
    )
    data[INGEST_SAMPLE + 1] = late
    collect({ data, columns: [{ key: 'a' }, { key: 'a.b' }] })
    collect({ data })
    expect(reads).toBe(0)
  })

  it('a throwing Proxy row is skipped, the table is created', () => {
    const trap = () => {
      throw new Error('trap')
    }
    const bad = new Proxy({}, { has: trap, get: trap, ownKeys: trap })
    expect(() =>
      collect({ data: [bad, { a: 1 }], columns: [{ key: 'a' }, { key: 'a.b' }] }),
    ).not.toThrow()
    expect(() => collect({ data: [bad, { a: 1 }] })).not.toThrow()
  })
})

describe('catalog', () => {
  it('the three codes are defined', () => {
    for (const code of [
      'DK_COLUMN_PATH_NOT_FOUND',
      'DK_COLUMN_PATH_PARTIAL',
      'DK_INCONSISTENT_ROW_SHAPE',
    ]) {
      expect(listDiagnosticCodes()).toContain(code)
    }
  })

  it('deriveColumns is exported from the package', () => {
    expect(pkg.deriveColumns).toBe(deriveColumns)
  })
})

describe('when checks run', () => {
  it('again on new data and on a columns change; not for the same data and columns', () => {
    const { t, seen } = collect({ data: [{ a: 1 }], columns: [{ key: 'b' }] })
    expect(seen).toHaveLength(1)
    const columns = [{ key: 'c' }]
    t.setOptions({ columns: columns as never })
    expect(seen.map((d) => d.details.column)).toEqual(['b', 'c'])
    t.setOptions({ columns: columns as never })
    t.setState({})
    expect(seen).toHaveLength(2)
    t.setOptions({ data: [{ a: 2 }] })
    expect(seen.map((d) => d.details.column)).toEqual(['b', 'c', 'c'])
  })

  it('data and columns changed together: checked once, against the new data', () => {
    const { t, seen } = collect({ data: [{ a: 1 }], columns: [{ key: 'a' }] })
    t.setOptions({ data: [{ b: 1 }], columns: [{ key: 'b' }] as never })
    expect(seen).toEqual([])
  })
})
