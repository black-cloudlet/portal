import Link from "next/link";

import ApiErrorNotice from "@/components/ApiErrorNotice";
import AutoRefresh from "@/components/AutoRefresh";
import DeleteWorkloadButton from "@/components/DeleteWorkloadButton";
import Icon from "@/components/Icon";
import LogsToolbar from "@/components/LogsToolbar";
import StatusPill from "@/components/StatusPill";
import WorkloadDetailTabs, { type DetailTab } from "@/components/WorkloadDetailTabs";
import { isNotFound, withinCreateGrace } from "@/lib/pending-create";
import {
  getWorkload,
  getWorkloadLogs,
  getWorkloadStats,
  typeSegment,
  type ResourceUsage,
  type WorkloadDetail as WorkloadDetailData,
  type WorkloadType,
} from "@/lib/serverless";
import { getServerlessContext } from "@/lib/serverless-context";

/** Statuses that are still settling; while in one of these we auto-refresh. */
const PENDING_STATUSES = new Set(["Pending", "Building", "Deploying", "Terminating"]);
const TAB_IDS: DetailTab[] = [
  "status",
  "metrics",
  "variables",
  "secrets",
  "files",
  "advanced",
  "logs",
];

/**
 * Some log sources hand back their text with escaped newline sequences (a
 * literal "\n" rather than a real line break), which collapses the whole log
 * onto one line. Turn escaped CR/LF sequences — and any real CRLF — into plain
 * "\n" so the <pre> lays the log out one entry per line.
 */
function normalizeLogText(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(/\\r\\n|\\n|\\r/g, "\n");
}

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
 * metadata strip, and the Status / Metrics / Variables / Secrets / Files /
 * Advanced / Logs tabs. Server-rendered per request; auto-refreshes while still
 * deploying.
 */
export default async function WorkloadDetail({
  type,
  name,
  tab,
  container,
  created,
}: {
  type: WorkloadType;
  name: string;
  tab?: string;
  container?: string;
  /** Epoch ms the create was accepted, carried by the post-create redirect. */
  created?: string;
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
    // A just-accepted workload the platform hasn't created yet is a race, not a
    // failure - so wait it out and poll instead of showing the user a red error
    // for the workload they just created. Anything else (and anything past the
    // window) is the API's own error, shown as such.
    const provisioning = isNotFound(err) && withinCreateGrace(created);
    return (
      <div className="detail">
        <div className="detail__bar">
          <Link className="backlink" href={`/serverless/${seg}`}>
            <Icon name="arrow-left" size={14} />
            Back to {seg}
          </Link>
        </div>
        {provisioning ? (
          <ProvisioningPanel type={type} name={name} />
        ) : (
          <ApiErrorNotice error={err} />
        )}
      </div>
    );
  }

  const activeTab: DetailTab = TAB_IDS.includes(tab as DetailTab) ? (tab as DetailTab) : "status";

  return (
    <div className="detail">
      <AutoRefresh intervalMs={PENDING_STATUSES.has(wl.overallStatus) ? 5000 : 15000} />

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
      {activeTab === "metrics" && (
        <MetricsPanel type={type} group={activeGroup} name={name} accessToken={accessToken} />
      )}
      {activeTab === "variables" && <VariablesPanel wl={wl} />}
      {activeTab === "secrets" && <SecretsPanel wl={wl} />}
      {activeTab === "files" && <FilesPanel wl={wl} />}
      {activeTab === "advanced" && <AdvancedPanel wl={wl} />}
      {activeTab === "logs" && (
        <LogsPanel
          type={type}
          group={activeGroup}
          name={name}
          accessToken={accessToken}
          container={container}
        />
      )}
    </div>
  );
}

/**
 * Stand-in for a workload the API has accepted but not created yet, shown in
 * place of the NOT_FOUND error inside the create grace window. Polls faster than
 * the settled view: what it's waiting for lands within seconds, and the moment it
 * does this whole branch is gone and the real detail view renders.
 */
function ProvisioningPanel({ type, name }: { type: WorkloadType; name: string }) {
  return (
    <>
      <AutoRefresh intervalMs={3000} />
      <div className="detail__head">
        <div>
          <h2 className="detail__title">
            {name} <StatusPill status="Pending" />
          </h2>
        </div>
      </div>
      <div className="notice">
        This {type} was accepted and is being created. This page refreshes on its own and shows it
        as soon as the platform has it.
      </div>
    </>
  );
}

