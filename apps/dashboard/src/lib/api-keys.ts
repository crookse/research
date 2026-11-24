// Shared API key types and rules. Safe to import from client components:
// nothing here touches storage or secrets.

export type ApiKeyStatus = "active" | "rotating" | "expired" | "revoked";

export const STATUS_LABEL: Record<ApiKeyStatus, string> = {
  active: "Active",
  rotating: "Being replaced",
  expired: "Expired",
  revoked: "Revoked",
};

/** A key as stored. The secret itself is never kept, only its fingerprint. */
export type StoredApiKey = {
  id: string;
  /** Public part of the key; safe to show in logs and the dashboard. */
  publicId: string;
  name: string;
  /** Tenant path from the root tenant down, e.g. "Acme / EMEA / Sales". */
  tenant: string;
  /** The one top-level endpoint this key works on. */
  endpoint: string;
  permissions: string[];
  /** HMAC-SHA256(pepper, secret), hex. Absent on seed data. */
  secretHash?: string;
  createdAt: string;
  lastUsedAt?: string;
  expiresAt: string;
  revokedAt?: string;
  /** When a replacement was issued; the key keeps working for the overlap. */
  replacedAt?: string;
  replacedById?: string;
  rotatedFromId?: string;
};

/** A key as the dashboard sees it. */
export type ApiKey = Omit<StoredApiKey, "secretHash"> & {
  status: ApiKeyStatus;
  /** Display identifier, e.g. "mtk_live_inv_7K3QX9PDM2RA". Not a secret. */
  prefix: string;
};

export type Permission = { id: string; label: string; sensitive?: boolean };

export type EndpointDef = {
  path: string;
  /** Short code in the key, a hint for humans only. */
  code: string;
  /**
   * Everything a key for this endpoint could ever be given on the whole
   * collection, e.g. "customers:read" for /customers and everything under it.
   */
  permissions: Permission[];
  /**
   * The actions that also make sense on a single item (/customers/1234), as
   * "customers.*:read" or "customers.1234:read". Never "create": a new item
   * has no id yet, so creating always needs the collection-level permission.
   */
  itemActions: string[];
};

export const ENDPOINTS: EndpointDef[] = [
  {
    path: "/invoices",
    code: "inv",
    permissions: [
      { id: "invoices:read", label: "Read invoices" },
      { id: "invoices:create", label: "Create invoices" },
      { id: "invoices:void", label: "Void invoices", sensitive: true },
    ],
    itemActions: ["read", "void"],
  },
  {
    path: "/reports",
    code: "rep",
    permissions: [
      { id: "reports:read", label: "Read reports" },
      { id: "reports:export", label: "Export reports", sensitive: true },
    ],
    itemActions: ["read", "export"],
  },
  {
    path: "/customers",
    code: "cus",
    permissions: [
      { id: "customers:read", label: "Read customers" },
      { id: "customers:create", label: "Create customers" },
      { id: "customers:update", label: "Update customers" },
      { id: "customers:delete", label: "Delete customers", sensitive: true },
    ],
    itemActions: ["read", "update", "delete"],
  },
  {
    path: "/payments",
    code: "pay",
    permissions: [
      { id: "payments:read", label: "Read payments" },
      { id: "payments:refund", label: "Refund payments", sensitive: true },
    ],
    itemActions: ["read", "refund"],
  },
  {
    path: "/tenants",
    code: "ten",
    permissions: [
      { id: "tenants:read", label: "Read tenants" },
      { id: "tenants:create", label: "Create sub-tenants", sensitive: true },
    ],
    itemActions: ["read"],
  },
];

export function getEndpoint(path: string) {
  return ENDPOINTS.find((endpoint) => endpoint.path === path);
}

/** "customers" for /customers: the first part of every permission for it. */
export function endpointArea(endpoint: Pick<EndpointDef, "path">) {
  return endpoint.path.slice(1);
}

