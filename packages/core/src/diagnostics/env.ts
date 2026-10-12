// No @types/node in core: declare just what is read. Bundlers replace `process.env.NODE_ENV`.
declare const process: { env: { NODE_ENV?: string } } | undefined

/** Development build: text builders, dev checks and dev-only warnings are on (§8.2). */
export const DEV: boolean = typeof process === 'undefined' || process.env.NODE_ENV !== 'production'
