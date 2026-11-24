"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, Search } from "lucide-react";
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_equalsString,
  filterFn_includesString,
  globalFilteringFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { createContext, use, useId, useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FooterActions, Modal, useModalItem } from "@/components/ui/modal";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatDate,
  STATUS_LABEL,
  type ApiKey,
  type ApiKeyStatus,
} from "@/lib/api-keys";
import { replaceApiKey, revokeApiKey } from "./actions";
import { NewKeySecret } from "./new-key-secret";

const features = tableFeatures({
  rowSortingFeature,
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, basic: sortFn_basic },
  filterFns: {
    includesString: filterFn_includesString,
    equalsString: filterFn_equalsString,
  },
});

const STATUS_VARIANT: Record<
  ApiKeyStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  active: "default",
  rotating: "outline",
  expired: "secondary",
  revoked: "destructive",
};

type KeyAction = { kind: "revoke" | "replace"; key: ApiKey };

/** Lets row cells (defined once, at module scope) open the table's dialogs. */
const RowActionsContext = createContext<(action: KeyAction) => void>(() => {});

function RowActions({ apiKey }: { apiKey: ApiKey }) {
  const ask = use(RowActionsContext);
  if (apiKey.status !== "active" && apiKey.status !== "rotating") return null;
  return (
    <div className="flex justify-end gap-1">
      {apiKey.status === "active" && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => ask({ kind: "replace", key: apiKey })}
          aria-label={`Replace ${apiKey.name}`}
        >
          Replace
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="text-destructive hover:text-destructive"
        onClick={() => ask({ kind: "revoke", key: apiKey })}
        aria-label={`Revoke ${apiKey.name}`}
      >
        Revoke
      </Button>
    </div>
  );
}

const helper = createColumnHelper<typeof features, ApiKey>();

const columns = helper.columns([
  helper.accessor("name", {
    header: "Name",
    sortFn: "alphanumeric",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.original.name}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.prefix}
        </span>
      </div>
    ),
  }),
  // Not rendered: here so search also matches the key prefix.
  helper.accessor("prefix", { header: "Prefix", enableSorting: false }),
  helper.accessor("tenant", { header: "Tenant", sortFn: "alphanumeric" }),
  helper.accessor("endpoint", {
    header: "Endpoint",
    sortFn: "alphanumeric",
    filterFn: "equalsString",
    cell: ({ getValue }) => <code className="text-xs">{getValue()}</code>,
  }),
  helper.accessor("permissions", {
    header: "Permissions",
    enableSorting: false,
    enableGlobalFilter: false,
    cell: ({ getValue }) => (
      <div className="flex flex-wrap gap-1">
        {getValue().map((permission) => (
          <Badge key={permission} variant="outline" className="font-mono">
            {permission}
          </Badge>
        ))}
      </div>
    ),
  }),
  helper.accessor("status", {
    header: "Status",
    sortFn: "alphanumeric",
    filterFn: "equalsString",
    enableGlobalFilter: false,
    cell: ({ getValue }) => (
      <Badge variant={STATUS_VARIANT[getValue()]}>{STATUS_LABEL[getValue()]}</Badge>
    ),
  }),
  helper.accessor("createdAt", {
    header: "Created",
    sortFn: "basic",
    enableGlobalFilter: false,
    cell: ({ getValue }) => formatDate(getValue()),
  }),
  helper.accessor("lastUsedAt", {
    header: "Last used",
    sortFn: "basic",
    sortUndefined: "last",
    enableGlobalFilter: false,
    cell: ({ getValue }) => formatDate(getValue()),
  }),
  helper.accessor("expiresAt", {
    header: "Expires",
    sortFn: "basic",
    enableGlobalFilter: false,
    cell: ({ getValue }) => formatDate(getValue()),
  }),
  helper.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => <RowActions apiKey={row.original} />,
  }),
]);

const HIDDEN_COLUMNS = new Set(["prefix"]);

const STATUS_OPTIONS = (Object.keys(STATUS_LABEL) as ApiKeyStatus[]).map(
  (value) => ({ value, label: STATUS_LABEL[value] }),
);

