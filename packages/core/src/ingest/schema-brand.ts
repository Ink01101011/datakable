import type { SchemaIngest } from './schema'
import type { InvalidRowsMode } from './schema-codes'
import type { StandardSchemaV1 } from './standard-schema'

/**
 * Key of the schema step a {@link TableSchema} carries (§5.1). A registered symbol, so two copies of
 * core agree on it.
 */
export const SCHEMA_INGEST: unique symbol = Symbol.for('datakable.schemaIngest') as never

/** Builds the `data:ingest` schema step of one table. */
export type SchemaInstaller = (
  mode: InvalidRowsMode,
  getColumns: () => readonly unknown[] | undefined,
) => SchemaIngest

/**
 * A Standard Schema opted into table validation with `withSchema()` from `@datakable/core/schema`
 * (§5.1, changed 2026-10-13 for §9.3): `options.schema` takes only these, so a table without a
 * schema never bundles the validation step.
 */
export type TableSchema<Input = unknown, Output = Input> = StandardSchemaV1<Input, Output> & {
  readonly [SCHEMA_INGEST]: SchemaInstaller
}
