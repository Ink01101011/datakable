import { type DiagnosticMessages, defineDiagnostic } from '../diagnostics/catalog'
import { DEV } from '../diagnostics/env'

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_LISTENER_FAILED: {
      /** Subscription number (1 = the first `subscribe` call). */
      listener: number
      /** `error.name` only; the full error is `context.cause`. */
      errorName?: string
    }
    DK_UPDATE_LOOP: {
      limit: number
      /** Slice names of the dropped update. */
      slices: string[]
      /** The listener whose update was dropped, if one was running. */
      listener?: number
    }
    DK_TABLE_DESTROYED: { method: string }
    DK_CONTROLLED_WITHOUT_HANDLER: {
      /** Controlled slices (keys of `options.state`). */
      slices: string[]
      /** `true` when an update to them was just dropped. */
      dropped: boolean
    }
  }
}

const listSlices = (s: string[]) =>
  s.length === 0 ? 'a function updater' : s.map((k) => `"${k}"`).join(', ')

/** Message text (§8.2): development builds, or production via `@datakable/core/messages`. */
export const tableMessages: DiagnosticMessages<
  'DK_LISTENER_FAILED' | 'DK_UPDATE_LOOP' | 'DK_TABLE_DESTROYED' | 'DK_CONTROLLED_WITHOUT_HANDLER'
> = {
  DK_LISTENER_FAILED: {
    problem: (d) =>
      `subscribe listener #${d.listener} threw${d.errorName ? ` ${d.errorName}` : ''} ` +
      'while being notified of a state change',
    impact: () => 'the other listeners still ran; the state change is committed',
    fix: (d) => [
      `catch errors inside listener #${d.listener} (the ${d.listener}. subscribe call); ` +
        'listeners must not throw',
      'the original error is context.cause (passed to onDiagnostic)',
    ],
  },
  DK_UPDATE_LOOP: {
    problem: (d) =>
      `state updates re-entered from listeners ${d.limit} rounds in a row ` +
      `(last update: ${listSlices(d.slices)})`,
    impact: () => 'the update was dropped to break the loop; the state is unchanged by it',
    fix: (d) => [
      `make ${d.listener === undefined ? 'the listener' : `listener #${d.listener}`} update ` +
        'state only when the value differs (compare before calling setState)',
      'derive the value instead of storing it, or move the update out of the listener',
    ],
  },
  DK_TABLE_DESTROYED: {
    problem: (d) => `table.${d.method}() was called after table.destroy()`,
    impact: () => 'the call was ignored (no-op)',
    fix: (d) => [
      `stop calling ${d.method}() after destroy(): unsubscribe / cancel timers in your cleanup`,
      'create a new table with createTable() if the component is mounted again',
    ],
  },
  DK_CONTROLLED_WITHOUT_HANDLER: {
    problem: (d) =>
      `options.state controls ${listSlices(d.slices)} but options.onStateChange is missing`,
    impact: (d) =>
      d.dropped
        ? 'an update to these slices was dropped: interactions that change them are frozen'
        : 'interactions that change these slices are frozen (their updates are dropped)',
    fix: (d) => [
      'pass onStateChange: (updater) => setMyState(updater), and feed the result back with ' +
        'setOptions({ state })',
      `or remove ${listSlices(d.slices)} from options.state (use initialState) so the table ` +
        'owns them',
    ],
  },
}

/** Codes owned by the store (§3.2, §8.3). */
export const tableDiagnostics = [
  defineDiagnostic(
    {
      code: 'DK_LISTENER_FAILED',
      level: 'error',
      where: (d) => ({ kind: 'operation', op: 'table.subscribe', slot: `listener #${d.listener}` }),
    },
    DEV && tableMessages.DK_LISTENER_FAILED,
  ),
  defineDiagnostic(
    {
      code: 'DK_UPDATE_LOOP',
      level: 'error',
      where: (d) =>
        d.listener === undefined
          ? { kind: 'operation', op: 'table.setState' }
          : { kind: 'operation', op: 'table.setState', slot: `listener #${d.listener}` },
    },
    DEV && tableMessages.DK_UPDATE_LOOP,
  ),
  defineDiagnostic(
    {
      code: 'DK_TABLE_DESTROYED',
      level: 'warn',
      where: (d) => ({ kind: 'operation', op: `table.${d.method}` }),
    },
    DEV && tableMessages.DK_TABLE_DESTROYED,
  ),
  defineDiagnostic(
    {
      code: 'DK_CONTROLLED_WITHOUT_HANDLER',
      level: 'warn',
      where: (d) => ({ kind: 'option', path: `state.${d.slices[0] ?? ''}` }),
    },
    DEV && tableMessages.DK_CONTROLLED_WITHOUT_HANDLER,
  ),
]
