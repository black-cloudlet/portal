/**
 * Pure helpers for downloading a workload's mounted files through the console.
 *
 * File contents are deliberately never rendered in the UI (they may be large or
 * non-text); instead the detail view links to the console's own download route,
 * which re-reads the workload server-side and answers with the content as an
 * attachment. Only non-secret files are downloadable - the API redacts secret
 * contents, and the route refuses them outright.
 *
 * Kept out of the components so the mapping can be unit-tested.
 */

import type { WorkloadType } from "@/lib/serverless";

/** The console route that serves a mounted file as an attachment. */
export const FILE_DOWNLOAD_ROUTE = "/api/serverless/files";

/**
 * The href the detail view links for one mounted file. The group is resolved
 * server-side from the session (as everywhere else), so it is not a parameter.
 */
export function fileDownloadPath(type: WorkloadType, name: string, mountPath: string): string {
  const q = new URLSearchParams({ type, name, mountPath });
  return `${FILE_DOWNLOAD_ROUTE}?${q}`;
}

/** The filename a download is saved under: the mount path's last segment. */
export function downloadFilename(mountPath: string): string {
  const base = mountPath.split("/").filter(Boolean).pop() ?? "";
  return base === "" ? "file" : base;
}

/** Byte length of a file's content as the API returns it (a JS string). */
export function contentByteSize(content: string): number {
  return new TextEncoder().encode(content).length;
}

/** Human-readable size for the file summaries ("512 B", "3.4 KB", "1.2 MB"). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}
