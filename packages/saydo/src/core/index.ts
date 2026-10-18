// Isomorphic entry: safe to import from server and client code.
export * from './types';
export {
  defineCapability,
  isCapability,
  collectCapabilities,
  withFileId,
  idFromPath,
  serverAction,
  isServerAction,
  type ServerAction,
  navigate,
  refresh,
  toast,
  type Capability,
  type CapabilityDefinition,
  type CapabilityContext,
  type HandlerResult,
} from './capability';
export {
  defineEntity,
  entityRef,
  isEntity,
  getEntity,
  findRefFields,
  type Entity,
  type EntityDefinition,
  type EntityParam,
  type EntityContext,
} from './entity';
export {
  defineRoute,
  defineRoutes,
  toPattern,
  parsePattern,
  paramNames,
  isStaticPattern,
  buildPath,
  matchPath,
  findRoute,
  titleFromPattern,
  type Route,
  type RouteDefinition,
  type RouteDeclaration,
  type RouteRecord,
  type Segment,
} from './route';
export { fastPath, searchRoutes, scoreRoute, type NavTarget } from './fastpath';
export { tierFor, bulkCount, annotationsFor } from './policy';
export { receipt, CapabilityError, DEFAULT_FIXES } from './fixes';
export { canonicalize, canonicalEqual } from './jcs';
export { GRANT_HEADER, INVOCATION_HEADER } from './constants';
export {
  buildLock,
  diffLock,
  formatLockDiff,
  parseLock,
  serializeLock,
  LOCKFILE_NAME,
  type Lockfile,
  type LockEntry,
  type LockDiff,
} from './lockfile';
export type * from './protocol';
