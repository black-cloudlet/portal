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
  FunctionCreateInput,
  FunctionUpdateInput,
  PlatformInfo,
  ScalingInput,
  WorkloadDetail,
  WorkloadType,
} from "@/lib/serverless";
import {
  buildEnvList,
  buildFileList,
  RESERVED_WORKLOAD_NAMES,
  type EnvRow,
  type FileRow,
  type SecretRow,
} from "@/lib/workload-spec";

type Mode = "create" | "edit";

interface Props {
  mode: Mode;
  type: WorkloadType;
  info: PlatformInfo;
  group: string;
  initial?: WorkloadDetail;
  /**
   * "page" (default) renders the form as a standalone screen with its own back
   * link and title. "modal" drops those chrome bits (the dialog supplies its own
   * header) and turns Cancel into a close callback instead of a navigation.
   */
  variant?: "page" | "modal";
  /** Called by Cancel in the modal variant. */
  onClose?: () => void;
}

const FORM_TABS = [
  { id: "general", label: "General" },
  { id: "variables", label: "Variables" },
  { id: "secrets", label: "Secrets" },
  { id: "files", label: "Files" },
  { id: "advanced", label: "Advanced" },
] as const;
type FormTab = (typeof FORM_TABS)[number]["id"];

/**
 * Create or edit a function/container, organized into tabs (General, Variables,
 * Secrets, Files, Advanced) driven by the platform capabilities from /info.
 *
 * Edit follows the API's keep-on-write contract: a secret left blank keeps its
 * stored value, a value entered changes it, and dropping a row removes it. The
 * function git token is stored server-side, so it is only sent to rotate it; the
 * container registry token is kept when the username is echoed without a token.
 */
