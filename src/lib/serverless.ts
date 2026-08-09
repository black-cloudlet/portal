/**
 * Thin server-side client for the Serverless API.
 *
 * All calls run on the server (React Server Components / route handlers / server
 * actions) and forward the user's SSO access token as a Bearer, so the API
 * applies the exact same group-based authorization it would for any other OIDC
 * caller. The token never reaches the browser. The active group is a path
 * segment (`/api/v1/groups/{group}/...`) - identical to what the API normalizes
 * on its side.
 *
 * The shapes below mirror the API's response/request models (see
 * api/models/common.py, function.py, container.py, info.py).
 */

import { getService } from "@/lib/services";

/** The two workload offerings the console fronts. */
export type WorkloadType = "function" | "container";

/**
 * The workload `status` rollup - a closed, Kubernetes-phase-style set. Causes
 * never get promoted into it (they go on `reason`), so the authoritative list
 * lives on `GET .../info` (`statuses.workload`); this type mirrors it for the
 * console's own switches. Per-site `status` follows the same shape.
 */
export type WorkloadStatus =
  "Pending" | "Building" | "Deploying" | "Ready" | "Failed" | "Terminating";

/**
 * The statuses a poller stops on; anything else is still in flight. Fallback
 * for when the /info document (`statuses.terminal`) is not at hand - prefer
 * that where it is.
 */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set(["Ready", "Failed"]);

/** Whether a workload status is settled (per `terminal` from /info, or the fallback). */
export function isTerminalStatus(status: string, terminal?: string[]): boolean {
  return terminal ? terminal.includes(status) : TERMINAL_STATUSES.has(status);
}

export interface WorkloadSummary {
  name: string;
  group: string;
  type: WorkloadType;
  hostname: string;
  status: string;
  size: string | null;
  createdAt: string | null;
  sites: string[];
}

/** Live resource consumption summed over a workload's running pods. */
export interface ResourceUsage {
  cpu: string | null;
  memory: string | null;
}

/**
 * The deploy/health state of a workload at a single site. `reason`/`message`
 * are the Kubernetes-style pair behind a Failed status: `reason` is the
 * machine-readable cause a client switches on (from /info `statuses.reasons`,
 * additive - render unknown values as-is), `message` the human-readable detail.
 */
export interface SiteStatus {
  site: string;
  status: string;
  revision: string | null;
  reason: string | null;
  message: string | null;
  replicas: number | null;
}

/** One site's live numbers, from `GET .../{name}/stats` (no `message` by design). */
export interface SiteStats {
  site: string;
  status: string;
  reason: string | null;
  replicas: number | null;
  usage: ResourceUsage | null;
}

/**
 * A workload's live state (`GET .../{name}/stats`) - the lightweight endpoint,
 * and the body of the `stats` SSE events.
 *
 * The totals are summed across sites before rounding, so they need not equal
 * the sum of the per-site figures; render them rather than re-adding the parts.
 * Either is null when a site could not be measured, rather than a figure
 * quietly missing that site.
 */
export interface WorkloadStats {
  status: string;
  /** The first recognized per-site reason behind a Failed rollup, or null. */
  reason: string | null;
  replicas: number | null;
  usage: ResourceUsage | null;
  sites: SiteStats[];
}

/** An env var read back from a workload; secret values are redacted to null. */
export interface EnvVarView {
  name: string;
  value: string | null;
  secret: boolean;
}

/** A mounted file read back from a workload; secret contents are redacted. */
export interface FileView {
  mountPath: string;
  readOnly: boolean;
  secret: boolean;
  content: string | null;
}

/** Autoscaling settings (desired state). */
export interface Scaling {
  minScale: number;
  maxScale: number;
  metric: string;
  target: number | null;
  scaleDownDelay: string | null;
}

