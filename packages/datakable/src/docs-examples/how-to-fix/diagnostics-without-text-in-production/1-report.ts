import { createTable, type Diagnostic, type FetchResult, pagination, withFetcher } from 'datakable'

type User = { id: number; name: string }
declare const logger: { error(message: string, data: object): void }

// Production diagnostics always keep code, level, where, context and the docs URL (which carries
// the version and `where`): enough to group and look up an error without the text. toJSON() is a
// safe serialisation (no original error, no cycles).
const report = (d: Diagnostic) => {
  if (d.level === 'error') logger.error(d.code, d.toJSON())
}

export const table = createTable({
  rowKey: 'id',
  features: [pagination({ mode: 'server' })],
  fetcher: withFetcher(async (): Promise<FetchResult<User>> => {
    throw new TypeError('Failed to fetch')
  }),
  onDiagnostic: report,
})
