"use server";

// Server actions can be called by anyone who can POST to this app, so every
// one re-checks the rules here; the UI only hides what isn't allowed. Who is
// calling comes from getCurrentAccount, a cookie stand-in for real sign-in.

import { updateTag } from "next/cache";
import { cookies } from "next/headers";

import { API_KEYS_TAG, issueKey, mutate } from "@/lib/api-key-store";
import {
  ACCOUNTS,
  canManageTenant,
  DAY_MS,
  deriveStatus,
  endpointBlocker,
  EXPIRY_DAYS,
  getEndpoint,
  permissionBlocker,
  TENANTS,
  type Account,
  type StoredApiKey,
  withoutRedundant,
} from "@/lib/api-keys";
import { ACTING_AS_COOKIE, getCurrentAccount } from "@/lib/session";

/** Switches who the dashboard acts as. */
export async function setActingAs(accountId: string) {
  if (!ACCOUNTS.some((account) => account.id === accountId)) return;
  (await cookies()).set(ACTING_AS_COOKIE, accountId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
  });
}

export type CreateKeyField = "name" | "tenant" | "endpoint" | "permissions" | "expiryDays";

export type CreateKeyState =
  | { status: "idle" }
  | { status: "error"; errors: Partial<Record<CreateKeyField, string>>; message?: string }
  | { status: "created"; name: string; fullKey: string };

export async function createApiKey(
  _previous: CreateKeyState,
  formData: FormData,
): Promise<CreateKeyState> {
  const name = String(formData.get("name") ?? "").trim();
  const tenant = String(formData.get("tenant") ?? "");
  const endpointPath = String(formData.get("endpoint") ?? "");
  const permissions = formData.getAll("permissions").map(String);
  const expiryDays = Number(formData.get("expiryDays"));

  const account = await getCurrentAccount();
  const errors: Partial<Record<CreateKeyField, string>> = {};
  const endpoint = getEndpoint(endpointPath);

  if (!name) errors.name = "Give the key a name.";
  else if (name.length > 80) errors.name = "Keep the name under 80 characters.";
  if (!TENANTS.includes(tenant)) errors.tenant = "Choose a tenant.";
  else if (!canManageTenant(account, tenant)) {
    errors.tenant = `${account.name} can't create keys for ${tenant}.`;
  }
  if (!endpoint) errors.endpoint = "Choose an endpoint.";
  if (permissions.length === 0) {
    errors.permissions = "Choose at least one permission.";
  } else if (permissions.length > 50) {
    errors.permissions = "That's too many permissions for one key.";
  } else if (endpoint && permissions.some((id) => endpointBlocker(endpoint, id))) {
    // Each permission must parse, belong to this endpoint, and only be scoped
    // to single items for actions that make sense on one item.
    const blocked = permissions.flatMap((id) => {
      const problem = endpointBlocker(endpoint, id);
      return problem ? [{ id, problem }] : [];
    });
    const first =
      blocked.find((p) => p.problem.kind === "invalid") ??
      blocked.find((p) => p.problem.kind === "wrong-endpoint") ??
      blocked[0];
    errors.permissions =
      first.problem.kind === "wrong-endpoint"
        ? `Those permissions aren't available on ${endpoint.path}.`
        : first.problem.kind === "invalid"
          ? `${first.id} isn't a valid permission.`
          : `${first.id}: ${first.problem.message}.`;
  } else if (!errors.tenant) {
    // A key can never do more than its tenant, or any tenant above it.
    const blocked = permissions
      .map((id) => ({ id, reason: permissionBlocker(tenant, id) }))
      .find((p) => p.reason);
    if (blocked) errors.permissions = `${blocked.id}: ${blocked.reason}.`;
  }
  if (!EXPIRY_DAYS.includes(expiryDays)) errors.expiryDays = "Choose an expiry.";

  if (Object.keys(errors).length > 0 || !endpoint) {
    return { status: "error", errors };
  }

  const now = Date.now();
  const issued = issueKey(endpoint.path);
  await mutate((keys) => {
    keys.push({
      id: issued.id,
      publicId: issued.publicId,
      name,
      tenant,
      endpoint: endpoint.path,
      // "customers.42:read" adds nothing next to "customers:read".
      permissions: withoutRedundant(permissions),
      secretHash: issued.secretHash,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + expiryDays * DAY_MS).toISOString(),
    });
  });

  updateTag(API_KEYS_TAG);
  return { status: "created", name, fullKey: issued.fullKey };
}

export type KeyActionResult =
  | { ok: true; name: string; fullKey?: string }
  | { ok: false; error: string };

class ActionError extends Error {}

function findManageable(
  keys: StoredApiKey[],
  id: string,
  account: Account,
  now: number,
) {
  const key = keys.find((k) => k.id === id);
  // Same answer whether it doesn't exist or isn't yours: don't reveal keys
  // outside the account's tenants.
  if (!key || !canManageTenant(account, key.tenant)) {
    throw new ActionError("That key doesn't exist.");
  }
  return { key, status: deriveStatus(key, now) };
}

async function run(
  change: (keys: StoredApiKey[], account: Account, now: number) => KeyActionResult,
): Promise<KeyActionResult> {
  try {
    const account = await getCurrentAccount();
    const result = await mutate((keys) => change(keys, account, Date.now()));
    updateTag(API_KEYS_TAG);
    return result;
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Turns a key off straight away. Keys are never deleted, for the audit trail. */
export async function revokeApiKey(id: string): Promise<KeyActionResult> {
  return run((keys, account, now) => {
    const { key, status } = findManageable(keys, id, account, now);
    if (status !== "active" && status !== "rotating") {
      throw new ActionError(`"${key.name}" is already ${status}.`);
    }
    key.revokedAt = new Date(now).toISOString();
    return { ok: true, name: key.name };
  });
}

/**
 * Issues a new key with exactly the same settings. The old key keeps
 * working for a 24-hour overlap, then stops on its own.
 */
export async function replaceApiKey(id: string): Promise<KeyActionResult> {
  return run((keys, account, now) => {
    const { key, status } = findManageable(keys, id, account, now);
    if (status !== "active") {
      throw new ActionError(
        status === "rotating"
          ? `"${key.name}" has already been replaced.`
          : `"${key.name}" is ${status} and can't be replaced.`,
      );
    }
    // A replacement has exactly the same settings, so if the tenant has since
    // lost a permission the key has, it can't be replaced as is.
    const lost = key.permissions.find((p) => permissionBlocker(key.tenant, p));
    if (lost) {
      throw new ActionError(
        `${key.tenant} can no longer use ${lost} (${permissionBlocker(key.tenant, lost)}). Create a new key instead.`,
      );
    }

    const issued = issueKey(key.endpoint);
    // Same lifetime as the original, counted from today.
    const lifetime = new Date(key.expiresAt).getTime() - new Date(key.createdAt).getTime();
    keys.push({
      id: issued.id,
      publicId: issued.publicId,
      name: key.name,
      tenant: key.tenant,
      endpoint: key.endpoint,
      permissions: [...key.permissions],
      secretHash: issued.secretHash,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + Math.min(lifetime, 365 * DAY_MS)).toISOString(),
      rotatedFromId: key.id,
    });
    key.replacedAt = new Date(now).toISOString();
    key.replacedById = issued.id;

    return { ok: true, name: key.name, fullKey: issued.fullKey };
  });
}
