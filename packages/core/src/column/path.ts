/** `true` when `T` is `any`, otherwise `false` (also for `unknown` and `never`). */
export type IsAny<T> = 0 extends 1 & T ? true : false

/** Values that end a path: never traversed by {@link Path}. */
export type Primitive = string | number | bigint | boolean | null | undefined | Date

// biome-ignore lint/suspicious/noExplicitAny: matches every function signature
type AnyFn = (...args: any[]) => any
type Prev = [never, 0, 1, 2, 3, 4]

/**
 * Dot-paths into `T`, e.g. `'address.geo.lat'`. Arrays, functions and `Date` are leaves (not
 * traversed); nullable intermediates are traversed (`'manager.name'` when `manager` may be
 * `null`). Capped at 4 traversals below the root so recursive types terminate.
 */
export type Path<T, D extends number = 4> = [D] extends [never]
  ? never
  : {
      [K in Extract<keyof T, string>]: NonNullable<T[K]> extends
        | Primitive
        | readonly unknown[]
        | AnyFn
        ? K
        : NonNullable<T[K]> extends object
          ? K | `${K}.${Path<NonNullable<T[K]>, Prev[D]>}`
          : K
    }[Extract<keyof T, string>]

/**
 * Value type at path `P` of `T`. A nullable intermediate adds its `null` / `undefined` to the
 * result (`PathValue<User, 'manager.name'>` is `string | null`). `never` when `P` is not a path.
 */
export type PathValue<T, P extends string> = P extends `${infer H}.${infer R}`
  ? H extends keyof T
    ? PathValue<NonNullable<T[H]>, R> | Extract<T[H], null | undefined>
    : never
  : P extends keyof T
    ? T[P]
    : never