/** Source (image/git) plus per-site deploy/health status and any error. */
function StatusPanel({ wl }: { wl: WorkloadDetailData }) {
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
                <dt>Version</dt>
                <dd>{wl.version ?? "default"}</dd>
              </div>
              <div>
                <dt>Git repo</dt>
                <dd>{wl.gitRepo ?? "—"}</dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd>{wl.branch ?? "—"}</dd>
              </div>
              <div>
                <dt>Path</dt>
                <dd>{wl.path ? <code>{wl.path}</code> : "root"}</dd>
              </div>
              <div>
                <dt>Port</dt>
                <dd>{wl.port ?? "default"}</dd>
              </div>
              {wl.build && (
                <div>
                  <dt>Build</dt>
                  <dd>
                    <StatusPill status={wl.build.state} />
                    {wl.build.message ? (
                      <span className="text-error"> {wl.build.message}</span>
                    ) : null}
                  </dd>
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <dt>Image</dt>
                <dd>{wl.image ?? "—"}</dd>
              </div>
              <div>
                <dt>Port</dt>
                <dd>{wl.port ?? "default"}</dd>
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
        <h3 className="section-title">Sites</h3>
        {wl.sites.length === 0 ? (
          <div className="notice">No per-site status yet.</div>
        ) : (
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
        )}
      </section>
    </div>
  );
}

/** Non-secret environment variables. */
function VariablesPanel({ wl }: { wl: WorkloadDetailData }) {
  const vars = wl.env.filter((e) => !e.secret);
  if (vars.length === 0) return <div className="notice">No environment variables.</div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {vars.map((e) => (
            <tr key={e.name}>
              <td className="table__name">{e.name}</td>
              <td>
                <code>{e.value}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Secret environment variables (names only; values are never returned). */
function SecretsPanel({ wl }: { wl: WorkloadDetailData }) {
  const secretVars = wl.env.filter((e) => e.secret);
  if (secretVars.length === 0) return <div className="notice">No secrets.</div>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {secretVars.map((e) => (
            <tr key={e.name}>
              <td className="table__name">{e.name}</td>
              <td>
                <span className="pill pill--muted">secret set</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Mounted files (secret and non-secret); secret contents are redacted. */
function FilesPanel({ wl }: { wl: WorkloadDetailData }) {
  if (wl.files.length === 0) return <div className="notice">No mounted files.</div>;
  return (
    <div className="stack">
      {wl.files.map((f) => (
        <div key={f.mountPath} className="file-card">
          <div className="file-card__head">
            <code>{f.mountPath}</code>
            <span className="file-card__tags">
              {f.secret && <span className="pill pill--muted">secret</span>}
              <span className="pill pill--muted">{f.readOnly ? "read-only" : "read-write"}</span>
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
  );
}

/** Desired autoscaling. Live replicas and usage are on the Metrics tab. */
function AdvancedPanel({ wl }: { wl: WorkloadDetailData }) {
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
    </div>
  );
}

/** Render a usage figure, or an em dash when nothing was measured. */
function usageCell(u: ResourceUsage | null, key: "cpu" | "memory") {
  return u?.[key] ?? "—";
}

/**
 * Live resource usage, replica count and status, from the lightweight `/stats`
 * endpoint rather than the full GET - so this tab does not re-read the
 * workload's spec (and its backing Secret) on every refresh.
 */
async function MetricsPanel({
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
  let stats;
  try {
    stats = await getWorkloadStats(type, group, name, accessToken);
  } catch (err) {
    return <ApiErrorNotice error={err} />;
  }

  // The API nulls a total when a site could not be measured, so say which it is
  // rather than showing a dash that reads as "zero".
  const unmeasured = stats.usage == null && stats.sites.some((s) => s.usage != null);

  return (
    <div className="stack">
      <section>
        <h3 className="section-title">Totals</h3>
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

/** Pod log snapshots from the local site. */
async function LogsPanel({
  type,
  group,
  name,
  accessToken,
  container,
}: {
  type: WorkloadType;
  group: string;
  name: string;
  accessToken?: string;
  container?: string;
}) {
  let logs;
  try {
    logs = await getWorkloadLogs(type, group, name, accessToken, { container });
  } catch (err) {
    return (
      <div className="stack">
        <LogsToolbar container={container ?? "user-container"} />
        <ApiErrorNotice error={err} />
      </div>
    );
  }
  return (
    <div className="stack">
      <LogsToolbar container={container ?? "user-container"} />
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
            <pre className="code-block code-block--logs">
              {p.logs ? normalizeLogText(p.logs) : "(empty)"}
            </pre>
          </div>
        ))
      )}
    </div>
  );
}
