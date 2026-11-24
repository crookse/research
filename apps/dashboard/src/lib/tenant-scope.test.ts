// Sub-tenants can never reach above themselves: not their parent's keys, not
// their parent's tenants, and never a permission any tenant above them
// lacks. These tests drive the real server actions against a throwaway key
// store (see vitest.config.ts); only Next's request helpers are stubbed.

import { readFile, rm } from "node:fs/promises";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => ({ actingAs: "admin" }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "acting-as" ? { name, value: request.actingAs } : undefined,
    set: () => {},
  }),
}));
vi.mock("next/cache", () => ({
  updateTag: () => {},
  cacheTag: () => {},
  cacheLife: () => {},
}));

import { createApiKey, replaceApiKey, revokeApiKey } from "@/app/dashboard/actions";
import { getApiKeys } from "@/lib/api-key-store";
import {
  ACCOUNTS,
  canManageTenant,
  effectivePermissions,
  ENDPOINTS,
  getAccount,
  getEndpoint,
  keyPrefix,
  permissionBlocker,
  TENANT_PLANS,
  TENANTS,
  visibleKeys,
  type StoredApiKey,
} from "@/lib/api-keys";

const DATA_FILE = process.env.API_KEY_DATA_FILE!;
const ORIGINAL_PLANS = structuredClone(TENANT_PLANS);

// ---- Helpers --------------------------------------------------------------

/**
 * The tenant and everything above it, worked out independently of the code
 * under test (walking up by the last separator rather than down by parts).
 */
function selfAndAncestors(tenant: string) {
  const chain = [tenant];
  let current = tenant;
  for (let i = current.lastIndexOf(" / "); i !== -1; i = current.lastIndexOf(" / ")) {
    current = current.slice(0, i);
    chain.push(current);
  }
  return chain;
}

/**
 * True if some entry in `list` allows `permission`, worked out independently
 * of covers(): "area:action" allows itself and every item below it, and
 * "area.*:action" allows any single item.
 */
function allowedBy(list: Iterable<string>, permission: string) {
  const [resource, action] = permission.split(":");
  const [area, item] = resource.split(".");
  return [...list].some(
    (entry) =>
      entry === permission ||
      entry === `${area}:${action}` ||
      (item !== undefined && entry === `${area}.*:${action}`),
  );
}

function parentOf(tenant: string) {
  return selfAndAncestors(tenant)[1];
}

function ownerOf(tenant: string) {
  const account = ACCOUNTS.find(
    (a) => a.role === "tenant-owner" && a.tenant === tenant,
  );
  if (!account) throw new Error(`No owner account for ${tenant}`);
  return account.id;
}

function endpointFor(permission: string) {
  return ENDPOINTS.find((e) => e.permissions.some((p) => p.id === permission))!.path;
}

async function createAs(
  accountId: string,
  tenant: string,
  permissions: string[],
  endpoint = endpointFor(permissions[0]),
) {
  request.actingAs = accountId;
  const formData = new FormData();
  formData.set("name", "Test key");
  formData.set("tenant", tenant);
  formData.set("endpoint", endpoint);
  for (const permission of permissions) formData.append("permissions", permission);
  formData.set("expiryDays", "90");
  return createApiKey({ status: "idle" }, formData);
}

async function storedKeys(): Promise<StoredApiKey[]> {
  try {
    return JSON.parse(await readFile(DATA_FILE, "utf8"));
  } catch {
    return []; // Nothing written yet: the store is still the seed.
  }
}

/** Removes a permission from one tenant's plan, as a downgrade would. */
function downgrade(tenant: string, permission: string) {
  TENANT_PLANS[tenant] = TENANT_PLANS[tenant].filter((p) => p !== permission);
}

const subTenants = TENANTS.filter((t) => parentOf(t));
const allPermissions = ENDPOINTS.flatMap((e) => e.permissions.map((p) => p.id));

beforeEach(async () => {
  await rm(DATA_FILE, { force: true });
  request.actingAs = "admin";
});

