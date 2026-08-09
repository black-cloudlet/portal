"use client";

import { useEffect } from "react";

import Icon from "@/components/Icon";

/**
 * A small confirmation modal in the console's own dialog style, replacing the
 * browser's native confirm() popup. Escape and the backdrop cancel; the confirm
 * button carries the danger style and shows the caller's pending/error state so
 * a failed action explains itself inside the dialog instead of vanishing.
 */
export default function ConfirmDialog({
  title,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  // Close on Escape and lock background scroll, like the create dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onCancel]);

  return (
    <div className="modal-overlay" onClick={onCancel} role="presentation">
      <div
        className="modal modal--confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <h2 className="modal__title">{title}</h2>
          <button type="button" className="modal__close" aria-label="Close" onClick={onCancel}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="modal__body">
          <div className="confirm__text">{children}</div>
          {error && <div className="notice notice--error">{error}</div>}
          <div className="form__actions form__actions--modal">
            <button type="button" className="btn" onClick={onCancel} disabled={pending}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={onConfirm}
              disabled={pending}
              autoFocus
            >
              {pending ? pendingLabel : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
