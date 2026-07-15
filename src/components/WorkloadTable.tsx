import Link from "next/link";

import StatusPill from "@/components/StatusPill";
import { typeSegment, type WorkloadSummary } from "@/lib/serverless";

/** Show the API's naive local timestamp as-is (no timezone math). */
function fmtDate(v: string | null): string {
  if (!v) return "—";
  return v
    .replace("T", " ")
    .replace(/\.\d+/, "")
    .replace(/(Z|[+-]\d{2}:\d{2})$/, "");
}

/**
 * Presentational table for one workload type (functions OR containers). Each
 * Serverless tab renders this with its own list, so there is no "Type" column -
 * the tab already names the type. The name links to the workload's detail view.
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
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {workloads.map((w) => (
            <tr key={w.name}>
              <td className="table__name">
                <Link
                  className="table__link"
                  href={`/serverless/${typeSegment(w.type)}/${encodeURIComponent(w.name)}`}
                >
                  {w.name}
                </Link>
              </td>
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
              <td>{fmtDate(w.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