// ---- Resource-scoped permissions --------------------------------------------
// A permission is <resource>:<action>. The resource is the endpoint's area,
// optionally followed by one item, so it mirrors the URL path:
//
//   customers:read        /customers and everything under it
//   customers.*:read      any single customer (/customers/:id), not the list
//   customers.1234:read   only /customers/1234
//
// A broader permission covers every narrower one below it, never the other
// way round. "*" stands for exactly one whole segment; there are no partial
// wildcards ("cus*"), no wildcard actions and no "everything" permission.

export type ParsedPermission = {
  /** ["customers"] or ["customers", "*"] or ["customers", "1234"]. */
  path: string[];
  action: string;
};

export const ITEM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const PERMISSION_PATTERN = /^([a-z]+)(?:\.(\*|[A-Za-z0-9_-]{1,64}))?:([a-z_]+)$/;

/** The parts of a permission, or null if it isn't one. */
export function parsePermission(permission: string): ParsedPermission | null {
  const match = PERMISSION_PATTERN.exec(permission);
  if (!match) return null;
  const [, area, item, action] = match;
  return { path: item === undefined ? [area] : [area, item], action };
}

/**
 * True if holding `granted` allows everything `requested` does. The granted
 * path must be a whole-segment prefix of the requested one, so
 * "customers.12" never covers "customers.1234".
 */
export function covers(granted: string, requested: string) {
  const g = parsePermission(granted);
  const r = parsePermission(requested);
  if (!g || !r || g.action !== r.action || g.path.length > r.path.length) return false;
  return g.path.every((segment, i) => segment === r.path[i] || (i > 0 && segment === "*"));
}

export type EndpointProblem =
  | { kind: "invalid"; message: string }
  | { kind: "wrong-endpoint"; message: string }
  | { kind: "collection-only"; message: string };

/**
 * Why a permission can't go on a key for this endpoint, or null if it can.
 * Item-level permissions are limited to the endpoint's item actions.
 */
export function endpointBlocker(endpoint: EndpointDef, permission: string): EndpointProblem | null {
  const parsed = parsePermission(permission);
  if (!parsed) return { kind: "invalid", message: "not a valid permission" };
  const [area, item] = parsed.path;
  const collection = `${area}:${parsed.action}`;
  if (area !== endpointArea(endpoint) || !endpoint.permissions.some((p) => p.id === collection)) {
    return { kind: "wrong-endpoint", message: `not available on ${endpoint.path}` };
  }
  if (item !== undefined && !endpoint.itemActions.includes(parsed.action)) {
    return { kind: "collection-only", message: `${parsed.action} only works on the whole collection` };
  }
  return null;
}

/** The endpoint's definition of a permission, whatever its scope. */
export function permissionInfo(endpoint: EndpointDef, permission: string) {
  const parsed = parsePermission(permission);
  if (!parsed) return undefined;
  return endpoint.permissions.find((p) => p.id === `${parsed.path[0]}:${parsed.action}`);
}

/**
 * The resource a request path is for: ["customers", "1234"] for
 * "/customers/1234". Null for anything that isn't a plain, canonical path, so
 * tricks like "..", "%2F", "//" or "/Customers" are refused, not reinterpreted.
 */
export function resourceForPath(urlPath: string): string[] | null {
  if (!urlPath.startsWith("/") || urlPath.includes("%")) return null;
  const segments = urlPath.slice(1).replace(/\/$/, "").split("/");
  if (segments.length > 2) return null;
  if (segments.some((s) => s === "*" || !ITEM_ID_PATTERN.test(s))) return null;
  if (!getEndpoint(`/${segments[0]}`)) return null;
  return segments;
}

/** Whether a key holding `permissions` may take `action` on `urlPath`. */
export function authorize(permissions: string[], action: string, urlPath: string) {
  const resource = resourceForPath(urlPath);
  if (!resource) return false;
  const requested = `${resource.join(".")}:${action}`;
  return permissions.some((p) => covers(p, requested));
}

/** Drops permissions already covered by a broader one in the same list. */
export function withoutRedundant(permissions: string[]) {
  const unique = [...new Set(permissions)];
  return unique.filter((p) => !unique.some((other) => other !== p && covers(other, p)));
}

