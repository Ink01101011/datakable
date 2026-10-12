// `@datakable/core/search-async` (§6.3, §12): the async `searchFn` engine, an opt-in import.
export { searchDiagnostics } from './codes'
export {
  type AsyncSearchFn,
  SEARCH_ENGINE,
  type SearchFn,
  type SearchFnContext,
  type SearchResult,
} from './search-fn-brand'
export { withSearchFn } from './with-search-fn'
