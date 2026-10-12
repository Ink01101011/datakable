/** Versioning (spec §8.5): deprecations, the global version registry, dependency feature-detection. */
export { type DependencyCapability, detectCapability } from './capability'
export { type Deprecation, defineDeprecation, warnDeprecated } from './deprecation'
export { REGISTRY_KEY, registerPackage, type VersionRegistry } from './registry'