/**
 * What each tenant's own plan allows. A tenant can never do more than every
 * tenant above it, so what it can actually use is this list narrowed by each
 * ancestor's (see effectivePermissions). Some sub-tenant plans list things
 * their parent doesn't allow, to show that narrowing at work.
 */
export const TENANT_PLANS: Record<string, string[]> = {
  Acme: [
    "invoices:read", "invoices:create", "invoices:void",
    "reports:read", "reports:export",
    "customers:read", "customers:create", "customers:update", "customers:delete",
    "payments:read", "payments:refund",
    "tenants:read", "tenants:create",
  ],
  "Acme / Americas": ["invoices:read", "invoices:create", "payments:read", "payments:refund", "reports:read"],
  "Acme / EMEA": ["reports:read", "reports:export", "customers:read", "customers:create", "customers:update", "invoices:read"],
  "Acme / EMEA / Sales": ["customers:read", "customers:update", "customers:delete", "reports:read", "payments:read"],
  Globex: ["invoices:read", "invoices:create", "invoices:void", "reports:read", "reports:export", "payments:read", "tenants:read", "tenants:create"],
  "Globex / Research": ["tenants:read", "payments:read", "payments:refund", "invoices:read", "reports:read"],
  "Globex / Research / Lab A": ["invoices:read", "invoices:create", "reports:read"],
  Initech: ["customers:read", "customers:create", "customers:update", "reports:read", "reports:export", "payments:read"],
  "Initech / Ops": ["reports:read", "reports:export", "payments:read", "payments:refund"],
  Northwind: ["reports:read", "tenants:read", "tenants:create", "invoices:read", "invoices:create", "payments:read", "payments:refund", "customers:read"],
  "Northwind / Retail": ["invoices:create", "payments:refund", "customers:read", "customers:update"],
  // Can look up one customer at a time, but never list them all.
  "Northwind / Retail / Kiosk": ["customers.*:read", "invoices:create"],
};

export const TENANTS = Object.keys(TENANT_PLANS).sort();

const SEPARATOR = " / ";

/** ["Acme", "Acme / EMEA", "Acme / EMEA / Sales"] for "Acme / EMEA / Sales". */
export function tenantAncestry(tenant: string) {
  const parts = tenant.split(SEPARATOR);
  return parts.map((_, i) => parts.slice(0, i + 1).join(SEPARATOR));
}

/** True for the tenant itself and every tenant below it. */
export function isWithinTenant(tenant: string, root: string) {
  return tenant === root || tenant.startsWith(root + SEPARATOR);
}

/**
 * Why a tenant can't use a permission, or null if it can. A plan entry covers
 * everything narrower than it, so "customers:read" in a plan allows a key
 * with "customers.1234:read". Checks from the top down, so the reason names
 * the highest tenant that blocks it.
 */
export function permissionBlocker(tenant: string, permission: string) {
  for (const level of tenantAncestry(tenant)) {
    if (!(TENANT_PLANS[level] ?? []).some((entry) => covers(entry, permission))) {
      return level === tenant ? `Not in ${tenant}'s plan` : `Not allowed by ${level}`;
    }
  }
  return null;
}

/** Everything a key for this tenant could ever be given. */
export function effectivePermissions(tenant: string) {
  return new Set(
    (TENANT_PLANS[tenant] ?? []).filter((p) => permissionBlocker(tenant, p) === null),
  );
}

export type Scope = "all" | "any" | "ids";

/**
 * Which scopes a tenant's key may have for one action on one endpoint:
 * the whole collection ("customers:read"), any single item
 * ("customers.*:read"), or specific items ("customers.1234:read").
 * "ids" is offered when the tenant may use at least one specific item; the
 * server still checks every id.
 */
export function allowedScopes(
  tenant: string,
  endpoint: EndpointDef,
  action: string,
): Record<Scope, boolean> {
  const area = endpointArea(endpoint);
  const onItems = endpoint.itemActions.includes(action);
  const all = !permissionBlocker(tenant, `${area}:${action}`);
  const any = onItems && !permissionBlocker(tenant, `${area}.*:${action}`);
  const someItem =
    onItems &&
    [...effectivePermissions(tenant)].some((p) => {
      const parsed = parsePermission(p);
      return parsed?.action === action && parsed.path[0] === area && parsed.path.length > 1;
    });
  return { all, any, ids: any || someItem };
}

