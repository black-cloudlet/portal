"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import {
  createWorkloadAction,
  updateWorkloadAction,
  type ActionError,
} from "@/app/(console)/serverless/actions";
import { useCreationTracker } from "@/components/CreationTracker";
import Icon from "@/components/Icon";
import { bytesToBase64, fileByteSize, formatBytes } from "@/lib/file-download";
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
  { id: "env", label: "Variables & Secrets" },
  { id: "scaling", label: "Scaling Configuration" },
] as const;
type FormTab = (typeof FORM_TABS)[number]["id"];

/** Time-unit choices for the scale-down delay (value + Go-duration suffix). */
const TIME_UNITS = [
  { id: "s", label: "seconds" },
  { id: "m", label: "minutes" },
  { id: "h", label: "hours" },
] as const;

/** Split a stored Go duration like "30s" into a number + unit for the two inputs. */
function parseDelay(v: string | null | undefined): { value: string; unit: string } {
  if (!v) return { value: "", unit: "s" };
  const m = /^(\d+)\s*(s|m|h)?$/.exec(v.trim());
  if (m) return { value: m[1], unit: m[2] ?? "s" };
  return { value: v.trim(), unit: "s" };
}

/**
 * Create or edit a function/container. The form mirrors the platform's create
 * flow: a "before you begin" banner, then three tabs — General (identity +
 * source + placement), Variables & Secrets (env vars, secret env vars, and
 * mounted files with drag-and-drop upload), and Scaling Configuration (the
 * autoscaler settings from /info).
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
  const router = useRouter();
  const { track } = useCreationTracker();
  const isFn = type === "function";
  const typeLabel = isFn ? "Function" : "Container";
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
  const [path, setPath] = useState(initial?.path ?? "");
  const [gitToken, setGitToken] = useState("");
  // Runtimes are objects ({name, versions, defaultVersion}); the picker deals in
  // names, and the version list follows the selected runtime.
  const runtimeList = info.runtimes ?? [];
  const [runtime, setRuntime] = useState(initial?.runtime ?? runtimeList[0]?.name ?? "");
  // "" means "take the runtime's default version" (sent as null).
  const [version, setVersion] = useState(initial?.version ?? "");
  const selectedRuntime = runtimeList.find((r) => r.name === runtime);
  const versions = selectedRuntime?.versions ?? [];
  const [image, setImage] = useState(initial?.image ?? "");
  // Port the workload listens on - published by /info for both offerings, so the
  // bounds and the pre-filled default come from the API rather than this file.
  // (The fallbacks only apply to an API that predates the port capability.)
  const portRules = info.port ?? { required: false, default: 8080, min: 1, max: 65535 };
  // PUT is a full replace, so a workload with no explicit port (create, or one
  // created before the field existed) starts from the platform default.
  const [port, setPort] = useState(String(initial?.port ?? portRules.default));
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
  // Lazy initializer: the mapping (with its per-file size scan) runs once,
  // not on every render.
  const [files, setFiles] = useState<FileRow[]>(
    () =>
      initial?.files.map((f) => {
        const content = f.content ?? "";
        // Binary files read back base64-encoded with encoding "base64"; echoing
        // the pair back is exactly what the API expects on the full-replace PUT.
        const encoding = f.encoding ?? "text";
        return {
          mountPath: f.mountPath,
          content,
          encoding,
          secret: f.secret,
          existing: true,
          // Stored content is kept in state (the API's full-replace needs it)
          // but never rendered - the row shows a size summary instead.
          source: "stored" as const,
          byteSize: fileByteSize(content, encoding),
        };
      }) ?? [],
  );
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Advanced: placement + scaling
  const [size, setSize] = useState(initial?.size ?? sizes[0]);
  // Prefill the effective host on edit so saving doesn't reset a custom hostname
  // (PUT is a full replace; a blank hostname would recompute the default).
  const [hostname, setHostname] = useState(initial?.hostname ?? "");
  const initScale = initial?.scaling;
  const initDelay = parseDelay(initScale?.scaleDownDelay);
  const [metric, setMetric] = useState(initScale?.metric ?? defaultMetric);
  const [minScale, setMinScale] = useState(String(initScale?.minScale ?? 0));
  const [maxScale, setMaxScale] = useState(String(initScale?.maxScale ?? 5));
  const [target, setTarget] = useState(initScale?.target != null ? String(initScale.target) : "");
  const [delayValue, setDelayValue] = useState(initDelay.value);
  const [delayUnit, setDelayUnit] = useState(initDelay.unit);

  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError | null>(null);

  /**
   * Read one local file's raw bytes as base64, or null when the read fails
   * (file moved/locked since it was picked) - callers surface the failure
   * instead of silently committing an empty file. Uploads always go out with
   * `encoding: "base64"` (never as text, which is UTF-8 only), so binary
   * files - keystores, certificates - survive byte-for-byte.
   */
  async function readFileBase64(file: File): Promise<string | null> {
    try {
      return bytesToBase64(new Uint8Array(await file.arrayBuffer()));
    } catch {
      return null;
    }
  }

  /** Read picked/dropped local files into new file rows (mount path = /etc/<name>). */
  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const failed: string[] = [];
    const rows: FileRow[] = [];
    for (const file of Array.from(list)) {
      const content = await readFileBase64(file);
      if (content == null) {
        failed.push(file.name);
        continue;
      }
      rows.push({
        mountPath: `/etc/${file.name}`,
        content,
        encoding: "base64",
        secret: false,
        existing: false,
        source: "upload",
        byteSize: file.size,
      });
    }
    if (rows.length > 0) setFiles((p) => [...p, ...rows]);
    if (failed.length > 0) {
      setError({ error: `Could not read ${failed.join(", ")} — the file(s) were not added.` });
    }
  }

  /**
   * Put a re-picked file's content into `row`. The row is matched by identity,
   * not index, so a list that changed while the file dialog or read was in
   * flight can never route the bytes into a different row (a removed row makes
   * the pick a no-op). On a failed read the row is left untouched.
   */
  async function replaceRowFile(row: FileRow, list: FileList | null) {
    if (!list || list.length === 0) return;
    const file = list[0];
    const content = await readFileBase64(file);
    if (content == null) {
      setError({ error: `Could not read ${file.name} — the row keeps its current content.` });
      return;
    }
    setFiles((p) =>
      p.map((r) =>
        r === row
          ? {
              ...r,
              content,
              encoding: "base64" as const,
              source: "upload" as const,
              byteSize: file.size,
            }
          : r,
      ),
    );
  }

  /** A row's decoded size for the summaries (cached at creation/replace time). */
  function rowByteSize(row: FileRow): number {
    return row.byteSize ?? fileByteSize(row.content, row.encoding);
  }

  function buildScaling(): ScalingInput {
    const delay = delayValue.trim() === "" ? null : `${delayValue.trim()}${delayUnit}`;
    return {
      minScale: Number(minScale),
      maxScale: Number(maxScale),
      metric,
      target: target.trim() === "" ? null : Number(target),
      scaleDownDelay: delay,
    };
  }

  /** Client-side checks that mirror the API's required fields. */
  function validate(): { tab: FormTab; message: string } | null {
    if (mode === "create" && name.trim() === "")
      return { tab: "general", message: "Name is required." };
    if (mode === "create" && RESERVED_WORKLOAD_NAMES.includes(name.trim()))
      return { tab: "general", message: `"${name.trim()}" is a reserved name; choose another.` };
    // No shape or length checks on the name: the API is the authority on its
    // own rules (pattern and length on /openapi.json, the combined
    // {name}-{group} cap on /info) and rejects with a precise message the form
    // surfaces as-is. Only what the API cannot know is checked client-side -
    // the reserved route segments above and the required fields below.
    if (isFn) {
      // PUT is a full replace, so the build inputs are required on edit as well
      // as create. The git token is redacted keep-on-omit (stored server-side),
      // so it is required only on create.
      if (gitRepo.trim() === "") return { tab: "general", message: "Git repository is required." };
      if (runtime.trim() === "") return { tab: "general", message: "Runtime is required." };
      if (mode === "create" && gitToken.trim() === "")
        return { tab: "general", message: "Git token is required." };
    } else {
      // Full replace: the image is required on edit as well as create.
      if (image.trim() === "") return { tab: "general", message: "Image is required." };
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
    // Both offerings carry a port, and the console always sends one, so it is
    // checked once here against the bounds /info publishes.
    const portNum = Number(port);
    if (
      port.trim() === "" ||
      !Number.isInteger(portNum) ||
      portNum < portRules.min ||
      portNum > portRules.max
    )
      return {
        tab: "general",
        message: `A valid port (${portRules.min}–${portRules.max}) is required.`,
      };
    for (const s of secrets) {
      if (s.name.trim() !== "" && s.value.trim() === "" && !(isEdit && s.existing))
        return { tab: "env", message: `Secret "${s.name}" needs a value.` };
    }
    for (const f of files) {
      if (
        f.mountPath.trim() !== "" &&
        f.secret &&
        f.content.trim() === "" &&
        !(isEdit && f.existing)
      )
        return { tab: "env", message: `Secret file "${f.mountPath}" needs content.` };
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

    // Shared by all four bodies: a function and a container take the same
    // non-source fields, port included.
    const common = {
      env: buildEnvList(variables, secrets, isEdit),
      files: buildFileList(files, isEdit),
      scaling: buildScaling(),
      size,
      hostname: hostname.trim() === "" ? null : hostname.trim(),
      port: Number(port),
    };

    startTransition(async () => {
      let res: ActionError | void;
      if (mode === "create") {
        // Placement is always cluster-wide: send no regions so the API deploys to
        // every region (the console does not expose per-region targeting).
        if (isFn) {
          const spec: FunctionCreateInput = {
            name,
            gitRepo,
            branch: branch || "main",
            path: path.trim(),
            gitToken,
            runtime,
            version: version.trim() === "" ? null : version,
            regions: null,
            ...common,
          };
          res = await createWorkloadAction("function", spec);
        } else {
          const spec: ContainerCreateInput = {
            name,
            image,
            registryUsername: registryUsername.trim() || null,
            registryToken: registryToken.trim() || null,
            regions: null,
            ...common,
          };
          res = await createWorkloadAction("container", spec);
        }
      } else if (isFn) {
        const spec: FunctionUpdateInput = {
          // Full replace: the build inputs are the complete desired state and are
          // always sent. The API rebuilds only when one actually changes (or the
          // token is rotated), so re-sending unchanged values is a no-op. branch
          // defaults to main; the git token is sent only to rotate it.
          gitRepo,
          branch: branch.trim() || "main",
          path: path.trim(),
          runtime,
          version: version.trim() === "" ? null : version,
          gitToken: gitToken.trim() || null,
          ...common,
        };
        res = await updateWorkloadAction("function", initial!.name, spec);
      } else {
        const spec: ContainerUpdateInput = {
          // Full replace: the image is the complete desired state.
          // Registry: username+token rotates, username-only keeps, neither removes.
          image: image.trim(),
          registryUsername: registryUsername.trim() || null,
          registryToken: registryToken.trim() || null,
          ...common,
        };
        res = await updateWorkloadAction("container", initial!.name, spec);
      }
      if (res?.error) {
        setError(res);
        return;
      }
      if (mode === "create") {
        // Accepted (202): no redirect to the workload page. Hand the deploy to
        // the corner tracker, put the user back on the list (or just close the
        // dialog if they are already there), and refresh so the new row shows.
        track(type, name.trim());
        if (isModal) onClose?.();
        else router.push(`/serverless/${seg}`);
        router.refresh();
      }
    });
  }

  // The host the API generates when no custom hostname is given, derived from
  // /info's template. Shown as the hostname placeholder and (before a name is
  // typed) as a hint under the Name field.
  const generatedHost = info.defaultHostTemplate
    .replace("{name}", name.trim() || "{name}")
    .replace("{group}", group)
    .replace("{routeDomain}", info.routeDomain);
  const hostPreview = hostname.trim() === "" && name.trim() !== "" ? generatedHost : null;

  const cancelHref = isEdit ? `/serverless/${seg}/${initial!.name}` : `/serverless/${seg}`;

  return (
    <form className="form stack" onSubmit={submit}>
      {!isModal && (
        <>
          <div className="detail__bar">
            <Link className="backlink" href={cancelHref}>
              <Icon name="arrow-left" size={14} />
              Cancel
            </Link>
          </div>

          <h2 className="detail__title">
            {mode === "create" ? `Create ${typeLabel}` : `Edit ${initial!.name}`}
          </h2>
        </>
      )}

      {mode === "create" && (
        <div className="form-banner">
          <span className="form-banner__icon" aria-hidden="true">
            <Icon name="info" size={18} />
          </span>
          <div>
            <strong>Before you begin: Essential {typeLabel} Docs</strong>
            <p className="form-banner__text">
              Learn more about how to create a {typeLabel} in our{" "}
              <a href="/docs" target="_blank" rel="noreferrer">
                Documentation Center
              </a>
              .
            </p>
          </div>
        </div>
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
      <div className="form-panel" hidden={tab !== "general"}>
        <div className="form-grid">
          {mode === "create" && (
            <label className="field">
              <span className="field__label">Name*</span>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
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
              <label className="field field--full">
                <span className="field__label">Git repository*</span>
                <input
                  className="input"
                  value={gitRepo}
                  onChange={(e) => setGitRepo(e.target.value)}
                  placeholder="https://git.internal/team/app.git"
                />
              </label>
              <label className="field">
                <span className="field__label">Branch</span>
                <input
                  className="input"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                />
              </label>
              <label className="field field--full">
                <span className="field__label">Path</span>
                <input
                  className="input"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="repository root"
                />
                <span className="field__hint">
                  Sub-directory in the repo to build from. Leave blank for the root.
                </span>
              </label>
              <label className="field">
                <span className="field__label">Runtime</span>
                <select
                  className="input"
                  value={runtime}
                  // Changing the runtime invalidates the chosen version; fall back
                  // to that runtime's default (empty selection).
                  onChange={(e) => {
                    setRuntime(e.target.value);
                    setVersion("");
                  }}
                >
                  {runtimeList.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field__label">Version</span>
                <select
                  className="input"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  disabled={versions.length === 0}
                >
                  <option value="">
                    {selectedRuntime?.defaultVersion
                      ? `Default (${selectedRuntime.defaultVersion})`
                      : "Default"}
                  </option>
                  {versions.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field field--full">
                <span className="field__label">Git token{isEdit ? " (only to rotate)" : ""}</span>
                <input
                  className="input"
                  type="password"
                  value={gitToken}
                  onChange={(e) => setGitToken(e.target.value)}
                  placeholder={isEdit ? "leave blank to keep the stored token" : undefined}
                  autoComplete="off"
                />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span className="field__label">Registry path*</span>
                <input className="input" value={image} onChange={(e) => setImage(e.target.value)} />
              </label>
              <label className="field">
                <span className="field__label">Registry username</span>
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
                  placeholder={isEdit ? "leave blank to keep" : undefined}
                  autoComplete="off"
                />
              </label>
              <div className="field field--full field--hint-only">
                <span className="field__hint">
                  {isEdit
                    ? "Username + token rotates the pull secret; username alone keeps it; clearing both removes it."
                    : "Provide username and token together for a private image, or leave both blank for a public one."}
                </span>
              </div>
            </>
          )}

          {/* Port: the same field for both offerings, since both take one. */}
          <label className="field">
            <span className="field__label">Port</span>
            <div className="port-field">
              <span className="port-field__icon" aria-hidden="true">
                <Icon name="plug" size={15} />
              </span>
              <input
                className="input port-field__input"
                type="number"
                inputMode="numeric"
                min={portRules.min}
                max={portRules.max}
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder={String(portRules.default)}
              />
              {port.trim() !== String(portRules.default) && (
                <button
                  type="button"
                  className="port-field__reset"
                  onClick={() => setPort(String(portRules.default))}
                  title={`Reset to the platform default (${portRules.default})`}
                >
                  Use {portRules.default}
                </button>
              )}
            </div>
            <span className="field__hint">
              The port your {typeLabel.toLowerCase()} listens on ({portRules.min}–{portRules.max}).
              Keep {portRules.default} unless the {isFn ? "app" : "image"} serves on another one.
            </span>
          </label>

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
            <span className="field__label">Hostname (optional)</span>
            <input
              className="input"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder={generatedHost}
            />
            <span className="field__hint">Leave blank to use the generated host.</span>
          </label>
        </div>
      </div>

      {/* ---- Variables & Secrets (env + files) ---- */}
      <div className="form-panel stack" hidden={tab !== "env"}>
        {/* Variables (non-secret env) */}
        <section className="form-section">
          <div className="form-section__head">
            <h3 className="section-title">Variables</h3>
            <button
              type="button"
              className="btn btn--outline btn--sm"
              onClick={() => setVariables((p) => [...p, { name: "", value: "" }])}
            >
              Add Variable
            </button>
          </div>
          {variables.length === 0 ? (
            <div className="empty-state">
              <Icon name="code" size={28} />
              <p>There are no variables yet</p>
            </div>
          ) : (
            <div className="stack">
              {variables.map((row, i) => (
                <div key={i} className="kv-row">
                  <input
                    className="input"
                    placeholder="NAME"
                    value={row.name}
                    onChange={(e) =>
                      setVariables((p) =>
                        p.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)),
                      )
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
            </div>
          )}
        </section>

        {/* Secrets (secret env) */}
        <section className="form-section">
          <div className="form-section__head">
            <h3 className="section-title">Secrets</h3>
            <button
              type="button"
              className="btn btn--outline btn--sm"
              onClick={() => setSecrets((p) => [...p, { name: "", value: "", existing: false }])}
            >
              Add Secret
            </button>
          </div>
          <p className="field__hint">
            Stored in a Kubernetes Secret and never shown after saving.
            {isEdit && " Leave a value blank to keep the stored secret."}
          </p>
          {secrets.length === 0 ? (
            <div className="empty-state">
              <Icon name="code" size={28} />
              <p>There are no secrets yet</p>
            </div>
          ) : (
            <div className="stack">
              {secrets.map((row, i) => (
                <div key={i} className="kv-row">
                  <input
                    className="input"
                    placeholder="NAME"
                    value={row.name}
                    onChange={(e) =>
                      setSecrets((p) =>
                        p.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)),
                      )
                    }
                  />
                  <input
                    className="input"
                    type="password"
                    placeholder={row.existing ? "•••• stored — blank keeps it" : "secret value"}
                    value={row.value}
                    autoComplete="off"
                    onChange={(e) =>
                      setSecrets((p) =>
                        p.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)),
                      )
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
            </div>
          )}
        </section>

        {/* Files */}
        <section className="form-section">
          <div className="form-section__head">
            <h3 className="section-title">
              Files{" "}
              <span className="section-title__info" title="Mounted into the workload filesystem.">
                <Icon name="info" size={14} />
              </span>
            </h3>
            <button
              type="button"
              className="btn btn--outline btn--sm"
              onClick={() =>
                setFiles((p) => [
                  ...p,
                  {
                    mountPath: "",
                    content: "",
                    encoding: "text",
                    secret: false,
                    existing: false,
                    source: "text",
                  },
                ])
              }
            >
              Add File
            </button>
          </div>

          <div
            className={`dropzone${dragging ? " dropzone--active" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void addFiles(e.dataTransfer.files);
            }}
          >
            <Icon name="upload" size={26} />
            <span>Drag and drop here or click to upload</span>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {files.length > 0 && (
            <div className="stack">
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
                    <label
                      className="check"
                      title={
                        row.existing
                          ? "Secrecy can't change on an existing file — remove the row and add it again."
                          : undefined
                      }
                    >
                      <input
                        type="checkbox"
                        checked={row.secret}
                        // Locked on existing rows: a stored secret's content is
                        // redacted, so making it non-secret would save an empty
                        // file over the stored one.
                        disabled={row.existing}
                        onChange={(e) =>
                          setFiles((p) =>
                            p.map((r, j) => (j === i ? { ...r, secret: e.target.checked } : r)),
                          )
                        }
                      />
                      secret
                    </label>
                    <button
                      type="button"
                      className="btn btn--sm"
                      onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                    >
                      Remove
                    </button>
                  </div>
                  {/* Uploaded / stored content is never rendered (it may be large
                      or non-text); those rows show a size summary with a replace
                      action. Only hand-typed rows get an editable textarea. */}
                  {row.source === "upload" || row.source === "stored" ? (
                    <div className="file-editor__summary">
                      <span className="text-muted">
                        {row.source === "stored"
                          ? row.secret
                            ? "Stored secret content is kept."
                            : `Stored content · ${formatBytes(rowByteSize(row))} — kept as is.`
                          : `Uploaded · ${formatBytes(rowByteSize(row))}`}
                      </span>
                      <span className="file-editor__actions">
                        {/* Rotate a stored secret by typing: switches the row to
                            a text editor (blank still keeps the stored value). */}
                        {row.secret && row.source === "stored" && (
                          <button
                            type="button"
                            className="btn btn--outline btn--sm"
                            onClick={() =>
                              setFiles((p) =>
                                p.map((r) =>
                                  r === row
                                    ? {
                                        ...r,
                                        content: "",
                                        encoding: "text" as const,
                                        source: "text" as const,
                                      }
                                    : r,
                                ),
                              )
                            }
                          >
                            Enter new value
                          </button>
                        )}
                        {/* A label-wrapped input opens the picker with no refs;
                            the handler closes over this row's identity. */}
                        <label className="btn btn--outline btn--sm">
                          Replace file
                          <input
                            type="file"
                            hidden
                            onChange={(e) => {
                              void replaceRowFile(row, e.target.files);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </span>
                    </div>
                  ) : (
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
                        setFiles((p) =>
                          p.map((r, j) => (j === i ? { ...r, content: e.target.value } : r)),
                        )
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* ---- Scaling Configuration ---- */}
      <div className="form-panel" hidden={tab !== "scaling"}>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">Scale Down Delay*</span>
            <input
              className="input"
              type="number"
              min={0}
              value={delayValue}
              onChange={(e) => setDelayValue(e.target.value)}
              placeholder="10"
            />
          </label>
          <label className="field">
            <span className="field__label">Time Unit</span>
            <select
              className="input"
              value={delayUnit}
              onChange={(e) => setDelayUnit(e.target.value)}
            >
              {TIME_UNITS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Min Replicas*</span>
            <input
              className="input"
              type="number"
              min={0}
              value={minScale}
              onChange={(e) => setMinScale(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="field__label">Max Replicas*</span>
            <input
              className="input"
              type="number"
              min={1}
              value={maxScale}
              onChange={(e) => setMaxScale(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="field__label">Scaling Metric*</span>
            <select className="input" value={metric} onChange={(e) => setMetric(e.target.value)}>
              {metrics.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Scale Target* (blank = default)</span>
            <input
              className="input"
              type="number"
              min={1}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="100"
            />
          </label>
        </div>
        <p className="field__hint">
          cpu/memory metrics use the HPA autoscaler and cannot scale to zero (min replicas ≥ 1).
        </p>
        <p className="field__hint">
          Want to know more about Scaling your {typeLabel.toLowerCase()}?{" "}
          <a href="/docs" target="_blank" rel="noreferrer">
            Read more
          </a>
        </p>
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

      <div className={`form__actions${isModal ? " form__actions--modal" : ""}`}>
        {isModal ? (
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        ) : (
          <Link className="btn" href={cancelHref}>
            Cancel
          </Link>
        )}
        <button type="submit" className="btn btn--primary" disabled={pending}>
          {pending ? "Saving…" : mode === "create" ? `Create ${typeLabel}` : "Save changes"}
        </button>
      </div>
    </form>
  );
}
