"use client";

import { useEffect, useRef, useState } from "react";

import {
  getPodLogsAction,
  getPodsAction,
  mintStreamUrlAction,
} from "@/app/(console)/serverless/actions";
import { openTicketedStream } from "@/lib/stream";
import type { LogLine, PodRoster, WorkloadType } from "@/lib/serverless";

/** Keep the last N lines so a chatty pod cannot grow the tab unbounded. */
const MAX_LINES = 2000;

/**
 * Panes open at once. Each open pane holds one SSE connection, next to the
 * roster's own - and a browser caps HTTP/1.1 connections per origin at six,
 * beyond which a new EventSource silently queues forever. Opening one more
 * closes the oldest instead.
 */
const MAX_OPEN = 3;

/**
 * The Logs tab: the workload's pods as a live list, each row expanding into
 * its own log console.
 *
 * The list comes from `GET .../{name}/pods` - a stream, because Knative
 * replaces pods on every revision and removes them all on scale-to-zero, so a
 * roster fetched once quietly stops being true. Rows appear and vanish as the
 * roster changes; expanding a row opens `GET .../{name}/logs/pods/{pod}` for
 * that pod alone, and collapsing it closes the stream. Everything
 * authenticates with server-minted tickets (see lib/stream.ts) and falls back
 * to `?follow=false` snapshot polling when a stream cannot be opened.
 */
