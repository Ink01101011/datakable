import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineInterceptor } from '../intercept/define'
import { createInterceptorRuntime } from '../intercept/runtime'
import { DatakableError } from './build'
import { defineDiagnostic } from './catalog'
import { createDiagnostics, type DiagnosticsOptions } from './hub'
import type { Diagnostic } from './types'

/**
 * Sentinel test (T26 "done when"): user data that reaches a diagnostic under `'safe'` must not
 * appear anywhere a diagnostic goes — except `context.cause`, which reaches `onDiagnostic` only.
 */
const SENTINEL = 'alice@example.com'

declare module './catalog' {
  interface DiagnosticCatalog {
    DK_TEST_SENTINEL: {
      index: number
      key: string
      keys: string[]
      column: string
      value: unknown
      secret: unknown
      issues: unknown[]
      error: unknown
    }
  }
}

defineDiagnostic({
  code: 'DK_TEST_SENTINEL',
  level: 'error',
  where: (d) => ({ kind: 'row', index: d.index, key: d.key }),
  problem: (d) =>
    `row ${d.key} (also ${d.keys.join(', ')}) has ${String(d.value)} / ${String(d.secret)}`,
  impact: (d) => `issues: ${JSON.stringify(d.issues)}`,
  fix: (d) => [`look at row ${d.key}`, `fetcher said ${String(d.error)}`],
  redact: {
    key: 'rowKey',
    keys: 'rowKeys',
    value: 'value',
    secret: 'value',
    issues: 'schemaIssues',
    error: 'error',
  },
})

const details = {
  index: 7,
  key: SENTINEL,
  keys: [SENTINEL, `x-${SENTINEL}`],
  column: 'email',
  value: SENTINEL,
  secret: SENTINEL,
  issues: [{ message: `Invalid email: "${SENTINEL}"`, path: ['email'] }],
  error: Object.assign(new Error(`GET /users?email=${SENTINEL} failed`), { code: 'E500' }),
}

const cause = new Error(`cause mentions ${SENTINEL}`)

/** Everything a diagnostic exposes, minus `context.cause`. */
function exposed(d: Diagnostic): string {
  const { cause: _c, ...context } = d.context
  return [
    JSON.stringify(d),
    JSON.stringify(context),
    JSON.stringify(d.details, (_k, v) => (typeof v === 'bigint' ? String(v) : v)),
    d.problem,
    d.impact,
    d.fix.join('\n'),
    d.docs,
    d.fingerprint,
    JSON.stringify(d.where),
  ].join('\n')
}

function consoleText(spies: ReturnType<typeof vi.spyOn>[]): string {
  return spies
    .flatMap((s) => s.mock.calls)
    .map((c) => c.map(String).join(' '))
    .join('\n')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe.each([
  ['dev', true],
  ['prod', false],
])("sentinel under 'safe' (%s)", (_name, dev) => {
  const run = (extra: Partial<DiagnosticsOptions> = {}) => {
    const spies = (['error', 'warn', 'info', 'log', 'groupCollapsed', 'group'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    )
    const seen: Diagnostic[] = []
    const onDiagnostic = vi.fn((d: Diagnostic) => {
      seen.push(d)
    })
    const hub = createDiagnostics({
      name: 'UsersTable',
      dev,
      redaction: { level: 'safe', sensitiveColumns: () => ['ssn'] },
      onDiagnostic,
      ...extra,
    })
    const chain: string[] = []
    hub.attach(
      createInterceptorRuntime({
        emit: hub.emit,
        interceptors: [
          defineInterceptor({
            name: 'audit',
            on: ['diagnostic:emit'],
            intercept(ctx, next) {
              chain.push(exposed(ctx.input.diagnostic), ctx.where)
              return next()
            },
          }),
        ],
      }),
    )
    let thrown: unknown
    try {
      hub.emit('DK_TEST_SENTINEL', details, { cause })
    } catch (e) {
      thrown = e
    }
    return { hub, seen, chain, spies, thrown }
  }

  it('onDiagnostic, toJSON, fingerprint, docs URL and getDiagnostics are clean', () => {
    const { hub, seen } = run()
    expect(seen).toHaveLength(1)
    const d = seen[0] as Diagnostic
    expect(exposed(d)).not.toContain(SENTINEL)
    expect(exposed(d)).not.toContain('alice')
    expect(d.fingerprint).toMatch(/^DK_TEST_SENTINEL@row #7 \(key h:[0-9a-f]{8}\)$/)
    expect(decodeURIComponent(d.docs)).not.toContain('alice')
    for (const x of hub.getDiagnostics()) expect(exposed(x)).not.toContain(SENTINEL)
    // The original error is kept for onDiagnostic only.
    expect(d.context.cause).toBe(cause)
  })

  it('console output (dev group / prod line) is clean', () => {
    const { spies } = run()
    const text = consoleText(spies)
    expect(text).toContain('DK_TEST_SENTINEL')
    expect(text).not.toContain('alice')
  })

  it('user diagnostic:emit interceptors only ever see redacted data', () => {
    const { chain } = run()
    expect(chain.length).toBeGreaterThan(0)
    expect(chain.join('\n')).not.toContain('alice')
  })

  it('the strict DatakableError message is clean', () => {
    const { thrown } = run({ strict: true })
    expect(thrown).toBeInstanceOf(DatakableError)
    const e = thrown as DatakableError
    expect(e.message).not.toContain('alice')
    expect(exposed(e.diagnostic)).not.toContain('alice')
  })
})
