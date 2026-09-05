"use client";

import { useEffect, useState, useTransition } from "react";

import { rotateWebhookAction } from "@/app/(console)/serverless/actions";
import ConfirmDialog from "@/components/ConfirmDialog";
import Icon from "@/components/Icon";
import type { WebhookView } from "@/lib/serverless";

/**
 * Copy one value to the clipboard, confirming in place. The API is only
 * available on a secure origin, so a failure is shown rather than swallowed -
 * the value is on screen either way and can be selected by hand.
 */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const id = setTimeout(() => setState("idle"), 3000);
    return () => clearTimeout(id);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  return (
    <button
      type="button"
      className="btn btn--outline btn--sm"
      onClick={copy}
      aria-label={`Copy ${label}`}
    >
      {state === "copied" ? (
        <>
          <Icon name="check" size={13} /> Copied
        </>
      ) : state === "failed" ? (
        "Copy failed"
      ) : (
        "Copy"
      )}
    </button>
  );
}

/** One webhook field: its label, the value in a code box, and a copy button. */
function WebhookField({
  label,
  value,
  display,
  children,
}: {
  label: string;
  /** What Copy puts on the clipboard - always the real value. */
  value: string;
  /** What is shown, when that differs (a masked token). */
  display?: string;
  /** Extra control beside Copy (the token's Show/Hide). */
  children?: React.ReactNode;
}) {
  return (
    <div className="webhook__field">
      <span className="webhook__label">{label}</span>
      <code className="webhook__value">{display ?? value}</code>
      <span className="webhook__actions">
        {children}
        <CopyButton value={value} label={label} />
      </span>
    </div>
  );
}

/**
 * The function's git webhook: the URL a push posts to, and the token the
 * provider sends back as `X-Gitlab-Token`. Both are handed over to be pasted
 * into the provider, so the token is shown here (masked until asked for) rather
 * than redacted as `gitToken` is - it is the platform's own credential, and
 * anyone who can read this page can already start a build with their own
 * session.
 *
 * Rotating replaces it in every region before the API answers, so the hook
 * stops working the moment this returns and has to be reconfigured with the new
 * token - which is why it is behind a confirmation, and why the new token is
 * shown revealed straight after.
 */
export default function WebhookPanel({ name, initial }: { name: string; initial: WebhookView }) {
  const [hook, setHook] = useState(initial);
  const [revealed, setRevealed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [rotated, setRotated] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The last token the server handed us. The detail page auto-refreshes, so
  // this component re-renders with a fresh read every few seconds; comparing
  // against the token *value* (not the prop object, whose identity changes on
  // every poll) is what tells a real change from a re-render.
  const [serverToken, setServerToken] = useState(initial.token);

  if (initial.token !== serverToken) {
    // Someone else rotated it. Adopt what the API now stores rather than
    // leaving a token on screen that no longer authenticates a push.
    setServerToken(initial.token);
    setHook(initial);
    setRevealed(false);
    setRotated(false);
  }

  function rotate() {
    setError(null);
    startTransition(async () => {
      const res = await rotateWebhookAction(name);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setHook(res.webhook);
      // Record it as the server's own, so the refresh this action triggers
      // reads as the same token and leaves the panel below as it is.
      setServerToken(res.webhook.token);
      // The old token is already dead; show the replacement so it can be pasted
      // into the provider without a second click.
      setRevealed(true);
      setRotated(true);
      setConfirming(false);
    });
  }

  return (
    <section>
      <div className="section-row">
        <h3 className="section-title">Git webhook</h3>
        <button
          type="button"
          className="btn btn--outline btn--sm"
          onClick={() => setConfirming(true)}
          disabled={pending}
        >
          {pending ? "Rotating…" : "Rotate token"}
        </button>
      </div>

      <p className="text-muted">
        A push to <code>{hook.events.join(", ")}</code> can build this function. In{" "}
        {hook.provider === "gitlab" ? "GitLab" : hook.provider}, add a webhook with the URL and
        secret token below, send push events only, and leave SSL verification on. Only a push to the
        branch this function&apos;s revision names starts a build; anything else is acknowledged and
        ignored.
      </p>

      <div className="webhook">
        <WebhookField label="URL" value={hook.url} />
        <WebhookField
          label="Secret token"
          value={hook.token}
          display={revealed ? hook.token : "•".repeat(24)}
        >
          <button
            type="button"
            className="btn btn--outline btn--sm"
            onClick={() => setRevealed((v) => !v)}
          >
            {revealed ? "Hide" : "Show"}
          </button>
        </WebhookField>
      </div>

      {rotated && (
        <div className="notice">
          The token was replaced in every region. The old one no longer works — paste this one into{" "}
          {hook.provider === "gitlab" ? "GitLab" : hook.provider} to make the hook work again.
        </div>
      )}
      {error && !confirming && <div className="notice notice--error">{error}</div>}

      {confirming && (
        <ConfirmDialog
          title="Rotate webhook token"
          confirmLabel="Rotate"
          pendingLabel="Rotating…"
          pending={pending}
          error={error}
          onConfirm={rotate}
          onCancel={() => {
            if (!pending) setConfirming(false);
          }}
        >
          <p>
            Replace the webhook token for <strong>{name}</strong>? The current token stops working
            immediately, so pushes will not build this function until the hook is reconfigured with
            the new token.
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
