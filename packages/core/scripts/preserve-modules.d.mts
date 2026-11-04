import type { Options } from 'tsup'

export declare const preserveModules: NonNullable<Options['esbuildPlugins']>[number]

export declare function inlineDev(src: string): string | undefined
export declare function loadWithoutProcess(url: URL): string
