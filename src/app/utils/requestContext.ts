import { AsyncLocalStorage } from 'async_hooks';

// Per-request context. The tenant scope plugin reads tenantId from here so that
// every query and every new document is confined to the caller's tenant.
export type TRequestContext = {
  tenantId?: string;
  userId?: string;
  locationId?: string;
  bypassTenantScope?: boolean;
};

const storage = new AsyncLocalStorage<TRequestContext>();

const run = <T>(ctx: TRequestContext, fn: () => T): T => storage.run(ctx, fn);

const get = (): TRequestContext | undefined => storage.getStore();

const set = (values: Partial<TRequestContext>) => {
  const store = storage.getStore();
  if (store) Object.assign(store, values);
};

// Runs fn as a system actor with no tenant restriction (login, webhooks, jobs lookups).
const asSystem = <T>(fn: () => T): T => storage.run({ bypassTenantScope: true }, fn);

// Runs fn confined to one tenant (background jobs, public endpoints after resolving the tenant).
const asTenant = <T>(tenantId: string, fn: () => T, extra: Partial<TRequestContext> = {}): T =>
  storage.run({ tenantId, ...extra }, fn);

export const requestContext = { run, get, set, asSystem, asTenant };
