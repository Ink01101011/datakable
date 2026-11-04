---
'@datakable/core': patch
'@datakable/react': patch
'datakable': patch
---

- Bundle-size checks measure every bundle with the inlined package version replaced by a fixed placeholder, so a release version bump can no longer fail them; every size ratchet now keeps at least 64 B of headroom. (#78)
- Release workflow: npm is pinned to an exact version instead of `npm@latest`, and every GitHub Action in the CI and Release workflows is pinned to a full commit SHA. (#79)
- A Windows checkout with `core.autocrlf=true` builds, lints and tests again: the repository forces LF line endings (`.gitattributes`), and the core build accepts CRLF sources. (#81)
- The core build no longer fails when the repository path contains a space or non-ASCII characters, or on Windows paths. (#82)
- `@datakable/core` no longer ships the test-only `dist/ingest/test-schemas.*` files, and all three packages now include the MIT `LICENSE` file. (#83)
