import { createSchemaIngest } from './schema'
import { SCHEMA_INGEST, type TableSchema } from './schema-brand'
import type { StandardSchemaV1 } from './standard-schema'

const wrapped = new WeakMap<object, TableSchema>()

/**
 * Opts a Standard Schema v1 (zod, valibot, arktype, …) into table validation (§5.1):
 * `createTable({ data, schema: withSchema(UserSchema) })`. The row type is the schema's output and
 * `invalidRows` applies as before. Memoised per schema, so a call inside a React render keeps one
 * identity (`schema` is read once, at creation).
 */
export function withSchema<S extends StandardSchemaV1>(
  schema: S,
): TableSchema<StandardSchemaV1.InferInput<S>, StandardSchemaV1.InferOutput<S>> {
  const key = schema !== null && (typeof schema === 'object' || typeof schema === 'function')
  let w = key ? wrapped.get(schema) : undefined
  if (!w) {
    w = {
      '~standard': (schema as Partial<StandardSchemaV1> | null)?.['~standard'] as never,
      [SCHEMA_INGEST]: (mode, getColumns) => createSchemaIngest(schema, mode, getColumns),
    }
    if (key) wrapped.set(schema, w)
  }
  return w as TableSchema<StandardSchemaV1.InferInput<S>, StandardSchemaV1.InferOutput<S>>
}
