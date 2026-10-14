/**
 * `@datakable/core/messages` (`datakable/messages`): full diagnostic text in production (§8.2).
 *
 * Production builds strip `problem` / `impact` / `fix` and keep `code`, `where`, `context` and a
 * docs URL. `import '@datakable/core/messages'` once (e.g. in the app entry) installs the text of
 * every code a production build can emit. Development builds already have it. This module is the
 * package's only side effect (`sideEffects` in package.json).
 */
import { optionMessages } from '../catalog/codes'
import { installMessages } from '../diagnostics/catalog'
import { coreMessages } from '../diagnostics/codes'
import { proseMessages } from '../diagnostics/prose'
import { redactionMessages } from '../diagnostics/redact'
import { featureMessages } from '../feature/codes'
import { columnFiltersMessages } from '../features/column-filters/codes'
import { paginationMessages } from '../features/pagination/codes'
import { searchMessages } from '../features/search/codes'
import { sortingMessages } from '../features/sorting/codes'
import { validityMessages } from '../features/validity/codes'
import { dataCheckMessages } from '../ingest/data-check-codes'
import { rowKeyMessages } from '../ingest/row-key-codes'
import { schemaMessages } from '../ingest/schema-codes'
import { boundaryMessages } from '../intercept/codes'
import { pipelineMessages } from '../pipeline/codes'
import { envMessages } from '../pipeline/env-codes'
import { asyncMessages } from '../source/codes'
import { fetchMessages } from '../source/fetch-codes'
import { tableMessages } from '../table/codes'
import { ssrMessages } from '../table/ssr-codes'
import { versioningMessages } from '../versioning/codes'

/** Every message object core ships, one per module that owns codes. */
export const allMessages: ReadonlyArray<Readonly<Record<string, unknown>>> = [
  coreMessages,
  redactionMessages,
  optionMessages,
  featureMessages,
  boundaryMessages,
  pipelineMessages,
  tableMessages,
  ssrMessages,
  asyncMessages,
  fetchMessages,
  rowKeyMessages,
  schemaMessages,
  dataCheckMessages,
  versioningMessages,
  columnFiltersMessages,
  validityMessages,
  searchMessages,
  sortingMessages,
  paginationMessages,
  envMessages,
  // The detail sentences production keeps as keys (`fallback: 'cells-undefined'`).
  proseMessages,
]

installMessages(...allMessages)