/** Full single-workload view (`GET .../{name}`). */
export interface WorkloadDetail {
  name: string;
  group: string;
  type: WorkloadType;
  hostname: string;
  status: string;
  /** The first recognized per-site reason behind a Failed rollup, or null. */
  reason?: string | null;
  size: string | null;
  createdAt: string | null;
  sites: SiteStatus[];
  statusUrl: string | null;
  scaling: Scaling | null;
  env: EnvVarView[];
  files: FileView[];
  // Function source (functions deal in source, never images).
  runtime?: string | null;
  // The requested language version, or null when the function took the runtime's
  // default (that default is on GET .../functions/info as `defaultVersion`).
  version?: string | null;
  gitRepo?: string | null;
  branch?: string | null;
  // Sub-directory inside the repo the function is built from; null/"" is the root.
  path?: string | null;
  // The function's image build state on the local site (kpack). Absent on a site
  // that has never built it.
  build?: BuildStatusView | null;
  // Container source.
  image?: string | null;
  registryUsername?: string | null;
  // The port the workload listens on. Null when it was created without an
  // explicit port and runs on the platform default (see /info's `port.default`).
  port?: number | null;
}

/** A function's image build state (kpack), from `FunctionResponse.build`. */
export interface BuildStatusView {
  // Building / Ready / Failed / Unknown.
  state: string;
  // Why the build failed, when it did.
  message: string | null;
}

/**
 * One of the workload's pods on the local site, from the `/pods` roster.
 * `usage` is per pod and null for a pod too new to have been scraped.
 */
export interface PodInfo {
  pod: string;
  revision: string | null;
  phase: string;
  ready: boolean;
  restarts: number;
  startedAt: string | null;
  usage: ResourceUsage | null;
}

/**
 * The `pods` event / `?follow=false` snapshot of `GET .../{name}/pods`: which
 * pods the workload has on the local site right now. Empty is a normal state
 * (scaled to zero), not an error.
 */
export interface PodRoster {
  name: string;
  group: string;
  type: WorkloadType;
  site: string;
  pods: PodInfo[];
}

/** One line of a pod log - the `log` event, and what a snapshot's `lines` holds. */
export interface LogLine {
  pod: string;
  container: string;
  revision: string | null;
  time: string | null;
  message: string;
}

/**
 * One pod's log as the node holds it right now
 * (`GET .../logs/pods/{pod}?follow=false`) - the same lines a follow would
 * have delivered, bounded by the node's log rotation.
 */
export interface PodLogSnapshot {
  name: string;
  group: string;
  type: WorkloadType;
  site: string;
  pod: string;
  container: string;
  revision: string | null;
  lines: LogLine[];
}

/**
 * A minted stream ticket (`POST /api/v1/stream-tickets`): the browser's
 * credential for one SSE path, sent as `?ticket=` since EventSource cannot
 * carry an Authorization header.
 */
export interface StreamTicket {
  ticket: string;
  expiresAt: string;
  path: string;
}

/* ---------- /info capabilities (drive the create/edit form) ---------- */

export interface MetricTarget {
  default: number;
  min: number;
  max: number | null;
  unit: string;
}

export interface MetricCapability {
  name: string;
  minScaleFloor: number;
  target: MetricTarget;
}

export interface ScaleDownDelayCapability {
  format: string;
  min: string;
  max: string;
  default: string | null;
}

export interface ScalingCapabilities {
  defaultMetric: string;
  metrics: MetricCapability[];
  scaleDownDelay: ScaleDownDelayCapability;
}

/**
 * The `port` field's rules, published identically by both offerings' info
 * documents (`GET .../functions/info` and `GET .../containers/info`).
 *
 * `default` is what the API applies when a body carries no port, so the form
 * pre-fills from it rather than hardcoding the number.
 */
export interface PortCapability {
  required: boolean;
  default: number;
  min: number;
  max: number;
}

/** One runtime a function may be built with, plus the versions it offers. */
export interface RuntimeCapability {
  // The value to send as `runtime`.
  name: string;
  // Selectable language versions; empty when the runtime pins one.
  versions: string[];
  // Applied when the caller picks no version.
  defaultVersion: string | null;
}

