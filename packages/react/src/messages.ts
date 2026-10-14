/**
 * `@datakable/react/messages`: full diagnostic text in production builds (§8.2, §12), core's codes
 * plus `<DataTable />`'s. `import '@datakable/react/messages'` once in the app entry; development
 * builds already have it. Imports no React, so `datakable/messages` (#63) works without it.
 */
import { installMessages } from '@datakable/core'
import { renderMessages } from './render-codes'

export * from '@datakable/core/messages'

installMessages(renderMessages)
