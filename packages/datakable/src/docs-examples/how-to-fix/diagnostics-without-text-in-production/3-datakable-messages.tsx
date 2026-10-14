'use client'
// app/datakable-messages.tsx — a client module: the import reaches the browser bundle (and the
// server render of client components). An import in app/layout.tsx, a server component, does not.
import 'datakable/messages'

export function DatakableMessages() {
  return null
}
