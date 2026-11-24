"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

/** The full key, shown once right after it's created. */
export function NewKeySecret({ name, fullKey }: { name: string; fullKey: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(fullKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the key is selectable as a fallback.
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Your new key for <strong>{name}</strong> is ready. Copy it now: it&apos;s
        shown once and can&apos;t be shown again. Only a fingerprint of it is
        stored.
      </p>
      <div className="flex items-stretch gap-2">
        <input
          readOnly
          aria-label="New API key"
          value={fullKey}
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-input bg-muted px-2.5 py-1.5 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Button type="button" variant="outline" onClick={copy} className="h-auto">
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p role="status" className="sr-only">
        {copied ? "Key copied to clipboard" : ""}
      </p>
    </div>
  );
}
