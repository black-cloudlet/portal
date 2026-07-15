"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import {
  createWorkloadAction,
  updateWorkloadAction,
  type ActionError,
} from "@/app/(console)/serverless/actions";
import type {
  ContainerCreateInput,
  ContainerUpdateInput,
  EnvVarInput,
  FileInput,
  FunctionCreateInput,
  FunctionUpdateInput,
  PlatformInfo,
  ScalingInput,
  WorkloadDetail,
  WorkloadType,
} from "@/lib/serverless";

type Mode = "create" | "edit";

interface Props {
  mode: Mode;
  type: WorkloadType;
  info: PlatformInfo;
  group: string;
  initial?: WorkloadDetail;
}

/** A blank env/file row for the "add" buttons. */
const emptyEnv = (): EnvVarInput => ({ name: "", value: "", secret: false });
const emptyFile = (): FileInput => ({ mountPath: "", content: "", secret: false, readOnly: true });

/**
 * Create or edit a function/container. Renders the fields for the workload type
 * against the platform capabilities from /info (sizes, runtimes, scaling), and
 * submits via the create/update server actions. On success the action redirects
 * to the workload; API validation errors are shown inline.
 */
export default function WorkloadForm({ mode, type, info, group, initial }: Props) {
  const isFn = type === "function";
  const seg = isFn ? "functions" : "containers";
  const sizes = info.sizes.length ? info.sizes : ["small"];
  const metrics = info.scaling.metrics.map((m) => m.name);
  const defaultMetric = info.scaling.defaultMetric || metrics[0] || "concurrency";

  // Identity / source
  const [name, setName] = useState(initial?.name ?? "");
  const [gitRepo, setGitRepo] = useState(initial?.gitRepo ?? "");
  const [branch, setBranch] = useState(initial?.branch ?? "main");
  const [gitToken, setGitToken] = useState("");
  const [runtime, setRuntime] = useState(initial?.runtime ?? info.runtimes[0] ?? "");
  const [image, setImage] = useState(initial?.image ?? "");
  const [registryUsername, setRegistryUsername] = useState(initial?.registryUsername ?? "");
  const [registryToken, setRegistryToken] = useState("");

  // Common config
  const [size, setSize] = useState(initial?.size ?? sizes[0]);
  const [hostname, setHostname] = useState("");
  const [sites, setSites] = useState<string[]>([]);
  const [env, setEnv] = useState<EnvVarInput[]>(
    initial?.env.map((e) => ({ name: e.name, value: e.value ?? "", secret: e.secret })) ?? [],
  );
  const [files, setFiles] = useState<FileInput[]>(
    initial?.files.map((f) => ({
      mountPath: f.mountPath,
      content: f.content ?? "",
      secret: f.secret,
      readOnly: f.readOnly,
    })) ?? [],
  );

  // Scaling
  const initScale = initial?.scaling;
  const [metric, setMetric] = useState(initScale?.metric ?? defaultMetric);
  const [minScale, setMinScale] = useState(String(initScale?.minScale ?? 0));
  const [maxScale, setMaxScale] = useState(String(initScale?.maxScale ?? 3));
  const [target, setTarget] = useState(initScale?.target != null ? String(initScale.target) : "");
  const [scaleDownDelay, setScaleDownDelay] = useState(initScale?.scaleDownDelay ?? "");

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError | null>(null);

  const hasSecrets =
    (initial?.env.some((e) => e.secret) ?? false) ||
    (initial?.files.some((f) => f.secret) ?? false);

  function buildScaling(): ScalingInput {
    return {
      minScale: Number(minScale),
      maxScale: Number(maxScale),
      metric,
      target: target.trim() === "" ? null : Number(target),
      scaleDownDelay: scaleDownDelay.trim() === "" ? null : scaleDownDelay.trim(),
    };
  }

  function cleanEnv(): EnvVarInput[] {
    return env.filter((e) => e.name.trim() !== "");
  }
  function cleanFiles(): FileInput[] {
    return files.filter((f) => f.mountPath.trim() !== "");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const scaling = buildScaling();
    const common = {
      env: cleanEnv(),
      files: cleanFiles(),
      scaling,
      size,
      hostname: hostname.trim() === "" ? null : hostname.trim(),
    };

    startTransition(async () => {
      let res: ActionError | void;
      if (mode === "create") {
        const sitesVal = sites.length ? sites : null;
        if (isFn) {
          const spec: FunctionCreateInput = {
            name,
            gitRepo,
            branch: branch || "main",
            gitToken,
            runtime,
            sites: sitesVal,
            ...common,
          };
          res = await createWorkloadAction("function", spec);
        } else {
          const spec: ContainerCreateInput = {
            name,
            image,
            registryUsername: registryUsername.trim() || null,
            registryToken: registryToken.trim() || null,
            sites: sitesVal,
            ...common,
          };
          res = await createWorkloadAction("container", spec);
        }
      } else {
        if (isFn) {
          const spec: FunctionUpdateInput = {
            // Send build inputs only when a token is supplied to rebuild.
            gitRepo: gitToken.trim() ? gitRepo || null : null,
            branch: gitToken.trim() ? branch || null : null,
            runtime: gitToken.trim() ? runtime || null : null,
            gitToken: gitToken.trim() || null,
            ...common,
          };
          res = await updateWorkloadAction("function", initial!.name, spec);
        } else {
          const spec: ContainerUpdateInput = {
            image: image.trim() || null,
            registryUsername: registryUsername.trim() || null,
            registryToken: registryToken.trim() || null,
            ...common,
          };
          res = await updateWorkloadAction("container", initial!.name, spec);
        }
      }
      if (res?.error) setError(res);
    });
  }

  const hostPreview =
    hostname.trim() === "" && name.trim() !== ""
      ? info.defaultHostTemplate
          .replace("{name}", name.trim())
          .replace("{group}", group)
          .replace("{routeDomain}", info.routeDomain)
      : null;

  return (
    <form className="form stack" onSubmit={submit}>
      <div className="detail__bar">
        <Link
          className="backlink"
          href={mode === "edit" ? `/serverless/${seg}/${initial!.name}` : `/serverless/${seg}`}
        >
          ← Cancel
        </Link>
      </div>

      <h2 className="detail__title">
        {mode === "create" ? `New ${type}` : `Edit ${initial!.name}`}
      </h2>

      {mode === "edit" && (
        <div className="notice notice--warn">
          Saving replaces the workload&rsquo;s full spec. Secret values are never shown, so
          {hasSecrets
            ? " re-enter any secrets below or they will be cleared."
            : " any secret you add must be entered here."}
          {isFn && " Changing the repo, branch, or runtime requires a git token to rebuild."}
        </div>
      )}

      {/* ---- Identity / source ---- */}
      <section className="stack">
        <h3 className="section-title">{isFn ? "Function source" : "Container image"}</h3>

        {mode === "create" && (
          <label className="field">
            <span className="field__label">Name</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-workload"
              required
            />
            <span className="field__hint">
              Lowercase DNS-1123 label.{" "}
              {hostPreview && (
                <>
                  Host: <code>{hostPreview}</code>
                </>
              )}
            </span>
          </label>
        )}

        {isFn ? (
          <>
            <label className="field">
              <span className="field__label">Git repository</span>
              <input
                className="input"
                value={gitRepo}
                onChange={(e) => setGitRepo(e.target.value)}
                placeholder="https://git.internal/team/app.git"
                required={mode === "create"}
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span className="field__label">Branch</span>
                <input
                  className="input"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field__label">Runtime</span>
                <select
                  className="input"
                  value={runtime}
                  onChange={(e) => setRuntime(e.target.value)}
                >
                  {info.runtimes.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              <span className="field__label">
                Git token{mode === "edit" ? " (only to rebuild)" : ""}
              </span>
              <input
                className="input"
                type="password"
                value={gitToken}
                onChange={(e) => setGitToken(e.target.value)}
                placeholder={mode === "edit" ? "leave blank to keep the current image" : ""}
                required={mode === "create"}
                autoComplete="off"
              />
            </label>
          </>
        ) : (
          <>
            <label className="field">
              <span className="field__label">Image</span>
              <input
                className="input"
                value={image}
                onChange={(e) => setImage(e.target.value)}
                placeholder="registry.internal/team/app:latest"
                required={mode === "create"}
              />
            </label>
            <div className="field-row">
              <label className="field">
                <span className="field__label">Registry username (optional)</span>
                <input
                  className="input"
                  value={registryUsername}
                  onChange={(e) => setRegistryUsername(e.target.value)}
                  autoComplete="off"
                />
              </label>
              <label className="field">
                <span className="field__label">Registry token (optional)</span>
                <input
                  className="input"
                  type="password"
                  value={registryToken}
                  onChange={(e) => setRegistryToken(e.target.value)}
                  placeholder={mode === "edit" ? "leave blank to keep" : ""}
                  autoComplete="off"
                />
              </label>
            </div>
            <span className="field__hint">
              Provide username and token together for a private image, or leave both blank for a
              public one.
            </span>
          </>
        )}
      </section>

      {/* ---- Placement ---- */}
      <section className="stack">
        <h3 className="section-title">Placement</h3>
        <div className="field-row">
          <label className="field">
            <span className="field__label">Size</span>
            <select className="input" value={size} onChange={(e) => setSize(e.target.value)}>
              {sizes.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Custom hostname (optional)</span>
            <input
              className="input"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="defaults to the generated host"
            />
          </label>
        </div>
        {mode === "create" && info.sites.length > 0 && (
          <div className="field">
            <span className="field__label">Sites (none selected = all)</span>
            <div className="checks">
              {info.sites.map((s) => (
                <label key={s} className="check">
                  <input
                    type="checkbox"
                    checked={sites.includes(s)}
                    onChange={(e) =>
                      setSites((prev) =>
                        e.target.checked ? [...prev, s] : prev.filter((x) => x !== s),
                      )
                    }
                  />
                  {s}
                </label>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ---- Environment ---- */}
      <section className="stack">
        <h3 className="section-title">Environment variables</h3>
        {env.map((row, i) => (
          <div key={i} className="kv-row">
            <input
              className="input"
              placeholder="NAME"
              value={row.name}
              onChange={(e) =>
                setEnv((p) => p.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
              }
            />
            <input
              className="input"
              placeholder={row.secret ? "secret value" : "value"}
              type={row.secret ? "password" : "text"}
              value={row.value}
              onChange={(e) =>
                setEnv((p) => p.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
              }
            />
            <label className="check">
              <input
                type="checkbox"
                checked={row.secret}
                onChange={(e) =>
                  setEnv((p) => p.map((r, j) => (j === i ? { ...r, secret: e.target.checked } : r)))
                }
              />
              secret
            </label>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setEnv((p) => p.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setEnv((p) => [...p, emptyEnv()])}
          >
            + Add variable
          </button>
        </div>
      </section>

      {/* ---- Files ---- */}
      <section className="stack">
        <h3 className="section-title">Mounted files</h3>
        {files.map((row, i) => (
          <div key={i} className="file-editor">
            <div className="kv-row">
              <input
                className="input"
                placeholder="/etc/app/config.yaml"
                value={row.mountPath}
                onChange={(e) =>
                  setFiles((p) =>
                    p.map((r, j) => (j === i ? { ...r, mountPath: e.target.value } : r)),
                  )
                }
              />
              <label className="check">
                <input
                  type="checkbox"
                  checked={row.secret}
                  onChange={(e) =>
                    setFiles((p) =>
                      p.map((r, j) => (j === i ? { ...r, secret: e.target.checked } : r)),
                    )
                  }
                />
                secret
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={row.readOnly}
                  onChange={(e) =>
                    setFiles((p) =>
                      p.map((r, j) => (j === i ? { ...r, readOnly: e.target.checked } : r)),
                    )
                  }
                />
                read-only
              </label>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
            <textarea
              className="input textarea"
              placeholder={row.secret ? "secret file content" : "file content"}
              rows={3}
              value={row.content}
              onChange={(e) =>
                setFiles((p) => p.map((r, j) => (j === i ? { ...r, content: e.target.value } : r)))
              }
            />
          </div>
        ))}
        <div>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setFiles((p) => [...p, emptyFile()])}
          >
            + Add file
          </button>
        </div>
      </section>

      {/* ---- Scaling ---- */}
      <section className="stack">
        <h3 className="section-title">Autoscaling</h3>
        <div className="field-row">
          <label className="field">
            <span className="field__label">Metric</span>
            <select className="input" value={metric} onChange={(e) => setMetric(e.target.value)}>
              {metrics.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Target (blank = default)</span>
            <input
              className="input"
              type="number"
              min={1}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span className="field__label">Min replicas</span>
            <input
              className="input"
              type="number"
              min={0}
              value={minScale}
              onChange={(e) => setMinScale(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Max replicas</span>
            <input
              className="input"
              type="number"
              min={1}
              value={maxScale}
              onChange={(e) => setMaxScale(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Scale-down delay</span>
            <input
              className="input"
              value={scaleDownDelay}
              onChange={(e) => setScaleDownDelay(e.target.value)}
              placeholder="e.g. 30s, 5m"
            />
          </label>
        </div>
        <span className="field__hint">
          cpu/memory metrics use the HPA autoscaler and cannot scale to zero (min replicas ≥ 1).
        </span>
      </section>

      {error && (
        <div className="notice notice--error">
          <p>{error.error}</p>
          {(error.code || error.requestId) && (
            <p className="notice__meta">
              {error.code && <span className="notice__code">{error.code}</span>}
              {error.code && error.requestId && " · "}
              {error.requestId && (
                <span>
                  Request ID: <code>{error.requestId}</code>
                </span>
              )}
            </p>
          )}
        </div>
      )}

      <div className="form__actions">
        <button type="submit" className="btn btn--primary" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? `Create ${type}` : "Save changes"}
        </button>
        <Link
          className="btn"
          href={mode === "edit" ? `/serverless/${seg}/${initial!.name}` : `/serverless/${seg}`}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
