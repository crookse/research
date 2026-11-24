"use client";

import { useId, useTransition } from "react";

import { setActingAs } from "@/app/dashboard/actions";
import { ACCOUNTS, PLATFORM_ADMIN } from "@/lib/api-keys";

/** Pretend to be someone else. A stand-in for signing in and out. */
export function AccountSwitcher({ currentId }: { currentId: string }) {
  const id = useId();
  const [pending, startTransition] = useTransition();
  const owners = ACCOUNTS.filter((account) => account.role === "tenant-owner");

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-muted-foreground">
        Signed in as
      </label>
      <select
        id={id}
        value={currentId}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value;
          startTransition(() => setActingAs(next));
        }}
        className="h-8 max-w-[14rem] rounded-lg border border-input bg-background px-2 text-sm font-medium outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
      >
        <option value={PLATFORM_ADMIN.id}>{PLATFORM_ADMIN.name}</option>
        <optgroup label="Tenant owners">
          {owners.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}
