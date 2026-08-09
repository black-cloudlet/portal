"use client";

import { useEffect, useRef, useState } from "react";

import {
  getPodLogsAction,
  getPodsAction,
  mintStreamUrlAction,
} from "@/app/(console)/serverless/actions";
import { openTicketedStream } from "@/lib/stream";
import type { LogLine, PodInfo, PodRoster, WorkloadType } from "@/lib/serverless";

/** Keep the last N lines so a chatty pod cannot grow the tab unbounded. */
const MAX_LINES = 2000;
/** How far back a freshly-opened follow starts. */
const SINCE_SECONDS = 300;

/** hh:mm:ss for the line gutter; the API renders full RFC 3339 timestamps. */
function fmtTime(v: string | null): string {
  if (!v) return "";
  const t = v.indexOf("T");
  return t === -1 ? v : v.slice(t + 1, t + 9);
}

/**
 * The Logs tab: pick a pod, follow its log.
 *
 * The pod roster comes from `GET .../{name}/pods` - a stream, because Knative
 * replaces pods on every revision and removes them all on scale-to-zero, so a
 * roster fetched once quietly stops being true. Picking a pod opens
 * `GET .../{name}/logs/pods/{pod}` and appends `log` events as they arrive.
 * Both streams authenticate with server-minted tickets (see lib/stream.ts) and
 * fall back to the `?follow=false` snapshots via server actions when streaming
 * is unavailable.
 *
 * An `end` event is routine, not an error. At the stream's time limit the API
 * asks the client to reconnect, and this does; when the pod's log genuinely
 * ended (scale-down, new revision) the roster stream keeps running, so the
 * selection moves to the replacement pod on its next event.
 */
