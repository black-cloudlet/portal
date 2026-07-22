"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

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
 * the tab already names the type. The whole row links to the workload's detail
 * view (the name is also a plain link for right-click / open-in-new-tab), while
 * the hostname stays a separate outbound link.
 */
export default function WorkloadTable({
  workloads,
  emptyLabel,
}: {
  workloads: WorkloadSummary[];
  emptyLabel: string;
}) {
  const router = useRouter();

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
          {workloads.map((w) => {
            const href = `/serverless/${typeSegment(w.type)}/${encodeURIComponent(w.name)}`;
            return (
              <tr
                key={w.name}
                className="table__row"
                onClick={() => router.push(href)}
                role="link"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") router.push(href);
                }}
              >
                <td className="table__name">
                  <Link className="table__link" href={href} onClick={(e) => e.stopPropagation()}>
                    {w.name}
                  </Link>
                </td>
                <td>
                  <StatusPill status={w.overallStatus} />
                </td>
                <td>
                  <a
                    href={`https://${w.hostname}`}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {w.hostname}
                  </a>
                </td>
                <td>{w.size ?? "—"}</td>
                <td>{w.sites.join(", ") || "—"}</td>
                <td>{fmtDate(w.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