/** The status strings a response can carry, so a client hardcodes none. */
export interface StatusVocabulary {
  // Values of the workload `status` a poller switches on.
  workload: string[];
  // Values of a per-site `status` inside `sites[]`.
  site: string[];
  // The subset of `workload` a poller should stop on; anything else is in flight.
  terminal: string[];
  // Values of the workload/per-site `reason` fields (additive; may grow).
  reasons?: string[];
}

/** One machine-readable error code and the HTTP status carrying it. */
export interface ErrorCode {
  code: string;
  status: number;
}

/** The combined limit on `name` and `group` (their join becomes the object name). */
export interface NamingRule {
  template: string;
  maxLength: number;
}

/**
 * Platform capabilities common to both offerings (see api/models/info.py BaseInfo).
 * `statuses`, `errorCodes`, and `naming` are newer additions; typed optional so
 * the console still works against an API that predates them.
 */
export interface BasePlatformInfo {
  version: string;
  sites: string[];
  sizes: string[];
  scaling: ScalingCapabilities;
  routeDomain: string;
  defaultHostTemplate: string;
  statuses?: StatusVocabulary;
  errorCodes?: ErrorCode[];
  naming?: NamingRule;
}

/** Container capabilities (`GET /api/v1/containers/info`): the base plus the port rules. */
export interface ContainerInfo extends BasePlatformInfo {
  port: PortCapability;
}

/**
 * Function capabilities (`GET /api/v1/functions/info`): the base plus the
 * runtimes and the same port rules a container publishes.
 */
export interface FunctionInfo extends BasePlatformInfo {
  runtimes: RuntimeCapability[];
  port: PortCapability;
}

/**
 * The capabilities the shared create/edit form consumes. Both per-offering
 * documents are assignable to it: `runtimes` is returned only for functions, and
 * `port` is optional only because an API predating it would omit it (the form
 * falls back to its own default then).
 */
export interface PlatformInfo extends BasePlatformInfo {
  runtimes?: RuntimeCapability[];
  port?: PortCapability;
}

/* ---------- Request inputs (create/update bodies) ---------- */

export interface ScalingInput {
  minScale: number;
  maxScale: number;
  metric: string;
  target?: number | null;
  scaleDownDelay?: string | null;
}

export interface EnvVarInput {
  name: string;
  // Keep-on-write: a secret var sent with value null/omitted keeps the stored
  // value on update. A non-secret var always needs a value; a brand-new secret
  // needs one too. Send a value to set/change it.
  value?: string | null;
  secret: boolean;
}

export interface FileInput {
  mountPath: string;
  // Keep-on-write: a secret file sent with content null/omitted keeps the
  // stored content on update. A non-secret file always needs content.
  content?: string | null;
  secret: boolean;
  readOnly: boolean;
}

export interface FunctionCreateInput {
  name: string;
  gitRepo: string;
  branch: string;
  // Sub-directory inside the repo to build from; "" (or omitted) is the root.
  path?: string;
  gitToken: string;
  runtime: string;
  // One of the runtime's advertised `versions`; null/omitted takes the default.
  version?: string | null;
  // The port the built app listens on. Optional to the API (it applies its own
  // default), but the console always sends an explicit value, as for a container.
  port: number;
  env: EnvVarInput[];
  files: FileInput[];
  scaling: ScalingInput;
  size: string;
  sites?: string[] | null;
  hostname?: string | null;
}

export interface FunctionUpdateInput {
  // Full replace: the build inputs are the complete desired state. gitRepo and
  // runtime are required (like create); branch defaults to "main". Only the git
  // token is keep-on-omit (redacted, can't be read back) - blank keeps the
  // stored one, a value rotates it.
  gitRepo: string;
  branch: string;
  // Sub-directory inside the repo to build from; "" (or omitted) is the root.
  path?: string;
  gitToken?: string | null;
  runtime: string;
  // Replaced like every non-secret field (not keep-on-omit): null/omitted returns
  // the function to the runtime default and rebuilds.
  version?: string | null;
  // Replaced too, and always sent: omitting it would return the function to the
  // platform default port rather than keeping the deployed one.
  port: number;
  env: EnvVarInput[];
  files: FileInput[];
  scaling: ScalingInput;
  size: string;
  hostname?: string | null;
}

