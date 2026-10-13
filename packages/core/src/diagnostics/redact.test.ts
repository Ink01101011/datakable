import { describe, expect, it, vi } from 'vitest'
import { buildDiagnostic } from './build'
import { defineDiagnostic } from './catalog'
import { createDiagnostics } from './hub'
import {
  describeValue,
  hashRowKey,
  resolveRedaction,
  SENSITIVE,
  scrubError,
  scrubSchemaIssue,
} from './redact'

declare module './catalog' {
  interface DiagnosticCatalog {
    DK_TEST_REDACT: {
      index: number
      key: string | number
      keys?: (string | number)[]
      column: string
      value?: unknown
      values?: unknown[]
      issues?: unknown
      error?: unknown
    }
    DK_TEST_REDACT_COL: { id: string; value: unknown }
  }
}

defineDiagnostic({
  code: 'DK_TEST_REDACT',
  level: 'error',
  where: (d) => ({ kind: 'row', index: d.index, key: String(d.key) }),
  problem: (d) => `row key ${d.key} has value ${String(d.value)} in "${d.column}"`,
  impact: () => 'none',
  fix: (d) => [`check ${d.key}`],
  redact: {
    key: 'rowKey',
    keys: 'rowKeys',
    value: 'value',
    values: 'values',
    issues: 'schemaIssues',
    error: 'error',
  },
})

const build = (
  details: Parameters<typeof buildDiagnostic<'DK_TEST_REDACT'>>[1],
  redaction: Parameters<typeof resolveRedaction>[0],
  dev = true,
) =>
  buildDiagnostic('DK_TEST_REDACT', details, { dev, redaction: resolveRedaction(redaction, dev) })

describe('hashRowKey', () => {
  it('is a stable short FNV-1a hash', () => {
    // FNV-1a 32-bit of "" is 0x811c9dc5, of "a" is 0xe40c292c (reference vectors).
    expect(hashRowKey('')).toBe('h:811c9dc5')
    expect(hashRowKey('a')).toBe('h:e40c292c')
    expect(hashRowKey(42)).toBe(hashRowKey('42'))
    expect(hashRowKey('alice@example.com')).toMatch(/^h:[0-9a-f]{8}$/)
  })
  it('hashes non-ASCII by UTF-16 code unit without throwing', () => {
    expect(hashRowKey('ผู้ใช้')).toMatch(/^h:[0-9a-f]{8}$/)
    expect(hashRowKey('ผู้ใช้')).not.toBe(hashRowKey('ผู้ใช'))
  })
})

describe('describeValue', () => {
  it('summarises types, never contents', () => {
    expect(describeValue('hello world!')).toBe('string(12)')
    expect(describeValue(3.5)).toBe('number')
    expect(describeValue(Number.NaN)).toBe('number(NaN)')
    expect(describeValue(true)).toBe('boolean')
    expect(describeValue(null)).toBe('null')
    expect(describeValue(undefined)).toBe('undefined')
    expect(describeValue(10n)).toBe('bigint')
    expect(describeValue([1, 2, 3])).toBe('array(3)')
    expect(describeValue(new Date(0))).toBe('date')
    expect(describeValue({ a: 1 })).toBe('object')
    expect(describeValue(() => 1)).toBe('function')
    expect(describeValue(Symbol('s'))).toBe('symbol')
  })
})

describe('resolveRedaction', () => {
  it('defaults to keys in dev and safe in prod', () => {
    expect(resolveRedaction(undefined, true).level).toBe('keys')
    expect(resolveRedaction(undefined, false).level).toBe('safe')
    expect(resolveRedaction({}, false).level).toBe('safe')
    expect(resolveRedaction('full', false).level).toBe('full')
  })
  it('an unknown level falls back to the strictest one', () => {
    // @ts-expect-error not a level
    expect(resolveRedaction('none', true).level).toBe('safe')
  })
})

