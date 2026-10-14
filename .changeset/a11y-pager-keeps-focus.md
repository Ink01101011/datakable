---
'@datakable/react': patch
---

`<DataTable />`'s default pager marks Previous / Next with `aria-disabled="true"` at the first /
last page instead of `disabled`: paging to the last page with the keyboard no longer disables the
focused button and drops focus to `<body>`. The button stays focusable and ignores activation;
`styles.css` dims `button[aria-disabled="true"]` like `:disabled`. Fixes #55.
