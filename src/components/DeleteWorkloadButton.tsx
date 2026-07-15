"use client";

import { useState, useTransition } from "react";

import { deleteWorkloadAction } from "@/app/(console)/serverless/actions";
import type { WorkloadType } from "@/lib/serverless";

/**
 * Delete a workload. Confirms first, then calls the delete server action (which
 * redirects to the list on success). Any API error is shown inline.
 */
export default function DeleteWorkloadButton({ type, name }: { type: WorkloadType; name: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onDelete() {
    if (!window.confirm(`Delete ${type} "${name}"? This cannot be undone.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteWorkloadAction(type, name);
      // A successful delete redirects, so we only get here on failure.
      if (res?.error) setError(res.error);
    });
  }

  return (
    <span className="delete-action">
      <button type="button" className="btn btn--danger" onClick={onDelete} disabled={pending}>
        {pending ? "Deleting…" : "Delete"}
      </button>
      {error && <span className="delete-action__error">{error}</span>}
    </span>
  );
}
