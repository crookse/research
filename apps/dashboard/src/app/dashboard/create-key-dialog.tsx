"use client";

import { Plus } from "lucide-react";
import { startTransition, useActionState, useId, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FooterActions, Modal } from "@/components/ui/modal";
import {
  allowedScopes,
  DAY_MS,
  DEFAULT_EXPIRY_DAYS,
  describePermissions,
  endpointArea,
  ENDPOINTS,
  EXPIRY_DAYS,
  formatDate,
  getEndpoint,
  ITEM_ID_PATTERN,
  permissionBlocker,
  scopedPermissions,
  type EndpointDef,
  type Scope,
} from "@/lib/api-keys";
import { createApiKey, type CreateKeyField, type CreateKeyState } from "./actions";
import { NewKeySecret } from "./new-key-secret";

const FORM_ID = "create-key-form";

const SCOPE_LABEL: Record<Scope, string> = {
  all: "All, including the list",
  any: "Any single one",
  ids: "Specific ids",
};

/** "42, 77 c_9" → ["42", "77", "c_9"]. */
function splitIds(value: string) {
  return [...new Set(value.split(/[\s,]+/).filter(Boolean))];
}

/** The scopes a row can use, in the order they're offered. */
function usableScopes(tenant: string, endpoint: EndpointDef, action: string) {
  const allowed = allowedScopes(tenant, endpoint, action);
  return (Object.keys(SCOPE_LABEL) as Scope[]).filter((scope) => allowed[scope]);
}

function actionOf(permissionId: string) {
  return permissionId.split(":")[1];
}

function endpointUsable(tenant: string, path: string) {
  const endpoint = getEndpoint(path);
  return (
    !!endpoint &&
    endpoint.permissions.some((p) => usableScopes(tenant, endpoint, actionOf(p.id)).length > 0)
  );
}

/** One permission row. Rows nobody has touched use defaultChoice. */
type Choice = { checked: boolean; scope: Scope; ids: string };

function defaultChoice(scopes: Scope[]): Choice {
  return { checked: false, scope: scopes[0] ?? "all", ids: "" };
}

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm";

type TenantChoice = {
  /** Tenants the signed-in account manages. */
  tenants: string[];
  /** Pre-selected: the account's own tenant. */
  defaultTenant?: string;
};

export function CreateKeyButton(props: TenantChoice) {
  const [open, setOpen] = useState(false);
  // A fresh form for every opening, once the last one has animated out.
  const [session, setSession] = useState(0);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus />
        Create key
      </Button>
      <CreateKeyModal
        key={session}
        {...props}
        open={open}
        onClose={() => setOpen(false)}
        onExited={() => setSession((n) => n + 1)}
      />
    </>
  );
}

