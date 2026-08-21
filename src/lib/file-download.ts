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

/**
 * Base64-encode raw bytes (chunked so a large file does not blow the argument
 * limit of `String.fromCharCode`). This is how an upload is sent to the API:
 * `contentBase64` carries arbitrary bytes, where `content` is UTF-8 text only.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Decoded byte size of a base64 blob (ignoring whitespace and padding). */
export function base64ByteSize(b64: string): number {
  const significant = b64.replace(/[^A-Za-z0-9+/]/g, "").length;
  return Math.floor((significant * 3) / 4);
}

/** Human-readable size for the file summaries ("512 B", "3.4 KB", "1.2 MB"). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (kb < 1024) return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}
