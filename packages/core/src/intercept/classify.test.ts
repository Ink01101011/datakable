import { describe, expect, it } from 'vitest'
import { classifyError } from './classify'

/** An Error whose top stack frame is `frame` (V8 format). */
const thrownAt = (frame: string) => {
  const e = new TypeError('x')
  e.stack = `TypeError: x\n    at fn (${frame}:12:3)\n    at other (/app/src/main.ts:1:1)`
  return e
}

describe('classifyError: DataKable frames (R2 carry-over)', () => {
  it.each([
    ['scoped package', '/app/node_modules/@datakable/core/dist/index.js'],
    [
      'pnpm store path',
      '/app/node_modules/.pnpm/@datakable+core@1.0.0/node_modules/@datakable/core/dist/index.js',
    ],
    ['bundled chunk of the package', '/app/node_modules/@datakable/core/dist/chunk-ABC123.js'],
    ['unscoped package', '/app/node_modules/datakable/dist/index.js'],
    [
      'Vite optimized dep (scoped)',
      'http://localhost:5173/node_modules/.vite/deps/@datakable_core.js?v=1a2b3c',
    ],
    [
      'Vite optimized dep (unscoped)',
      'http://localhost:5173/node_modules/.vite/deps/datakable.js?v=1a2b3c',
    ],
    [
      'Vite optimized dep (unscoped subpath)',
      'http://localhost:5173/node_modules/.vite/deps/datakable_core.js?v=9',
    ],
    ['CDN', 'https://cdn.jsdelivr.net/npm/@datakable/core@1.0.0/dist/index.js'],
    ['Windows path', 'C:\\app\\node_modules\\@datakable\\core\\dist\\index.cjs'],
  ])('%s → DK_INTERNAL', (_label, frame) => {
    expect(classifyError(thrownAt(frame))).toBe('DK_INTERNAL')
  })

  it.each([
    ['user folder named datakable', '/home/me/datakable/src/UsersPage.tsx'],
    ['user folder named datakable-app', '/home/me/datakable-app/src/main.ts'],
    ['user folder named datakable_demo', '/Users/me/datakable_demo/index.js'],
    ['another package containing the word', '/app/node_modules/my-datakable-plugin/index.js'],
    [
      'Vite optimized dep of another package',
      'http://localhost:5173/node_modules/.vite/deps/react.js?v=1',
    ],
    [
      'Vite shared chunk (not attributable)',
      'http://localhost:5173/node_modules/.vite/deps/chunk-XYZ.js?v=1',
    ],
  ])('%s → DK_UNKNOWN', (_label, frame) => {
    expect(classifyError(thrownAt(frame))).toBe('DK_UNKNOWN')
  })
})