afterEach(() => {
  // Undo any downgrade a test made.
  for (const tenant of Object.keys(TENANT_PLANS)) {
    TENANT_PLANS[tenant] = [...ORIGINAL_PLANS[tenant]];
  }
});

afterAll(async () => {
  await rm(DATA_FILE, { force: true });
});

// ---- What a tenant can use ------------------------------------------------

describe("a tenant's permissions", () => {
  it.each(subTenants)("%s can use nothing its parent can't", (tenant) => {
    const parent = effectivePermissions(parentOf(tenant));
    for (const permission of effectivePermissions(tenant)) {
      expect(allowedBy(parent, permission), `${tenant} has ${permission}`).toBe(true);
    }
  });

  it.each(subTenants)("%s can use nothing any tenant above it can't", (tenant) => {
    const own = effectivePermissions(tenant);
    for (const ancestor of selfAndAncestors(tenant).slice(1)) {
      for (const permission of own) {
        expect(
          allowedBy(TENANT_PLANS[ancestor], permission),
          `${tenant} has ${permission}, which ${ancestor}'s plan lacks`,
        ).toBe(true);
      }
    }
  });

  it.each([
    ["Acme / EMEA / Sales", "customers:delete", "Acme / EMEA"],
    ["Acme / EMEA / Sales", "payments:read", "Acme / EMEA"],
    ["Globex / Research", "payments:refund", "Globex"],
    ["Globex / Research / Lab A", "invoices:create", "Globex / Research"],
    ["Initech / Ops", "payments:refund", "Initech"],
    ["Northwind / Retail", "customers:update", "Northwind"],
  ])(
    "%s can't use %s even though its own plan lists it, because %s doesn't allow it",
    (tenant, permission, blocker) => {
      expect(TENANT_PLANS[tenant]).toContain(permission);
      expect(effectivePermissions(tenant)).not.toContain(permission);
      expect(permissionBlocker(tenant, permission)).toBe(`Not allowed by ${blocker}`);
    },
  );

  it("names the highest tenant that blocks a permission", () => {
    // Sales already loses payments:read at Acme / EMEA; take it from Acme too.
    downgrade("Acme", "payments:read");
    expect(permissionBlocker("Acme / EMEA / Sales", "payments:read")).toBe(
      "Not allowed by Acme",
    );
  });

  it("narrows every tenant below the moment a parent is downgraded", () => {
    expect(effectivePermissions("Acme / EMEA / Sales")).toContain("reports:read");

    downgrade("Acme / EMEA", "reports:read");

    // Nothing about Sales was edited, yet it has lost the permission.
    expect(TENANT_PLANS["Acme / EMEA / Sales"]).toContain("reports:read");
    expect(effectivePermissions("Acme / EMEA")).not.toContain("reports:read");
    expect(effectivePermissions("Acme / EMEA / Sales")).not.toContain("reports:read");
    // The tenant above is unaffected.
    expect(effectivePermissions("Acme")).toContain("reports:read");
  });
});

// ---- Which tenants an owner manages ---------------------------------------

describe("which tenants an owner manages", () => {
  const owners = ACCOUNTS.filter((a) => a.role === "tenant-owner");

  it.each(owners.map((o) => [o.name, o] as const))(
    "%s manages only its own tenant and those below it",
    (_name, owner) => {
      for (const tenant of TENANTS) {
        const below = selfAndAncestors(tenant).includes(owner.tenant);
        expect(canManageTenant(owner, tenant), `${owner.name} → ${tenant}`).toBe(below);
      }
    },
  );

  it("doesn't treat a tenant with a longer name as a sub-tenant", () => {
    const emeaOwner = getAccount(ownerOf("Acme / EMEA"));
    expect(canManageTenant(emeaOwner, "Acme / EMEA North")).toBe(false);
    expect(canManageTenant(emeaOwner, "Acme / EMEA / North")).toBe(true);
  });

  it("shows a sub-tenant owner no keys from its parent, siblings or other tenants", async () => {
    const { keys } = await getApiKeys();
    const salesOwner = getAccount(ownerOf("Acme / EMEA / Sales"));
    const visible = visibleKeys(salesOwner, keys);

    expect(visible.length).toBeGreaterThan(0);
    expect(new Set(visible.map((k) => k.tenant))).toEqual(new Set(["Acme / EMEA / Sales"]));
    // Its parent can see its keys, though.
    const emeaOwner = getAccount(ownerOf("Acme / EMEA"));
    expect(visibleKeys(emeaOwner, keys).map((k) => k.id)).toEqual(
      expect.arrayContaining(visible.map((k) => k.id)),
    );
  });
});

