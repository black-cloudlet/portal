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

/**
 * The platform's cap on a workload name. Mirrors the API's per-field request
 * schema (maxLength on /openapi.json): names are capped so that {name}-{group}
 * always fits the 63-character DNS label, with per-field rather than combined
 * enforcement. The API remains the authority; this only pre-empts a round trip.
 */
const NAME_MAX_LENGTH = 39;
/** DNS-1123 label - the shape of a workload name. */
const DNS1123_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

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
  const [files, setFiles] = useState<FileRow[]>(
    initial?.files.map((f) => ({
      mountPath: f.mountPath,
      content: f.content ?? "",
      secret: f.secret,
      readOnly: f.readOnly,
      existing: true,
    })) ?? [],
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

  /** Read picked/dropped local files into new file rows (mount path = /etc/<name>). */
  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const rows = await Promise.all(
      Array.from(list).map(
        (file) =>
          new Promise<FileRow>((resolve) => {
            const reader = new FileReader();
            const done = (content: string) =>
              resolve({
                mountPath: `/etc/${file.name}`,
                content,
                secret: false,
                readOnly: true,
                existing: false,
              });
            reader.onload = () => done(typeof reader.result === "string" ? reader.result : "");
            reader.onerror = () => done("");
            reader.readAsText(file);
          }),
      ),
    );
    setFiles((p) => [...p, ...rows]);
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
    // Per-field limits, matching the API's request schema (/openapi.json): a
    // name is a DNS-1123 label of at most NAME_MAX_LENGTH characters. The old
    // combined {name}-{group} <= 63 rule is now impossible to violate under the
    // per-field caps, so it is no longer pre-checked here. The group is never
    // length-checked client-side: its cap applies to the *normalized* form, and
    // a raw value (e.g. with a "/ggd-1234-" prefix) may legitimately be longer.
    if (mode === "create" && name.trim() !== "") {
      const n = name.trim();
      if (n.length > NAME_MAX_LENGTH)
        return {
          tab: "general",
          message: `Name too long: ${n.length} characters (max ${NAME_MAX_LENGTH}).`,
        };
      if (!DNS1123_LABEL.test(n))
        return {
          tab: "general",
          message:
            "Name must be lowercase letters, digits and '-', starting and ending alphanumeric.",
        };
    }
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
              <input
                className="input"
                value={name}
                maxLength={NAME_MAX_LENGTH}
                onChange={(e) => setName(e.target.value)}
                placeholder={`${typeLabel.toLowerCase()} name`}
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
                  placeholder={isEdit ? "leave blank to keep the stored token" : "Token"}
                  autoComplete="off"
                />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span className="field__label">Registry path*</span>
                <input
                  className="input"
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  placeholder="Registry path"
                />
              </label>
              <label className="field">
                <span className="field__label">Registry username</span>
                <input
                  className="input"
                  value={registryUsername}
                  onChange={(e) => setRegistryUsername(e.target.value)}
                  placeholder="Username"
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
                  placeholder={isEdit ? "leave blank to keep" : "Token"}
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
                  { mountPath: "", content: "", secret: false, readOnly: true, existing: false },
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
                      setFiles((p) =>
                        p.map((r, j) => (j === i ? { ...r, content: e.target.value } : r)),
                      )
                    }
                  />
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
