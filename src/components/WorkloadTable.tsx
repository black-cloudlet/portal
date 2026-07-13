import type { WorkloadSummary } from "@/lib/serverless";

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "Ready"
      ? "ok"
      : status === "Failed" || status === "Degraded"
        ? "error"
        : status === "Deploying" || status === "Pending"
          ? "warn"
          : "muted";
  return <span className={`pill pill--${tone}`}>{status}</span>;
}

/**
 * Presentational table for one workload type (functions OR containers). Each
 * Serverless tab renders this with its own list, so there is no "Type" column -
 * the tab already names the type.
 */
export default function WorkloadTable({
  workloads,
  emptyLabel,
}: {
  workloads: WorkloadSummary[];
  emptyLabel: string;
}) {
  if (workloads.length === 0) {
    return <div className="notice">{emptyLabel}</div>;
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Host</th>
            <th>Size</th>
            <th>Sites</th>
          </tr>
        </thead>
        <tbody>
          {workloads.map((w) => (
            <tr key={w.name}>
              <td className="table__name">{w.name}</td>
              <td>
                <StatusPill status={w.overallStatus} />
              </td>
              <td>
                <a href={`https://${w.hostname}`} target="_blank" rel="noreferrer">
                  {w.hostname}
                </a>
              </td>
              <td>{w.size ?? "—"}</td>
              <td>{w.sites.join(", ") || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