function FilterGroup({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
}) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="flex flex-wrap items-center gap-1">
      {/* Fixed width so the buttons of stacked groups line up. */}
      <span id={labelId} className="w-20 shrink-0 text-sm font-medium text-muted-foreground">
        {label}
      </span>
      <Button
        size="sm"
        variant={value === undefined ? "secondary" : "ghost"}
        aria-pressed={value === undefined}
        onClick={() => onChange(undefined)}
      >
        All
      </Button>
      {options.map((option) => (
        <Button
          key={option.value}
          size="sm"
          variant={value === option.value ? "secondary" : "ghost"}
          aria-pressed={value === option.value}
          onClick={() =>
            onChange(value === option.value ? undefined : option.value)
          }
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

export function ApiKeysTable({ data }: { data: ApiKey[] }) {
  const table = useTable({
    features,
    columns,
    data,
    globalFilterFn: "includesString",
    initialState: {
      sorting: [{ id: "createdAt", desc: true }],
    },
  });

  const confirm = useModalItem<KeyAction>();
  const reveal = useModalItem<{ name: string; fullKey: string }>();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function ask(action: KeyAction) {
    setError(null);
    confirm.show(action);
  }

  function runConfirmed() {
    const action = confirm.item;
    if (!action) return;
    startTransition(async () => {
      const result =
        action.kind === "revoke"
          ? await revokeApiKey(action.key.id)
          : await replaceApiKey(action.key.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      confirm.close();
      if (result.fullKey) reveal.show({ name: result.name, fullKey: result.fullKey });
    });
  }

  const endpoints = [...new Set(data.map((key) => key.endpoint))]
    .sort()
    .map((value) => ({ value, label: value }));
  const statusColumn = table.getColumn("status");
  const endpointColumn = table.getColumn("endpoint");
  const rows = table.getRowModel().rows;
  const visibleColumnCount = table
    .getAllLeafColumns()
    .filter((column) => !HIDDEN_COLUMNS.has(column.id)).length;

  const action = confirm.item;

  return (
    <RowActionsContext value={ask}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative w-full xl:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search name, prefix, tenant…"
              aria-label="Search API keys"
              className="pl-8"
              value={(table.state.globalFilter as string | undefined) ?? ""}
              onChange={(event) => table.setGlobalFilter(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <FilterGroup
              label="Status"
              options={STATUS_OPTIONS}
              value={statusColumn?.getFilterValue() as string | undefined}
              onChange={(value) => statusColumn?.setFilterValue(value)}
            />
            <FilterGroup
              label="Endpoint"
              options={endpoints}
              value={endpointColumn?.getFilterValue() as string | undefined}
              onChange={(value) => endpointColumn?.setFilterValue(value)}
            />
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((group) => (
                <TableRow key={group.id}>
                  {group.headers
                    .filter((header) => !HIDDEN_COLUMNS.has(header.column.id))
                    .map((header) => {
                      const sorted = header.column.getIsSorted();
                      const toggle = header.column.getToggleSortingHandler();
                      return (
                        <TableHead
                          key={header.id}
                          aria-sort={
                            sorted === "asc"
                              ? "ascending"
                              : sorted === "desc"
                                ? "descending"
                                : undefined
                          }
                        >
                          {header.isPlaceholder ? null : toggle ? (
                            <button
                              type="button"
                              onClick={toggle}
                              className="-mx-1 inline-flex items-center gap-1 rounded px-1 hover:text-foreground"
                            >
                              <table.FlexRender header={header} />
                              {sorted === "asc" ? (
                                <ArrowUp className="size-3.5" />
                              ) : sorted === "desc" ? (
                                <ArrowDown className="size-3.5" />
                              ) : (
                                <ArrowUpDown className="size-3.5 opacity-40" />
                              )}
                            </button>
                          ) : (
                            <table.FlexRender header={header} />
                          )}
                        </TableHead>
                      );
                    })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.length ? (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    {row
                      .getAllCells()
                      .filter((cell) => !HIDDEN_COLUMNS.has(cell.column.id))
                      .map((cell) => (
                        <TableCell key={cell.id}>
                          <table.FlexRender cell={cell} />
                        </TableCell>
                      ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={visibleColumnCount}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No API keys match these filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <p className="text-sm text-muted-foreground">
          Showing {rows.length} of {data.length} keys
        </p>
      </div>

      <Modal
        open={confirm.open}
        title={action?.kind === "replace" ? "Replace this key?" : "Revoke this key?"}
        onClose={() => !pending && confirm.close()}
        onExited={confirm.onExited}
        closeButton={false}
        footer={
          <FooterActions
            secondary={
              <Button variant="outline" onClick={confirm.close} disabled={pending}>
                Cancel
              </Button>
            }
            primary={
              <Button
                variant={action?.kind === "revoke" ? "destructive" : "default"}
                onClick={runConfirmed}
                disabled={pending}
              >
                {action?.kind === "replace"
                  ? pending
                    ? "Replacing…"
                    : "Replace key"
                  : pending
                    ? "Revoking…"
                    : "Revoke key"}
              </Button>
            }
          />
        }
      >
        {action?.kind === "replace" ? (
          <p className="text-sm">
            A new key with exactly the same settings will be created for{" "}
            <strong>{action.key.name}</strong>. The current key keeps working
            for 24 hours so you can switch over, then stops on its own.
          </p>
        ) : action ? (
          <p className="text-sm">
            <strong>{action.key.name}</strong> will stop working straight away
            for <code>{action.key.endpoint}</code> on {action.key.tenant}. This
            can&apos;t be undone.
          </p>
        ) : null}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </Modal>

      <Modal
        open={reveal.open}
        title="Copy your new key"
        onClose={reveal.close}
        onExited={reveal.onExited}
        width="34rem"
        closeButton={false}
        footer={
          <FooterActions primary={<Button onClick={reveal.close}>Done</Button>} />
        }
      >
        {reveal.item && (
          <NewKeySecret name={reveal.item.name} fullKey={reveal.item.fullKey} />
        )}
      </Modal>
    </RowActionsContext>
  );
}
