"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import {
  pullContainerAction,
  rebuildFunctionAction,
} from "@/app/(console)/serverless/actions";
import type { WorkloadType } from "@/lib/serverless";

/**
 * The per-offering maintenance action on the detail header: Build for a
 * function (build the same source again - new base image, retry, or a pushed
 * commit now), Pull for a container (re-resolve the tag to a digest via one new
 * revision). Both are 202s that change no spec, so the button's job is to fire
 * the POST, confirm it was accepted, and refresh so the status pill picks up
 * Building/Deploying. An API error (e.g. pulling a digest-pinned image is a
 * 400) is shown next to the button.
 */
export default function WorkloadOpButton({ type, name }: { type: WorkloadType; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);

  // The POST itself is quick (a 202); the build/rollout runs in the background
  // and shows up on the status pill after the refresh.
  const label = type === "function" ? "Build" : "Pull image";
  const pendingLabel = "Requesting…";

  // Let the "accepted" confirmation fade back to the plain label.
  useEffect(() => {
    if (!accepted) return;
    const id = setTimeout(() => setAccepted(false), 4000);
    return () => clearTimeout(id);
  }, [accepted]);

  function run() {
    setError(null);
    startTransition(async () => {
      const res =
        type === "function" ? await rebuildFunctionAction(name) : await pullContainerAction(name);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setAccepted(true);
      router.refresh();
    });
  }

  return (
    <span className="op-action">
      <button
        type="button"
        className="btn btn--outline"
        onClick={run}
        disabled={pending}
        title={
          type === "function"
            ? "Build the current source again (same spec, fresh base image and dependencies)."
            : "Re-resolve the image tag: cut a new revision that pulls what the tag points at now."
        }
      >
        {pending ? pendingLabel : accepted ? "✓ Accepted" : label}
      </button>
      {error && <span className="op-action__error">{error}</span>}
    </span>
  );
}
