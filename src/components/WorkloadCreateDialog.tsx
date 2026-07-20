"use client";

import { useEffect, useState } from "react";

import Icon from "@/components/Icon";
import WorkloadForm from "@/components/WorkloadForm";
import type { PlatformInfo, WorkloadType } from "@/lib/serverless";

/**
 * The "+ Create" entry point for a workload list. Instead of navigating to a
 * separate `/new` screen, it opens the create form in a modal dialog layered
 * over the current list with a blurred backdrop. The form keeps its tabbed
 * sections (General / Variables / Secrets / Files / Advanced) inside the dialog.
 *
 * A successful create still redirects to the new workload's detail page (via the
 * server action), which unmounts the dialog; Cancel, the backdrop, the ✕, and
 * Escape all just close it.
 */
export default function WorkloadCreateDialog({
  type,
  info,
  group,
}: {
  type: WorkloadType;
  info: PlatformInfo;
  group: string;
}) {
  const [open, setOpen] = useState(false);

  // Close on Escape and lock background scroll while the dialog is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button type="button" className="btn btn--primary" onClick={() => setOpen(true)}>
        + Create {type}
      </button>

      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)} role="presentation">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={`New ${type}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal__head">
              <h2 className="modal__title">New {type}</h2>
              <button
                type="button"
                className="modal__close"
                aria-label="Close"
                onClick={() => setOpen(false)}
              >
                <Icon name="x" size={18} />
              </button>
            </div>
            <div className="modal__body">
              <WorkloadForm
                mode="create"
                type={type}
                info={info}
                group={group}
                variant="modal"
                onClose={() => setOpen(false)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
