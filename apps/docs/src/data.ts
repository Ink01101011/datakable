import type { FetchParams, FetchResult, StandardSchemaV1 } from 'datakable'

// Everything here is generated locally: the playground makes no network request.

export type Person = {
  id: number
  name: string
  age: number
  city: string
  role: string
  joined: Date
}

export const ROW_COUNT = 10_000

const FIRST = ['Mali', 'Anan', 'Ploy', 'Ada', 'Alan', 'Grace', 'Niran', 'Kanya', 'Linus', 'Somchai']
const LAST = ['Lovelace', 'Turing', 'Hopper', 'Srisuk', 'Wong', 'Chai', 'Torvalds', 'Boonma']
const CITIES = ['Bangkok', 'Chiang Mai', 'Phuket', 'Khon Kaen', 'Hat Yai', 'London', 'Berlin']
const ROLES = ['Engineer', 'Designer', 'Manager', 'Analyst', 'Support']

/** Deterministic pseudo-random numbers (mulberry32): the same rows on every load. */
function random(seed: number) {
  let s = seed
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = <T>(list: readonly T[], r: number): T => list[Math.floor(r * list.length)] as T

export function generatePeople(count: number, seed = 42): Person[] {
  const r = random(seed)
  const out: Person[] = []
  const start = Date.UTC(2015, 0, 1)
  for (let i = 0; i < count; i++) {
    out.push({
      id: i + 1,
      name: `${pick(FIRST, r())} ${pick(LAST, r())}`,
      age: 18 + Math.floor(r() * 50),
      city: pick(CITIES, r()),
      role: pick(ROLES, r()),
      joined: new Date(start + Math.floor(r() * 3650) * 86_400_000),
    })
  }
  return out
}

export const rows: readonly Person[] = generatePeople(ROW_COUNT)

// --- fake server ---------------------------------------------------------------------------------

/** Waits `ms`, or rejects with the abort reason when the table supersedes the request. */
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const id = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(id)
        reject(signal.reason)
      },
      { once: true },
    )
  })
}

/**
 * A fetcher over the local rows that behaves like a server: `latency` ms per request, abortable,
 * and an HTTP-like failure while `shouldFail()` is true.
 */
export function createFakeServer(opts: { latency: number; shouldFail: () => boolean }) {
  return async function fetchPeople(params: FetchParams): Promise<FetchResult<Person>> {
    await delay(opts.latency, params.signal)
    if (opts.shouldFail()) throw new Error('HTTP 503 (simulated)')
    let result: readonly Person[] = rows
    const q = params.query?.trim().toLowerCase()
    if (q)
      result = result.filter(
        (p) => p.name.toLowerCase().includes(q) || p.city.toLowerCase().includes(q),
      )
    const sort = params.sort ?? []
    if (sort.length > 0) {
      result = [...result].sort((a, b) => {
        for (const { id, desc } of sort) {
          const x = a[id as keyof Person]
          const y = b[id as keyof Person]
          const c = x < y ? -1 : x > y ? 1 : 0
          if (c !== 0) return desc ? -c : c
        }
        return 0
      })
    }
    const size = params.pageSize ?? result.length
    const from = (params.pageIndex ?? 0) * size
    return { rows: result.slice(from, from + size), rowCount: result.length }
  }
}

// --- schema --------------------------------------------------------------------------------------

export type Account = { id: number; email: string; balance: number }

/**
 * A hand-written Standard Schema v1 (zod, valibot, arktype, … implement the same interface; the
 * playground adds no schema library). Messages stay generic: DataKable never shows them anyway.
 */
export const AccountSchema: StandardSchemaV1<unknown, Account> = {
  '~standard': {
    version: 1,
    vendor: 'playground',
    validate(value) {
      const v = (typeof value === 'object' && value !== null ? value : {}) as Record<
        string,
        unknown
      >
      const issues: StandardSchemaV1.Issue[] = []
      if (typeof v.id !== 'number') issues.push({ message: 'Expected a number', path: ['id'] })
      if (typeof v.email !== 'string' || !v.email.includes('@')) {
        issues.push({ message: 'Expected an email', path: ['email'] })
      }
      if (typeof v.balance !== 'number' || Number.isNaN(v.balance)) {
        issues.push({ message: 'Expected a number', path: ['balance'] })
      }
      if (issues.length > 0) return { issues }
      return {
        value: { id: v.id as number, email: v.email as string, balance: v.balance as number },
      }
    },
  },
}

/** Raw input, as from `await res.json()`: every 7th row has a bad email, every 11th a bad balance. */
export const rawAccounts: readonly unknown[] = Array.from({ length: 60 }, (_, i) => ({
  id: i + 1,
  email: i % 7 === 3 ? 'not-an-email' : `user${i + 1}@example.com`,
  balance: i % 11 === 5 ? 'n/a' : Math.round(((i * 7919) % 100_000) / 10) / 10,
}))
