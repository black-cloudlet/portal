"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { getStatsAction } from "@/app/(console)/serverless/actions";
import Icon from "@/components/Icon";
import { ReasonChip } from "@/components/StatusPill";
import { CREATE_GRACE_MS } from "@/lib/pending-create";
import { isTerminalStatus, typeSegment, type WorkloadType } from "@/lib/serverless";

/** How often a toast re-reads the lightweight /stats endpoint. */
const POLL_MS = 2500;
/** How long a finished (Ready) toast lingers before dismissing itself. */
const SUCCESS_LINGER_MS = 10000;

interface Creation {
  id: number;
  type: WorkloadType;
  name: string;
  /** When the API accepted the create - anchors the NOT_FOUND grace window. */
  acceptedAt: number;
}

const CreationTrackerContext = createContext<{
  track: (type: WorkloadType, name: string) => void;
} | null>(null);

/**
 * Follow a just-accepted workload creation from wherever the user is. The
 * create form hands the accepted workload to `track()`; a small non-blocking
 * toast pinned to the bottom-right follows the deploy on the lightweight
 * `/stats` endpoint until it settles (Ready/Failed per the API's terminal set)
 * and can be dismissed at any point.
 */
export function useCreationTracker() {
  const ctx = useContext(CreationTrackerContext);
  if (!ctx) throw new Error("useCreationTracker must be used inside CreationTrackerProvider");
  return ctx;
}

/** Mounted once in the console layout, so toasts survive navigation. */
export default function CreationTrackerProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Creation[]>([]);
  const nextId = useRef(0);

  const track = useCallback((type: WorkloadType, name: string) => {
    setItems((prev) => [...prev, { id: nextId.current++, type, name, acceptedAt: Date.now() }]);
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  return (
    <CreationTrackerContext.Provider value={{ track }}>
      {children}
      {items.length > 0 && (
        <div className="toasts" role="status" aria-live="polite">
          {items.map((item) => (
            <CreationToast key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
          ))}
        </div>
      )}
    </CreationTrackerContext.Provider>
  );
}

type Phase = "watching" | "ready" | "failed" | "error";

/**
 * One tracked creation. Polls `/stats` (via a server action, so the token stays
 * server-side) every couple of seconds - the endpoint built for exactly this -
 * and stops on a terminal status. A NOT_FOUND inside the create grace window is
 * the 202 race (the platform hasn't materialized the workload yet), not a
 * failure; past the window it surfaces as one.
 */
function CreationToast({ item, onDismiss }: { item: Creation; onDismiss: () => void }) {
  const [status, setStatus] = useState("Pending");
  const [reason, setReason] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("watching");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== "watching") return;
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await getStatsAction(item.type, item.name);
      if (stop) return;
      if ("stats" in res) {
        setStatus(res.stats.status);
        setReason(res.stats.reason);
        if (isTerminalStatus(res.stats.status)) {
          setPhase(res.stats.status === "Ready" ? "ready" : "failed");
        }
      } else if (res.code === "NOT_FOUND" && Date.now() - item.acceptedAt < CREATE_GRACE_MS) {
        // Accepted but not materialized yet - keep waiting.
      } else {
        setErrorMsg(res.error);
        setPhase("error");
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [phase, item]);

  // A success announces itself, lingers briefly, and leaves on its own.
  useEffect(() => {
    if (phase !== "ready") return;
    const id = setTimeout(onDismiss, SUCCESS_LINGER_MS);
    return () => clearTimeout(id);
  }, [phase, onDismiss]);

  const href = `/serverless/${typeSegment(item.type)}/${encodeURIComponent(item.name)}`;
  const tone = phase === "ready" ? "ok" : phase === "watching" ? "" : "error";

  return (
    <div className={`toast${tone ? ` toast--${tone}` : ""}`}>
      {phase === "watching" ? (
        <span className="toast__spinner" aria-hidden="true" />
      ) : (
        <span className={`toast__mark toast__mark--${tone}`} aria-hidden="true">
          {phase === "ready" ? "✓" : "✕"}
        </span>
      )}
      <div className="toast__body">
        <Link href={href} className="toast__title">
          {phase === "watching"
            ? `Creating ${item.type} ${item.name}…`
            : phase === "ready"
              ? `${item.type === "function" ? "Function" : "Container"} ${item.name} is ready`
              : `${item.type === "function" ? "Function" : "Container"} ${item.name} failed`}
        </Link>
        <span className="toast__status">
          {phase === "error" ? (
            errorMsg
          ) : (
            <>
              {status}
              {reason && (
                <>
                  {" "}
                  <ReasonChip reason={reason} />
                </>
              )}
            </>
          )}
        </span>
      </div>
      <button type="button" className="toast__close" aria-label="Dismiss" onClick={onDismiss}>
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
