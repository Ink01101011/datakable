---
"@datakable/core": patch
---

search: client search is Unicode-normalised (NFC), like the `contains` filter: NFC and NFD spellings of the same text (`Zoë` composed or decomposed, common from macOS, Thai and Vietnamese input) now find each other. Values are normalised once when the matcher is built (only the rare non-NFC values are kept, in a sparse map), never per keystroke.

Fixes #30
