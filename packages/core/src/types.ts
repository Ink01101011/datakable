/** Any plain object row. Refined in the upcoming core API design. */
export type RowData = Record<string, unknown>

/** String keys of a row type — the seed for typed column accessors. */
export type ColumnKey<T extends RowData> = Extract<keyof T, string>
