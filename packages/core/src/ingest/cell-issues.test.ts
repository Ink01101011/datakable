import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Diagnostic } from '../diagnostics/types'
import type { RowIssue } from '../pipeline/row'
import { createTable } from '../table/create-table'
import { issuePathTouches } from './schema'
import { makeSchema } from './test-schemas'

let seen: Diagnostic[]
const onDiagnostic = (d: Diagnostic) => {
  seen.push(d)
}

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

const segs = (key: string) => key.split('.')

describe('issuePathTouches (issue path ↔ column key, segment-wise)', () => {
  it.each<[string, RowIssue['path'], string, boolean]>([
    ['equal', ['age'], 'age', true],
    ['equal, { key } segment', [{ key: 'age' }], 'age', true],
    ['issue under the column', ['address', 'city'], 'address', true],
    ['column under the issue', ['address'], 'address.city', true],
    ['sibling', ['address', 'zip'], 'address.city', false],
    ['other column', ['name'], 'age', false],
    ['prefix without a dot is another key', ['address'], 'addressLine', false],
    ['prefix without a dot, reversed', ['addressLine'], 'address', false],
    ['numeric array index', ['tags', 0], 'tags', true],
    ['numeric index vs key segment', ['tags', 1, 'v'], 'tags.1', true],
    ['other index', ['tags', 2], 'tags.1', false],
    ['mixed { key } and plain segments', [{ key: 'a' }, 'b', { key: 3 }], 'a.b.3', true],
    ['a dotted single segment is not two segments', [{ key: 'a.b' }], 'a.b', false],
    ['symbol segment never matches a key', [Symbol('age')], 'age', false],
  ])('%s', (_, path, key, expected) => {
    expect(issuePathTouches(path, segs(key))).toBe(expected)
  })

  it('row-level issues (no or empty path) touch every column, accessor columns included', () => {
    expect(issuePathTouches(undefined, segs('age'))).toBe(true)
    expect(issuePathTouches([], segs('a.b'))).toBe(true)
    expect(issuePathTouches(undefined, undefined)).toBe(true)
    expect(issuePathTouches([], undefined)).toBe(true)
  })

  it('accessor columns (no path) get no path issues', () => {
    expect(issuePathTouches(['age'], undefined)).toBe(false)
  })

  it('never throws on a malformed path from user code: treated as row-level', () => {
    const bad = [
      {
        get key(): PropertyKey {
          throw new Error('boom')
        },
      },
    ]
    expect(issuePathTouches(bad, segs('age'))).toBe(true)
    expect(issuePathTouches(null as never, segs('age'))).toBe(true)
  })
})

type Issue = { message: string; path?: RowIssue['path'] }

/** A flag-mode table whose row i fails with `issues[i]` (no issues → valid). */
function table(issues: readonly (readonly Issue[])[], columns: readonly unknown[]) {
  let i = 0
  const schema = makeSchema((v) => {
    const own = issues[i++] ?? []
    return own.length === 0 ? { value: v } : { issues: own }
  })
  return createTable({
    schema,
    data: issues.map((_, n) => ({ n })),
    columns: columns as never,
    invalidRows: 'flag',
    onDiagnostic,
  })
}

describe('row.getCellIssues: issue → column mapping', () => {
  const columns = [
    { key: 'name' },
    { key: 'address' },
    { key: 'address.city' },
    { key: 'addressLine' },
    { key: 'tags' },
    { id: 'full', accessor: () => 'x' },
  ]

  it('maps each issue to the columns it touches, in issue order', () => {
    const city: Issue = { message: 'city', path: ['address', 'city'] }
    const addr: Issue = { message: 'address', path: [{ key: 'address' }] }
    const tag: Issue = { message: 'tag', path: ['tags', 0] }
    const t = table([[city, addr, tag]], columns)
    const row = t.getRowModel().rows[0]
    expect(row?.getCellIssues('name')).toEqual([])
    expect(row?.getCellIssues('address')).toEqual([city, addr])
    expect(row?.getCellIssues('address.city')).toEqual([city, addr])
    expect(row?.getCellIssues('addressLine')).toEqual([])
    expect(row?.getCellIssues('tags')).toEqual([tag])
    expect(row?.getCellIssues('full')).toEqual([])
    expect(row?.getCellIssues('nope')).toEqual([])
    expect(row?.issues).toEqual([city, addr, tag])
  })

  it('row-level issues apply to every cell, accessor columns included', () => {
    const root: Issue = { message: 'passwords differ' }
    const empty: Issue = { message: 'whole row', path: [] }
    const name: Issue = { message: 'name', path: ['name'] }
    const t = table([[root, name, empty]], columns)
    const row = t.getRowModel().rows[0]
    expect(row?.getCellIssues('name')).toEqual([root, name, empty])
    expect(row?.getCellIssues('tags')).toEqual([root, empty])
    expect(row?.getCellIssues('full')).toEqual([root, empty])
  })

  it('a crashed row (synthetic issue, no path) is broken in every cell', () => {
    const schema = makeSchema<{ n: number }>(() => {
      throw new Error('boom')
    })
    const t = createTable({
      schema,
      data: [{ n: 1 }],
      columns: [{ key: 'n' }, { id: 'x', accessor: () => 1 }],
      invalidRows: 'flag',
      onDiagnostic,
    })
    const row = t.getRowModel().rows[0]
    expect(row?.valid).toBe(false)
    expect(row?.getCellIssues('n')).toHaveLength(1)
    expect(row?.getCellIssues('x')).toHaveLength(1)
  })

  it('valid rows and unknown columns have no cell issues (shared empty array)', () => {
    const t = table([[], [{ message: 'n', path: ['name'] }]], columns)
    const [ok, bad] = t.getRowModel().rows
    expect(ok?.getCellIssues('name')).toEqual([])
    expect(ok?.getCellIssues('name')).toBe(bad?.getCellIssues('tags'))
  })
})
