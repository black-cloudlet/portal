"use server";

/**
 * Server actions for the Serverless offering's write path (create/update/delete).
 *
 * Each action derives the active group and the SSO access token on the server
 * (never trusting a client-supplied group), forwards the call to the Serverless
 * API with the user's Bearer token, then revalidates the affected pages. On the
 * API's standard error envelope the action returns the message/code/requestId so
 * the form can show it inline; on success it redirects to the workload.
 */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  buildFunction,
  createWorkload,
  deleteWorkload,
  getPodLogsSnapshot,
  getPodsSnapshot,
  getWorkloadStats,
  mintStreamTicket,
  pullContainer,
  rotateFunctionWebhook,
  serverlessErrorBody,
  streamBaseUrl,
  typeSegment,
  updateWorkload,
  workloadStreamPath,
  type ContainerCreateInput,
  type ContainerUpdateInput,
  type FunctionCreateInput,
  type FunctionUpdateInput,
  type PodLogSnapshot,
  type PodRoster,
  type WebhookView,
  type WorkloadStats,
  type WorkloadType,
} from "@/lib/serverless";
import { requireServerlessContext } from "@/lib/serverless-context";

export interface ActionError {
  error: string;
  code?: string;
  requestId?: string;
}

function toActionError(err: unknown): ActionError {
  return serverlessErrorBody(err);
}

/** Resolve the request's active group + token, or an error to return to the form. */
async function requireContext(): Promise<
  { group: string; accessToken?: string } | { fail: ActionError }
> {
  const ctx = await requireServerlessContext();
  return "fail" in ctx ? { fail: { error: ctx.fail.error } } : ctx;
}

export async function createWorkloadAction(
  type: WorkloadType,
  spec: FunctionCreateInput | ContainerCreateInput,
): Promise<ActionError | void> {
  const ctx = await requireContext();
  if ("fail" in ctx) return ctx.fail;

  try {
    await createWorkload(type, ctx.group, spec, ctx.accessToken);
  } catch (err) {
    return toActionError(err);
  }
  // No redirect: the form stays where the user is (the list, or the /new page
  // navigating back to it) and hands the accepted workload to the creation
  // tracker, which follows the deploy from the corner of the screen. The 202
  // is applied in the background, so the workload may briefly answer NOT_FOUND
  // - the tracker waits that race out (see lib/pending-create.ts).
  revalidatePath(`/serverless/${typeSegment(type)}`);
}

export async function updateWorkloadAction(
  type: WorkloadType,
  name: string,
  spec: FunctionUpdateInput | ContainerUpdateInput,
): Promise<ActionError | void> {
  const ctx = await requireContext();
  if ("fail" in ctx) return ctx.fail;

  try {
    await updateWorkload(type, ctx.group, name, spec, ctx.accessToken);
  } catch (err) {
    return toActionError(err);
  }
  const seg = typeSegment(type);
  revalidatePath(`/serverless/${seg}/${name}`);
  revalidatePath(`/serverless/${seg}`);
  redirect(`/serverless/${seg}/${encodeURIComponent(name)}`);
}

/**
 * Build the function's current source again (POST .../build, no body). The API
 * answers 202 and the build runs in the background; the caller refreshes the
 * detail view, which reports `Building` while it runs.
 */
export async function rebuildFunctionAction(name: string): Promise<ActionError | void> {
  const ctx = await requireContext();
  if ("fail" in ctx) return ctx.fail;

  try {
    await buildFunction(ctx.group, name, ctx.accessToken);
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/serverless/functions/${name}`);
}

/**
 * Pull the container's image tag again (POST .../pull, no body). 202 - one new
 * revision per region re-resolves the tag; a digest-pinned image returns the
 * API's own 400, surfaced inline.
 */
export async function pullContainerAction(name: string): Promise<ActionError | void> {
  const ctx = await requireContext();
  if ("fail" in ctx) return ctx.fail;

  try {
    await pullContainer(ctx.group, name, ctx.accessToken);
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/serverless/containers/${name}`);
}

/**
 * Replace the function's git-webhook token (POST .../webhook/rotate) and hand
 * the new one back to the caller, which shows it so the hook can be
 * reconfigured. The API writes every region before answering, so the old token
 * is already dead when this returns - there is no overlap window to warn about.
 */
