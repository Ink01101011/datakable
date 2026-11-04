import { describe, expect, it } from 'vitest'
import { pinVersion, VERSION_PLACEHOLDER } from './size.mjs'

// How esbuild inlines a package.json `version` into each dist module (core version.js, react
// use-data-table.js, datakable register.js).
const dist = (v: string) =>
  `// package.json\nvar version = "${v}";\n\n// src/version.ts\nvar VERSION = version;\n`

describe('size.mjs: measured with the inlined version pinned (#78)', () => {
  it('a version bump does not change the measured source', () => {
    expect(pinVersion(dist('2.0.9'))).toBe(pinVersion(dist('2.0.10')))
    expect(pinVersion(dist('2.0.9'))).toBe(dist(VERSION_PLACEHOLDER))
  })

  it('pins a CRLF dist too', () => {
    const crlf = (v: string) => dist(v).replaceAll('\n', '\r\n')
    expect(pinVersion(crlf('10.20.30-beta.1'))).toBe(crlf(VERSION_PLACEHOLDER))
  })

  it('leaves other version strings alone', () => {
    const src = 'var version = "2.0.9";\nconst x = { version: "1.2.3" };\n'
    expect(pinVersion(src)).toBe(src)
  })
})
