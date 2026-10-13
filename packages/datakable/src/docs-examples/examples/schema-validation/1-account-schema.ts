import type { StandardSchemaV1 } from 'datakable'

export type Account = { id: number; email: string; balance: number }

// Any Standard Schema v1 works: with zod, `z.object({ id: z.number(), email: z.email(),
// balance: z.number() })`; valibot and arktype the same. Written by hand here, so the recipe
// needs no schema library.
export const AccountSchema: StandardSchemaV1<unknown, Account> = {
  '~standard': {
    version: 1,
    vendor: 'example',
    validate(input) {
      const v = (typeof input === 'object' && input !== null ? input : {}) as Record<
        string,
        unknown
      >
      const issues: StandardSchemaV1.Issue[] = []
      if (typeof v.id !== 'number') issues.push({ message: 'Expected a number', path: ['id'] })
      if (typeof v.email !== 'string' || !v.email.includes('@')) {
        issues.push({ message: 'Expected an email', path: ['email'] })
      }
      if (typeof v.balance !== 'number') {
        issues.push({ message: 'Expected a number', path: ['balance'] })
      }
      if (issues.length > 0) return { issues }
      return {
        value: { id: v.id as number, email: v.email as string, balance: v.balance as number },
      }
    },
  },
}
