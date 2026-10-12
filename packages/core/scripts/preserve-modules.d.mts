import type { Options } from 'tsup'

export declare const preserveModules: NonNullable<Options['esbuildPlugins']>[number]
export declare function checkDevInlined(dist: string): Promise<void>
