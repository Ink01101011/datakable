---
'@datakable/core': patch
'@datakable/react': patch
'datakable': patch
---

- Diagnostics: a user value with a `|` in a diagnostic sentence is no longer truncated. A column `sortAlgorithm: 'fast|stable'` now reads `"fast|stable" is not a sort algorithm …`; the same applies to operation, boundary, diagnostic-code and feature method names. (#92)
- Development console: control characters (C0, C1, DEL) and line breaks in printed diagnostic text are escaped (`\u001b`, `\n`), so a state key or column id from a URL or data can no longer forge a `✖ [DataKable …]` line or send terminal escape sequences. `onDiagnostic` and `getDiagnostics()` still receive the raw values. (#104)
