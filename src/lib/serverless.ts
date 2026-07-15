/**
 * Thin server-side client for the Serverless API.
 *
 * All calls run on the server (React Server Components / route handlers) and
 * forward the user's SSO access token as a Bearer, so the API applies the exact
 * same group-based authorization it would for any other OIDC caller. The token
 * never reaches the browser. The `group` query param is the normalized active
 * group - identical to what the API re-normalizes on its side.
 *
 * The shapes below mirror the API's `WorkloadSummary` and `/info` responses
 * (see api/models/common.py, api/models/info.py).
 */

import { getService } from "@/lib/services";

export interface WorkloadSummary {
  name: string;
  group: string;
  type: "function" | "container";
  hostname: string;
  overallStatus: string;
  size: string | null;
  createdAt: string | null;
  sites: string[];
}

export interface PlatformInfo {
  version: string;
  sites: string[];
  runtimes: string[];
  sizes: string[];
  routeDomain: string;
  defaultHostTemplate: string;
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

/** Public platform capabilities (`GET /api/v1/info`); no auth required. */
export function getPlatformInfo(): Promise<PlatformInfo> {
  return apiGet<PlatformInfo>("/api/v1/info", undefined);
}

/** Functions owned by `group` (`GET /api/v1/groups/{group}/functions`). */
export function listFunctions(group: string, accessToken: string | undefined) {
  return apiGet<WorkloadSummary[]>(
    `/api/v1/groups/${encodeURIComponent(group)}/functions`,
    accessToken,
  );
}

/** Containers owned by `group` (`GET /api/v1/groups/{group}/containers`). */
export function listContainers(group: string, accessToken: string | undefined) {
  return apiGet<WorkloadSummary[]>(
    `/api/v1/groups/${encodeURIComponent(group)}/containers`,
    accessToken,
  );
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
