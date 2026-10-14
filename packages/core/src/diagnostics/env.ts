// The helpful error when `process` is missing (#36); evaluated before the read below.
import './process-guard'

// No @types/node in core: declare just what is read.
declare const process: { env: { NODE_ENV?: string } }

/**
 * Development build: text builders, dev checks and dev-only warnings are on (§8.2).
 *
 * Written as the bare `process.env.NODE_ENV` read on purpose: bundlers replace it with a string
 * literal, so `DEV` folds to a constant and every `if (DEV)` branch is removed from a production
 * bundle. A `typeof process` guard would keep it a runtime value (and `true` in browsers).
 */
export const DEV: boolean = process.env.NODE_ENV !== 'production'
