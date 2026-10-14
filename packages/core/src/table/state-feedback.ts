import { defineDiagnostic } from '../diagnostics/catalog'
import { DEV } from '../diagnostics/env'
import type { Emit, Trigger } from '../diagnostics/types'
import type { TableState } from './types'

/**
 * `DK_CONTROLLED_NOT_FED_BACK` (§3.2, dev): `onStateChange` was told about a change to a controlled
 * slice, but the owner never passed a new value back in `options.state`. The table shows only what
 * it is given, so the slice is frozen. Without this check that freeze is silent (§8.1). Dev only:
 * the definition, its text and the check sit behind `DEV`, so a production bundle has none of it.
 */

declare module '../diagnostics/catalog' {
  interface DiagnosticCatalog {
    DK_CONTROLLED_NOT_FED_BACK: {
      /** Controlled slices whose change was not fed back. */
      slices: string[]
      /** How long the owner had to feed it back. */
      waitedMs: number
    }
    DK_CONTROLLED_SLICE_DROPPED: {
      /** Controlled slices missing from the new `options.state`. */
      slices: string[]
      /** The slices that new `options.state` did pass. */
      kept: string[]
    }
  }
}

const list = (s: string[]) => s.map((k) => `"${k}"`).join(', ')

export const stateFeedbackDiagnostics = DEV
  ? [
      defineDiagnostic({
        code: 'DK_CONTROLLED_NOT_FED_BACK',
        level: 'warn',
        where: (d) => ({ kind: 'option', path: `state.${d.slices[0] ?? ''}` }),
        problem: (d) =>
          `onStateChange was called with a change to ${list(d.slices)}, but options.state ` +
          `still had the old value ${d.waitedMs} ms later`,
        impact: () =>
          'the change was not applied: a controlled slice shows only the value you pass back, so ' +
          'interactions that change it look frozen',
        fix: (d) => [
          'apply the updater and feed the result back: onStateChange: (updater) => ' +
            'setMyState(updater), then pass the new state as options.state (React: the state prop; ' +
            'createTable: table.setOptions({ state }))',
          `or move ${list(d.slices)} to initialState so the table owns it`,
          'if you reject the change on purpose, disable the control that asks for it instead',
        ],
      }),
      defineDiagnostic({
        code: 'DK_CONTROLLED_SLICE_DROPPED',
        level: 'warn',
        where: (d) => ({ kind: 'option', path: `state.${d.slices[0] ?? ''}` }),
        problem: (d) =>
          `setOptions({ state }) fed back ${list(d.kept)} without ${list(d.slices)}: setOptions ` +
          `replaces the whole state option, so ${list(d.slices)} is no longer controlled`,
        impact: (d) =>
          `the table now owns ${list(d.slices)}: its changes no longer reach onStateChange and your ` +
          'copy goes stale',
        fix: (d) => [
          'pass every controlled slice each time, e.g. table.setOptions({ state: { ...current, ' +
            `${d.kept[0]} } })`,
          `to release a slice on purpose, pass it as undefined: { ${d.slices[0]}: undefined }`,
        ],
      }),
    ]
  : []

/** Time the owner has to feed a change back (a render, a store update, a router navigation). */
export const FEEDBACK_MS = 1000

/**
 * Watches the changes the table asks the owner of controlled slices to make: `ask` before
 * `onStateChange` is called, `asked` once it returned (not when it threw), `settle` after every
 * change to `options.state`. A slice whose value is still the old one `FEEDBACK_MS` later is
 * reported once per ask.
 */
export function createStateFeedbackCheck(emit: Emit) {
  /** Slice → its value in `options.state` when the change was asked. */
  const waiting = new Map<string, unknown>()
  /** The ask in progress (`ask` → `asked`): slice → its value before `onStateChange`. */
  const asking = new Map<string, unknown>()
  let asker: Trigger = 'init'
  let timer: ReturnType<typeof setTimeout> | undefined
  /** The interaction that asked first (the report's `context.trigger`). */
  let askedBy: Trigger = 'init'
  let state: TableState | undefined
  let controlled: ReadonlySet<string> = new Set()

  function settle(nextState: TableState | undefined, nextControlled: ReadonlySet<string>) {
    // A feed-back (an ask in flight or waiting) that passes some slices and omits others (#49).
    if (nextState && nextState !== state && (asking.size > 0 || waiting.size > 0)) {
      const kept = Object.keys(nextState)
      const slices = [...controlled].filter((k) => !(k in nextState))
      if (kept.length > 0 && slices.length > 0) {
        emit('DK_CONTROLLED_SLICE_DROPPED', { slices, kept })
      }
    }
    state = nextState
    controlled = nextControlled
    for (const [k, before] of waiting) {
      if (!controlled.has(k) || !Object.is(state?.[k], before)) waiting.delete(k)
    }
    if (waiting.size === 0) dispose()
  }

  function check() {
    timer = undefined
    settle(state, controlled)
    if (waiting.size === 0) return
    const slices = [...waiting.keys()]
    waiting.clear()
    emit('DK_CONTROLLED_NOT_FED_BACK', { slices, waitedMs: FEEDBACK_MS }, { trigger: askedBy })
  }

  function dispose() {
    waiting.clear()
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  return {
    ask(slices: string[], trigger: Trigger) {
      asking.clear()
      for (const k of slices) asking.set(k, state?.[k])
      asker = trigger
    },
    asked() {
      for (const [k, before] of asking) if (!waiting.has(k)) waiting.set(k, before)
      asking.clear()
      // A synchronous feed-back (setOptions inside onStateChange) already settled.
      settle(state, controlled)
      if (waiting.size === 0 || timer !== undefined) return
      askedBy = asker
      timer = setTimeout(check, FEEDBACK_MS)
      // Never keeps a server process (SSR, tests) alive.
      ;(timer as { unref?: () => void }).unref?.()
    },
    settle,
    dispose,
  }
}
