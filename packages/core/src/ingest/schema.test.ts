import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DatakableConfigError, DatakableError } from '../diagnostics/build'
import type { Diagnostic } from '../diagnostics/types'
import { defineFeature } from '../feature/define'
import type { AnyFeature } from '../feature/types'
import { createTable } from '../table/create-table'
import { DatakableSchemaError } from './schema'
import { makeSchema, type User, userCheck, userSchema } from './test-schemas'

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}
const codes = () => seen.map((d) => d.code)
const find = (code: string) => seen.find((d) => d.code === code)

beforeEach(() => {
  seen = []
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {})
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

const raw: unknown[] = [
  { id: 1, name: 'Ada', age: 36 },
  { id: 2, name: 'Bob', age: 'SECRET-AGE' },
  { id: 3, name: 'Cy', age: '41' },
]
const columns = [{ key: 'name' }, { key: 'age' }] as const
const tick = () => new Promise((r) => setTimeout(r, 0))

describe("schema: invalidRows 'drop' (default)", () => {
  it('removes invalid rows; data holds the validated output values', () => {
    const t = createTable({ schema: userSchema, data: raw, columns, onDiagnostic })
    const m = t.getRowModel()
    expect(m.totalCount).toBe(2)
    expect(m.rows.map((r) => r.original)).toEqual([
      { id: 1, name: 'Ada', age: 36 },
      { id: 3, name: 'Cy', age: 41 },
    ])
    expect(m.rows.every((r) => r.valid)).toBe(true)
    expect(m.status).toBe('idle')
  })

  it('getInvalidRows() lists { index, raw, issues } with the raw data index', () => {
    const t = createTable({ schema: userSchema, data: raw, columns, onDiagnostic })
    expect(t.getInvalidRows()).toEqual([
      {
        index: 1,
        raw: raw[1],
        issues: [{ message: 'Expected number, received "SECRET-AGE"', path: [{ key: 'age' }] }],
      },
    ])
  })

  it('reports DK_SCHEMA_INVALID_ROW once, mapping the issue path to the column', () => {
    const t = createTable({ schema: userSchema, data: raw, columns, onDiagnostic })
    t.getRowModel()
    expect(codes()).toEqual(['DK_SCHEMA_INVALID_ROW'])
    const d = find('DK_SCHEMA_INVALID_ROW') as Diagnostic
    expect(d.level).toBe('error')
    expect(d.where).toEqual({ kind: 'option', path: 'schema' })
    expect(d.details).toMatchObject({ mode: 'drop', count: 1, total: 3, rows: [1] })
    expect(d.details.columns).toEqual([{ path: 'age', column: 'age', index: 1, count: 1 }])
    expect(d.problem).toContain('1 of 3 rows')
    expect(d.impact).toContain('removed')
    expect(d.fix.join('\n')).toContain('columns[1]')
    expect(d.fix.join('\n')).toContain("invalidRows: 'flag'")
  })

  it('getInvalidRows() is empty without a schema and after valid data replaces invalid data', () => {
    expect(createTable({ data: [{ a: 1 }] }).getInvalidRows()).toEqual([])
    const t = createTable({ schema: userSchema, data: raw, onDiagnostic })
    expect(t.getInvalidRows()).toHaveLength(1)
    t.setOptions({ data: [{ id: 9, name: 'Z', age: 1 }] })
    expect(t.getInvalidRows()).toEqual([])
    expect(t.getRowModel().totalCount).toBe(1)
  })

  it('validation runs once per data reference (memoised)', () => {
    const check = vi.fn(userCheck)
    const t = createTable({ schema: makeSchema(check), data: raw, onDiagnostic })
    expect(check).toHaveBeenCalledTimes(3)
    const other = [{ id: 5, name: 'E', age: 5 }]
    t.setOptions({ data: other })
    t.setOptions({ data: raw })
    expect(check).toHaveBeenCalledTimes(4)
    expect(t.getInvalidRows()).toHaveLength(1)
  })
})

describe("schema: invalidRows 'flag'", () => {
  it('keeps invalid rows with valid / issues / getCellIssues', () => {
    const t = createTable({
      schema: userSchema,
      data: raw,
      columns,
      invalidRows: 'flag',
      onDiagnostic,
    })
    const rows = t.getRowModel().rows
    expect(rows).toHaveLength(3)
    const [a, b, c] = rows
    expect(a?.valid).toBe(true)
    expect(a?.issues).toEqual([])
    expect(c?.original).toEqual({ id: 3, name: 'Cy', age: 41 })
    expect(b?.valid).toBe(false)
    expect(b?.original).toBe(raw[1])
    expect(b?.issues).toHaveLength(1)
    expect(b?.getCellIssues('age')).toEqual(b?.issues)
    expect(b?.getCellIssues('name')).toEqual([])
    expect(b?.getCellIssues('nope')).toEqual([])
    expect(t.getInvalidRows().map((r) => r.index)).toEqual([1])
    expect(find('DK_SCHEMA_INVALID_ROW')?.impact).toContain('valid === false')
  })

  it('getCellIssues matches nested paths both ways (issue under the column, column under it)', () => {
    type N = { address: { city: string; zip: string } }
    const schema = makeSchema<N>((v) => {
      const a = (v as { address?: unknown }).address
      if (a === null) return { issues: [{ message: 'Required', path: ['address'] }] }
      return { issues: [{ message: 'Bad city', path: ['address', 'city'] }] }
    })
    const t = createTable({
      schema,
      data: [{ address: { city: 1 } }, { address: null }],
      columns: [{ key: 'address.city' }, { key: 'address.zip' }],
      invalidRows: 'flag',
      onDiagnostic,
    })
    const [cityBad, noAddress] = t.getRowModel().rows
    expect(cityBad?.getCellIssues('address.city')).toHaveLength(1)
    expect(cityBad?.getCellIssues('address.zip')).toEqual([])
    expect(noAddress?.getCellIssues('address.city')).toHaveLength(1)
    expect(noAddress?.getCellIssues('address.zip')).toHaveLength(1)
  })

  it('accessor columns have no cell issues (no path to match)', () => {
    const t = createTable({
      schema: userSchema,
      data: raw,
      columns: [{ id: 'age', accessor: (u: User) => u.age }],
      invalidRows: 'flag',
      onDiagnostic,
    })
    expect(t.getRowModel().rows[1]?.getCellIssues('age')).toEqual([])
  })
})

describe("schema: invalidRows 'throw'", () => {
  it('createTable throws DatakableSchemaError (a DatakableError) with the diagnostic', () => {
    let error: unknown
    try {
      createTable({ schema: userSchema, data: raw, invalidRows: 'throw', onDiagnostic })
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(DatakableSchemaError)
    expect(error).toBeInstanceOf(DatakableError)
    const e = error as DatakableSchemaError
    expect(e.name).toBe('DatakableSchemaError')
    expect(e.code).toBe('DK_SCHEMA_INVALID_ROW')
    expect(e.invalidRows.map((r) => r.index)).toEqual([1])
    // Reported to the sinks too.
    expect(codes()).toEqual(['DK_SCHEMA_INVALID_ROW'])
    expect(e.message).not.toContain('SECRET')
  })

  it('setOptions throws and keeps the previous data', () => {
    const good = [{ id: 1, name: 'A', age: 1 }]
    const t = createTable({ schema: userSchema, data: good, invalidRows: 'throw', onDiagnostic })
    const before = t.getData()
    expect(() => t.setOptions({ data: raw as never })).toThrow(DatakableSchemaError)
    expect(t.getData()).toBe(before)
    expect(t.getRowModel().totalCount).toBe(1)
  })

  it('valid data does not throw', () => {
    const t = createTable({
      schema: userSchema,
      data: [{ id: 1, name: 'A', age: 1 }],
      invalidRows: 'throw',
    })
    expect(t.getRowModel().totalCount).toBe(1)
  })
})

describe('schema that throws: DK_SCHEMA_CRASHED', () => {
  const crashing = makeSchema<User>((v) => {
    if ((v as { id: number }).id === 2) throw new TypeError('validator bug')
    return userCheck(v)
  })

  it('reports the crash with its cause; the row is treated per invalidRows with a synthetic issue', () => {
    const t = createTable({ schema: crashing, data: raw, onDiagnostic })
    const d = find('DK_SCHEMA_CRASHED') as Diagnostic
    expect(d).toBeDefined()
    expect(d.level).toBe('error')
    expect(d.details).toMatchObject({ mode: 'drop', count: 1, rows: [1], errorName: 'TypeError' })
    expect(d.context.cause).toBeInstanceOf(TypeError)
    expect(t.getRowModel().totalCount).toBe(2)
    const [inv] = t.getInvalidRows()
    expect(inv?.index).toBe(1)
    expect(inv?.issues[0]?.message).toMatch(/schema threw/)
  })

  it('flag mode keeps the crashed row flagged', () => {
    const t = createTable({ schema: crashing, data: raw, invalidRows: 'flag', onDiagnostic })
    expect(t.getRowModel().rows[1]?.valid).toBe(false)
  })

  it('an async validate that rejects counts as a crash', async () => {
    const schema = makeSchema<User>(userCheck, { async: true })
    const rejecting = {
      '~standard': {
        ...schema['~standard'],
        validate: (v: unknown) =>
          (v as { id: number }).id === 1
            ? Promise.reject(new RangeError('async bug'))
            : schema['~standard'].validate(v),
      },
    }
    const t = createTable({ schema: rejecting, data: raw, onDiagnostic })
    await tick()
    expect(find('DK_SCHEMA_CRASHED')?.details).toMatchObject({ rows: [0], errorName: 'RangeError' })
    expect(t.getInvalidRows().map((r) => r.index)).toEqual([0, 1])
    expect(t.getRowModel().status).toBe('idle')
  })
})

describe('async schema: status validating (never silent)', () => {
  it("'validating' until the result is applied, then 'idle'; notified each time", async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    const schema = makeSchema<User>(userCheck, { async: () => gate })
    const t = createTable({ schema, data: raw, onDiagnostic })
    const first = t.getRowModel()
    expect(first.status).toBe('validating')
    expect(first.isInitialLoad).toBe(true)
    expect(first.rows).toHaveLength(0)
    const seen: string[] = []
    t.subscribe(() => {
      seen.push(t.getRowModel().status)
    })
    release()
    await tick()
    const done = t.getRowModel()
    expect(done.status).toBe('idle')
    expect(done.isInitialLoad).toBe(false)
    expect(done.totalCount).toBe(2)
    expect(seen).toEqual(['idle'])
    expect(t.getInvalidRows()).toHaveLength(1)
  })

  it("setOptions({ data }) notifies 'validating' at once, then the result", async () => {
    const schema = makeSchema<User>(userCheck, { async: true })
    const t = createTable({ schema, data: [], onDiagnostic })
    await tick()
    const statuses: string[] = []
    t.subscribe(() => {
      statuses.push(t.getRowModel().status)
    })
    t.setOptions({ data: raw as never })
    expect(statuses).toEqual(['validating'])
    await tick()
    expect(statuses).toEqual(['validating', 'idle'])
    expect(t.getRowModel().totalCount).toBe(2)
  })

  it('latest wins: an older validation finishing late is discarded', async () => {
    const gates: (() => void)[] = []
    const schema = makeSchema<User>(userCheck, {
      async: () =>
        new Promise<void>((r) => {
          gates.push(r)
        }),
    })
    const a = [{ id: 1, name: 'A', age: 1 }]
    const b = [
      { id: 2, name: 'B', age: 2 },
      { id: 3, name: 'C', age: 3 },
    ]
    const t = createTable({ schema, data: a, onDiagnostic })
    t.setOptions({ data: b as never })
    // b's validation (gates[1..2]) resolves first, a's (gates[0]) last.
    for (const g of gates.slice(1)) g()
    await tick()
    expect(t.getRowModel().totalCount).toBe(2)
    expect(t.getRowModel().status).toBe('idle')
    gates[0]?.()
    await tick()
    expect(t.getRowModel().totalCount).toBe(2)
  })

  it("a sync throw superseding an async validation does not stay 'validating'", async () => {
    // Async for rows marked slow, sync otherwise.
    const schema = {
      '~standard': {
        version: 1 as const,
        vendor: 'test',
        validate: (v: unknown) =>
          (v as { slow?: boolean }).slow ? Promise.resolve(userCheck(v)) : userCheck(v),
      },
    }
    const t = createTable({
      schema,
      data: [{ id: 1, name: 'A', age: 1, slow: true }],
      invalidRows: 'throw',
      onDiagnostic,
    })
    expect(t.getRowModel().status).toBe('validating')
    expect(() => t.setOptions({ data: raw })).toThrow(DatakableSchemaError)
    expect(t.getRowModel().status).toBe('idle')
    await tick()
    // The superseded validation was discarded.
    expect(t.getRowModel().status).toBe('idle')
    expect(t.getData()).toEqual([])
  })

  it("throw mode, async: reports DK_SCHEMA_INVALID_ROW, status 'error', previous data kept", async () => {
    const schema = makeSchema<User>(userCheck, { async: true })
    const good = [{ id: 1, name: 'A', age: 1 }]
    const t = createTable({ schema, data: good, invalidRows: 'throw', onDiagnostic })
    await tick()
    expect(t.getRowModel().totalCount).toBe(1)
    const before = t.getData()
    t.setOptions({ data: raw as never })
    await tick()
    expect(codes()).toContain('DK_SCHEMA_INVALID_ROW')
    expect(t.getData()).toBe(before)
    expect(t.getRowModel().status).toBe('error')
    t.setOptions({ data: [{ id: 4, name: 'D', age: 4 }] })
    await tick()
    expect(t.getRowModel().status).toBe('idle')
  })
})

describe('schema issue redaction (§8.2, T26)', () => {
  it("'keys' (dev default) and 'safe' replace validator messages; 'full' keeps them", () => {
    for (const redact of [undefined, 'safe', 'keys'] as const) {
      seen = []
      createTable({
        schema: userSchema,
        data: raw,
        onDiagnostic,
        ...(redact ? { diagnostics: { redact } } : {}),
      })
      const d = find('DK_SCHEMA_INVALID_ROW') as Diagnostic
      expect(JSON.stringify(d.toJSON()), redact).not.toContain('SECRET')
      expect(d.details.issues).toEqual([{ path: 'age', message: 'invalid value at age' }])
    }
    seen = []
    createTable({ schema: userSchema, data: raw, onDiagnostic, diagnostics: { redact: 'full' } })
    expect(JSON.stringify(find('DK_SCHEMA_INVALID_ROW')?.details)).toContain('SECRET-AGE')
  })

  it('the issues on rows and getInvalidRows keep the validator text (developer API)', () => {
    const t = createTable({ schema: userSchema, data: raw, invalidRows: 'flag', onDiagnostic })
    expect(t.getRowModel().rows[1]?.issues[0]?.message).toContain('SECRET-AGE')
  })
})

describe('schema options', () => {
  it("invalidRows other than 'drop' without schema → DK_OPTION_NO_EFFECT", () => {
    createTable({ data: [{ a: 1 }], invalidRows: 'flag', onDiagnostic })
    const d = find('DK_OPTION_NO_EFFECT') as Diagnostic
    expect(d.where).toEqual({ kind: 'option', path: 'invalidRows' })
    expect(d.problem).toContain('schema')
  })

  it('a bad invalidRows value or a non-Standard-Schema schema throws DK_INVALID_OPTION', () => {
    expect(() =>
      createTable({ data: [], schema: userSchema, invalidRows: 'keep' as never }),
    ).toThrow(DatakableConfigError)
    expect(() => createTable({ data: [], schema: { parse: () => 1 } as never })).toThrow(
      /DK_INVALID_OPTION/,
    )
  })

  it('schema and invalidRows are read once: setOptions reports DK_OPTION_NO_EFFECT', () => {
    const t = createTable({ schema: userSchema, data: raw, onDiagnostic })
    t.setOptions({ invalidRows: 'flag' })
    expect(find('DK_OPTION_NO_EFFECT')?.details).toMatchObject({ path: 'invalidRows', once: true })
    expect(t.getRowModel().totalCount).toBe(2)
  })

  it('getInvalidRows is a core method: a feature cannot take the name', () => {
    const f = defineFeature({
      name: 'thief',
      stage: 'none',
      initialState: () => ({}),
      createApi: () => ({ getInvalidRows: () => [] }),
    }) as AnyFeature
    expect(() => createTable({ data: [], features: [f] })).toThrow(/DK_FEATURE_API_CONFLICT/)
  })

  it('strict: the error-level DK_SCHEMA_INVALID_ROW is rethrown', () => {
    expect(() => createTable({ schema: userSchema, data: raw, strict: true })).toThrow(
      DatakableError,
    )
  })
})
