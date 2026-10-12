import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './playground.css'

// REVIEWER: enable once T35's `datakable/styles.css` is on develop (it styles <DataTable />).
// import 'datakable/styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