// ---- Creating keys --------------------------------------------------------

describe("creating a key", () => {
  it.each([
    ["Acme / EMEA / Sales", "Acme / EMEA"],
    ["Acme / EMEA / Sales", "Acme"],
    ["Acme / EMEA", "Acme"],
    ["Northwind / Retail / Kiosk", "Northwind / Retail"],
    ["Northwind / Retail / Kiosk", "Northwind"],
    ["Globex / Research / Lab A", "Globex"],
  ])("the %s owner can't create keys for %s above it", async (own, above) => {
    const permission = [...effectivePermissions(above)][0];
    const result = await createAs(ownerOf(own), above, [permission]);

    expect(result).toEqual({
      status: "error",
      errors: { tenant: `${own} owner can't create keys for ${above}.` },
    });
    expect(await storedKeys()).toEqual([]);
  });

  it.each([
    ["Acme / EMEA", "Acme / Americas"],
    ["Acme / EMEA / Sales", "Acme / Americas"],
    ["Initech / Ops", "Globex / Research"],
  ])("the %s owner can't create keys for %s beside it", async (own, other) => {
    const result = await createAs(ownerOf(own), other, [
      [...effectivePermissions(other)][0],
    ]);
    expect(result.status).toBe("error");
    expect(await storedKeys()).toEqual([]);
  });

  it("a sub-tenant owner can't give its own key a permission its parent blocks", async () => {
    const result = await createAs(ownerOf("Acme / EMEA / Sales"), "Acme / EMEA / Sales", [
      "customers:delete",
    ]);
    expect(result).toEqual({
      status: "error",
      errors: { permissions: "customers:delete: Not allowed by Acme / EMEA." },
    });
  });

  it("a parent owner can't give a sub-tenant's key more than the sub-tenant can use", async () => {
    // Acme allows customers:delete, but Acme / EMEA (between them) doesn't.
    const blocked = await createAs(ownerOf("Acme"), "Acme / EMEA / Sales", ["customers:delete"]);
    expect(blocked.status).toBe("error");

    // Acme allows invoices:read, but it's not in Sales's own plan.
    const notInPlan = await createAs(ownerOf("Acme"), "Acme / EMEA / Sales", ["invoices:read"]);
    expect(notInPlan).toEqual({
      status: "error",
      errors: { permissions: "invoices:read: Not in Acme / EMEA / Sales's plan." },
    });
  });

  it("the platform admin is held to the same limits", async () => {
    const result = await createAs("admin", "Acme / EMEA / Sales", ["customers:delete"]);
    expect(result.status).toBe("error");
  });

  it("refuses the whole key if any one permission is out of reach", async () => {
    const result = await createAs(ownerOf("Acme / EMEA / Sales"), "Acme / EMEA / Sales", [
      "customers:read",
      "customers:delete",
    ]);
    expect(result.status).toBe("error");
    expect(await storedKeys()).toEqual([]);
  });

  it("allows what the tenant and every tenant above it allow", async () => {
    const result = await createAs(ownerOf("Acme / EMEA"), "Acme / EMEA / Sales", [
      "customers:read",
      "customers:update",
    ]);
    expect(result.status).toBe("created");

    const created = (await storedKeys()).at(-1)!;
    expect(created).toMatchObject({
      tenant: "Acme / EMEA / Sales",
      endpoint: "/customers",
      permissions: ["customers:read", "customers:update"],
    });
  });

  it("a key created after a parent's downgrade can't have what was taken away", async () => {
    downgrade("Acme / EMEA", "customers:update");
    const result = await createAs(ownerOf("Acme / EMEA / Sales"), "Acme / EMEA / Sales", [
      "customers:update",
    ]);
    expect(result).toEqual({
      status: "error",
      errors: { permissions: "customers:update: Not allowed by Acme / EMEA." },
    });
  });

  it("matches the rules for every account, tenant and permission", async () => {
    let allowed = 0;
    let refused = 0;

    for (const account of ACCOUNTS) {
      for (const tenant of TENANTS) {
        const manages =
          account.role === "platform-admin" ||
          selfAndAncestors(tenant).includes(account.tenant);
        for (const permission of allPermissions) {
          const withinEveryPlan = selfAndAncestors(tenant).every((t) =>
            TENANT_PLANS[t].includes(permission),
          );
          const expected = manages && withinEveryPlan ? "created" : "error";

          const result = await createAs(account.id, tenant, [permission]);
          expect(result.status, `${account.name} → ${tenant}: ${permission}`).toBe(expected);
          if (expected === "created") allowed++;
          else refused++;
        }
      }
    }

    // Make sure both outcomes were really exercised.
    expect(allowed).toBeGreaterThan(50);
    expect(refused).toBeGreaterThan(allowed);
    expect((await storedKeys()).length).toBe(20 + allowed);
  });
});

