/**
 * The window after a create in which "not found" means "not yet", not "broken".
 *
 * The Serverless API accepts a create with `202 Accepted` and applies the
 * workload in the background, so the console's post-create redirect regularly
 * beats the platform to it: the user lands on their brand new function's page and
 * the first read answers `NOT_FOUND`. Rendering that as an error tells them their
 * create failed when it is still running.
 *
 * The create action stamps the moment the API accepted the request onto the
 * redirect (`?created=<epoch ms>`); inside the window below, the detail view
 * waits and polls instead. The window is deliberately finite - past it the API's
 * own error is shown again, so a background create that genuinely failed surfaces
 * rather than hiding behind a spinner forever. Both the stamp and the comparison
 * are made on the server, so a skewed browser clock cannot widen it.
 */

import { ServerlessApiError } from "@/lib/serverless";

/** How long after an accepted create a NOT_FOUND still reads as "not yet". */
export const CREATE_GRACE_MS = 3 * 60 * 1000;

/**
 * Whether a failed API call is the API saying the workload does not exist.
 *
 * Matches on the envelope's machine-readable `code` as well as the status, since
 * either alone is enough and only these two are ever populated for a 404.
 */
export function isNotFound(err: unknown): boolean {
  return err instanceof ServerlessApiError && (err.status === 404 || err.code === "NOT_FOUND");
}

/**
 * Whether `created` - the epoch-ms stamp the create redirect carries - is recent
 * enough to wait on.
 *
 * Anything that is not a positive number (absent, empty, hand-edited) is not a
 * stamp this console wrote, so it opens no window: a bare visit to a workload
 * that does not exist still shows the error.
 *
 * @param created The `created` query parameter, if the URL carried one.
 * @param now Milliseconds since the epoch; injectable for tests.
 */
export function withinCreateGrace(created: string | undefined, now: number = Date.now()): boolean {
  const at = Number(created);
  return Number.isFinite(at) && at > 0 && now - at < CREATE_GRACE_MS;
}
