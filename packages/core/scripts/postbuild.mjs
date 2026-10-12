// Runs after tsup (`pnpm build`): checks and fixes that need every output file, .d.ts included.
import { checkDevInlined, fixDtsAugmentations } from './preserve-modules.mjs'

await checkDevInlined('dist')
const n = await fixDtsAugmentations('dist')
console.log(`postbuild: DEV inlined; ${n} DiagnosticCatalog augmentations point at @datakable/core`)
