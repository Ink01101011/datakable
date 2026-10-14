import type { ContextBase } from '../intercept/context'
import type { Trigger } from './types'

/** One step of the traced run: counts (never rows) and its duration (§9.1: bounded). */
export interface TraceStep {
  readonly input: number
  readonly output: number
  /** With time-sliced work (#61): the runs that waited on it, this one, and the slices between. */
  readonly ms: number
  /** Time-sliced work (#61): the runs {@link ms} spans (absent when the step ran in one). */
  readonly runs?: number
}

/** What the tracer kept of the last `pipeline:run` of a table (the last run only). */
export interface Trace {
  readonly run: number
  readonly trigger: Trigger
  /** Duration of the whole run; `undefined` while it is in progress. */
  ms: number | undefined
  /** Steps that ran (a step served from its memo is absent), by feature name. */
  readonly steps: Map<string, TraceStep>
  /** The last `state:dispatch` (its `where`: a method / feature name) and its duration. */
  dispatch: { where: string; ms: number } | undefined
}

/**
 * Set on the `pipeline:step` ctx's `meta` by the runner when the step waits on time-sliced work
 * (its result comes in a later run).
 */
export const SLICED = 'sliced'

/**
 * The tracer's (#61): the runner reports each slice of time-sliced work run between pipeline runs
 * (no step is timing it). Unset until a tracer is created.
 */
export const sliceTimer: {
  current?: ((base: ContextBase, feature: string, ms: number) => void) | undefined
} = {}

/** Kept apart from the tracer so `explain()` reads traces without bundling the tracer itself. */
const traces = new WeakMap<object, Trace>()

/** The last traced run of `table`, if a tracer is installed. */
export const readTrace = (table: object): Trace | undefined => traces.get(table)

export const writeTrace = (table: object, trace: Trace): void => {
  traces.set(table, trace)
}
