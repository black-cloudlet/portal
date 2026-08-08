"use client";

import { useEffect, useState } from "react";

import { getStatsAction, mintStreamUrlAction } from "@/app/(console)/serverless/actions";
import StatusPill from "@/components/StatusPill";
import { openTicketedStream } from "@/lib/stream";
import type { ResourceUsage, WorkloadStats, WorkloadType } from "@/lib/serverless";

/** Render a usage figure, or an em dash when nothing was measured. */
function usageCell(u: ResourceUsage | null | undefined, key: "cpu" | "memory") {
  return u?.[key] ?? "—";
}

/**
 * The Metrics tab, live. Follows `GET .../{name}/stats/stream` over
 * Server-Sent Events (via a server-minted stream ticket), so one connection
 * replaces the poll loop: status, replicas, and usage update as the API pushes
 * them. When the stream cannot be opened - tickets not configured, or the
 * browser cannot reach the API - it falls back to polling the `/stats`
 * snapshot through a server action, and says which mode it is in.
 */
export default function LiveStats({
  type,
  name,
  initial,
}: {
  type: WorkloadType;
  name: string;
  initial: WorkloadStats;
}) {
  const [stats, setStats] = useState<WorkloadStats>(initial);
  const [mode, setMode] = useState<"connecting" | "live" | "polling">("connecting");

  useEffect(() => {
    const stream = openTicketedStream({
      mint: async () => {
        const res = await mintStreamUrlAction(type, name, { kind: "stats" });
        return "url" in res ? res.url : null;
      },
      events: {
        stats: (data) => {
          setStats(data as WorkloadStats);
          setMode("live");
        },
        // The workload is gone or no site could answer; the reconnect/backoff
        // in the stream helper takes it from here.
        error: () => {},
      },
      onDown: () => setMode("polling"),
    });
    return () => stream.close();
  }, [type, name]);

  // Snapshot polling, only while the stream is down.
  useEffect(() => {
    if (mode !== "polling") return;
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await getStatsAction(type, name);
      if (!stop && "stats" in res) setStats(res.stats);
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [mode, type, name]);

  // The API nulls a total when a site could not be measured, so say which it is
  // rather than showing a dash that reads as "zero".
  const unmeasured = stats.usage == null && stats.sites.some((s) => s.usage != null);

  return (
    <div className="stack">
      <section>
        <div className="section-row">
          <h3 className="section-title">Totals</h3>
          <span className={`live-dot live-dot--${mode}`}>
            {mode === "live" ? "live" : mode === "polling" ? "polling" : "connecting…"}
          </span>
        </div>
        <dl className="meta-grid">
          <div>
            <dt>Status</dt>
            <dd>
              <StatusPill status={stats.overallStatus} />
            </dd>
          </div>
          <div>
            <dt>Replicas</dt>
            <dd>{stats.replicas ?? "—"}</dd>
          </div>
          <div>
            <dt>CPU</dt>
            <dd>{usageCell(stats.usage, "cpu")}</dd>
          </div>
          <div>
            <dt>Memory</dt>
            <dd>{usageCell(stats.usage, "memory")}</dd>
          </div>
        </dl>
        {unmeasured && (
          <p className="text-muted">
            A site could not be measured, so the totals are not shown - a figure missing a whole
            site would understate the workload. The per-site rows below show what did report.
          </p>
        )}
      </section>

      <section>
        <h3 className="section-title">Per site</h3>
        {stats.sites.length === 0 ? (
          <div className="notice">No running sites.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Status</th>
                  <th>Replicas</th>
                  <th>CPU</th>
                  <th>Memory</th>
                </tr>
              </thead>
              <tbody>
                {stats.sites.map((s) => (
                  <tr key={s.site}>
                    <td>{s.site}</td>
                    <td>
                      <StatusPill status={s.status} />
                    </td>
                    <td>{s.replicas ?? "—"}</td>
                    <td>{usageCell(s.usage, "cpu")}</td>
                    <td>{usageCell(s.usage, "memory")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-muted">
          Usage covers each pod&apos;s own container, not the platform sidecar, and is blank while a
          workload is scaled to zero. It is never fresher than the cluster&apos;s metrics scrape.
        </p>
      </section>
    </div>
  );
}
