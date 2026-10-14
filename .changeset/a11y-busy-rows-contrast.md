---
'@datakable/react': patch
'datakable': patch
---

`styles.css` no longer fades the stale rows to `opacity: 0.6` while the table is busy over them
(refresh, server or debounced search): that dropped body text to 4.24:1 in the light theme (WCAG
1.4.3 needs 4.5:1), and flagged cells to 2.59:1. The rows keep full contrast; the "Updating…"
indicator signals the refresh and the rows get `cursor: progress`. Fixes #57.
