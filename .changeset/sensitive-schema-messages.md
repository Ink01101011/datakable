---
'@datakable/core': patch
---

Privacy: under `diagnostics.redact: 'full'`, a table with a `sensitive` column no longer logs
validator messages of schema issues. Before, only an issue whose path was the sensitive column was
scrubbed; a root-level refinement or another field's message that quoted the sensitive value
(`record for 123-45-6789 is inconsistent`) reached `details.issues`, `toJSON()`, the console and
`explainRow().issues`. With a sensitive column, every schema issue message is now DataKable's own
text (`invalid value at <path>`) at every level; tables without one keep the validator text under
`'full'`. Fixes #46.
