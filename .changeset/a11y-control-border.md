---
'@datakable/react': patch
'datakable': patch
---

`styles.css`: the search input's border used `--dk-border` (the table-rule colour), only 1.43:1
(light) / 1.92:1 (dark) against the background, below WCAG 1.4.11's 3:1 for a control boundary. It
now uses a new token, `--dk-control-border`: `#818b98` (3.45:1 on `#fff`) and `#6e7681` in the
dark set (4.12:1 on `#0d1117`). `--dk-border` still draws the table rules. Fixes #58.
