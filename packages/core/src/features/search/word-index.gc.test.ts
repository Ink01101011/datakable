import { ExSearch } from 'ex-search'
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
      // The count is exact for the index's bytes (data and groups); what an engine retains on top
      // (its objects, typed-array headers) and the heap's reading noise stay within 16 KB + 3 %.
      expect(
        Math.abs(retained - estimate),
        `retained ${retained}, estimate ${estimate}`,
      ).toBeLessThan(16_384 + estimate * 0.03)
      expect(engines[0]?.search('zzzzz')).toEqual([])
    })
  }

  it('wordIndexBytes follows ex-search: words, gaps, ends', () => {
    expect(wordIndexBytes('')).toBe(0)
    expect(wordIndexBytes('   ')).toBe(0)
    expect(wordIndexBytes('ada')).toBe(0)
    // Header, first start, one word step.
    expect(wordIndexBytes('ada lovelace')).toBe(3)
    // + the trailing whitespace length; a padded single word is indexed too.
    expect(wordIndexBytes('ada lovelace ')).toBe(4)
    expect(wordIndexBytes(' ada')).toBe(2)
    // A gap of two characters: its length too.
    expect(wordIndexBytes('ada  lovelace')).toBe(4)
    // About one byte per word.
    expect(wordIndexBytes(words(0, 30))).toBe(31)
  })
})
