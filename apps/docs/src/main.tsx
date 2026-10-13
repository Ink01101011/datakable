import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
// The optional stylesheet (T35) styles <DataTable />; playground.css only lays out the page.
import 'datakable/styles.css'
import './playground.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