// ---- Revoking and replacing -----------------------------------------------

describe("revoking and replacing keys", () => {
  // From the seed data.
  const ACME_KEY = "key_01"; // Acme
  const EMEA_KEY = "key_02"; // Acme / EMEA
  const SALES_KEY = "key_03"; // Acme / EMEA / Sales, customers:read + update

  it.each([
    ["Acme / EMEA / Sales", EMEA_KEY],
    ["Acme / EMEA / Sales", ACME_KEY],
    ["Acme / EMEA", ACME_KEY],
    ["Acme / Americas", EMEA_KEY],
  ])("the %s owner can't revoke %s, which belongs above or beside it", async (own, keyId) => {
    request.actingAs = ownerOf(own);
    // The same answer as for a key that doesn't exist, so nothing leaks.
    expect(await revokeApiKey(keyId)).toEqual({ ok: false, error: "That key doesn't exist." });
    expect(await revokeApiKey("no-such-key")).toEqual({
      ok: false,
      error: "That key doesn't exist.",
    });
    expect(await storedKeys()).toEqual([]);
  });

  it("the Sales owner can't replace its parent's key", async () => {
    request.actingAs = ownerOf("Acme / EMEA / Sales");
    expect(await replaceApiKey(EMEA_KEY)).toEqual({
      ok: false,
      error: "That key doesn't exist.",
    });
    expect(await storedKeys()).toEqual([]);
  });

  it("a parent owner can revoke a sub-tenant's key", async () => {
    request.actingAs = ownerOf("Acme / EMEA");
    expect(await revokeApiKey(SALES_KEY)).toMatchObject({ ok: true });
    const key = (await storedKeys()).find((k) => k.id === SALES_KEY)!;
    expect(key.revokedAt).toBeDefined();
  });

  it("can't replace a key once a parent's downgrade puts it out of reach", async () => {
    downgrade("Acme / EMEA", "customers:update");
    request.actingAs = ownerOf("Acme / EMEA / Sales");

    const result = await replaceApiKey(SALES_KEY);
    expect(result).toEqual({
      ok: false,
      error:
        "Acme / EMEA / Sales can no longer use customers:update (Not allowed by Acme / EMEA). Create a new key instead.",
    });
    expect(await storedKeys()).toEqual([]);
  });

  it("a replacement has exactly the original's permissions", async () => {
    request.actingAs = ownerOf("Acme / EMEA / Sales");
    expect(await replaceApiKey(SALES_KEY)).toMatchObject({ ok: true });

    const keys = await storedKeys();
    const replacement = keys.find((k) => k.rotatedFromId === SALES_KEY)!;
    expect(replacement.tenant).toBe("Acme / EMEA / Sales");
    expect(replacement.endpoint).toBe("/customers");
    expect(replacement.permissions).toEqual(["customers:read", "customers:update"]);
  });
});

