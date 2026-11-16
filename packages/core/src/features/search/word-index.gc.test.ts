import { ExSearch } from 'ex-search'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { wordIndexBytes } from './search-index'

// R F1: the word-index cap counts what ex-search 2.1.1's word index keeps from the texts of a
// block (`wordIndexBytes` per cell, 16 bytes per 64 cells with any, an engine's fixed cost). This
// checks that count against the memory an engine really retains once its index is built, for
// short and long cells and unusual whitespace. Runs in the `core-memory` project (--expose-gc).

type Mem = { heapUsed: number; arrayBuffers: number }
const { process, gc } = globalThis as unknown as {
  process: { memoryUsage(): Mem }
  gc?: () => void
}
if (typeof gc !== 'function') throw new Error('word-index.gc.test.ts needs --expose-gc')

const used = () => {
  let last = -1
  for (let i = 0; i < 12; i++) {
    gc()
    const m = process.memoryUsage()
    if (i >= 3 && m.arrayBuffers === last) return m.heapUsed + m.arrayBuffers
    last = m.arrayBuffers
  }
  const m = process.memoryUsage()
  return m.heapUsed + m.arrayBuffers
}

/** ex-search 2.1.1's word index bytes for one cell (`buildWordIndex`), exactly. */
function layoutBytes(v: string): number {
  const space = (c: number) => /\s/.test(String.fromCharCode(c))
  const varint = (x: number) => (x < 128 ? 1 : x < 16_384 ? 2 : 3)
  const n = v.length
  let bytes = 0
  let words = 0
  let start = 0
  let end = 0
  for (let i = 0; ; ) {
    while (i < n && space(v.charCodeAt(i))) i++
    if (i === n) break
    const s = i
    while (i < n && !space(v.charCodeAt(i))) i++
    const gap = s - end
    bytes += !words++
      ? varint(s)
      : varint((s - start) * 2 + (gap > 1 ? 1 : 0)) + (gap > 1 ? varint(gap) : 0)
    start = s
    end = i
  }
  const t = n - end
  if (!words || (words < 2 && !start && !t)) return 0
  if (t) bytes += varint(t)
  return bytes + varint(bytes * 2 + (t ? 1 : 0))
}

const W = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india']
const words = (i: number, k: number) =>
  Array.from({ length: k }, (_, j) => W[(i * 31 + j * 7) % W.length]).join(' ')
const ROWS = 50_000
/** Engines measured together: the reading noise is shared out. */
const ENGINES = 4

/** Cell texts (already folded, as DataKable hands them to ex-search). */
const SHAPES: Record<string, (i: number) => string> = {
  'two or three words': (i) => words(i, 2 + (i % 2)),
  '10 words': (i) => words(i, 10),
  '30 words': (i) => words(i, 30),
  '100 words': (i) => words(i, 100),
  'one word (nothing kept)': (i) => `w${i}`,
  'padded, tabs, double spaces, nbsp': (i) =>
    ` ${words(i, 2)}\t\t${words(i + 1, 2)}  x y${i % 3 ? ' ' : ''}`,
  'words over 63 characters': (i) => `${'a'.repeat(70 + (i % 9))} ${'b'.repeat(80)} c`,
}

describe('word index bytes: the estimate against retained memory (R F1)', () => {
  for (const [name, text] of Object.entries(SHAPES)) {
    it(name, () => {
      const items = Array.from({ length: ROWS }, (_, i) => ({ i, c0: text(i), c1: words(i, 2) }))
      const keys = [
        { name: 'c0' as const, weight: 1 },
        { name: 'c1' as const, weight: 0.5 },
      ]
      // What the count adds for the cells of this data (two keys: cell id = row * 2 + key).
      let estimate = 0
      let group = -1
      for (let r = 0; r < ROWS; r++) {
        for (const [k, key] of keys.entries()) {
          const c = wordIndexBytes(items[r]?.[key.name] as string)
          const z = (r * keys.length + k) >>> 6
          if (c) estimate += c + (z === group ? 0 : 16)
          if (c) group = z
        }
      }
      const engines = Array.from({ length: ENGINES }, () =>
        new ExSearch({ keys, fuzzyMode: 'word', caseSensitive: true }).setData(items),
      )
      // Warm-up on another engine over the same texts, alive through both readings (a dead index
      // is not always released before the first): compiled code, inline caches and flattened
      // strings are not the index.
      const warm = new ExSearch({ keys, fuzzyMode: 'word', caseSensitive: true }).setData(items)
      warm.search('zzzzz')
      const before = used()
      for (const e of engines) e.search('zzzzz') // a one-word query builds the word index
      const retained = Math.round((used() - before) / ENGINES)
      expect(warm.search('zzzzz')).toEqual([])
      console.info(
        `[word index] ${name}: ${ROWS} rows x 2 cells, retained ${retained} B per engine, estimate ${estimate} B (${((retained / estimate - 1) * 100).toFixed(1)} %)`,
      )
      // The count is an upper bound of the index's bytes (data and groups; `layoutBytes` above is
      // exact): at least what an engine retains, less the heap's reading noise (16 KB), and at
      // most a third more.
      expect(estimate, `retained ${retained}, estimate ${estimate}`).toBeGreaterThan(
        retained - 16_384,
      )
      expect(estimate, `retained ${retained}, estimate ${estimate}`).toBeLessThan(
        retained * 1.35 + 16_384,
      )
      expect(engines[0]?.search('zzzzz')).toEqual([])
      // Several engines over long text with full GCs between readings: over 5 s on a CI runner.
    }, 60_000)
  }

  it('wordIndexBytes is never below the exact layout, and close above it (property)', () => {
    const piece = fc.constantFrom(
      'a',
      'ab',
      'hotel',
      'x'.repeat(70),
      ' ',
      '  ',
      '\t',
      '\u00a0',
      '\u3000',
      'é',
    )
    fc.assert(
      fc.property(fc.array(piece, { maxLength: 120 }), (parts) => {
        const v = parts.join('')
        const exact = layoutBytes(v)
        const est = wordIndexBytes(v)
        expect(est, JSON.stringify(v)).toBeGreaterThanOrEqual(exact)
        if (exact === 0) expect(est === 0 || /\s/.test(v)).toBe(true)
      }),
      { numRuns: 2000 },
    )
    expect(wordIndexBytes('ada')).toBe(0)
    expect(wordIndexBytes('ada lovelace')).toBe(4) // exact: 3
    expect(wordIndexBytes(words(0, 30))).toBe(34) // exact: 31
  })
})
