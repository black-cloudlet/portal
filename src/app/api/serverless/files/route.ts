/**
 * Download one of a workload's mounted files as an attachment
 * (`GET /api/serverless/files?type=...&name=...&mountPath=...`).
 *
 * The console never renders file contents inline (they may be large or
 * non-text); the detail view links here instead. The handler re-reads the
 * workload from the Serverless API with the caller's own token and active
 * group - the same authorization as the detail page, never a client-supplied
 * group - and answers with the file's bytes and a Content-Disposition header.
 *
 * Secret files are never served: the API redacts their contents to null, and
 * this route answers 404 for them so the console cannot become a side channel.
 */

import { NextResponse } from "next/server";

import { downloadFilename } from "@/lib/file-download";
import { getWorkload, ServerlessApiError, type WorkloadType } from "@/lib/serverless";
import { getServerlessContext } from "@/lib/serverless-context";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const name = searchParams.get("name");
  const mountPath = searchParams.get("mountPath");

  if ((type !== "function" && type !== "container") || !name || !mountPath) {
    return NextResponse.json(
      { error: "type (function|container), name and mountPath are required" },
      { status: 400 },
    );
  }

  const { enabled, activeGroup, accessToken } = await getServerlessContext();
  if (!enabled) {
    return NextResponse.json({ error: "The Serverless API is not configured." }, { status: 503 });
  }
  if (!activeGroup) {
    return NextResponse.json({ error: "No active group." }, { status: 403 });
  }

  let wl;
  try {
    wl = await getWorkload(type as WorkloadType, activeGroup, name, accessToken);
  } catch (err) {
    if (err instanceof ServerlessApiError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status ?? 502 });
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 502 });
  }

  const file = wl.files.find((f) => f.mountPath === mountPath);
  // A secret file is treated exactly like a missing one: its content is
  // redacted by the API, and this route must not confirm it exists.
  if (!file || file.secret || file.content == null) {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }

  // The API returns the file as text, or base64-encoded with encoding
  // "base64" when the bytes are not UTF-8 - decode so the download is the
  // file's real bytes either way.
  const bytes =
    file.encoding === "base64"
      ? Buffer.from(file.content, "base64")
      : Buffer.from(file.content, "utf-8");

  const filename = downloadFilename(file.mountPath);
  // ASCII fallback plus the RFC 5987 UTF-8 form for non-ASCII names.
  const asciiName = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
