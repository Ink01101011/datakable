// app/layout.tsx — the root layout (a server component) renders the client module once.
import type { ReactNode } from 'react'
import { DatakableMessages } from './3-datakable-messages' // './datakable-messages' in your app

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DatakableMessages />
        {children}
      </body>
    </html>
  )
}