export default function PodLogsViewer({ type, name }: { type: WorkloadType; name: string }) {
  const [roster, setRoster] = useState<PodRoster | null>(null);
  const [rosterMode, setRosterMode] = useState<"connecting" | "live" | "polling">("connecting");
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [container, setContainer] = useState("user-container");
  const [containerDraft, setContainerDraft] = useState("user-container");
  // Expanded pod names, oldest first; rows for pods the roster dropped keep
  // their entry so a pod that flaps does not lose its place, but render only
  // while the roster lists them.
  const [open, setOpen] = useState<string[]>([]);
  // Auto-expand happens once, and never again after the user has touched a
  // row - the view must not fight them.
  const [touched, setTouched] = useState(false);

  /* ---- the pod roster ---- */

  useEffect(() => {
    const stream = openTicketedStream({
      mint: async () => {
        const res = await mintStreamUrlAction(type, name, { kind: "pods" });
        return "url" in res ? res.url : null;
      },
      events: {
        pods: (data) => {
          setRoster(data as PodRoster);
          setRosterMode("live");
        },
        // Routine rollover at the stream's time limit; the helper reconnects
        // with a fresh ticket when the server closes the connection.
        end: () => {},
        error: () => {},
      },
      onDown: () => setRosterMode("polling"),
    });
    return () => stream.close();
  }, [type, name]);

  useEffect(() => {
    if (rosterMode !== "polling") return;
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await getPodsAction(type, name);
      if (stop) return;
      if ("roster" in res) {
        setRosterError(null);
        setRoster(res.roster);
      } else {
        // Say the roster could not be read - a silent failure here would
        // render as "no running pods", a claim about the user's workload.
        setRosterError(res.error);
      }
    };
    void tick();
    const id = setInterval(tick, 10000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [rosterMode, type, name]);

  // First roster with pods: expand the first row, so the common case - one
  // pod, one log - shows lines without a click. Render-phase (per React's
  // "adjusting state when props change" pattern), and only until the user
  // touches a row.
  const firstPod = roster?.pods[0]?.pod;
  if (!touched && firstPod && open.length === 0) {
    setTouched(true);
    setOpen([firstPod]);
  }

  function toggle(pod: string) {
    setTouched(true);
    setOpen((prev) =>
      prev.includes(pod) ? prev.filter((p) => p !== pod) : [...prev, pod].slice(-MAX_OPEN),
    );
  }

  return (
    <div className="stack">
      <form
        className="logs-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setContainer(containerDraft.trim() || "user-container");
        }}
      >
        <input
          className="input"
          value={containerDraft}
          onChange={(e) => setContainerDraft(e.target.value)}
          placeholder="user-container"
          aria-label="Container"
        />
        <button type="submit" className="btn btn--sm">
          Load
        </button>
      </form>

      {roster && (
        <p className="text-muted">
          Pods on region <strong>{roster.region}</strong>. A scaled-to-zero workload has no pods;
          logs reach back only as far as the node keeps them.
        </p>
      )}

      {rosterError && (
        <div className="notice notice--error">Could not read the pod roster: {rosterError}</div>
      )}

      {!roster ? (
        <div className="notice">Waiting for the pod roster from the API…</div>
      ) : roster.pods.length === 0 ? (
        <div className="notice">No running pods to read logs from.</div>
      ) : (
        <div className="pod-list">
          {roster.pods.map((p) => {
            const expanded = open.includes(p.pod);
            return (
              <div key={p.pod} className={`pod-row${expanded ? " pod-row--open" : ""}`}>
                <button
                  type="button"
                  className="pod-row__head"
                  onClick={() => toggle(p.pod)}
                  aria-expanded={expanded}
                >
                  <span className="pod-row__chevron" aria-hidden>
                    ▸
                  </span>
                  <span
                    className={`pod-row__dot pod-row__dot--${p.ready ? "ready" : "waiting"}`}
                    title={p.ready ? "Ready" : `${p.phase}, not ready`}
                  />
                  <span className="pod-row__name">{p.pod}</span>
                  <span className="pod-row__meta">
                    {p.revision && <span>rev {p.revision}</span>}
                    <span>{p.ready ? "Ready" : p.phase}</span>
                    {p.restarts > 0 && <span>{p.restarts} restarts</span>}
                    {p.usage?.cpu && <span>{p.usage.cpu} CPU</span>}
                    {p.usage?.memory && <span>{p.usage.memory}</span>}
                  </span>
                </button>
                {expanded && (
                  <div className="pod-row__body">
                    <PodLogPane type={type} name={name} pod={p.pod} container={container} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * One expanded pod's log console: opens the follow when mounted, closes it
 * when collapsed/unmounted, and falls back to snapshot polling if the stream
 * cannot be opened. Owns all of its own state, so panes never share fate.
 */
function PodLogPane({
  type,
  name,
  pod,
  container,
}: {
  type: WorkloadType;
  name: string;
  pod: string;
  container: string;
}) {
  // Lines carry a monotonic id so React keys stay stable once the buffer
  // starts sliding - keying by index would rewrite every row per event.
  const [lines, setLines] = useState<{ id: number; line: LogLine }[]>([]);
  const nextLineId = useRef(0);
  const [mode, setMode] = useState<"connecting" | "live" | "polling" | "ended">("connecting");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped to reopen the follow of the same pod (the API ends every stream at
  // its time limit and asks the client to reconnect).
  const [reconnectNonce, setReconnectNonce] = useState(0);

  // Reset the pane when what it follows changes (render-phase, per React's
  // "adjusting state when props change" pattern - not an effect).
  const streamKey = `${pod}|${container}|${reconnectNonce}`;
  const [prevStreamKey, setPrevStreamKey] = useState(streamKey);
  if (streamKey !== prevStreamKey) {
    setPrevStreamKey(streamKey);
    setLines([]);
    setNotice(null);
    setError(null);
    setMode("connecting");
  }

  useEffect(() => {
    let ended = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const stream = openTicketedStream({
      mint: async () => {
        // tailLines, not a since-window: an existing pod may have been quiet
        // for hours, and "the last 5 minutes" of that is an empty pane. The
        // newest N lines show its recent history however old, then follow on.
        const res = await mintStreamUrlAction(type, name, {
          kind: "logs",
          pod,
          container,
          tailLines: MAX_LINES,
        });
        return "url" in res ? res.url : null;
      },
      events: {
        open: () => setMode("live"),
        log: (data) => {
          setLines((prev) => {
            const next = [...prev, { id: nextLineId.current++, line: data as LogLine }];
            return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
          });
        },
        warning: (data) => {
          const w = data as { message: string; droppedLines?: number | null };
          setNotice(w.droppedLines ? `${w.message} (${w.droppedLines} lines dropped)` : w.message);
        },
        end: (data) => {
          // An `end` is routine, never a failure - but it means two different
          // things. At the stream's time limit the API says "…; reconnect",
          // and we do: the pod is still running and the follow should go on.
          // Otherwise the pod's log genuinely ended (scale-down or a new
          // revision): stop, and let the roster remove the row - the
          // replacement pod appears in the list on its next event.
          ended = true;
          stream.close();
          const reason = (data as { reason: string }).reason;
          if (/reconnect/i.test(reason)) {
            setMode("connecting");
            // The nonce bump alone resets the pane (see streamKey above).
            reconnectTimer = setTimeout(() => setReconnectNonce((n) => n + 1), 1000);
          } else {
            setMode("ended");
            setNotice(reason);
          }
        },
        error: (data) => {
          setError((data as { message?: string }).message ?? "The log stream failed.");
        },
      },
      onDown: () => {
        if (!ended) setMode("polling");
      },
    });
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stream.close();
    };
  }, [type, name, pod, container, reconnectNonce]);

  // Snapshot polling, only while this pane's stream is down.
  useEffect(() => {
    if (mode !== "polling") return;
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await getPodLogsAction(type, name, pod, { container });
      if (stop) return;
      if ("snapshot" in res) {
        setError(null);
        setLines(
          res.snapshot.lines.slice(-MAX_LINES).map((line) => ({ id: nextLineId.current++, line })),
        );
      } else {
        setError(res.error);
      }
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [mode, type, name, pod, container]);

  /* ---- auto-scroll: follow the tail unless the user scrolled up ---- */

  const logRef = useRef<HTMLPreElement>(null);
  const pinnedRef = useRef(true);
  useEffect(() => {
    const el = logRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="stack">
      {notice && <div className="notice">{notice}</div>}
      {error && <div className="notice notice--error">{error}</div>}
      <pre
        ref={logRef}
        className="code-block code-block--logs"
        onScroll={(e) => {
          const el = e.currentTarget;
          pinnedRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 32;
        }}
      >
        {lines.length === 0
          ? mode === "connecting"
            ? "Waiting for log lines…"
            : "(no log lines yet)"
          : lines.map(({ id, line }) => (
              <span key={id} className="log-line">
                {line.message}
                {"\n"}
              </span>
            ))}
      </pre>
    </div>
  );
}
