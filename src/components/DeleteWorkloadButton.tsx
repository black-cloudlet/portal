"use client";

import { useState, useTransition } from "react";

import { deleteWorkloadAction } from "@/app/(console)/serverless/actions";
import ConfirmDialog from "@/components/ConfirmDialog";
import type { WorkloadType } from "@/lib/serverless";

/**
 * Delete a workload. Opens the console's own confirmation dialog (not the
 * browser's native popup), then calls the delete server action, which redirects
 * to the list on success. An API error is shown inside the dialog.
 */
export default function DeleteWorkloadButton({ type, name }: { type: WorkloadType; name: string }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const res = await deleteWorkloadAction(type, name);
      // A successful delete redirects, so we only get here on failure.
      if (res?.error) setError(res.error);
    });
  }

  return (
    <>
      <button type="button" className="btn btn--danger" onClick={() => setOpen(true)}>
        Delete
      </button>
      {open && (
        <ConfirmDialog
          title={`Delete ${type}`}
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          pending={pending}
          error={error}
          onConfirm={onConfirm}
          onCancel={() => {
            if (!pending) setOpen(false);
          }}
        >
          <p>
            Delete {type} <strong>{name}</strong> from every site? Its revisions, routes, and
            derived secrets are removed. This cannot be undone.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
