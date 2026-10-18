import { z } from 'zod';
import type { SaydoUser } from './types';

export const ENTITY_META_KEY = 'saydoEntity';
/** Symbol-keyed so it travels with the schema but never into JSON Schema output. */
const ENTITY_REF = Symbol.for('saydo.entity-ref');
const ENTITY_MODE = Symbol.for('saydo.entity-mode');
const ENTITY_BRAND = Symbol.for('saydo.entity');

export interface EntityContext {
  user: SaydoUser;
}

export interface EntityDefinition<R> {
  /** Stable type name, e.g. 'post'. Used in handles like `post#1`. */
  type: string;
  /** Human label shown on confirm cards and to the model (treated as untrusted). */
  label: (record: R) => string;
  /**
   * Load one record the user may access, or return null. This is the authz
   * boundary: every handle the model passes is re-resolved through it.
   */
  get: (id: string, ctx: EntityContext) => R | null | undefined | Promise<R | null | undefined>;
  /** Optional search, exposed to the model as `entities_find`. */
  find?: (query: string, ctx: EntityContext) => R[] | Promise<R[]>;
  /** Extract the id from a record. Defaults to `record.id`. */
  id?: (record: R) => string;
  /**
   * Optimistic concurrency: a version that changes on every edit (updatedAt, a counter).
   * If it changed between the confirm card and the approval, the action is refused instead
   * of overwriting newer data.
   */
  version?: (record: R) => string | number;
  /** One-line description for the model. */
  describe?: string;
}

export interface Entity<R = unknown> extends EntityDefinition<R> {
  readonly [ENTITY_BRAND]: true;
  /**
   * Input field holding a reference to one record. The model sends an opaque
   * handle; the engine resolves it (with authz) before your handler runs, so
   * the handler receives the record itself.
   */
  ref(options?: { describe?: string }): z.ZodType<R>;
  /**
   * `ref({ as: 'id' })`: the handler receives the record's id (a string) instead
   * of the record. The model still only ever sees handles, and access is still
   * checked with `get`. Handy for Server Actions that also take ids from forms.
   */
  ref(options: { describe?: string; as: 'id' }): z.ZodType<string>;
  /** Bind a dynamic route segment (`[id]`) to this entity in `nav.ts`. */
  param(): EntityParam<R>;
  idOf(record: R): string;
}

export interface EntityParam<R = unknown> {
  readonly kind: 'entity-param';
  readonly entity: Entity<R>;
}

// Entities register themselves so the engine can resolve `Post.ref()` fields
// with zero wiring. Re-definition (HMR) replaces the previous entry.
const REGISTRY_KEY = Symbol.for('saydo.entity-registry');
const registry: Map<string, Entity<any>> = ((globalThis as Record<symbol, unknown>)[REGISTRY_KEY] ??=
  new Map()) as Map<string, Entity<any>>;

export function getEntity(type: string): Entity<any> | undefined {
  return registry.get(type);
}

export function allEntities(): Entity<any>[] {
  return [...registry.values()];
}

export function defineEntity<R>(definition: EntityDefinition<R>): Entity<R> {
  if (!/^[a-z][a-z0-9_-]*$/i.test(definition.type)) {
    throw new Error(
      `defineEntity: type "${definition.type}" must be alphanumeric (fix: use a name like "post").`,
    );
  }
  const entity: Entity<R> = {
    ...definition,
    [ENTITY_BRAND]: true,
    ref(options?: { describe?: string; as?: 'id' }) {
      return refSchema(definition.type, options?.describe, entity, options?.as === 'id' ? 'id' : 'record');
    },
    param() {
      return { kind: 'entity-param', entity };
    },
    idOf(record) {
      if (definition.id) return definition.id(record);
      const id = (record as { id?: unknown })?.id;
      if (typeof id !== 'string' && typeof id !== 'number') {
        throw new Error(
          `Entity "${definition.type}" records have no string id (fix: pass an \`id\` function to defineEntity).`,
        );
      }
      return String(id);
    },
  };
  registry.set(definition.type, entity);
  return entity;
}

function refSchema<R>(type: string, describe: string | undefined, entity?: Entity<any>, mode: 'record' | 'id' = 'record'): z.ZodType<R> {
  const schema = z.string().meta({
    [ENTITY_META_KEY]: type,
    [ENTITY_MODE]: mode,
    ...(entity ? { [ENTITY_REF]: entity } : {}),
    description:
      describe ??
      `A ${type} handle such as "${type}#1". Get handles from the current page context or entities_find; never invent them.`,
  });
  // The schema validates the handle string; the engine swaps in the resolved
  // record before any handler runs, hence the typed cast.
  return schema as unknown as z.ZodType<R>;
}

/**
 * Isomorphic entity reference by type name, for capability declarations that
 * the browser imports (client capabilities). It pulls in no resolver code;
 * the server resolves it through the entity registered under that type.
 *
 *   input: z.object({ post: entityRef<PostRecord>('post') })
 */
export function entityRef<R = { id: string }>(type: string, options?: { describe?: string }): z.ZodType<R> {
  return refSchema<R>(type, options?.describe);
}

export function isEntity(value: unknown): value is Entity {
  return typeof value === 'object' && value !== null && ENTITY_BRAND in value;
}

/** Where an entity ref sits inside a capability's input object. */
export interface RefField {
  key: string;
  type: string;
  many: boolean;
  optional: boolean;
  /** The entity this ref was created from (absent for hand-built schemas). */
  entity?: Entity<any>;
  /** 'record' (default) passes the resolved record; 'id' passes its id. */
  mode: 'record' | 'id';
}

function refOf(schema: z.ZodType): { type: string; entity?: Entity<any>; mode: 'record' | 'id' } | undefined {
  const meta = schema.meta() as Record<string | symbol, unknown> | undefined;
  const type = meta?.[ENTITY_META_KEY];
  if (typeof type !== 'string') return undefined;
  const entity = meta?.[ENTITY_REF];
  return { type, entity: isEntity(entity) ? entity : undefined, mode: meta?.[ENTITY_MODE] === 'id' ? 'id' : 'record' };
}

function unwrapOptional(schema: z.ZodType): { inner: z.ZodType; optional: boolean } {
  let inner = schema;
  let optional = false;
  for (let i = 0; i < 4; i++) {
    if (inner instanceof z.ZodOptional || inner instanceof z.ZodNullable || inner instanceof z.ZodDefault) {
      inner = inner.unwrap() as z.ZodType;
      optional = true;
    } else break;
  }
  return { inner, optional };
}

/** Find top-level entity refs (single or array) in an object schema. */
export function findRefFields(schema: z.ZodType): RefField[] {
  if (!(schema instanceof z.ZodObject)) return [];
  const fields: RefField[] = [];
  for (const [key, raw] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
    const { inner, optional } = unwrapOptional(raw);
    const direct = refOf(inner);
    if (direct) {
      fields.push({ key, ...direct, many: false, optional });
      continue;
    }
    if (inner instanceof z.ZodArray) {
      const element = refOf(unwrapOptional(inner.element as z.ZodType).inner);
      if (element) fields.push({ key, ...element, many: true, optional });
    }
  }
  return fields;
}