export default function PodLogsViewer({ type, name }: { type: WorkloadType; name: string }) {
  const [roster, setRoster] = useState<PodRoster | null>(null);
  const [rosterMode, setRosterMode] = useState<"connecting" | "live" | "polling">("connecting");
  const [chosenPod, setChosenPod] = useState<string>("");
  const [container, setContainer] = useState("user-container");
  const [containerDraft, setContainerDraft] = useState("user-container");

  // Lines carry a monotonic id so React keys stay stable once the buffer
  // starts sliding - keying by index would rewrite every row per event.
  const [lines, setLines] = useState<{ id: number; line: LogLine }[]>([]);
  const nextLineId = useRef(0);
  const [logMode, setLogMode] = useState<"idle" | "connecting" | "live" | "polling" | "ended">(
    "idle",
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  // Bumped to reopen the follow of the same pod (the API ends every stream at
  // its time limit and asks the client to reconnect).
  const [reconnectNonce, setReconnectNonce] = useState(0);

  // The pod actually followed is derived, not synced: the user's choice while
  // the roster still lists it, else the roster's first pod. When a followed pod
  // is replaced (new revision, scale-down) the selection moves to the
  // replacement on the next roster event - the "pick the replacement" the API
  // docs describe - with no effect writing state behind the user's back.
  const podNames = roster?.pods.map((p) => p.pod) ?? [];
  const pod = chosenPod && podNames.includes(chosenPod) ? chosenPod : (podNames[0] ?? "");

  // Reset the log view when what it follows changes (render-phase, per React's
  // "adjusting state when props change" pattern - not an effect).
  const streamKey = `${pod}|${container}`;
  const [prevStreamKey, setPrevStreamKey] = useState(streamKey);
  if (streamKey !== prevStreamKey) {
    setPrevStreamKey(streamKey);
    setLines([]);
    setNotice(null);
    setLogError(null);
    setLogMode(pod ? "connecting" : "idle");
  }

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

  /* ---- one pod's log ---- */

  useEffect(() => {
    if (!pod) return;

    let ended = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const stream = openTicketedStream({
      mint: async () => {
        const res = await mintStreamUrlAction(type, name, {
          kind: "logs",
          pod,
          container,
          sinceSeconds: SINCE_SECONDS,
        });
        return "url" in res ? res.url : null;
      },
      events: {
        open: () => setLogMode("live"),
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
          // revision): stop, and let the roster stream move the selection to
          // the replacement rather than chasing a pod that is gone.
          ended = true;
          stream.close();
          const reason = (data as { reason: string }).reason;
          if (/reconnect/i.test(reason)) {
            setLogMode("connecting");
            reconnectTimer = setTimeout(() => {
              setLines([]);
              setReconnectNonce((n) => n + 1);
            }, 1000);
          } else {
            setLogMode("ended");
            setNotice(reason);
          }
        },
        error: (data) => {
          setLogError((data as { message?: string }).message ?? "The log stream failed.");
        },
      },
      onDown: () => {
        if (!ended) setLogMode("polling");
      },
    });
    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stream.close();
    };
  }, [type, name, pod, container, reconnectNonce]);

  // Snapshot polling for the selected pod, only while its stream is down.
  useEffect(() => {
    if (logMode !== "polling" || !pod) return;
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await getPodLogsAction(type, name, pod, { container });
      if (stop) return;
      if ("snapshot" in res) {
        setLogError(null);
        setLines(
          res.snapshot.lines.slice(-MAX_LINES).map((line) => ({ id: nextLineId.current++, line })),
        );
      } else {
        setLogError(res.error);
      }
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [logMode, type, name, pod, container]);

  /* ---- auto-scroll: follow the tail unless the user scrolled up ---- */

  const logRef = useRef<HTMLPreElement>(null);
  const pinnedRef = useRef(true);
  useEffect(() => {
    const el = logRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const selected: PodInfo | undefined = roster?.pods.find((p) => p.pod === pod);

  // One state chip for the whole tab: the log stream's state wins while a pod
  // is followed; before that it reflects how the roster is being read.
  const indicator =
    logMode === "live"
      ? { cls: "live", label: "following" }
      : logMode === "polling"
        ? { cls: "polling", label: "polling" }
        : logMode === "ended"
          ? { cls: "ended", label: "ended" }
          : rosterMode === "polling"
            ? { cls: "polling", label: "polling" }
            : { cls: "connecting", label: "connecting…" };

  return (
    <div className="stack">
      <form
        className="logs-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setContainer(containerDraft.trim() || "user-container");
        }}
      >
        <select
          className="input logs-toolbar__pod"
          value={pod}
          onChange={(e) => setChosenPod(e.target.value)}
          aria-label="Pod"
          disabled={!roster || roster.pods.length === 0}
        >
          {(!roster || roster.pods.length === 0) && <option value="">No running pods</option>}
          {roster?.pods.map((p) => (
            <option key={p.pod} value={p.pod}>
              {p.pod}
              {p.ready ? "" : ` (${p.phase}, not ready)`}
            </option>
          ))}
        </select>
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
        <span className={`live-dot live-dot--${indicator.cls}`}>{indicator.label}</span>
      </form>

      {roster && (
        <p className="text-muted">
          Pods on site <strong>{roster.site}</strong>
          {selected && (
            <>
              {" "}
              · revision {selected.revision ?? "—"} · {selected.phase}
              {selected.restarts > 0 && ` · ${selected.restarts} restarts`}
              {selected.usage?.cpu && ` · ${selected.usage.cpu} CPU`}
              {selected.usage?.memory && ` · ${selected.usage.memory} memory`}
            </>
          )}
          . A scaled-to-zero workload has no pods; logs reach back only as far as the node keeps
          them.
        </p>
      )}

      {notice && <div className="notice">{notice}</div>}
      {rosterError && (
        <div className="notice notice--error">Could not read the pod roster: {rosterError}</div>
      )}
      {logError && <div className="notice notice--error">{logError}</div>}

      {!pod ? (
        <div className="notice">
          {roster
            ? "No running pods to read logs from."
            : "Waiting for the pod roster from the API…"}
        </div>
      ) : (
        <pre
          ref={logRef}
          className="code-block code-block--logs"
          onScroll={(e) => {
            const el = e.currentTarget;
            pinnedRef.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 32;
          }}
        >
          {lines.length === 0
            ? logMode === "connecting"
              ? "Waiting for log lines…"
              : "(no log lines yet)"
            : lines.map(({ id, line }) => (
                <span key={id} className="log-line">
                  {line.time && <span className="log-line__time">{fmtTime(line.time)} </span>}
                  {line.message}
                  {"\n"}
                </span>
              ))}
        </pre>
      )}
    </div>
  );
}
