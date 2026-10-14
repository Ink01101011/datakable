/**
 * `datakable/messages`: full diagnostic text in production builds (§8.2, §12).
 * `import 'datakable/messages'` once in the app entry; development builds already have it.
 * Imports no React (#63): `@datakable/react/messages` installs core's text and `<DataTable />`'s.
 */
import '@datakable/react/messages'

export * from '@datakable/core/messages'
