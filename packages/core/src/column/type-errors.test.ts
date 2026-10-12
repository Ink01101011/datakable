import ts from 'typescript'
import { beforeAll, describe, expect, test } from 'vitest'

// Pins the text of the six common column type errors (spec §4.3, §11) and the hover docs on
// `cell` / `format`. The cases live in type-errors.test-d.ts, where `@ts-expect-error` proves each
// line errors; here the directives are blanked out (same length, so offsets are unchanged), the
// file is compiled in memory with packages/core/tsconfig.json, and each diagnostic is matched to
// its `[E<n>]` marker. Fragments are asserted rather than full strings: the full text embeds the
// whole `Path<User>` union, whose member order is a TypeScript implementation detail.
// If a TypeScript upgrade breaks this, update docs/reading-type-errors.md with the new wording.

const here = decodeURIComponent(new URL('.', import.meta.url).pathname)
const fixture = `${here}type-errors.test-d.ts`
const tsconfig = `${here}../../tsconfig.json`

let service: ts.LanguageService
let source: string

beforeAll(() => {
  const config = ts.getParsedCommandLineOfConfigFile(
    tsconfig,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      },
    },
  )
  if (!config) throw new Error(`cannot read ${tsconfig}`)
  const original = ts.sys.readFile(fixture)
  if (original === undefined) throw new Error(`cannot read ${fixture}`)
  source = original.replaceAll('@ts-expect-error', ' '.repeat('@ts-expect-error'.length))
  const read = (file: string) => (file === fixture ? source : ts.sys.readFile(file))
  service = ts.createLanguageService({
    getCompilationSettings: () => config.options,
    getScriptFileNames: () => [fixture],
    getScriptVersion: () => '1',
    getScriptSnapshot: (file) => {
      const text = read(file)
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
    },
    getCurrentDirectory: () => here,
    getDefaultLibFileName: ts.getDefaultLibFilePath,
    fileExists: (file) => file === fixture || ts.sys.fileExists(file),
    readFile: read,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  })
})

/** Diagnostics on the line right under the `[marker]` comment, flattened to plain text. */
function errorsAt(marker: string): { code: number; text: string }[] {
  const lines = source.split('\n')
  const markerLine = lines.findIndex((l) => l.includes(`[${marker}]`))
  if (markerLine < 0) throw new Error(`marker [${marker}] not found in ${fixture}`)
  const file = service.getProgram()?.getSourceFile(fixture)
  if (!file) throw new Error('fixture not in program')
  return service
    .getSemanticDiagnostics(fixture)
    .filter((d) => d.start !== undefined)
    .filter((d) => file.getLineAndCharacterOfPosition(d.start ?? 0).line === markerLine + 1)
    .map((d) => ({ code: d.code, text: ts.flattenDiagnosticMessageText(d.messageText, '\n') }))
}

/** Asserts exactly one error under `marker`, with `code`, containing every fragment. */
function expectError(marker: string, code: number, fragments: string[]) {
  const errors = errorsAt(marker)
  expect(errors, `errors under [${marker}]`).toHaveLength(1)
  const [error] = errors
  expect(error?.code).toBe(code)
  for (const fragment of fragments) expect(error?.text).toContain(fragment)
}