export default function WorkloadForm({
  mode,
  type,
  info,
  group,
  initial,
  variant = "page",
  onClose,
}: Props) {
  const isModal = variant === "modal";
  const isFn = type === "function";
  const seg = isFn ? "functions" : "containers";
  const isEdit = mode === "edit";
  const sizes = info.sizes.length ? info.sizes : ["small"];
  const metrics = info.scaling.metrics.map((m) => m.name);
  const defaultMetric = info.scaling.defaultMetric || metrics[0] || "concurrency";

  const [tab, setTab] = useState<FormTab>("general");

  // Identity / source
  const [name, setName] = useState(initial?.name ?? "");
  const [gitRepo, setGitRepo] = useState(initial?.gitRepo ?? "");
  const [branch, setBranch] = useState(initial?.branch ?? "main");
  const [gitToken, setGitToken] = useState("");
  const [runtime, setRuntime] = useState(initial?.runtime ?? info.runtimes[0] ?? "");
  const [image, setImage] = useState(initial?.image ?? "");
  const [registryUsername, setRegistryUsername] = useState(initial?.registryUsername ?? "");
  const [registryToken, setRegistryToken] = useState("");

  // Variables (non-secret env) and Secrets (secret env) as separate lists.
  const [variables, setVariables] = useState<EnvRow[]>(
    initial?.env.filter((e) => !e.secret).map((e) => ({ name: e.name, value: e.value ?? "" })) ??
      [],
  );
  const [secrets, setSecrets] = useState<SecretRow[]>(
    initial?.env
      .filter((e) => e.secret)
      .map((e) => ({ name: e.name, value: "", existing: true })) ?? [],
  );
  const [files, setFiles] = useState<FileRow[]>(
    initial?.files.map((f) => ({
      mountPath: f.mountPath,
      content: f.content ?? "",
      secret: f.secret,
      readOnly: f.readOnly,
      existing: true,
    })) ?? [],
  );

  // Advanced: placement + scaling
  const [size, setSize] = useState(initial?.size ?? sizes[0]);
  // Prefill the effective host on edit so saving doesn't reset a custom hostname
  // (PUT is a full replace; a blank hostname would recompute the default).
  const [hostname, setHostname] = useState(initial?.hostname ?? "");
  const [sites, setSites] = useState<string[]>([]);
  const initScale = initial?.scaling;
  const [metric, setMetric] = useState(initScale?.metric ?? defaultMetric);
  const [minScale, setMinScale] = useState(String(initScale?.minScale ?? 0));
  const [maxScale, setMaxScale] = useState(String(initScale?.maxScale ?? 3));
  const [target, setTarget] = useState(initScale?.target != null ? String(initScale.target) : "");
  const [scaleDownDelay, setScaleDownDelay] = useState(initScale?.scaleDownDelay ?? "");

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError | null>(null);

  /**
   * Read a picked local file's text into a file row's content, defaulting the
   * mount path to `/etc/<filename>` when the row doesn't have one yet.
   */
  function loadFileInto(index: number, file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      setFiles((p) =>
        p.map((r, j) =>
          j === index
            ? { ...r, content: text, mountPath: r.mountPath.trim() || `/etc/${file.name}` }
            : r,
        ),
      );
    };
    reader.readAsText(file);
  }

  function buildScaling(): ScalingInput {
    return {
      minScale: Number(minScale),
      maxScale: Number(maxScale),
      metric,
      target: target.trim() === "" ? null : Number(target),
      scaleDownDelay: scaleDownDelay.trim() === "" ? null : scaleDownDelay.trim(),
    };
  }

  /** Client-side checks that mirror the API's required fields. */
  function validate(): { tab: FormTab; message: string } | null {
    if (mode === "create" && name.trim() === "")
      return { tab: "general", message: "Name is required." };
    if (mode === "create" && RESERVED_WORKLOAD_NAMES.includes(name.trim()))
      return { tab: "general", message: `"${name.trim()}" is a reserved name; choose another.` };
    if (isFn) {
      if (mode === "create") {
        if (gitRepo.trim() === "")
          return { tab: "general", message: "Git repository is required." };
        if (gitToken.trim() === "") return { tab: "general", message: "Git token is required." };
      }
    } else {
      if (mode === "create" && image.trim() === "")
        return { tab: "general", message: "Image is required." };
      const hasUser = registryUsername.trim() !== "";
      const hasToken = registryToken.trim() !== "";
      // A token always needs a username; on create the two are all-or-nothing
      // (username-only "keep" only makes sense against an existing pull secret).
      if (hasToken && !hasUser)
        return { tab: "general", message: "A registry token needs a username." };
      if (mode === "create" && hasUser && !hasToken)
        return {
          tab: "general",
          message: "Provide a registry token with the username, or leave both blank.",
        };
    }
    for (const s of secrets) {
      if (s.name.trim() !== "" && s.value.trim() === "" && !(isEdit && s.existing))
        return { tab: "secrets", message: `Secret "${s.name}" needs a value.` };
    }
    for (const f of files) {
      if (
        f.mountPath.trim() !== "" &&
        f.secret &&
        f.content.trim() === "" &&
        !(isEdit && f.existing)
      )
        return { tab: "files", message: `Secret file "${f.mountPath}" needs content.` };
    }
    return null;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const problem = validate();
    if (problem) {
      setTab(problem.tab);
      setError({ error: problem.message });
      return;
    }

    const common = {
      env: buildEnvList(variables, secrets, isEdit),
      files: buildFileList(files, isEdit),
      scaling: buildScaling(),
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
      } else if (isFn) {
        const spec: FunctionUpdateInput = {
          // Build inputs are always sent (unchanged values are a no-op); the
          // stored git token rebuilds on a change. A token is sent only to rotate.
          gitRepo: gitRepo || null,
          branch: branch || null,
          runtime: runtime || null,
          gitToken: gitToken.trim() || null,
          ...common,
        };
        res = await updateWorkloadAction("function", initial!.name, spec);
      } else {
        const spec: ContainerUpdateInput = {
          // Registry: username+token rotates, username-only keeps, neither removes.
          image: image.trim() || null,
          registryUsername: registryUsername.trim() || null,
          registryToken: registryToken.trim() || null,
          ...common,
        };
        res = await updateWorkloadAction("container", initial!.name, spec);
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

  const cancelHref = isEdit ? `/serverless/${seg}/${initial!.name}` : `/serverless/${seg}`;

  return (
    <form className="form stack" onSubmit={submit}>
      {!isModal && (
        <>
          <div className="detail__bar">
            <Link className="backlink" href={cancelHref}>
              ← Cancel
            </Link>
          </div>

          <h2 className="detail__title">
            {mode === "create" ? `New ${type}` : `Edit ${initial!.name}`}
          </h2>
        </>
      )}

      {isEdit && (
        <div className="notice notice--warn">
          A secret left blank keeps its stored value — enter a value to change it, or remove the row
          to delete it.
          {isFn
            ? " Leave the git token blank to keep the stored one, or enter one to rotate it; changing the repo, branch, or runtime rebuilds with the stored token."
            : " Leave the registry token blank to keep it, or clear the username to remove the pull secret."}
        </div>
      )}

      <nav className="form-tabs" aria-label="Form sections">
        {FORM_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`form-tab${t.id === tab ? " form-tab--active" : ""}`}
            aria-current={t.id === tab ? "true" : undefined}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* ---- General ---- */}
      <div className="form-panel stack" hidden={tab !== "general"}>
        {mode === "create" && (
          <label className="field">
            <span className="field__label">Name</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-workload"
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
              <span className="field__label">Git token{isEdit ? " (only to rotate)" : ""}</span>
              <input
                className="input"
                type="password"
                value={gitToken}
                onChange={(e) => setGitToken(e.target.value)}
                placeholder={isEdit ? "leave blank to keep the stored token" : ""}
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
                <span className="field__label">
                  Registry token{isEdit ? " (only to rotate)" : ""}
                </span>
                <input
                  className="input"
                  type="password"
                  value={registryToken}
                  onChange={(e) => setRegistryToken(e.target.value)}
                  placeholder={isEdit ? "leave blank to keep" : ""}
                  autoComplete="off"
                />
              </label>
            </div>
            <span className="field__hint">
              {isEdit
                ? "Username + token rotates the pull secret; username alone keeps it; clearing both removes it."
                : "Provide username and token together for a private image, or leave both blank for a public one."}
            </span>
          </>
        )}
      </div>

      {/* ---- Variables (non-secret env) ---- */}
      <div className="form-panel stack" hidden={tab !== "variables"}>
        <p className="field__hint">Plain environment variables, stored inline on the workload.</p>
        {variables.map((row, i) => (
          <div key={i} className="kv-row">
            <input
              className="input"
              placeholder="NAME"
              value={row.name}
              onChange={(e) =>
                setVariables((p) => p.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
              }
            />
            <input
              className="input"
              placeholder="value"
              value={row.value}
              onChange={(e) =>
                setVariables((p) =>
                  p.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)),
                )
              }
            />
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setVariables((p) => p.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setVariables((p) => [...p, { name: "", value: "" }])}
          >
            + Add variable
          </button>
        </div>
      </div>

      {/* ---- Secrets (secret env) ---- */}
      <div className="form-panel stack" hidden={tab !== "secrets"}>
        <p className="field__hint">
          Secret environment variables, stored in a Kubernetes Secret and never shown after saving.
          {isEdit && " Leave a value blank to keep the stored secret."}
        </p>
        {secrets.map((row, i) => (
          <div key={i} className="kv-row">
            <input
              className="input"
              placeholder="NAME"
              value={row.name}
              onChange={(e) =>
                setSecrets((p) => p.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))
              }
            />
            <input
              className="input"
              type="password"
              placeholder={row.existing ? "•••• stored — blank keeps it" : "secret value"}
              value={row.value}
              autoComplete="off"
              onChange={(e) =>
                setSecrets((p) => p.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
              }
            />
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => setSecrets((p) => p.filter((_, j) => j !== i))}
            >
              Remove
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setSecrets((p) => [...p, { name: "", value: "", existing: false }])}
          >
            + Add secret
          </button>
        </div>
      </div>

      {/* ---- Files ---- */}
      <div className="form-panel stack" hidden={tab !== "files"}>
        <p className="field__hint">
          Files mounted into the workload. Mark a file secret to store it in a Secret.
          {isEdit && " Leave a secret file's content blank to keep the stored content."}
        </p>
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
              placeholder={
                row.secret && row.existing
                  ? "blank keeps the stored content"
                  : row.secret
                    ? "secret file content"
                    : "file content"
              }
              rows={3}
              value={row.content}
              onChange={(e) =>
                setFiles((p) => p.map((r, j) => (j === i ? { ...r, content: e.target.value } : r)))
              }
            />
            <div className="file-editor__upload">
              <label className="btn btn--sm">
                Load from computer…
                <input
                  type="file"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    // Reset the input so picking the same file again still fires.
                    e.target.value = "";
                    if (file) loadFileInto(i, file);
                  }}
                />
              </label>
              <span className="field__hint">
                Reads the file&rsquo;s contents into the box above.
              </span>
            </div>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() =>
              setFiles((p) => [
                ...p,
                { mountPath: "", content: "", secret: false, readOnly: true, existing: false },
              ])
            }
          >
            + Add file
          </button>
        </div>
      </div>

      {/* ---- Advanced (placement + scaling) ---- */}
      <div className="form-panel stack" hidden={tab !== "advanced"}>
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
      </div>

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
        {isModal ? (
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        ) : (
          <Link className="btn" href={cancelHref}>
            Cancel
          </Link>
        )}
      </div>
    </form>
  );
}
