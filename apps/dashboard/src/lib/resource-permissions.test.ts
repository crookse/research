// Resource-scoped permissions: "customers:read" for the collection and
// everything under it, "customers.*:read" for any single customer,
// "customers.1234:read" for one. Pure rules only; the server actions are
// covered in tenant-scope.test.ts.

import { describe, expect, it } from "vitest";

import {
  allowedScopes,
  authorize,
  covers,
  describePermissions,
  endpointBlocker,
  getEndpoint,
  parsePermission,
  resourceForPath,
  withoutRedundant,
} from "@/lib/api-keys";

const customers = getEndpoint("/customers")!;

describe("parsing a permission", () => {
  it.each([
    ["customers:read", ["customers"], "read"],
    ["customers.*:read", ["customers", "*"], "read"],
    ["customers.c_1234:read", ["customers", "c_1234"], "read"],
    ["customers.A-9:update", ["customers", "A-9"], "update"],
  ])("reads %s", (permission, path, action) => {
    expect(parsePermission(permission)).toEqual({ path, action });
  });

  it.each([
    "",
    "customers",
    "*:read",
    "*:*",
    "customers:*",
    "cus*:read",
    "customers.12*:read",
    "customers.1.2:read",
    "customers..1:read",
    "customers.:read",
    "Customers:read",
    "customers.1234:read:extra",
    "customers/1234:read",
    `customers.${"x".repeat(65)}:read`,
  ])("refuses %j", (permission) => {
    expect(parsePermission(permission)).toBeNull();
  });
});

describe("one permission covering another", () => {
  it.each([
    ["customers:read", "customers:read"],
    ["customers:read", "customers.*:read"],
    ["customers:read", "customers.1234:read"],
    ["customers.*:read", "customers.*:read"],
    ["customers.*:read", "customers.1234:read"],
    ["customers.1234:read", "customers.1234:read"],
  ])("%s covers %s", (granted, requested) => {
    expect(covers(granted, requested)).toBe(true);
  });

  it.each([
    // Narrow never covers broad.
    ["customers.*:read", "customers:read"],
    ["customers.1234:read", "customers:read"],
    ["customers.1234:read", "customers.*:read"],
    // Whole segments only.
    ["customers.12:read", "customers.1234:read"],
    ["customers.1234:read", "customers.12:read"],
    // Different actions or areas.
    ["customers:read", "customers:update"],
    ["customers.*:read", "customers.1234:delete"],
    ["customer:read", "customers:read"],
    ["customers:read", "invoices.1:read"],
    // Anything that doesn't parse covers nothing.
    ["*:read", "customers:read"],
    ["customers:*", "customers:read"],
  ])("%s does not cover %s", (granted, requested) => {
    expect(covers(granted, requested)).toBe(false);
  });
});

describe("what a key for an endpoint can hold", () => {
  it.each(["customers:read", "customers.*:read", "customers.42:update", "customers.*:delete", "customers:create"])(
    "%s is fine on /customers",
    (permission) => {
      expect(endpointBlocker(customers, permission)).toBeNull();
    },
  );

  it("refuses create on a single item, since a new item has no id yet", () => {
    expect(endpointBlocker(customers, "customers.42:create")).toEqual({
      kind: "collection-only",
      message: "create only works on the whole collection",
    });
    expect(endpointBlocker(customers, "customers.*:create")?.kind).toBe("collection-only");
  });

  it.each(["invoices.1:read", "invoices:read", "customers:void", "customers.1:void"])(
    "refuses %s, which isn't on /customers",
    (permission) => {
      expect(endpointBlocker(customers, permission)?.kind).toBe("wrong-endpoint");
    },
  );

  it("refuses a permission that doesn't parse", () => {
    expect(endpointBlocker(customers, "customers.1.2:read")?.kind).toBe("invalid");
  });
});

describe("matching a request to a key", () => {
  it("a key for any single customer can read /customers/1234 but not list /customers", () => {
    const key = ["customers.*:read"];
    expect(authorize(key, "read", "/customers/1234")).toBe(true);
    expect(authorize(key, "read", "/customers/c_9")).toBe(true);
    expect(authorize(key, "read", "/customers")).toBe(false);
    expect(authorize(key, "update", "/customers/1234")).toBe(false);
  });

  it("a key for one customer reaches that customer only", () => {
    const key = ["customers.1234:read"];
    expect(authorize(key, "read", "/customers/1234")).toBe(true);
    expect(authorize(key, "read", "/customers/12345")).toBe(false);
    expect(authorize(key, "read", "/customers/123")).toBe(false);
    expect(authorize(key, "read", "/customers")).toBe(false);
  });

  it("a collection key reaches the list and every item", () => {
    const key = ["customers:read"];
    expect(authorize(key, "read", "/customers")).toBe(true);
    expect(authorize(key, "read", "/customers/")).toBe(true);
    expect(authorize(key, "read", "/customers/1234")).toBe(true);
  });

  it.each([
    "/customers/1234/../",
    "/customers/..",
    "/customers%2F1234",
    "/customers/%31234",
    "//customers/1234",
    "/customers//1234",
    "/Customers/1234",
    "/customers/*",
    "/customers/1234/notes",
    "customers/1234",
    "/invoices/1234",
    "/billing/1234",
  ])("refuses %j, even for a collection key", (path) => {
    expect(authorize(["customers:read"], "read", path)).toBe(false);
  });

  it("maps paths to resources without reinterpreting them", () => {
    expect(resourceForPath("/customers/1234")).toEqual(["customers", "1234"]);
    expect(resourceForPath("/customers")).toEqual(["customers"]);
    expect(resourceForPath("/customers/../invoices")).toBeNull();
  });
});

describe("a tenant's choice of scope", () => {
  it("the Kiosk can look up single customers, but never list them", () => {
    expect(allowedScopes("Northwind / Retail / Kiosk", customers, "read")).toEqual({
      all: false,
      any: true,
      ids: true,
    });
  });

  it("a tenant with the collection permission can choose any scope", () => {
    expect(allowedScopes("Northwind / Retail", customers, "read")).toEqual({
      all: true,
      any: true,
      ids: true,
    });
  });

  it("create is only offered for the whole collection", () => {
    expect(allowedScopes("Acme", customers, "create")).toEqual({
      all: true,
      any: false,
      ids: false,
    });
  });
});

describe("tidying and describing permissions", () => {
  it("drops what a broader permission on the same key already covers", () => {
    expect(
      withoutRedundant([
        "customers.42:read",
        "customers:read",
        "customers.*:update",
        "customers.7:update",
        "customers.7:delete",
        "customers:read",
      ]),
    ).toEqual(["customers:read", "customers.*:update", "customers.7:delete"]);
  });

  it("describes each scope in words", () => {
    expect(describePermissions(["customers:read", "customers:update"])).toBe(
      "read and update customers",
    );
    expect(describePermissions(["customers.*:read"])).toBe("read any single customer");
    expect(describePermissions(["customers.1234:read", "customers.1234:update"])).toBe(
      "read and update customer 1234",
    );
  });
});