export interface ContainerCreateInput {
  name: string;
  image: string;
  port: number;
  registryUsername?: string | null;
  registryToken?: string | null;
  env: EnvVarInput[];
  files: FileInput[];
  scaling: ScalingInput;
  size: string;
  sites?: string[] | null;
  hostname?: string | null;
}

export interface ContainerUpdateInput {
  // Full replace: image and port are the complete desired state, so both are
  // required (like create). The only keep-on-omit is the redacted registry
  // token (see the registry-creds semantics in the form).
  image: string;
  port: number;
  registryUsername?: string | null;
  registryToken?: string | null;
  env: EnvVarInput[];
  files: FileInput[];
  scaling: ScalingInput;
  size: string;
  hostname?: string | null;
}

export class ServerlessApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Machine-readable code from the API's error envelope (e.g. NOT_FOUND). */
    readonly code?: string,
    /** Correlation id from the envelope, for the user to quote to support. */
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ServerlessApiError";
  }
}

/**
 * The Serverless API's standard error envelope (see common/errors.py). Every
 * failed call returns this shape, so the console surfaces the real reason a
 * workload call failed - and the requestId to trace it - not a bare status.
 */
interface ErrorEnvelope {
  error?: {
    status?: number;
    code?: string;
    message?: string;
    details?: unknown[];
    requestId?: string | null;
  };
}

function baseUrl(): string {
  const svc = getService("serverless");
  if (!svc?.apiBaseUrl) {
    throw new ServerlessApiError(
      "Serverless API address is not configured (PORTAL_SERVERLESS_API_URL).",
    );
  }
  return svc.apiBaseUrl;
}

/** The collection path for a workload type, e.g. `/api/v1/groups/team/functions`. */
function collectionPath(type: WorkloadType, group: string): string {
  return `/api/v1/groups/${encodeURIComponent(group)}/${type}s`;
}

async function apiGet<T>(path: string, accessToken: string | undefined): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl()}${path}`, {
      headers,
      // Console data is always live; never serve a cached workload list.
      cache: "no-store",
    });
  } catch (err) {
    throw new ServerlessApiError(`Could not reach the Serverless API: ${(err as Error).message}`);
  }
  if (!resp.ok) {
    throw await toApiError(resp, path);
  }
  return (await resp.json()) as T;
}

/**
 * Send a write (POST/PUT/DELETE) with a JSON body, forwarding the Bearer token.
 * Returns the parsed body, or null for a 204 (delete).
 */
async function apiSend<T>(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  accessToken: string | undefined,
  body?: unknown,
): Promise<T | null> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let resp: Response;
  try {
    resp = await fetch(`${baseUrl()}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    throw new ServerlessApiError(`Could not reach the Serverless API: ${(err as Error).message}`);
  }
  if (!resp.ok) {
    throw await toApiError(resp, path);
  }
  if (resp.status === 204) return null;
  return (await resp.json()) as T;
}

/**
 * Turn a non-2xx response into a ServerlessApiError, preferring the API's error
 * envelope so the UI shows the API's own message, code, and requestId; falls
 * back to the status line for a non-JSON body (e.g. a proxy error page).
 */
async function toApiError(resp: Response, path: string): Promise<ServerlessApiError> {
  let envelope: ErrorEnvelope | null = null;
  try {
    envelope = (await resp.json()) as ErrorEnvelope;
  } catch {
    // Non-JSON body; fall back to the status line below.
  }
  const err = envelope?.error;
  const message = err?.message ?? `Serverless API returned ${resp.status} for ${path}`;
  return new ServerlessApiError(
    message,
    err?.status ?? resp.status,
    err?.code,
    err?.requestId ?? undefined,
  );
}

/** Public container capabilities (`GET /api/v1/containers/info`); no auth required. */
export function getContainerInfo(): Promise<ContainerInfo> {
  return apiGet<ContainerInfo>("/api/v1/containers/info", undefined);
}

