/**
 * Download one of a workload's mounted files as an attachment
 * (`GET /api/serverless/files?type=...&name=...&mountPath=...&group=...`).
 *
 * The console never renders file contents inline (they may be large or
 * binary); the detail view links here instead. The handler re-reads the
 * workload from the Serverless API with the caller's own token and active
 * group - the same authorization as the detail page, never a client-supplied
 * group. The `group` parameter is only a staleness check: it names the group
 * the page was rendered for, and a mismatch with the session's active group
 * is refused rather than silently serving another group's same-named file.
 *
 * Secret files are never served: the API redacts their contents to null, and
 * this route answers 404 for them so the console cannot become a side channel.
 */

import { NextResponse } from "next/server";

import { downloadFilename } from "@/lib/file-download";
import { getWorkload, ServerlessApiError, serverlessErrorBody } from "@/lib/serverless";
import { requireServerlessContext } from "@/lib/serverless-context";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const name = searchParams.get("name");
  const mountPath = searchParams.get("mountPath");
  const group = searchParams.get("group");

  if ((type !== "function" && type !== "container") || !name || !mountPath) {
    return NextResponse.json(
      { error: "type (function|container), name and mountPath are required" },
      { status: 400 },
    );
  }

  const ctx = await requireServerlessContext();
  if ("fail" in ctx) {
    return NextResponse.json({ error: ctx.fail.error }, { status: ctx.fail.status });
  }
  // Stale-tab guard: the link carries the group its page was rendered for. If
  // the active group has changed since (another tab's switch), refuse instead
  // of resolving the name against the new group.
  if (group !== null && group !== ctx.group) {
    return NextResponse.json(
      { error: "The active group changed since this page was loaded - reload and retry." },
      { status: 409 },
    );
  }

  let wl;
  try {
    wl = await getWorkload(type, ctx.group, name, ctx.accessToken);
  } catch (err) {
    const status = err instanceof ServerlessApiError ? (err.status ?? 502) : 502;
    return NextResponse.json(serverlessErrorBody(err), { status });
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
  // Quoted-string fallback: strip non-printable-ASCII, and both '"' and '\'
  // (a quoted-pair backslash would corrupt or unbalance the quoting).
  const asciiName = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "'");
  // RFC 5987 form: encodeURIComponent leaves ' ( ) * bare, but they are not
  // attr-chars (a raw ' collides with the UTF-8''<value> delimiters).
  const rfc5987Name = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  // Zero-copy view over the Buffer (a plain `new Uint8Array(buffer)` clones).
  return new Response(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${rfc5987Name}`,
      "Cache-Control": "no-store",
    },
  });
}
