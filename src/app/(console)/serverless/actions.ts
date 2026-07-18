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
  createWorkload,
  deleteWorkload,
  ServerlessApiError,
  typeSegment,
  updateWorkload,
  type ContainerCreateInput,
  type ContainerUpdateInput,
  type FunctionCreateInput,
  type FunctionUpdateInput,
  type WorkloadType,
} from "@/lib/serverless";
import { getServerlessContext } from "@/lib/serverless-context";

export interface ActionError {
  error: string;
  code?: string;
  requestId?: string;
}

function toActionError(err: unknown): ActionError {
  if (err instanceof ServerlessApiError) {
    return { error: err.message, code: err.code, requestId: err.requestId };
  }
  return { error: (err as Error).message };
}

/** Resolve the request's active group + token, or an error to return to the form. */
async function requireContext(): Promise<
  { group: string; accessToken?: string } | { fail: ActionError }
> {
  const { enabled, activeGroup, accessToken } = await getServerlessContext();
  if (!enabled) {
    return { fail: { error: "The Serverless API is not configured." } };
  }
  if (!activeGroup) {
    return { fail: { error: "You have no active group to deploy into." } };
  }
  return { group: activeGroup, accessToken };
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
  revalidatePath(`/serverless/${typeSegment(type)}`);
  redirect(`/serverless/${typeSegment(type)}/${encodeURIComponent(spec.name)}`);
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
