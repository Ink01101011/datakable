// plugins/datakable-messages.ts — a universal Nuxt plugin. The call keeps the messages in the
// server bundle too; a side-effect-only import would be dropped there.
import { installMessages } from '@datakable/core'
import { allMessages } from '@datakable/core/messages'

declare function defineNuxtPlugin(setup: () => void): unknown // auto-imported by Nuxt

installMessages(...allMessages)

export default defineNuxtPlugin(() => {})
