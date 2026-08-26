/**
 * Per-request context shared by the Serverless offering's layout and its tab
 * pages: whether the offering is configured, the caller's active group, and the
 * SSO access token to forward. auth()/cookies() are request-cached, so calling
 * this from both the layout and a page does not double the work.
 */

import { auth } from "@/auth";
import { getService } from "@/lib/services";
import { resolveActiveGroup } from "@/lib/session-group";

export interface ServerlessContext {
  enabled: boolean;
  activeGroup: string | null;
  accessToken?: string;
}

export async function getServerlessContext(): Promise<ServerlessContext> {
  const session = await auth();
  const svc = getService("serverless");
  const groups = session?.user.groups ?? [];
  const activeGroup = await resolveActiveGroup(groups);
  return {
    enabled: Boolean(svc?.enabled),
    activeGroup,
    accessToken: session?.accessToken,
  };
}

/**
 * The context a Serverless write/read path needs, or why it cannot proceed -
 * the single "is serverless usable for this request" gate, shared by the
 * server actions and the file-download route so the policy is defined once.
 * `status` is the HTTP status a route answers with (actions drop it).
 */
export async function requireServerlessContext(): Promise<
  { group: string; accessToken?: string } | { fail: { error: string; status: number } }
> {
  const { enabled, activeGroup, accessToken } = await getServerlessContext();
  if (!enabled) {
    return { fail: { error: "The Serverless API is not configured.", status: 503 } };
  }
  if (!activeGroup) {
    return { fail: { error: "You have no active group.", status: 403 } };
  }
  return { group: activeGroup, accessToken };
}
