import { throwConfigError } from '../diagnostics/build'
import type { Diagnostic } from '../diagnostics/types'

/**
 * Operation registry (spec §3.4). Every unit of work is an operation with a declared kind
 * (sync / async / either) and typed input + output. Cross-cutting behaviour is attached as
 * interceptors over these operations.
 *
 * Two halves, kept in step by whoever adds an op:
 * - types: the `Operations` interface — extend it with declaration merging
 *   (`declare module '@datakable/core' { interface Operations { 'x:y': {...} } }`);
 * - runtime: `registerOperation(name, { kind, hot })`.
 *
 * Input/output shapes below are provisional where the owning task has not landed yet
 * (store T07, pipeline T09/T10, source T17); those tasks narrow them.
 */

export type OpKind = 'sync' | 'async' | 'sync|async'

export interface OpSpec {
  kind: OpKind
  input: unknown
  output: unknown
}

/** The ops core itself runs. `render:table` / `render:cell` are registered by @datakable/react. */
export interface BuiltinOperations {
  'table:init': { kind: 'sync'; input: { options: unknown }; output: undefined }
  'table:setOptions': {
    kind: 'sync'
    input: { options: unknown; previous: unknown }
    output: undefined
  }
  'table:destroy': { kind: 'sync'; input: undefined; output: undefined }
  'state:dispatch': { kind: 'sync'; input: { updater: unknown }; output: undefined }
  'data:ingest': { kind: 'sync|async'; input: { data: unknown }; output: readonly unknown[] }
  'pipeline:run': { kind: 'sync'; input: { rowCount: number }; output: Uint32Array }
  'pipeline:step': {
    kind: 'sync'
    input: { stage: string; feature: string; indices: Uint32Array }
    output: Uint32Array
  }
  /** Hot: intercepted once per column per pipeline run, never per cell. */
  'column:batch': {
    kind: 'sync'
    input: {
      column: string
      slot: 'accessor' | 'format' | 'filterFn' | 'sortBy'
      rows: Uint32Array
    }
    output: undefined
  }
  'async:request': {
    kind: 'async'
    input: { source: 'fetcher' | 'searchFn'; params?: unknown }
    output: unknown
  }
  /** The enriched diagnostic; interceptors may rewrite it (redaction) or drop it (skip `next`). */
  'diagnostic:emit': { kind: 'sync'; input: { diagnostic: Diagnostic }; output: undefined }
}

/** Open for declaration merging; every entry must satisfy `OpSpec`. */
export interface Operations extends BuiltinOperations {}

export type OpName = keyof Operations & string
export type OpInput<O extends OpName> = Operations[O]['input']
export type OpOutput<O extends OpName> = Operations[O]['output']

/** What `next()` returns and what an interceptor must return, per op kind. Distributes over unions. */
export type OpResult<O extends OpName> = O extends OpName
  ? Operations[O]['kind'] extends 'async'
    ? Promise<OpOutput<O>>
    : Operations[O]['kind'] extends 'sync|async'
      ? OpOutput<O> | Promise<OpOutput<O>>
      : OpOutput<O>
  : never

export interface OperationInfo {
  readonly kind: OpKind
  /** Hot ops are intercepted per batch; attaching without `hot: true` triggers a dev warning. */
  readonly hot: boolean
}

const registry = new Map<string, OperationInfo>()

const builtins: { [K in keyof BuiltinOperations]: OperationInfo } = {
  'table:init': { kind: 'sync', hot: false },
  'table:setOptions': { kind: 'sync', hot: false },
  'table:destroy': { kind: 'sync', hot: false },
  'state:dispatch': { kind: 'sync', hot: false },
  'data:ingest': { kind: 'sync|async', hot: false },
  'pipeline:run': { kind: 'sync', hot: false },
  'pipeline:step': { kind: 'sync', hot: false },
  'column:batch': { kind: 'sync', hot: true },
  'async:request': { kind: 'async', hot: false },
  'diagnostic:emit': { kind: 'sync', hot: false },
}
for (const [name, info] of Object.entries(builtins)) registry.set(name, info)

/**
 * Registers an op at runtime. Identical re-registration is a no-op; a conflicting one throws
 * `DatakableConfigError` (`DK_OPERATION_CONFLICT`). The registry is process-wide (ops are code, not
 * table state); diagnostics stay per table because each runtime reports through its own emitter.
 */
export function registerOperation<O extends OpName>(
  name: O,
  info: { kind: Operations[O]['kind']; hot: boolean },
): void {
  const prev = registry.get(name)
  if (prev) {
    if (prev.kind === info.kind && prev.hot === info.hot) return
    throwConfigError('DK_OPERATION_CONFLICT', {
      op: name,
      kind: info.kind,
      hot: info.hot,
      previousKind: prev.kind,
      previousHot: prev.hot,
    })
  }
  registry.set(name, { kind: info.kind, hot: info.hot })
}

export function getOperation(name: string): OperationInfo | undefined {
  return registry.get(name)
}

export function listOperations(): string[] {
  return [...registry.keys()]
}
