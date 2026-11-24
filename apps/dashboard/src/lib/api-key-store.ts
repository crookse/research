// Server-only key storage: a JSON file under data/ so changes survive
// restarts in local development. Swap for a real database when one exists.
// Never import this from a client component.

import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { cacheLife, cacheTag } from "next/cache";

import {
  deriveStatus,
  getEndpoint,
  keyPrefix,
  type ApiKey,
  type StoredApiKey,
} from "./api-keys";

export const API_KEYS_TAG = "api-keys";

// Overridable so tests can use a throwaway file.
const DATA_FILE =
  process.env.API_KEY_DATA_FILE ?? path.join(process.cwd(), "data", "api-keys.json");

const SEED: StoredApiKey[] = [
  { id: "key_01", publicId: "7K3QX9PDM2RA", name: "Billing sync", tenant: "Acme", endpoint: "/invoices", permissions: ["invoices:read", "invoices:create"], createdAt: "2026-02-04T00:00:00Z", lastUsedAt: "2026-11-16T00:00:00Z", expiresAt: "2027-02-04T00:00:00Z" },
  { id: "key_02", publicId: "C3D4R8WQ1ZTN", name: "Monthly report export", tenant: "Acme / EMEA", endpoint: "/reports", permissions: ["reports:read", "reports:export"], createdAt: "2026-03-12T00:00:00Z", lastUsedAt: "2026-11-01T00:00:00Z", expiresAt: "2026-12-01T00:00:00Z" },
  { id: "key_03", publicId: "E5F6H2KM9VBX", name: "CRM import", tenant: "Acme / EMEA / Sales", endpoint: "/customers", permissions: ["customers:read", "customers:update"], createdAt: "2026-05-20T00:00:00Z", lastUsedAt: "2026-11-15T00:00:00Z", expiresAt: "2027-05-20T00:00:00Z" },
  { id: "key_04", publicId: "G7H8J4NP2QWE", name: "Legacy invoice reader", tenant: "Acme / EMEA / Sales", endpoint: "/invoices", permissions: ["invoices:read"], createdAt: "2025-09-01T00:00:00Z", lastUsedAt: "2026-08-30T00:00:00Z", expiresAt: "2026-09-01T00:00:00Z" },
  { id: "key_05", publicId: "I9J0K5RT3YUA", name: "Payout webhook", tenant: "Acme / Americas", endpoint: "/payments", permissions: ["payments:read", "payments:refund"], createdAt: "2026-06-11T00:00:00Z", lastUsedAt: "2026-11-17T00:00:00Z", expiresAt: "2026-12-10T00:00:00Z" },
  { id: "key_06", publicId: "K1L2M6SV4ZXC", name: "Leaked CI token", tenant: "Acme / Americas", endpoint: "/reports", permissions: ["reports:read"], createdAt: "2026-04-02T00:00:00Z", lastUsedAt: "2026-07-19T00:00:00Z", expiresAt: "2027-04-02T00:00:00Z", revokedAt: "2026-07-20T00:00:00Z" },
  { id: "key_07", publicId: "M3N4P7TW5ADF", name: "Analytics dashboard", tenant: "Northwind", endpoint: "/reports", permissions: ["reports:read"], createdAt: "2026-07-08T00:00:00Z", lastUsedAt: "2026-11-14T00:00:00Z", expiresAt: "2027-07-08T00:00:00Z" },
  { id: "key_08", publicId: "O5P6Q8UX6BGH", name: "Reseller provisioning", tenant: "Northwind", endpoint: "/tenants", permissions: ["tenants:read", "tenants:create"], createdAt: "2026-01-15T00:00:00Z", lastUsedAt: "2026-11-10T00:00:00Z", expiresAt: "2027-01-15T00:00:00Z" },
  { id: "key_09", publicId: "Q7R8S9VY7CJK", name: "Store front orders", tenant: "Northwind / Retail", endpoint: "/invoices", permissions: ["invoices:create"], createdAt: "2026-08-22T00:00:00Z", expiresAt: "2027-08-22T00:00:00Z" },
  { id: "key_10", publicId: "S9T0U1WZ8DLM", name: "Refund bot", tenant: "Northwind / Retail", endpoint: "/payments", permissions: ["payments:refund"], createdAt: "2026-09-03T00:00:00Z", lastUsedAt: "2026-11-12T00:00:00Z", expiresAt: "2026-11-30T00:00:00Z" },
  { id: "key_11", publicId: "U1V2W3XA9ENP", name: "Customer lookup", tenant: "Northwind / Retail / Kiosk", endpoint: "/customers", permissions: ["customers.*:read"], createdAt: "2026-10-01T00:00:00Z", lastUsedAt: "2026-11-16T00:00:00Z", expiresAt: "2027-10-01T00:00:00Z" },
  { id: "key_12", publicId: "W3X4Y5ZB1FQR", name: "Old kiosk key", tenant: "Northwind / Retail / Kiosk", endpoint: "/customers", permissions: ["customers.*:read"], createdAt: "2025-11-01T00:00:00Z", lastUsedAt: "2026-09-30T00:00:00Z", expiresAt: "2026-11-01T00:00:00Z", revokedAt: "2026-10-01T00:00:00Z" },
  { id: "key_13", publicId: "Y5Z6A7BC2GST", name: "Quarterly audit", tenant: "Globex", endpoint: "/reports", permissions: ["reports:read", "reports:export"], createdAt: "2026-10-14T00:00:00Z", expiresAt: "2027-01-14T00:00:00Z" },
  { id: "key_14", publicId: "B7C8D9DE3HUV", name: "ERP connector", tenant: "Globex", endpoint: "/invoices", permissions: ["invoices:read", "invoices:create", "invoices:void"], createdAt: "2026-02-28T00:00:00Z", lastUsedAt: "2026-11-17T00:00:00Z", expiresAt: "2027-02-28T00:00:00Z" },
  { id: "key_15", publicId: "D9E0F1EF4JWX", name: "Division onboarding", tenant: "Globex / Research", endpoint: "/tenants", permissions: ["tenants:read"], createdAt: "2026-06-30T00:00:00Z", lastUsedAt: "2026-10-02T00:00:00Z", expiresAt: "2026-12-15T00:00:00Z" },
  { id: "key_16", publicId: "F1G2H3FG5KYZ", name: "Grant payments", tenant: "Globex / Research", endpoint: "/payments", permissions: ["payments:read"], createdAt: "2025-10-10T00:00:00Z", lastUsedAt: "2026-10-09T00:00:00Z", expiresAt: "2026-10-10T00:00:00Z" },
  { id: "key_17", publicId: "H3I4J5GH6LZA", name: "Lab invoices", tenant: "Globex / Research / Lab A", endpoint: "/invoices", permissions: ["invoices:read"], createdAt: "2026-09-19T00:00:00Z", expiresAt: "2027-09-19T00:00:00Z" },
  { id: "key_18", publicId: "J5K6L7HJ7MAB", name: "Partner portal", tenant: "Initech", endpoint: "/customers", permissions: ["customers:read", "customers:create"], createdAt: "2026-03-03T00:00:00Z", lastUsedAt: "2026-11-11T00:00:00Z", expiresAt: "2027-03-03T00:00:00Z" },
  { id: "key_19", publicId: "L7M8N9JK8NBC", name: "TPS report export", tenant: "Initech / Ops", endpoint: "/reports", permissions: ["reports:export"], createdAt: "2026-05-05T00:00:00Z", lastUsedAt: "2026-11-03T00:00:00Z", expiresAt: "2026-12-05T00:00:00Z" },
  { id: "key_20", publicId: "N9O0P1KL9PCD", name: "Contractor access", tenant: "Initech / Ops", endpoint: "/payments", permissions: ["payments:read"], createdAt: "2026-01-20T00:00:00Z", lastUsedAt: "2026-02-14T00:00:00Z", expiresAt: "2027-01-20T00:00:00Z", revokedAt: "2026-02-15T00:00:00Z" },
];