describe('buildDiagnostic: levels', () => {
  const details = { index: 3, key: 'alice@example.com', column: 'email', value: 'secret-value' }

  it("'safe': keys hashed everywhere, values as types", () => {
    const d = build(details, 'safe')
    const h = hashRowKey('alice@example.com')
    expect(d.where).toEqual({ kind: 'row', index: 3, key: h })
    expect(d.details.key).toBe(h)
    expect(d.details.value).toBe('string(12)')
    expect(d.problem).toBe(`row key ${h} has value string(12) in "email"`)
    expect(d.fix).toEqual([`check ${h}`])
    expect(d.fingerprint).toBe(`DK_TEST_REDACT@row #3 (key ${h})`)
  })

  it("'keys': raw keys, values as types", () => {
    const d = build(details, 'keys')
    expect(d.where).toEqual({ kind: 'row', index: 3, key: 'alice@example.com' })
    expect(d.details.key).toBe('alice@example.com')
    expect(d.details.value).toBe('string(12)')
    expect(d.fingerprint).toBe('DK_TEST_REDACT@row #3 (key alice@example.com)')
  })

  it("'full': raw keys and raw values", () => {
    const d = build(details, 'full')
    expect(d.details.key).toBe('alice@example.com')
    expect(d.details.value).toBe('secret-value')
  })

  it('arrays of keys and values are redacted per item', () => {
    const d = build({ ...details, keys: ['a', 7], values: ['xx', 1] }, 'safe')
    expect(d.details.keys).toEqual([hashRowKey('a'), hashRowKey(7)])
    expect(d.details.values).toEqual(['string(2)', 'number'])
  })

  it('never mutates the emitted details object', () => {
    const input = { ...details, keys: ['a'] }
    build(input, 'safe')
    expect(input.key).toBe('alice@example.com')
    expect(input.keys).toEqual(['a'])
  })

  it('prod docs URL carries the redacted where', () => {
    const d = build(details, 'safe', false)
    expect(d.docs).toContain(encodeURIComponent(hashRowKey('alice@example.com')))
    expect(d.docs).not.toContain('alice')
  })

  it('without a redactor, prod builds use safe and dev builds use keys', () => {
    const prod = buildDiagnostic('DK_TEST_REDACT', details, { dev: false })
    expect(prod.where).toEqual({ kind: 'row', index: 3, key: hashRowKey('alice@example.com') })
    const dev = buildDiagnostic('DK_TEST_REDACT', details, { dev: true })
    expect(dev.where).toEqual({ kind: 'row', index: 3, key: 'alice@example.com' })
  })
})

describe('buildDiagnostic: sensitive columns and rowKey', () => {
  const details = { index: 1, key: 'k1', column: 'ssn', value: '123-45-6789' }

  it('a sensitive column value is never logged, at any level', () => {
    for (const level of ['safe', 'keys', 'full'] as const) {
      const d = build(details, { level, sensitiveColumns: () => ['ssn'] })
      expect(d.details.value).toBe(SENSITIVE)
      expect(d.problem).not.toContain('123-45-6789')
    }
  })

  it('reads the column from a column location when details have none', () => {
    defineDiagnostic({
      code: 'DK_TEST_REDACT_COL',
      level: 'warn',
      where: (d) => ({ kind: 'column', index: 0, id: d.id }),
      problem: (d) => `bad ${String(d.value)}`,
      impact: () => 'none',
      fix: () => ['none'],
      redact: { value: 'value' },
    })
    const d = buildDiagnostic(
      'DK_TEST_REDACT_COL',
      { id: 'ssn', value: 'x' },
      { redaction: resolveRedaction({ level: 'full', sensitiveColumns: () => ['ssn'] }, true) },
    )
    expect(d.details.value).toBe(SENSITIVE)
  })

  it('a sensitive rowKey column is hashed at every level', () => {
    for (const level of ['safe', 'keys', 'full'] as const) {
      const d = build(details, { level, rowKeySensitive: () => true })
      expect(d.where).toEqual({ kind: 'row', index: 1, key: hashRowKey('k1') })
      expect(d.details.key).toBe(hashRowKey('k1'))
    }
  })
})

describe('buildDiagnostic: custom redact(path, value)', () => {
  it('replaces values it returns a string for and defers on undefined', () => {
    const redact = vi.fn((path: string, value: unknown) =>
      path === 'details.value' ? `<${typeof value}>` : undefined,
    )
    const d = build(
      { index: 0, key: 'k', column: 'c', value: 'v', keys: ['a'] },
      { level: 'full', redact },
    )
    expect(d.details.value).toBe('<string>')
    expect(d.details.key).toBe('k')
    expect(redact).toHaveBeenCalledWith('where.key', 'k')
    expect(redact).toHaveBeenCalledWith('details.key', 'k')
    expect(redact).toHaveBeenCalledWith('details.keys.0', 'a')
  })

  it('cannot reveal a sensitive column', () => {
    const d = build(
      { index: 0, key: 'k', column: 'ssn', value: 'v' },
      { level: 'full', sensitiveColumns: () => ['ssn'], redact: (_p, v) => String(v) },
    )
    expect(d.details.value).toBe(SENSITIVE)
  })

  it('a throwing custom redact yields [redacted] and reports the error', () => {
    const onError = vi.fn()
    const r = resolveRedaction(
      {
        level: 'full',
        redact: () => {
          throw new Error('bad rule')
        },
      },
      true,
    )
    r.onError = onError
    const d = buildDiagnostic(
      'DK_TEST_REDACT',
      { index: 0, key: 'k', column: 'c', value: 'v' },
      { redaction: r },
    )
    expect(d.details.value).toBe('[redacted]')
    expect(d.where).toEqual({ kind: 'row', index: 0, key: '[redacted]' })
    expect(onError).toHaveBeenCalled()
  })
})

