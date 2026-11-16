import { describe, expect, it } from 'vitest'
import reference from './datakable-2.1.1-nonfinite.ref.json'
import { CASES, QUERIES, typed } from './test-nonfinite'

// R2 N2: development builds accept a non-finite column weight as datakable 2.1.1 did (no throw, no
// diagnostic) and search with it as 2.1.1 did: the `development` rows of the reference, recorded
// with the published 2.1.1. A non-finite `threshold` was DK_INVALID_OPTION in 2.1.1 and still is.

describe('development: a non-finite weight or threshold as in datakable 2.1.1 (R2 N2)', () => {
  it('every case: the 2.1.1 development rows and status, or its DK_INVALID_OPTION throw', async () => {
    expect(reference.queries).toEqual(QUERIES)
    const expected = reference.development as Record<string, string[] | string>
    expect(Object.keys(CASES)).toEqual(Object.keys(expected))
    for (const [name, c] of Object.entries(CASES)) {
      const ref = expected[name] as string[] | string
      if (typeof ref === 'string') {
        expect(ref, name).toBe('throws DK_INVALID_OPTION')
        await expect(typed(c), name).rejects.toMatchObject({ code: 'DK_INVALID_OPTION' })
        continue
      }
      const got = await typed(c)
      for (let j = 0; j < QUERIES.length; j++)
        expect(got[j], `${name} "${QUERIES[j]}"`).toBe(ref[j])
    }
  })
})