async function readAll(): Promise<StoredApiKey[]> {
  try {
    // The path can come from the environment; tell the bundler not to trace it.
    return JSON.parse(
      await readFile(/*turbopackIgnore: true*/ DATA_FILE, "utf8"),
    ) as StoredApiKey[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(SEED);
    throw error;
  }
}

async function writeAll(keys: StoredApiKey[]) {
  await mkdir(/*turbopackIgnore: true*/ path.dirname(DATA_FILE), { recursive: true });
  // Write then rename, so a crash never leaves a half-written file.
  const tmp = `${DATA_FILE}.${process.pid}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify(keys, null, 2));
  await rename(/*turbopackIgnore: true*/ tmp, DATA_FILE);
}

// One write at a time, so two actions can't overwrite each other's changes.
let queue: Promise<unknown> = Promise.resolve();

export function mutate<T>(change: (keys: StoredApiKey[]) => T | Promise<T>) {
  const run = queue.then(async () => {
    const keys = await readAll();
    const result = await change(keys);
    await writeAll(keys);
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

/** All keys with their current status, newest view as of the cache entry. */
export async function getApiKeys(): Promise<{ keys: ApiKey[]; asOf: number }> {
  "use cache";
  cacheTag(API_KEYS_TAG);
  // Statuses depend on the time (expiry, replacement overlap), so don't
  // hold a view for long even when nothing changes.
  cacheLife("minutes");

  const asOf = Date.now();
  const keys = (await readAll()).map((stored): ApiKey => {
    // Never let the fingerprint reach the page.
    const key: Partial<StoredApiKey> = { ...stored };
    delete key.secretHash;
    return {
      ...(key as Omit<StoredApiKey, "secretHash">),
      status: deriveStatus(stored, asOf),
      prefix: keyPrefix(stored),
    };
  });
  return { keys, asOf };
}

// ---- Issuing keys ---------------------------------------------------------

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const PUBLIC_ID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // no I, L, O, U

function randomString(alphabet: string, length: number) {
  // Rejection sampling keeps every character equally likely.
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < limit && out.length < length) out += alphabet[byte % alphabet.length];
    }
  }
  return out;
}

function pepper() {
  const value = process.env.API_KEY_PEPPER;
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error("API_KEY_PEPPER must be set in production");
  }
  return "dev-only-pepper-do-not-use-in-production";
}

export function hashSecret(secret: string) {
  return createHmac("sha256", pepper()).update(secret).digest("hex");
}

/**
 * Makes a new key: mtk_live_<code>_<public id>_<secret>_<check digits>.
 * Returns the full key (to show once) and the parts to store.
 */
export function issueKey(endpoint: string) {
  const code = getEndpoint(endpoint)?.code ?? "gen";
  const publicId = randomString(PUBLIC_ID_ALPHABET, 12);
  // 43 base62 characters carry just over 256 bits.
  const secret = randomString(BASE62, 43);
  const body = `mtk_live_${code}_${publicId}_${secret}`;
  const check = createHash("sha256").update(body).digest("hex").slice(0, 6);
  return {
    id: randomUUID(),
    publicId,
    fullKey: `${body}_${check}`,
    secretHash: hashSecret(secret),
  };
}
