/**
 * `datakable/messages`: full diagnostic text in production builds (§8.2, §12).
 * `import 'datakable/messages'` once in the app entry; development builds already have it.
 */
import { installMessages } from '@datakable/core'
import { renderMessages } from '@datakable/react'

export * from '@datakable/core/messages'

// `@datakable/react`'s codes that production can emit (`<DataTable />`).
installMessages(renderMessages)
