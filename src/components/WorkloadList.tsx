"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";

import AutoRefresh from "@/components/AutoRefresh";
import Icon from "@/components/Icon";
import StatusPill from "@/components/StatusPill";
import {
  isTerminalStatus,
  typeSegment,
  type WorkloadSummary,
  type WorkloadType,
} from "@/lib/serverless";

/** Show the API's naive local timestamp as-is (no timezone math). */
function fmtDate(v: string | null): string {
  if (!v) return "—";
  return v
    .replace("T", " ")
    .replace(/\.\d+/, "")
    .replace(/(Z|[+-]\d{2}:\d{2})$/, "");
}

type View = "grid" | "list";
type Sort = "name" | "createdAt";

/**
 * The workload browser for one offering type (functions OR containers): a
 * toolbar (grid/list view toggle, search, sort) over a searchable set of cards
 * or rows. Purely client-side over the already-fetched summaries, so filtering,
 * sorting, and switching views never round-trips. Every card/row links to the
 * workload's detail view; the fields shown are the ones the list endpoint
 * returns (status, size, regions, created) plus the outbound host.
 */
export default function WorkloadList({
  workloads,
  type,
  emptyLabel,
  toolbarRight,
}: {
  workloads: WorkloadSummary[];
  type: WorkloadType;
  emptyLabel: string;
  toolbarRight?: ReactNode;
}) {
  const router = useRouter();
  const [view, setView] = useState<View>("grid");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("name");

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? workloads.filter((w) => w.name.toLowerCase().includes(q)) : workloads;
    const sorted = [...filtered].sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name)
        : (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
    );
    return sorted;
  }, [workloads, query, sort]);

  const label = type === "function" ? "function" : "container";

  // While anything on the list is still settling (not Ready/Failed), poll fast
  // so a just-created workload's progress shows up within seconds.
  const settling = workloads.some((w) => !isTerminalStatus(w.status));

  return (
    <div className="stack">
      {/* Keep the list fresh (new workloads, status changes) without a manual reload. */}
      <AutoRefresh intervalMs={settling ? 3000 : 15000} />
      <div className="listbar">
        <div className="listbar__views" role="group" aria-label="View">
          <button
            type="button"
            className={`viewbtn ${view === "list" ? "viewbtn--active" : ""}`}
            aria-label="List view"
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            <Icon name="list" size={18} />
          </button>
          <button
            type="button"
            className={`viewbtn ${view === "grid" ? "viewbtn--active" : ""}`}
            aria-label="Grid view"
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
          >
            <Icon name="grid" size={18} />
          </button>
        </div>

        <label className="searchbox">
          <Icon name="search" size={16} className="searchbox__icon" />
          <input
            className="searchbox__input"
            type="search"
            placeholder={`Search ${label}s…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        <label className="listbar__sort">
          <span className="text-muted">Sort</span>
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="name">Name</option>
            <option value="createdAt">Newest</option>
          </select>
        </label>

        {toolbarRight && <div className="listbar__right">{toolbarRight}</div>}
      </div>

      {shown.length === 0 ? (
        <div className="notice">
          {query.trim() ? `No ${label}s match “${query.trim()}”.` : emptyLabel}
        </div>
      ) : view === "grid" ? (
        <div className="wl-grid">
          {shown.map((w) => {
            const href = `/serverless/${typeSegment(w.type)}/${encodeURIComponent(w.name)}`;
            return (
              <Link key={w.name} href={href} className="wl-card">
                <div className="wl-card__head">
                  <span className="wl-card__name">{w.name}</span>
                  <StatusPill status={w.status} />
                </div>
                <a
                  className="wl-card__host"
                  href={`https://${w.hostname}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {w.hostname}
                </a>
                <dl className="wl-card__meta">
                  <div>
                    <dt>Size</dt>
                    <dd>{w.size ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Regions</dt>
                    <dd>{w.regions.join(", ") || "All"}</dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>{fmtDate(w.createdAt)}</dd>
                  </div>
                </dl>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Host</th>
                <th>Size</th>
                <th>Regions</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((w) => {
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
                      <Link
                        className="table__link"
                        href={href}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {w.name}
                      </Link>
                    </td>
                    <td>
                      <StatusPill status={w.status} />
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
                    <td>{w.regions.join(", ") || "All"}</td>
                    <td>{fmtDate(w.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
