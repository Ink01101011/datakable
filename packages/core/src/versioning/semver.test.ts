import { describe, expect, it } from 'vitest'
import { parseVersion, satisfies } from './semver'

describe('parseVersion', () => {
  it('parses x.y.z and ignores prerelease / build metadata', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('v1.2.3-beta.1+sha')).toEqual([1, 2, 3])
    expect(parseVersion('1.2')).toBeUndefined()
    expect(parseVersion('nope')).toBeUndefined()
  })
})

describe('satisfies', () => {
  const cases: [string, string, boolean][] = [
    ['1.4.2', '^1.0', true],
    ['2.0.0', '^1.0', false],
    ['0.9.0', '^1.0', false],
    ['1.0.0', '^1.0.0', true],
    ['0.2.5', '^0.2.3', true],
    ['0.3.0', '^0.2.3', false],
    ['0.0.3', '^0.0.3', true],
    ['0.0.4', '^0.0.3', false],
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['1.2.0', '~1.2', true],
    ['1.9.0', '~1', true],
    ['1.5.0', '1.x', true],
    ['2.0.0', '1.x', false],
    ['1.2.7', '1.2.*', true],
    ['3.0.0', '*', true],
    ['3.0.0', '', true],
    ['1.2.3', '1.2.3', true],
    ['1.2.4', '=1.2.3', false],
    ['1.5.0', '>=1.2 <2', true],
    ['2.0.0', '>=1.2 <2', false],
    ['1.1.0', '>1.0.0', true],
    ['1.0.0', '>1.0.0', false],
    ['1.0.0', '<=1.0.0', true],
    ['2.1.0', '^1.0 || ^2.0', true],
    ['3.0.0', '^1.0 || ^2.0', false],
    ['1.0.0-beta.1', '^1.0', true],
  ]
  it.each(cases)('%s in "%s" → %s', (v, range, ok) => {
    expect(satisfies(v, range)).toBe(ok)
  })

  it('returns undefined for an unparseable range or version', () => {
    expect(satisfies('1.0.0', 'latest')).toBeUndefined()
    expect(satisfies('1.0.0', '^one')).toBeUndefined()
    expect(satisfies('1.0.0', '>= ')).toBeUndefined()
    expect(satisfies('one', '^1.0')).toBeUndefined()
  })
})