function CreateKeyModal({
  open,
  onClose,
  onExited,
  ...tenantChoice
}: TenantChoice & {
  open: boolean;
  onClose: () => void;
  onExited: () => void;
}) {
  const [state, formAction, pending] = useActionState<CreateKeyState, FormData>(
    createApiKey,
    { status: "idle" },
  );

  if (state.status === "created") {
    return (
      <Modal
        open={open}
        title="Copy your new key"
        onClose={onClose}
        onExited={onExited}
        width="34rem"
        closeButton={false}
        footer={<FooterActions primary={<Button onClick={onClose}>Done</Button>} />}
      >
        <NewKeySecret name={state.name} fullKey={state.fullKey} />
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      title="Create an API key"
      onClose={onClose}
      onExited={onExited}
      width="34rem"
      footer={
        <FooterActions
          secondary={
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
          }
          primary={
            <Button type="submit" form={FORM_ID} disabled={pending}>
              {pending ? "Creating…" : "Create key"}
            </Button>
          }
        />
      }
    >
      <CreateKeyForm
        {...tenantChoice}
        action={formAction}
        errors={state.status === "error" ? state.errors : {}}
      />
    </Modal>
  );
}

function CreateKeyForm({
  tenants,
  defaultTenant,
  action,
  errors,
}: TenantChoice & {
  action: (formData: FormData) => void;
  errors: Partial<Record<CreateKeyField, string>>;
}) {
  const ids = useId();
  const [name, setName] = useState("");
  const [tenant, setTenant] = useState(defaultTenant ?? "");
  const [endpointPath, setEndpointPath] = useState("");
  // Each row's state, keyed by collection permission ("customers:read"):
  // whether it's ticked and how far it reaches.
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [expiryDays, setExpiryDays] = useState(DEFAULT_EXPIRY_DAYS);
  // Only rendered once the dialog opens, so this runs in the browser.
  const [now] = useState(() => Date.now());

  const endpoint = getEndpoint(endpointPath);
  const expiresAt = now + expiryDays * DAY_MS;

  // What is actually sent: one string per chosen scope, e.g.
  // "customers.*:read" or "customers.42:read". The server checks it all again.
  const permissions = endpoint
    ? Object.entries(choices)
        .filter(([, choice]) => choice.checked)
        .flatMap(([id, choice]) =>
          scopedPermissions(endpointArea(endpoint), actionOf(id), choice.scope, splitIds(choice.ids)),
        )
    : [];

  function updateChoice(id: string, scopes: Scope[], change: Partial<Choice>) {
    setChoices((current) => ({
      ...current,
      [id]: { ...(current[id] ?? defaultChoice(scopes)), ...change },
    }));
  }

  const fieldError = (field: CreateKeyField) =>
    errors[field] ? (
      <p id={`${ids}-${field}-error`} className="text-sm text-destructive">
        {errors[field]}
      </p>
    ) : null;
  const errorProps = (field: CreateKeyField) =>
    errors[field]
      ? { "aria-invalid": true, "aria-describedby": `${ids}-${field}-error` }
      : {};

  return (
    <form
      id={FORM_ID}
      // Not `action={...}`: React resets a form after its action runs, which
      // would clear what was typed when the server sends back errors.
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        startTransition(() => action(formData));
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-name`} className="text-sm font-medium">
          Name
        </label>
        <Input
          id={`${ids}-name`}
          name="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="e.g. Nightly invoice sync"
          maxLength={80}
          autoComplete="off"
          {...errorProps("name")}
        />
        {fieldError("name")}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-tenant`} className="text-sm font-medium">
            Tenant
          </label>
          <select
            id={`${ids}-tenant`}
            name="tenant"
            value={tenant}
            onChange={(event) => {
              const next = event.target.value;
              setTenant(next);
              // Drop anything the new tenant can't give.
              if (endpointPath && !endpointUsable(next, endpointPath)) {
                setEndpointPath("");
                setChoices({});
              } else if (endpoint) {
                setChoices((current) => {
                  const kept: Record<string, Choice> = {};
                  for (const [id, choice] of Object.entries(current)) {
                    const scopes = usableScopes(next, endpoint, actionOf(id));
                    if (scopes.length === 0) continue;
                    kept[id] = scopes.includes(choice.scope)
                      ? choice
                      : { ...defaultChoice(scopes), checked: choice.checked };
                  }
                  return kept;
                });
              }
            }}
            className={selectClass}
            {...errorProps("tenant")}
          >
            <option value="" disabled>
              Choose a tenant
            </option>
            {tenants.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {fieldError("tenant")}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${ids}-endpoint`} className="text-sm font-medium">
            Endpoint
          </label>
          <select
            id={`${ids}-endpoint`}
            name="endpoint"
            value={endpointPath}
            onChange={(event) => {
              setEndpointPath(event.target.value);
              // Permissions belong to one endpoint; start over on a change.
              setChoices({});
            }}
            className={selectClass}
            {...errorProps("endpoint")}
          >
            <option value="" disabled>
              Choose an endpoint
            </option>
            {ENDPOINTS.map((e) => {
              const usable = !tenant || endpointUsable(tenant, e.path);
              return (
                <option key={e.path} value={e.path} disabled={!usable}>
                  {usable ? e.path : `${e.path} (not allowed)`}
                </option>
              );
            })}
          </select>
          {fieldError("endpoint")}
        </div>
      </div>

      <fieldset
        className="flex flex-col gap-2"
        {...(errors.permissions
          ? { "aria-describedby": `${ids}-permissions-error` }
          : {})}
      >
        <legend className="mb-1.5 text-sm font-medium">Permissions</legend>
        {endpoint && tenant ? (
          endpoint.permissions.map((permission) => {
            const scopes = usableScopes(tenant, endpoint, actionOf(permission.id));
            const blocker = scopes.length === 0 ? permissionBlocker(tenant, permission.id) : null;
            const reasonId = `${ids}-${permission.id}-reason`;
            const choice = choices[permission.id] ?? defaultChoice(scopes);
            const badIds = choice.scope === "ids"
              ? splitIds(choice.ids).filter((id) => !ITEM_ID_PATTERN.test(id))
              : [];
            return (
              <div key={permission.id} className="flex flex-col gap-1.5">
                <label
                  className={`flex items-center gap-2 text-sm ${blocker ? "text-muted-foreground" : ""}`}
                >
                  <input
                    type="checkbox"
                    disabled={!!blocker}
                    aria-describedby={blocker ? reasonId : undefined}
                    checked={choice.checked}
                    onChange={(event) =>
                      updateChoice(permission.id, scopes, { checked: event.target.checked })
                    }
                    className="size-4 accent-primary disabled:opacity-50"
                  />
                  {permission.label}
                  <code className="text-xs text-muted-foreground">{permission.id}</code>
                  {permission.sensitive && !blocker && (
                    <Badge variant="destructive" className="ml-auto">
                      Sensitive
                    </Badge>
                  )}
                </label>
                {blocker && (
                  <p id={reasonId} className="ml-6 text-xs text-muted-foreground">
                    {blocker}
                  </p>
                )}
                <div className="ml-6 flex flex-col gap-1.5 sm:flex-row sm:items-center">
                  <label className="sr-only" htmlFor={`${ids}-${permission.id}-scope`}>
                    {permission.label}: applies to
                  </label>
                  <select
                    id={`${ids}-${permission.id}-scope`}
                    value={choice.scope}
                    disabled={!!blocker}
                    onChange={(event) =>
                      updateChoice(permission.id, scopes, { scope: event.target.value as Scope })
                    }
                    className={`${selectClass} sm:w-48`}
                  >
                    {(Object.keys(SCOPE_LABEL) as Scope[]).map((scope) => (
                      <option key={scope} value={scope} disabled={!scopes.includes(scope)}>
                        {SCOPE_LABEL[scope]}
                      </option>
                    ))}
                  </select>
                  {choice.scope === "ids" && (
                    <Input
                      aria-label={`${permission.label}: ids`}
                      value={choice.ids}
                      onChange={(event) =>
                        updateChoice(permission.id, scopes, { ids: event.target.value })
                      }
                      placeholder="e.g. 1234, c_77"
                      autoComplete="off"
                      aria-invalid={badIds.length > 0 || undefined}
                    />
                    )}
                </div>
                {!blocker && !scopes.includes("all") && (
                  <p className="ml-6 text-xs text-muted-foreground">
                    {permissionBlocker(tenant, permission.id)}: single items only.
                  </p>
                )}
                {badIds.length > 0 && (
                  <p className="ml-6 text-xs text-destructive">
                    Ids may only use letters, digits, - and _: {badIds.join(", ")}
                  </p>
                )}
              </div>
            );
          })
        ) : (
          <p className="text-sm text-muted-foreground">
            Choose a tenant and an endpoint to see what this key can be given.
          </p>
        )}
        {permissions.map((p) => (
          <input key={p} type="hidden" name="permissions" value={p} />
        ))}
        {fieldError("permissions")}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${ids}-expiry`} className="text-sm font-medium">
          Expires after
        </label>
        <select
          id={`${ids}-expiry`}
          name="expiryDays"
          value={expiryDays}
          onChange={(event) => setExpiryDays(Number(event.target.value))}
          className={selectClass}
          {...errorProps("expiryDays")}
        >
          {EXPIRY_DAYS.map((days) => (
            <option key={days} value={days}>
              {days === 365 ? "1 year" : `${days} days`}
            </option>
          ))}
        </select>
        {fieldError("expiryDays")}
      </div>

      {tenant && endpoint && permissions.length > 0 && (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm">
          This key can {describePermissions(permissions)} for{" "}
          <strong>{tenant}</strong> on the <code>{endpoint.path}</code> endpoint,
          until {formatDate(expiresAt)}.
        </p>
      )}
    </form>
  );
}
