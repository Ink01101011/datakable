// Read from package.json at build time (the bundler inlines the one field), so a release never
// ships a stale hard-coded version.
import { version } from '../package.json'

/** The `@datakable/core` version (`context.package`, docs URLs, the global version registry). */
export const VERSION: string = version