describe('pinned type-error messages (docs/reading-type-errors.md)', () => {
  test('the fixture has no errors outside the marked lines', () => {
    const file = service.getProgram()?.getSourceFile(fixture)
    const lines = source.split('\n')
    const stray = service
      .getSemanticDiagnostics(fixture)
      .map((d) => file?.getLineAndCharacterOfPosition(d.start ?? 0).line ?? -1)
      .filter((line) => !/\[E\d+b?\]/.test(lines[line - 1] ?? ''))
    expect(stray).toEqual([])
    expect(service.getSyntacticDiagnostics(fixture)).toEqual([])
  })

  test('E1 typo key: TS2820 with a "Did you mean" suggestion', () => {
    expectError('E1', 2820, [`Type '"frist"' is not assignable to type`, `Did you mean '"first"'?`])
  })

  test('E2 nested typo: TS2820 suggests the nested path', () => {
    expectError('E2', 2820, [
      `Type '"address.ctiy"' is not assignable to type`,
      `Did you mean '"address.city"'?`,
    ])
  })

  test('E3 filter kind: names the allowed filter set for the value type', () => {
    expectError('E3', 2322, [
      `Types of property 'filter' are incompatible.`,
      `is not assignable to type 'StringFilter | undefined'`,
      `Type '"range"' is not assignable to type`,
    ])
  })

  test('E4 object column: "format is missing" names NeedsFormat and lists NeedsCell', () => {
    expectError('E4', 2322, [
      `Type '{ key: "address"; }' is not assignable to type 'ColumnDef<User, string>'.`,
      'NeedsCell<User, { city: string; geo: { lat: number; lng: number; }; }, string>',
      `Property 'format' is missing in type '{ key: "address"; }' but required in type 'NeedsFormat<`,
    ])
  })

  test('E5 function column: same shape as E4, with the function type as V', () => {
    expectError('E5', 2322, [
      `Type '{ key: "onClick"; }' is not assignable to type 'ColumnDef<User, string>'.`,
      'NeedsCell<User, () => void, string>',
      `Property 'format' is missing in type '{ key: "onClick"; }' but required in type 'NeedsFormat<() => void>'.`,
    ])
  })

  test('E6 bad rowKey: TS2322 against the row paths', () => {
    expectError('E6', 2322, [`Type '"nope"' is not assignable to type`, `"address.geo.lat"`])
  })

  test('E4b array of objects reads like E4', () => {
    expectError('E4b', 2322, [
      'NeedsCell<User, { id: number; }[], string>',
      `but required in type 'NeedsFormat<{ id: number; }[]>'.`,
    ])
  })
})

describe('JSDoc on cell / format', () => {
  const cellRule = 'Required (or `format`) when the value is an object, a function'
  const formatRule = 'Required (or `cell`) when the value is an object, a function'

  /** Offset right after `needle` in the fixture. */
  function after(needle: string): number {
    const at = source.indexOf(needle)
    if (at < 0) throw new Error(`${needle} not found in ${fixture}`)
    return at + needle.length
  }

  // Hover (quick info) on a written property. TypeScript shows docs only when the contextual union
  // narrows to one property symbol, which holds for columns whose value the default formatter can
  // display. For object / function columns the `NeedsCell | NeedsFormat` union leaves two symbols,
  // so quick info shows the signature only; their docs come through completions (next tests).
  test('hover on cell explains the rule', () => {
    const info = service.getQuickInfoAtPosition(fixture, after("{ key: 'first', ce"))
    const docs = ts.displayPartsToString(info?.documentation)
    expect(docs).toContain('Renders the cell')
    expect(docs).toContain(cellRule)
  })

  test('hover on format explains the rule', () => {
    const info = service.getQuickInfoAtPosition(fixture, after("{ key: 'age', fo"))
    const docs = ts.displayPartsToString(info?.documentation)
    expect(docs).toContain('Formats the value to a string')
    expect(docs).toContain(formatRule)
  })

  // Completion details where `cell` / `format` is required. The optional (BaseColumn) and required
  // (NeedsCell / NeedsFormat) declarations carry the same text, so TypeScript shows it once.
  test.each([
    ['object column', "{ key: 'address', ", 'cell', 'Renders the cell', cellRule],
    ['array-of-objects column', "{ key: 'friends', ", 'format', 'Formats the value', formatRule],
  ])('completion for %s %s explains the rule once', (_, needle, name, lead, rule) => {
    const at = after(needle)
    const entries = service.getCompletionsAtPosition(fixture, at, {})?.entries.map((e) => e.name)
    expect(entries).toContain(name)
    const details = service.getCompletionEntryDetails(
      fixture,
      at,
      name,
      {},
      undefined,
      {},
      undefined,
    )
    const docs = ts.displayPartsToString(details?.documentation)
    expect(docs).toContain(lead)
    expect(docs.split(rule)).toHaveLength(2)
  })
})