// ---- One endpoint per key -------------------------------------------------

describe("a key's endpoint", () => {
  it("refuses a permission that belongs to another endpoint", async () => {
    // Acme is allowed invoices:read, but not through a /reports key.
    const result = await createAs(ownerOf("Acme"), "Acme", ["invoices:read"], "/reports");
    expect(result).toEqual({
      status: "error",
      errors: { permissions: "Those permissions aren't available on /reports." },
    });
    expect(await storedKeys()).toEqual([]);
  });

  it("refuses a key that mixes permissions from two endpoints", async () => {
    const result = await createAs(
      ownerOf("Acme"),
      "Acme",
      ["customers:read", "invoices:read"],
      "/customers",
    );
    expect(result).toEqual({
      status: "error",
      errors: { permissions: "Those permissions aren't available on /customers." },
    });
    expect(await storedKeys()).toEqual([]);
  });

  it.each(["/billing", "", "/customers/../invoices", "/Customers"])(
    "refuses the endpoint %j, which isn't on the list",
    async (endpoint) => {
      const result = await createAs(ownerOf("Acme"), "Acme", ["customers:read"], endpoint);
      expect(result.status).toBe("error");
      if (result.status === "error") {
        expect(result.errors.endpoint).toBe("Choose an endpoint.");
      }
      expect(await storedKeys()).toEqual([]);
    },
  );

  it("only accepts a permission on the endpoint it belongs to", async () => {
    // Acme's plan allows everything, so the endpoint is the only thing deciding.
    let created = 0;
    for (const endpoint of ENDPOINTS) {
      for (const permission of allPermissions) {
        const belongs = endpoint.permissions.some((p) => p.id === permission);
        const result = await createAs(ownerOf("Acme"), "Acme", [permission], endpoint.path);
        expect(result.status, `${permission} on ${endpoint.path}`).toBe(
          belongs ? "created" : "error",
        );
        if (belongs) created++;
      }
    }
    expect(created).toBe(allPermissions.length);

    // Every stored key is tied to one endpoint, and only holds that endpoint's permissions.
    const keys = (await storedKeys()).slice(20);
    expect(keys).toHaveLength(created);
    for (const key of keys) {
      const allowed = getEndpoint(key.endpoint)!.permissions.map((p) => p.id);
      expect(allowed).toEqual(expect.arrayContaining(key.permissions));
    }
  });

  it("a tenant can create a key for its own tenant, tied to one endpoint", async () => {
    const result = await createAs(ownerOf("Acme"), "Acme", ["invoices:void"], "/invoices");
    expect(result.status).toBe("created");
    if (result.status !== "created") return;

    const key = (await storedKeys()).at(-1)!;
    expect(key).toMatchObject({
      tenant: "Acme",
      endpoint: "/invoices",
      permissions: ["invoices:void"],
    });
    expect(key.secretHash).toMatch(/^[0-9a-f]{64}$/);
    // The key names its endpoint and its own public id, and the secret isn't stored.
    expect(result.fullKey.startsWith(`${keyPrefix(key)}_`)).toBe(true);
    expect(keyPrefix(key)).toBe(`mtk_live_inv_${key.publicId}`);
    expect(JSON.stringify(key)).not.toContain(result.fullKey);
  });

  it("refuses create on a single item", async () => {
    const result = await createAs(ownerOf("Acme"), "Acme", ["customers.42:create"], "/customers");
    expect(result).toEqual({
      status: "error",
      errors: { permissions: "customers.42:create: create only works on the whole collection." },
    });
    expect(await storedKeys()).toEqual([]);
  });

  it("refuses an item permission for another endpoint", async () => {
    const result = await createAs(ownerOf("Acme"), "Acme", ["invoices.1:read"], "/customers");
    expect(result).toEqual({
      status: "error",
      errors: { permissions: "Those permissions aren't available on /customers." },
    });
  });

  it.each(["customers.1.2:read", "customers.*1:read", "*:read"])(
    "refuses the malformed permission %j",
    async (permission) => {
      const result = await createAs(ownerOf("Acme"), "Acme", [permission], "/customers");
      expect(result).toEqual({
        status: "error",
        errors: { permissions: `${permission} isn't a valid permission.` },
      });
    },
  );

  it("a sub-tenant's key stays on its endpoint, even for a permission the tenant has elsewhere", async () => {
    // Sales may use reports:read, but not through a /customers key.
    expect(effectivePermissions("Acme / EMEA / Sales")).toContain("reports:read");
    const result = await createAs(
      ownerOf("Acme / EMEA / Sales"),
      "Acme / EMEA / Sales",
      ["customers:read", "reports:read"],
      "/customers",
    );
    expect(result.status).toBe("error");
    expect(await storedKeys()).toEqual([]);
  });
});

