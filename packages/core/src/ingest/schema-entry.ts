// `@datakable/core/schema` (§5.1, §12): Standard Schema validation, an opt-in import.
export {
  DatakableSchemaError,
  type InvalidRow,
  isStandardSchema,
  type SchemaOutcome,
} from './schema'
export { SCHEMA_INGEST, type TableSchema } from './schema-brand'
export { type InvalidRowsMode, type SchemaIssueColumn, schemaDiagnostics } from './schema-codes'
export type { StandardSchemaV1 } from './standard-schema'
export { withSchema } from './with-schema'
