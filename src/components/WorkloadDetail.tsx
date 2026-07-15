import Link from "next/link";

import ApiErrorNotice from "@/components/ApiErrorNotice";
import AutoRefresh from "@/components/AutoRefresh";
import DeleteWorkloadButton from "@/components/DeleteWorkloadButton";
import StatusPill from "@/components/StatusPill";
import WorkloadDetailTabs, { type DetailTab } from "@/components/WorkloadDetailTabs";
import {
  getWorkload,
  getWorkloadLogs,
  typeSegment,
  type WorkloadDetail as WorkloadDetailData,
  type WorkloadType,
} from "@/lib/serverless";
import { getServerlessContext } from "@/lib/serverless-context";

/** Statuses that are still settling; while in one of these we auto-refresh. */
const PENDING_STATUSES = new Set(["Pending", "Deploying", "Terminating"]);
const TAB_IDS: DetailTab[] = ["status", "config", "scaling", "logs"];

/** Show the API's naive local timestamp as-is (no timezone math). */
function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  return v
    .replace("T", " ")
    .replace(/\.\d+/, "")
    .replace(/(Z|[+-]\d{2}:\d{2})$/, "");
}

/**
 * The workload detail view: a header with status and Edit/Delete actions, a
 * metadata strip, and the Status / Config / Scaling / Logs tabs. Server-rendered
 * per request; auto-refreshes while the workload is still deploying.
 */
export default async function WorkloadDetail({
  type,
  name,
  tab,
}: {
  type: WorkloadType;
  name: string;
  tab?: string;
}) {
  const { enabled, activeGroup, accessToken } = await getServerlessContext();
  const seg = typeSegment(type);

  if (!enabled) {
    return <div className="notice notice--warn">The Serverless API address is not configured.</div>;
  }
  if (!activeGroup) {
    return <div className="notice notice--warn">You have no active group.</div>;
  }

  let wl: WorkloadDetailData;
  try {
    wl = await getWorkload(type, activeGroup, name, accessToken);
  } catch (err) {
    return (
      <div className="detail">
        <div className="detail__bar">
          <Link className="backlink" href={`/serverless/${seg}`}>
            ← Back to {seg}
          </Link>
        </div>
        <ApiErrorNotice error={err} />
      </div>
    );
  }

  const activeTab: DetailTab = TAB_IDS.includes(tab as DetailTab) ? (tab as DetailTab) : "status";

  return (
    <div className="detail">
      <AutoRefresh active={PENDING_STATUSES.has(wl.overallStatus)} />

      <div className="detail__bar">
        <Link className="backlink" href={`/serverless/${seg}`}>
          ← Back to {seg}
        </Link>
      </div>

      <div className="detail__head">
        <div>
          <h2 className="detail__title">
            {wl.name} <StatusPill status={wl.overallStatus} />
          </h2>
          <p className="detail__sub">
            <a href={`https://${wl.hostname}`} target="_blank" rel="noreferrer">
              {wl.hostname}
            </a>
          </p>
        </div>
        <div className="detail__actions">
          <Link className="btn" href={`/serverless/${seg}/${encodeURIComponent(wl.name)}/edit`}>
            Edit
          </Link>
          <DeleteWorkloadButton type={type} name={wl.name} />
        </div>
      </div>

      <dl className="meta-grid">
        <div>
          <dt>Group</dt>
          <dd>{wl.group}</dd>
        </div>
        <div>
          <dt>Type</dt>
          <dd>{wl.type}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{wl.size ?? "—"}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{fmtDate(wl.createdAt)}</dd>
        </div>
      </dl>

      <WorkloadDetailTabs active={activeTab} />

      {activeTab === "status" && <StatusPanel wl={wl} />}
      {activeTab === "config" && <ConfigPanel wl={wl} />}
      {activeTab === "scaling" && <ScalingPanel wl={wl} />}
      {activeTab === "logs" && (
        <LogsPanel type={type} group={activeGroup} name={name} accessToken={accessToken} />
      )}
    </div>
  );
}

