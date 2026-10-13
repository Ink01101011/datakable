import { createSearch } from 'ex-search'
import { timSort } from 'exsorted/tim'
import fc from 'fast-check'
import { debounce } from 'kk-debounce/debounce'
import { describe, expect, it } from 'vitest'

// Tooling smoke (T01): runtime deps resolve through their subpaths and
// fast-check runs under vitest. Feature behaviour is tested by later units.
describe('core dependencies', () => {
  it('resolve through subpath exports', () => {
    expect(typeof timSort).toBe('function')
    expect(typeof debounce).toBe('function')
    expect(typeof createSearch).toBe('function')
  })

  it('fast-check drives property tests', () => {
    fc.assert(
      fc.property(fc.array(fc.integer()), (xs) => {
        expect(timSort([...xs], (a, b) => a - b)).toEqual([...xs].sort((a, b) => a - b))
      }),
    )
  })
})