// ---- Single items -----------------------------------------------------------

describe("keys for single items", () => {
  const KIOSK = "Northwind / Retail / Kiosk";

  it("the Kiosk can have a key for any single customer, or for specific ones", async () => {
    const any = await createAs(ownerOf(KIOSK), KIOSK, ["customers.*:read"], "/customers");
    expect(any.status).toBe("created");
    const some = await createAs(
      ownerOf(KIOSK),
      KIOSK,
      ["customers.42:read", "customers.77:read"],
      "/customers",
    );
    expect(some.status).toBe("created");

    const keys = (await storedKeys()).slice(20);
    expect(keys.map((k) => k.permissions)).toEqual([
      ["customers.*:read"],
      ["customers.42:read", "customers.77:read"],
    ]);
  });

  it("the Kiosk can't list every customer, because its plan only has single ones", async () => {
    const result = await createAs(ownerOf(KIOSK), KIOSK, ["customers:read"], "/customers");
    expect(result).toEqual({
      status: "error",
      errors: { permissions: `customers:read: Not in ${KIOSK}'s plan.` },
    });
  });

  it("a parent's downgrade takes single-item access away below it too", async () => {
    downgrade("Northwind", "customers:read");
    for (const tenant of ["Northwind / Retail", KIOSK]) {
      const result = await createAs(ownerOf(tenant), tenant, ["customers.42:read"], "/customers");
      expect(result).toEqual({
        status: "error",
        errors: { permissions: "customers.42:read: Not allowed by Northwind." },
      });
    }
  });

  it("a narrow permission is allowed when the plan only lists the broad one", async () => {
    // Sales' plan says customers:update; one customer is narrower than that.
    const result = await createAs(
      ownerOf("Acme / EMEA / Sales"),
      "Acme / EMEA / Sales",
      ["customers.1234:update"],
      "/customers",
    );
    expect(result.status).toBe("created");
  });

  it("stores no permission a broader one on the same key already covers", async () => {
    const result = await createAs(
      ownerOf("Acme"),
      "Acme",
      ["customers.42:read", "customers:read", "customers.*:update"],
      "/customers",
    );
    expect(result.status).toBe("created");
    expect((await storedKeys()).at(-1)!.permissions).toEqual([
      "customers:read",
      "customers.*:update",
    ]);
  });

  it("replacing a single-item key keeps its scope", async () => {
    request.actingAs = ownerOf(KIOSK);
    expect(await replaceApiKey("key_11")).toMatchObject({ ok: true });
    const replacement = (await storedKeys()).find((k) => k.rotatedFromId === "key_11")!;
    expect(replacement.permissions).toEqual(["customers.*:read"]);
  });
});
