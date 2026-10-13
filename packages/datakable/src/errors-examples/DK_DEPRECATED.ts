import { defineDeprecation, warnDeprecated } from '@datakable/core'

// A plugin deprecates one of its methods (DataKable's own deprecations work the same way).
const oldExport = defineDeprecation({
  api: 'table.exportCsv',
  since: '1.4.0',
  removeIn: '2.0.0',
  replacement: 'table.export({ format: "csv" })',
})

export function exportCsv() {
  warnDeprecated(oldExport) // once per session
}
exportCsv()