/** Public function capabilities (`GET /api/v1/functions/info`); no auth required. */
export function getFunctionInfo(): Promise<FunctionInfo> {
  return apiGet<FunctionInfo>("/api/v1/functions/info", undefined);
}

/** Sort keys the list endpoints accept. */
export type WorkloadSort = "name" | "createdAt";

/** Functions owned by `group` (`GET .../functions`). */
export function listFunctions(
  group: string,
  accessToken: string | undefined,
  sort: WorkloadSort = "name",
) {
  return apiGet<WorkloadSummary[]>(
    `${collectionPath("function", group)}?sort=${sort}`,
    accessToken,
  );
}

/** Containers owned by `group` (`GET .../containers`). */
export function listContainers(
  group: string,
  accessToken: string | undefined,
  sort: WorkloadSort = "name",
) {
  return apiGet<WorkloadSummary[]>(
    `${collectionPath("container", group)}?sort=${sort}`,
    accessToken,
  );
}

/** List one workload type for a group (`GET .../{type}s`). */
export function listWorkloadsOfType(
  type: WorkloadType,
  group: string,
  accessToken: string | undefined,
  sort: WorkloadSort = "name",
) {
  return type === "function"
    ? listFunctions(group, accessToken, sort)
    : listContainers(group, accessToken, sort);
}

/** All workloads (functions + containers) for a group, merged and sorted. */
export async function listWorkloads(
  group: string,
  accessToken: string | undefined,
): Promise<WorkloadSummary[]> {
  const [functions, containers] = await Promise.all([
    listFunctions(group, accessToken),
    listContainers(group, accessToken),
  ]);
  return [...functions, ...containers].sort((a, b) => a.name.localeCompare(b.name));
}

/** One workload's full detail (`GET .../{type}s/{name}`). */
export function getWorkload(
  type: WorkloadType,
  group: string,
  name: string,
  accessToken: string | undefined,
): Promise<WorkloadDetail> {
  return apiGet<WorkloadDetail>(
    `${collectionPath(type, group)}/${encodeURIComponent(name)}`,
    accessToken,
  );
}

/** A workload's live usage, replicas and status (`GET .../{type}s/{name}/stats`). */
export function getWorkloadStats(
  type: WorkloadType,
  group: string,
  name: string,
  accessToken: string | undefined,
): Promise<WorkloadStats> {
  return apiGet<WorkloadStats>(
    `${collectionPath(type, group)}/${encodeURIComponent(name)}/stats`,
    accessToken,
  );
}

/**
 * The path of one of a workload's streaming endpoints - what a ticket is minted
 * for, and what the browser's EventSource opens (with `?ticket=` appended).
 * Query parameters are deliberately excluded: the ticket signs the path alone.
 */
export function workloadStreamPath(
  type: WorkloadType,
  group: string,
  name: string,
  stream: { kind: "pods" } | { kind: "stats" } | { kind: "logs"; pod: string },
): string {
  const base = `${collectionPath(type, group)}/${encodeURIComponent(name)}`;
  switch (stream.kind) {
    case "pods":
      return `${base}/pods`;
    case "stats":
      return `${base}/stats/stream`;
    case "logs":
      return `${base}/logs/pods/${encodeURIComponent(stream.pod)}`;
  }
}

/**
 * Mint a short-lived ticket for one streaming path
 * (`POST /api/v1/stream-tickets`). The user's token is spent server-side, on a
 * request that can carry it; only the ticket - one path, ~60s - reaches the
 * browser. A 503 means the deployment has no signing key, so streaming is off
 * for browsers and the caller should fall back to snapshot polling.
 */
export function mintStreamTicket(
  path: string,
  accessToken: string | undefined,
): Promise<StreamTicket> {
  return apiSend<StreamTicket>("POST", "/api/v1/stream-tickets", accessToken, {
    path,
  }) as Promise<StreamTicket>;
}

/**
 * The base URL the browser opens streams against - the same API address the
 * server calls (an externally-routed host in every deployment; the API's
 * `SERVERLESS_CORS_ALLOW_ORIGINS` must include the portal's origin).
 */
