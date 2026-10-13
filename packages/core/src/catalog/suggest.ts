import { Scorer } from 'ex-search'

/** `Scorer.levenshtein` (bit-parallel Myers) keeps the shorter string in a 32-bit word. */
const MAX_LENGTH = 31

/**
 * Did-you-mean: the candidates within edit distance max(1, ⌊length / 3⌋) of `name`, closest first
 * (ties keep the candidates' order). Case-insensitive. Names are option keys, so this is cold code.
 */
export function suggest(name: string, candidates: Iterable<string>): string[] {
  const n = name.toLowerCase()
  const limit = Math.max(1, Math.floor(n.length / 3))
  const hits: { c: string; d: number }[] = []
  for (const c of candidates) {
    if (Math.min(n.length, c.length) > MAX_LENGTH || Math.abs(n.length - c.length) > limit) continue
    const d = Scorer.levenshtein(n, c.toLowerCase())
    if (d <= limit) hits.push({ c, d })
  }
  return hits.sort((a, b) => a.d - b.d).map((h) => h.c)
}
