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
