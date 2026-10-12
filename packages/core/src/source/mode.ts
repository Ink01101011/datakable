/** Where a pipeline feature's step runs (§7.1): in core (`'client'`) or on the server. */
export type DataMode = 'client' | 'server'

export const DATA_MODES: readonly DataMode[] = ['client', 'server']

/** The `mode` rule of a feature's `defineOptions` schema (§7.1). */
export const modeOption = {
  type: 'string',
  oneOf: DATA_MODES,
} as const