/** The permission strings for one action at one scope. */
export function scopedPermissions(area: string, action: string, scope: Scope, ids: string[] = []) {
  if (scope === "all") return [`${area}:${action}`];
  if (scope === "any") return [`${area}.*:${action}`];
  return ids.map((id) => `${area}.${id}:${action}`);
}

// ---- Accounts ---------------------------------------------------------------
// Stand-ins for signed-in people, so the rules can be tried from both sides.
// Each tenant has one owner, a key admin for that tenant and everything below
// it (keys:manage + keys:manage:descendants in the white paper).

export type Account =
  | { id: "admin"; name: string; role: "platform-admin" }
  | { id: string; name: string; role: "tenant-owner"; tenant: string };

export const PLATFORM_ADMIN: Account = {
  id: "admin",
  name: "Platform admin",
  role: "platform-admin",
};

export const ACCOUNTS: Account[] = [
  PLATFORM_ADMIN,
  ...TENANTS.map(
    (tenant): Account => ({
      id: tenant.toLowerCase().replaceAll(SEPARATOR, "-").replaceAll(" ", "-"),
      name: `${tenant} owner`,
      role: "tenant-owner",
      tenant,
    }),
  ),
];

export function getAccount(id: string | undefined) {
  return ACCOUNTS.find((account) => account.id === id) ?? PLATFORM_ADMIN;
}

export function canManageTenant(account: Account, tenant: string) {
  return account.role === "platform-admin" || isWithinTenant(tenant, account.tenant);
}

/** The keys an account may see: its own tenant's and every tenant's below. */
export function visibleKeys<T extends { tenant: string }>(account: Account, keys: T[]) {
  return keys.filter((key) => canManageTenant(account, key.tenant));
}

export function manageableTenants(account: Account) {
  return TENANTS.filter((tenant) => canManageTenant(account, tenant));
}

/** Keys expire after 90 days by default and never last more than a year. */
export const EXPIRY_DAYS = [30, 60, 90, 180, 365];
export const DEFAULT_EXPIRY_DAYS = 90;

/** How long the old key keeps working after it is replaced. */
export const REPLACEMENT_OVERLAP_MS = 24 * 60 * 60 * 1000;

export const DAY_MS = 24 * 60 * 60 * 1000;

export function keyPrefix(key: Pick<StoredApiKey, "endpoint" | "publicId">) {
  const code = getEndpoint(key.endpoint)?.code ?? "gen";
  return `mtk_live_${code}_${key.publicId}`;
}

export function deriveStatus(key: StoredApiKey, now: number): ApiKeyStatus {
  if (key.revokedAt) return "revoked";
  if (key.replacedAt) {
    const overlapEnds = new Date(key.replacedAt).getTime() + REPLACEMENT_OVERLAP_MS;
    if (now >= overlapEnds) return "revoked";
  }
  if (now >= new Date(key.expiresAt).getTime()) return "expired";
  return key.replacedAt ? "rotating" : "active";
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

export function formatDate(value: string | number | undefined) {
  return value === undefined ? "—" : dateFormat.format(new Date(value));
}

/**
 * "read and export reports", from ["reports:read", "reports:export"];
 * "read any single customer" from ["customers.*:read"]; "update customer
 * 1234" from ["customers.1234:update"].
 */
export function describePermissions(permissions: string[]) {
  const byTarget = new Map<string, string[]>();
  for (const permission of permissions) {
    const parsed = parsePermission(permission);
    if (!parsed) continue;
    const [area, item] = parsed.path;
    const singular = area.endsWith("s") ? area.slice(0, -1) : area;
    const target =
      item === undefined ? area : item === "*" ? `any single ${singular}` : `${singular} ${item}`;
    byTarget.set(target, [...(byTarget.get(target) ?? []), parsed.action]);
  }
  return [...byTarget]
    .map(([target, actions]) => `${joinWords(actions)} ${target}`)
    .join("; ");
}

function joinWords(words: string[]) {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}
