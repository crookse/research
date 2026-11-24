import type { Metadata } from "next";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { getApiKeys } from "@/lib/api-key-store";
import {
  DAY_MS,
  endpointBlocker,
  ENDPOINTS,
  manageableTenants,
  permissionBlocker,
  TENANT_PLANS,
  visibleKeys,
  type Account,
} from "@/lib/api-keys";
import { getCurrentAccount } from "@/lib/session";
import { ApiKeysTable } from "./api-keys-table";
import { CreateKeyButton } from "./create-key-dialog";

export const metadata: Metadata = { title: "API keys" };

export default function DashboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6">
      {/* Who's signed in comes from a cookie, so this part streams in. */}
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading keys…</p>}>
        <Dashboard />
      </Suspense>
    </main>
  );
}

async function Dashboard() {
  const account = await getCurrentAccount();
  const { keys: allKeys, asOf } = await getApiKeys();
  const keys = visibleKeys(account, allKeys);

  const working = keys.filter(
    (key) => key.status === "active" || key.status === "rotating",
  );
  const stats = [
    { label: "Working keys", value: working.length },
    {
      label: "Expiring in 14 days",
      value: working.filter(
        (key) => new Date(key.expiresAt).getTime() - asOf <= 14 * DAY_MS,
      ).length,
    },
    {
      label: "Unused 30+ days",
      value: working.filter(
        (key) =>
          asOf - new Date(key.lastUsedAt ?? key.createdAt).getTime() >= 30 * DAY_MS,
      ).length,
    },
    { label: "Total keys", value: keys.length },
  ];

  return (
    <>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
          <p className="text-sm text-muted-foreground">
            {account.role === "platform-admin" ? (
              "Every tenant's keys. Each key belongs to one tenant and works on one endpoint, with only the permissions it was given."
            ) : (
              <>
                Keys for <strong className="text-foreground">{account.tenant}</strong>{" "}
                and the tenants below it. A key can never do more than its
                tenant, or any tenant above it, allows.
              </>
            )}
          </p>
        </div>
        <CreateKeyButton
          tenants={manageableTenants(account)}
          defaultTenant={account.role === "tenant-owner" ? account.tenant : undefined}
        />
      </header>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border p-4">
            <dt className="text-sm text-muted-foreground">{stat.label}</dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      {account.role === "tenant-owner" && <Allowance account={account} />}

      <ApiKeysTable data={keys} />
    </>
  );
}

/** The most a key for this account's tenant can be given, endpoint by endpoint. */
function Allowance({ account }: { account: Extract<Account, { role: "tenant-owner" }> }) {
  const plan = TENANT_PLANS[account.tenant] ?? [];
  const rows = ENDPOINTS.map((endpoint) => {
    // Plan entries at any scope: "customers:read", "customers.*:read", ...
    const inPlan = plan
      .filter((id) => !endpointBlocker(endpoint, id))
      .map((id) => ({ id, reason: permissionBlocker(account.tenant, id) }));
    return {
      endpoint,
      allowed: inPlan.filter((p) => !p.reason),
      blocked: inPlan.filter((p) => p.reason),
    };
  }).filter((row) => row.allowed.length || row.blocked.length);

  return (
    <section aria-labelledby="allowance-heading" className="rounded-lg border p-4">
      <h2 id="allowance-heading" className="font-medium">
        What {account.tenant} can give its keys
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Its plan, narrowed by every tenant above it. Endpoints not listed
        aren&apos;t available at all.
      </p>
      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
        {rows.map(({ endpoint, allowed, blocked }) => (
          <div key={endpoint.path} className="contents">
            <dt>
              <code className="text-xs">{endpoint.path}</code>
            </dt>
            <dd className="flex flex-wrap items-center gap-1">
              {allowed.map((p) => (
                <Badge key={p.id} variant="outline" className="font-mono">
                  {p.id}
                </Badge>
              ))}
              {blocked.map((p) => (
                <Badge
                  key={p.id}
                  variant="secondary"
                  className="font-mono text-muted-foreground line-through"
                  title={p.reason ?? undefined}
                >
                  {p.id}
                </Badge>
              ))}
              {blocked.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {[...new Set(blocked.map((p) => p.reason))].join("; ")}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