/** Per-site deploy/health status and any error. */
function StatusPanel({ wl }: { wl: WorkloadDetailData }) {
  if (wl.sites.length === 0) {
    return <div className="notice">No per-site status yet.</div>;
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Site</th>
            <th>Status</th>
            <th>Revision</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {wl.sites.map((s) => (
            <tr key={s.site}>
              <td>{s.site}</td>
              <td>
                <StatusPill status={s.status} />
              </td>
              <td>{s.revision ?? "—"}</td>
              <td>{s.error ? <span className="text-error">{s.error}</span> : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Source (image/git), environment variables, and mounted files. */
function ConfigPanel({ wl }: { wl: WorkloadDetailData }) {
  return (
    <div className="stack">
      <section>
        <h3 className="section-title">Source</h3>
        <dl className="meta-grid">
          {wl.type === "function" ? (
            <>
              <div>
                <dt>Runtime</dt>
                <dd>{wl.runtime ?? "—"}</dd>
              </div>
              <div>
                <dt>Git repo</dt>
                <dd>{wl.gitRepo ?? "—"}</dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd>{wl.branch ?? "—"}</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt>Image</dt>
                <dd>{wl.image ?? "—"}</dd>
              </div>
              <div>
                <dt>Registry user</dt>
                <dd>{wl.registryUsername ?? "— (public)"}</dd>
              </div>
            </>
          )}
        </dl>
      </section>

      <section>
        <h3 className="section-title">Environment</h3>
        {wl.env.length === 0 ? (
          <div className="notice">No environment variables.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {wl.env.map((e) => (
                  <tr key={e.name}>
                    <td className="table__name">{e.name}</td>
                    <td>
                      {e.secret ? (
                        <span className="pill pill--muted">secret</span>
                      ) : (
                        <code>{e.value}</code>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h3 className="section-title">Files</h3>
        {wl.files.length === 0 ? (
          <div className="notice">No mounted files.</div>
        ) : (
          <div className="stack">
            {wl.files.map((f) => (
              <div key={f.mountPath} className="file-card">
                <div className="file-card__head">
                  <code>{f.mountPath}</code>
                  <span className="file-card__tags">
                    {f.secret && <span className="pill pill--muted">secret</span>}
                    <span className="pill pill--muted">
                      {f.readOnly ? "read-only" : "read-write"}
                    </span>
                  </span>
                </div>
                {f.secret ? (
                  <p className="text-muted">Secret content is not shown.</p>
                ) : f.content != null ? (
                  <pre className="code-block">{f.content}</pre>
                ) : (
                  <p className="text-muted">No content.</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Desired autoscaling and current per-site replicas / live usage. */
function ScalingPanel({ wl }: { wl: WorkloadDetailData }) {
  const sc = wl.scaling;
  return (
    <div className="stack">
      <section>
        <h3 className="section-title">Autoscaling</h3>
        {sc ? (
          <dl className="meta-grid">
            <div>
              <dt>Metric</dt>
              <dd>{sc.metric}</dd>
            </div>
            <div>
              <dt>Target</dt>
              <dd>{sc.target ?? "default"}</dd>
            </div>
            <div>
              <dt>Min replicas</dt>
              <dd>{sc.minScale}</dd>
            </div>
            <div>
              <dt>Max replicas</dt>
              <dd>{sc.maxScale}</dd>
            </div>
            <div>
              <dt>Scale-down delay</dt>
              <dd>{sc.scaleDownDelay ?? "default"}</dd>
            </div>
          </dl>
        ) : (
          <div className="notice">No scaling configuration.</div>
        )}
      </section>

      <section>
        <h3 className="section-title">Live capacity</h3>
        {wl.sites.length === 0 ? (
          <div className="notice">No running sites.</div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Site</th>
                  <th>Replicas</th>
                  <th>CPU</th>
                  <th>Memory</th>
                </tr>
              </thead>
              <tbody>
                {wl.sites.map((s) => (
                  <tr key={s.site}>
                    <td>{s.site}</td>
                    <td>{s.replicas ?? "—"}</td>
                    <td>{s.usage?.cpu ?? "—"}</td>
                    <td>{s.usage?.memory ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** Pod log snapshots from the local site. */
async function LogsPanel({
  type,
  group,
  name,
  accessToken,
}: {
  type: WorkloadType;
  group: string;
  name: string;
  accessToken?: string;
}) {
  let logs;
  try {
    logs = await getWorkloadLogs(type, group, name, accessToken);
  } catch (err) {
    return <ApiErrorNotice error={err} />;
  }
  return (
    <div className="stack">
      <p className="text-muted">
        Point-in-time snapshot from site <strong>{logs.site}</strong>. A scaled-to-zero workload has
        no pods.
      </p>
      {logs.pods.length === 0 ? (
        <div className="notice">No running pods to read logs from.</div>
      ) : (
        logs.pods.map((p) => (
          <div key={p.pod} className="file-card">
            <div className="file-card__head">
              <code>{p.pod}</code>
              <span className="file-card__tags">
                <span className="pill pill--muted">{p.container}</span>
                {p.revision && <span className="pill pill--muted">{p.revision}</span>}
              </span>
            </div>
            <pre className="code-block code-block--logs">{p.logs || "(empty)"}</pre>
          </div>
        ))
      )}
    </div>
  );
}