export async function rotateWebhookAction(
  name: string,
): Promise<{ webhook: WebhookView } | ActionError> {
  const ctx = await requireContext();
  if ("fail" in ctx) return ctx.fail;

  let webhook: WebhookView;
  try {
    webhook = await rotateFunctionWebhook(ctx.group, name, ctx.accessToken);
  } catch (err) {
    return toActionError(err);
  }
  revalidatePath(`/serverless/functions/${name}`);
  return { webhook };
}

/** What a client stream component asks to follow. */
export type StreamSpec =
  | { kind: "pods" }
  | { kind: "stats" }
  | {
      kind: "logs";
      pod: string;
      container?: string;
      sinceSeconds?: number;
      /** Open at the newest N lines however old they are (clamped by the API). */
      tailLines?: number;
    };

/**
 * Mint a stream ticket for one of this workload's SSE endpoints and hand the
 * browser the full URL to open (`EventSource` cannot send an Authorization
 * header, so the token is spent here - server-side - for a short-lived,
 * single-path ticket; see the Serverless API's streaming docs).
 *
 * The group comes from the session, never from the client; the API re-runs the
 * same group authorization when the stream opens. A 503 means the deployment
 * mints no tickets, and the caller falls back to snapshot polling.
 */
export async function mintStreamUrlAction(
  type: WorkloadType,
  name: string,
  stream: StreamSpec,
): Promise<{ url: string } | ActionError> {
  const ctx = await requireContext();
  if ("fail" in ctx) return ctx.fail;

  const path = workloadStreamPath(
    type,
    ctx.group,
    name,
    stream.kind === "logs" ? { kind: "logs", pod: stream.pod } : { kind: stream.kind },
  );
  try {
    const { ticket } = await mintStreamTicket(path, ctx.accessToken);
    const q = new URLSearchParams({ ticket });
    if (stream.kind === "logs") {
      if (stream.container) q.set("container", stream.container);
      if (stream.sinceSeconds) q.set("sinceSeconds", String(stream.sinceSeconds));
      if (stream.tailLines) q.set("tailLines", String(stream.tailLines));
    }
    return { url: `${streamBaseUrl()}${path}?${q}` };
  } catch (err) {
    return toActionError(err);
  }
}

/** Poll fallback for the Metrics tab when the stats stream cannot be opened. */
export async function getStatsAction(
  type: WorkloadType,
  name: string,
): Promise<{ stats: WorkloadStats } | ActionError> {
  const ctx = await requireContext();
  if ("fail" in ctx) return ctx.fail;

  try {
    return { stats: await getWorkloadStats(type, ctx.group, name, ctx.accessToken) };
  } catch (err) {
    return toActionError(err);
  }
}

/** Poll fallback for the pod roster when the pods stream cannot be opened. */
export async function getPodsAction(
  type: WorkloadType,
  name: string,
): Promise<{ roster: PodRoster } | ActionError> {
  const ctx = await requireContext();
  if ("fail" in ctx) return ctx.fail;

  try {
    return { roster: await getPodsSnapshot(type, ctx.group, name, ctx.accessToken) };
  } catch (err) {
    return toActionError(err);
  }
}

/** Snapshot fallback for one pod's log when its stream cannot be opened. */
export async function getPodLogsAction(
  type: WorkloadType,
  name: string,
  pod: string,
  opts: { container?: string; sinceSeconds?: number; limitBytes?: number } = {},
): Promise<{ snapshot: PodLogSnapshot } | ActionError> {
  const ctx = await requireContext();
  if ("fail" in ctx) return ctx.fail;

  try {
    return {
      snapshot: await getPodLogsSnapshot(type, ctx.group, name, pod, ctx.accessToken, opts),
    };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteWorkloadAction(
  type: WorkloadType,
  name: string,
): Promise<ActionError | void> {
  const ctx = await requireContext();
  if ("fail" in ctx) return ctx.fail;

  try {
    await deleteWorkload(type, ctx.group, name, ctx.accessToken);
  } catch (err) {
    return toActionError(err);
  }
  const seg = typeSegment(type);
  revalidatePath(`/serverless/${seg}`);
  redirect(`/serverless/${seg}`);
}
