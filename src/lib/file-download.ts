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

import type { FileEncoding, WorkloadType } from "@/lib/serverless";

/** The console route that serves a mounted file as an attachment. */
export const FILE_DOWNLOAD_ROUTE = "/api/serverless/files";

/**
 * The href the detail view links for one mounted file. The API call is always
 * made with the session's active group (never a client-supplied one); `group`
 * here is the group the page was rendered for, which the route compares to the
 * session's so a stale tab cannot download a same-named workload's file from
 * another group after a group switch.
 */
export function fileDownloadPath(
  type: WorkloadType,
  name: string,
  mountPath: string,
  group: string,
): string {
  const q = new URLSearchParams({ type, name, mountPath, group });
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
 * content with `encoding: "base64"` carries arbitrary bytes, where a text
 * content string is UTF-8 only.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Decoded byte size of a base64 blob (ignoring whitespace and padding). The
 * URL-safe alphabet (-/_) counts as significant so a base64url body is sized
 * correctly too.
 */
export function base64ByteSize(b64: string): number {
  const significant = b64.replace(/[^A-Za-z0-9+/\-_]/g, "").length;
  return Math.floor((significant * 3) / 4);
}

/** The decoded size of a file's content string, honoring its encoding. */
export function fileByteSize(content: string, encoding: FileEncoding | undefined): number {
  return encoding === "base64" ? base64ByteSize(content) : contentByteSize(content);
}

/** Human-readable size for the file summaries ("512 B", "3.4 KB", "1.2 MB"). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  // Promote when the DISPLAYED value would read as 1024 (e.g. 1048575 bytes
  // must show "1.0 MB", never "1024 KB").
  while (i < units.length - 1 && Math.round(v) >= 1024) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}
