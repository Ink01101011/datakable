import type { StandardSchemaV1 } from './standard-schema'

/** Test-only Standard Schema implementations (no schema library is a dependency, §5.1). */

type Check<Out> = (value: unknown) => StandardSchemaV1.Result<Out>

/** A conforming schema from a check; `async` makes `validate` return a promise. */
export function makeSchema<Out, In = unknown>(
  check: Check<Out>,
  opts: { async?: boolean | (() => Promise<void>); vendor?: string } = {},
): StandardSchemaV1<In, Out> {
  const delay = opts.async
  return {
    '~standard': {
      version: 1,
      vendor: opts.vendor ?? 'test',
      validate: (value) => {
        if (!delay) return check(value)
        const wait = typeof delay === 'function' ? delay() : Promise.resolve()
        return wait.then(() => check(value))
      },
    },
  }
}

export type User = { id: number; name: string; age: number }

/**
 * `{ id: number, name: string, age: number | numeric string }`; `age` is coerced to a number.
 * Messages embed the received value, like real validators do (redaction must scrub them).
 */
export function userCheck(value: unknown): StandardSchemaV1.Result<User> {
  if (typeof value !== 'object' || value === null) {
    return { issues: [{ message: `Expected object, received ${JSON.stringify(value)}` }] }
  }
  const v = value as Record<string, unknown>
  const issues: StandardSchemaV1.Issue[] = []
  if (typeof v.id !== 'number') {
    issues.push({ message: `Expected number, received ${JSON.stringify(v.id)}`, path: ['id'] })
  }
  if (typeof v.name !== 'string') {
    issues.push({ message: `Expected string, received ${JSON.stringify(v.name)}`, path: ['name'] })
  }
  const age = typeof v.age === 'string' && /^\d+$/.test(v.age) ? Number(v.age) : v.age
  if (typeof age !== 'number') {
    issues.push({
      message: `Expected number, received ${JSON.stringify(v.age)}`,
      path: [{ key: 'age' }],
    })
  }
  if (issues.length > 0) return { issues }
  return { value: { id: v.id as number, name: v.name as string, age: age as number } }
}

export const userSchema = makeSchema<User, { id: number; name: string; age: number | string }>(
  userCheck,
)
