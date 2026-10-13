import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorBoundary } from '../intercept/boundary'
import { createInterceptorRuntime } from '../intercept/runtime'
import { createDiagnostics } from './hub'

/**
 * R2 carry-over (§8.2): the two places that print an error outside the diagnostics pipeline (the
 * hub's "pipeline failed" line, and the errorBoundary's silent `diagnostic:emit` fallback) print
 * only `error.name` (+ `code`) in a production build: a user's onDiagnostic / redact step can throw
 * messages that embed row values, and production consoles are often collected.
 */
vi.mock('./env', () => ({ DEV: false }))

const SECRET = 'SECRET-123'
const printed = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls
    .flat()
    .map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : String(x)))
    .join('\n')

afterEach(() => {
  vi.restoreAllMocks()
})

describe('production console: thrown errors are scrubbed', () => {
  it('a throwing onDiagnostic prints its error name, not its message', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hub = createDiagnostics({
      onDiagnostic: () => {
        throw new TypeError(`cannot send ${SECRET}`)
      },
    })
    hub.emit('DK_INVALID_PAGINATION', {
      source: 'setPageSize',
      field: 'pageSize',
      received: 'NaN',
      fallback: 'the call was ignored',
    })
    expect(error).toHaveBeenCalled()
    expect(printed(error)).not.toContain(SECRET)
    expect(printed(error)).toContain('TypeError')
  })

  it('a throwing redact step (diagnostic:emit fallback) prints its error name only', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hub = createDiagnostics({
      console: false,
      redact: () => {
        throw new RangeError(`row ${SECRET}`)
      },
    })
    const rt = createInterceptorRuntime({ emit: hub.emit, interceptors: [] })
    hub.attach(rt)
    rt.installBoundary(errorBoundary)
    hub.emit('DK_HOT_INTERCEPTOR', { interceptor: 'x', op: 'column:batch' })
    expect(error).toHaveBeenCalledTimes(1)
    expect(printed(error)).not.toContain(SECRET)
    expect(printed(error)).toContain('RangeError')
  })
})