describe('schema and fetcher message scrubbing', () => {
  const issue = {
    message: 'Expected number, received "alice@example.com"',
    path: ['user', 0, { key: 'email' }],
  }

  it("replaces validator messages under 'safe' and 'keys'", () => {
    for (const level of ['safe', 'keys'] as const) {
      expect(scrubSchemaIssue(issue, resolveRedaction(level, true))).toEqual({
        path: 'user.0.email',
        message: 'invalid value at user.0.email',
      })
    }
    expect(scrubSchemaIssue({ message: 'x' }, resolveRedaction('safe', true))).toEqual({
      path: '',
      message: 'invalid value at (root)',
    })
  })

  it("keeps the validator message under 'full' unless the column is sensitive", () => {
    expect(scrubSchemaIssue(issue, resolveRedaction('full', true)).message).toBe(issue.message)
    const r = resolveRedaction({ level: 'full', sensitiveColumns: () => ['user'] }, true)
    expect(scrubSchemaIssue(issue, r).message).toBe('invalid value at user.0.email')
  })

  it('a schemaIssues field is scrubbed in details (one issue or an array)', () => {
    const d = build({ index: 0, key: 'k', column: 'c', issues: [issue] }, 'safe')
    expect(d.details.issues).toEqual([
      { path: 'user.0.email', message: 'invalid value at user.0.email' },
    ])
    const one = build({ index: 0, key: 'k', column: 'c', issues: issue }, 'keys')
    expect(one.details.issues).toEqual({
      path: 'user.0.email',
      message: 'invalid value at user.0.email',
    })
  })

  it('fetcher errors keep error.name + code only, at every level', () => {
    const e = Object.assign(new TypeError('GET https://api/?token=abc failed'), {
      code: 'ECONNRESET',
    })
    expect(scrubError(e)).toBe('TypeError (ECONNRESET)')
    expect(scrubError(new Error('secret'))).toBe('Error')
    expect(scrubError('secret string')).toBe('string')
    expect(scrubError({ name: 'AbortError', code: 20 })).toBe('AbortError (20)')
    const cause = e
    const d = buildDiagnostic(
      'DK_TEST_REDACT',
      { index: 0, key: 'k', column: 'c', error: e },
      { redaction: resolveRedaction('full', true), cause },
    )
    expect(d.details.error).toBe('TypeError (ECONNRESET)')
    expect(d.context.cause).toBe(e)
  })
})

describe("hub: 'full' in production", () => {
  it('warns once with DK_UNSAFE_REDACTION', () => {
    const onDiagnostic = vi.fn()
    createDiagnostics({ console: false, dev: false, redaction: 'full', onDiagnostic })
    expect(onDiagnostic).toHaveBeenCalledTimes(1)
    const d = onDiagnostic.mock.calls[0]?.[0]
    expect(d.code).toBe('DK_UNSAFE_REDACTION')
    expect(d.level).toBe('warn')
    expect(d.where).toEqual({ kind: 'option', path: 'diagnostics.redact' })
    const text = buildDiagnostic('DK_UNSAFE_REDACTION', { level: 'full' }, { dev: true })
    expect(text.problem).toMatch(/production/)
    expect(text.impact.length).toBeGreaterThan(0)
    expect(text.fix.length).toBeGreaterThan(0)
  })

  it('does not warn in development or for safe/keys', () => {
    const onDiagnostic = vi.fn()
    createDiagnostics({ console: false, dev: true, redaction: 'full', onDiagnostic })
    createDiagnostics({ console: false, dev: false, redaction: 'keys', onDiagnostic })
    expect(onDiagnostic).not.toHaveBeenCalled()
  })

  it('reports a throwing custom redact once via console.error and keeps going', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onDiagnostic = vi.fn()
    const hub = createDiagnostics({
      console: false,
      onDiagnostic,
      redaction: {
        redact: () => {
          throw new Error('bad rule')
        },
      },
    })
    hub.emit('DK_TEST_REDACT', { index: 0, key: 'k', column: 'c', value: 'v' })
    hub.emit('DK_TEST_REDACT', { index: 1, key: 'k', column: 'c', value: 'v' })
    expect(onDiagnostic).toHaveBeenCalledTimes(2)
    expect(error).toHaveBeenCalledTimes(1)
    error.mockRestore()
  })
})
