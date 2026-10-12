import { NO_ISSUES, type RowIssue } from '../pipeline/row'

/** Standard Schema issue path → `a.b.0.c`. Never throws (paths come from user code). */
export function joinIssuePath(path: RowIssue['path']): string {
  if (!path) return ''
  let out = ''
  for (let i = 0; i < path.length; i++) {
    const s = path[i]
    const k = typeof s === 'object' && s !== null ? (s as { key: PropertyKey }).key : s
    out += (i === 0 ? '' : '.') + (typeof k === 'symbol' ? k.toString() : String(k))
  }
  return out
}

/**
 * `row.getCellIssues` matching (§5.1), segment by segment against a column's compiled key path —
 * no string is built, so a check allocates nothing:
 *
 * - the issue path and the column key agree on their common prefix: equal, the issue under the
 *   column (`address.city` → `address`), or the column under the issue (`address` →
 *   `address.city`). `address` never matches `addressLine`.
 * - `{ key }` and numeric segments compare as strings (`['tags', 0]` → `tags.0`); a symbol segment
 *   never matches; one segment `'a.b'` is not the two-segment key `a.b`.
 * - a row-level issue (no or empty path) touches every column, accessor columns included;
 *   accessor columns (`segments` `undefined`) have no key, so they get only those.
 * - a path that throws when read (user code) counts as row-level. Never throws.
 */
export function issuePathTouches(
  path: RowIssue['path'],
  segments: readonly string[] | undefined,
): boolean {
  try {
    if (!path || path.length === 0) return true
    if (!segments) return false
    const n = path.length < segments.length ? path.length : segments.length
    for (let i = 0; i < n; i++) {
      const s = path[i]
      const k = typeof s === 'object' && s !== null ? (s as { key: PropertyKey }).key : s
      if (typeof k === 'symbol' || String(k) !== segments[i]) return false
    }
    return true
  } catch {
    return true
  }
}

/**
 * The issues of `issues` that touch the column with key path `segments` (`undefined`: accessor
 * column), per {@link issuePathTouches}. Allocates only when an issue matches.
 */
export function matchCellIssues(
  issues: readonly RowIssue[],
  segments: readonly string[] | undefined,
): readonly RowIssue[] {
  let out: RowIssue[] | undefined
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i] as RowIssue
    let path: RowIssue['path']
    try {
      path = issue.path
    } catch {
      path = undefined
    }
    if (!issuePathTouches(path, segments)) continue
    out ??= []
    out.push(issue)
  }
  return out ?? NO_ISSUES
}
