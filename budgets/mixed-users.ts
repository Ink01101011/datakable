// The PVT data shape (#27, #40): what a zero-config table over real-world rows searches.

const CITIES = ['Bangkok', 'กรุงเทพมหานคร', 'Chiang Mai', 'São Paulo', 'Zürich', '東京']
const TAGS = ['admin', 'beta', 'vip', 'ลูกค้า', 'früh', '🔥']

/** The PVT shape (#27): ten mixed-type fields, nullish / NaN numbers, Date | string, arrays. */
export const mixedUsers = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const id = i + 1
    const ms = Date.UTC(2015, 0, 1) + ((i * 7919) % 3650) * 86_400_000 + ((i * 104729) % 86_400_000)
    return {
      id,
      name: `user ${(i * 2654435761) % n}`,
      age:
        id % 17 === 0
          ? null
          : id % 19 === 0
            ? undefined
            : id % 23 === 0
              ? Number.NaN
              : 18 + (i % 62),
      city: CITIES[i % CITIES.length] as string,
      email: `user${id}@example.com`,
      joined: id % 2 === 0 ? new Date(ms) : new Date(ms).toISOString(),
      balance: id % 25 === 0 ? `${9007199254740993n + BigInt(id)}` : ((i * 7919) % 1_000_000) / 100,
      tags: TAGS.filter((_, k) => (i >> k) % 3 === 0).slice(0, 3),
      address: { street: `${1 + (i % 999)} Sukhumvit Rd`, geo: { lat: i % 90, lng: i % 180 } },
      isActive: i % 10 > 2,
    }
  })