export function streamBaseUrl(): string {
  return baseUrl();
}

/**
 * One JSON roster of the workload's pods on the local site
 * (`GET .../{name}/pods?follow=false`) - the non-streaming form, for polling.
 */
export function getPodsSnapshot(
  type: WorkloadType,
  group: string,
  name: string,
  accessToken: string | undefined,
): Promise<PodRoster> {
  return apiGet<PodRoster>(
    `${workloadStreamPath(type, group, name, { kind: "pods" })}?follow=false`,
    accessToken,
  );
}

/**
 * One pod's log as the node holds it right now
 * (`GET .../{name}/logs/pods/{pod}?follow=false`) - the non-streaming form.
 */
export function getPodLogsSnapshot(
  type: WorkloadType,
  group: string,
  name: string,
  pod: string,
  accessToken: string | undefined,
  opts: { container?: string; sinceSeconds?: number; limitBytes?: number } = {},
): Promise<PodLogSnapshot> {
  const q = new URLSearchParams({ follow: "false" });
  if (opts.container) q.set("container", opts.container);
  if (opts.sinceSeconds) q.set("sinceSeconds", String(opts.sinceSeconds));
  if (opts.limitBytes) q.set("limitBytes", String(opts.limitBytes));
  return apiGet<PodLogSnapshot>(
    `${workloadStreamPath(type, group, name, { kind: "logs", pod })}?${q}`,
    accessToken,
  );
}

/**
 * Build the function's current source again (`POST .../functions/{name}/build`,
 * no body). 202 - the spec is untouched and the running revision keeps serving;
 * the build lands via the platform's build controller. Poll the workload (its
 * `build.state` / `status` report Building) to watch it.
 */
export function buildFunction(
  group: string,
  name: string,
  accessToken: string | undefined,
): Promise<WorkloadDetail | null> {
  return apiSend<WorkloadDetail>(
    "POST",
    `${collectionPath("function", group)}/${encodeURIComponent(name)}/build`,
    accessToken,
  );
}

/**
 * Pull the container's image tag again (`POST .../containers/{name}/pull`, no
 * body). 202 - cuts one new revision in every site so the tag is resolved to a
 * digest again. A digest-pinned image is a 400 (nothing newer to pull).
 */
export function pullContainer(
  group: string,
  name: string,
  accessToken: string | undefined,
): Promise<WorkloadDetail | null> {
  return apiSend<WorkloadDetail>(
    "POST",
    `${collectionPath("container", group)}/${encodeURIComponent(name)}/pull`,
    accessToken,
  );
}

/** Create a workload (`POST .../{type}s`); returns 202 + detail with statusUrl. */
export function createWorkload(
  type: WorkloadType,
  group: string,
  spec: FunctionCreateInput | ContainerCreateInput,
  accessToken: string | undefined,
): Promise<WorkloadDetail | null> {
  return apiSend<WorkloadDetail>("POST", collectionPath(type, group), accessToken, spec);
}

/** Update a workload (`PUT .../{type}s/{name}`); full replace of the spec. */
export function updateWorkload(
  type: WorkloadType,
  group: string,
  name: string,
  spec: FunctionUpdateInput | ContainerUpdateInput,
  accessToken: string | undefined,
): Promise<WorkloadDetail | null> {
  return apiSend<WorkloadDetail>(
    "PUT",
    `${collectionPath(type, group)}/${encodeURIComponent(name)}`,
    accessToken,
    spec,
  );
}

/** Delete a workload (`DELETE .../{type}s/{name}`); 204 on success. */
export function deleteWorkload(
  type: WorkloadType,
  group: string,
  name: string,
  accessToken: string | undefined,
): Promise<null> {
  return apiSend<null>(
    "DELETE",
    `${collectionPath(type, group)}/${encodeURIComponent(name)}`,
    accessToken,
  ) as Promise<null>;
}

/** The URL path segment for a workload type ("functions" | "containers"). */
export function typeSegment(type: WorkloadType): "functions" | "containers" {
  return type === "function" ? "functions" : "containers";
}
