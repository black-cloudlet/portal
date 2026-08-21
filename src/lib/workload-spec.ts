/**
 * Pure helpers that turn the create/edit form's row state into the API's env /
 * files request lists, implementing the Serverless API's keep-on-write contract
 * (see api/models/common.py, function.py, container.py).
 *
 * Keep-on-write (edit only): a secret entry left blank keeps its stored value
 * (secret env -> value null; secret file -> content omitted); entering a value
 * changes it; and dropping a row removes it (full-replace over the set). A
 * non-secret var/file always carries its value/content.
 *
 * Kept out of the client component so the mapping can be unit-tested.
 */

import type { EnvVarInput, FileInput } from "@/lib/serverless";

/** A plain (non-secret) environment variable row from the Variables tab. */
export interface EnvRow {
  name: string;
  value: string;
}

/** A secret environment variable row from the Secrets tab. */
export interface SecretRow {
  name: string;
  value: string;
  /** True when this secret already exists on the workload (edit prefill). */
  existing: boolean;
}

/** A mounted-file row from the Files tab. */
export interface FileRow {
  mountPath: string;
  /** The file body: UTF-8 text, or a base64 blob when `encoding` is "base64". */
  content: string;
  /**
   * How `content` is encoded, deciding which API field carries it: "text"
   * (default) sends `content`, "base64" sends `contentBase64`. Uploads are
   * always base64 so binary files survive; hand-typed rows are text.
   */
  encoding?: "text" | "base64";
  secret: boolean;
  readOnly: boolean;
  /** True when this file already exists on the workload (edit prefill). */
  existing: boolean;
  /**
   * Where the row's content came from. The form shows an editable textarea
   * only for "text" (hand-typed) rows; "upload" and "stored" rows show a size
   * summary instead, since their content may be large or non-text and is never
   * rendered. Absent means "text" (and does not affect the built request).
   */
  source?: "text" | "upload" | "stored";
  /**
   * True for a stored non-secret file whose content the API could not return
   * (binary reads back as null). The API has no "keep" for non-secret files -
   * a full replace must carry the bytes - so the form requires re-uploading
   * such a row before saving, instead of silently writing an empty file.
   */
  unreadable?: boolean;
}

/**
 * Merge the Variables (non-secret) and Secrets (secret) rows into the API env
 * list. Rows with a blank name are dropped. On edit, a blank existing secret
 * keeps its stored value (`value: null`); otherwise the entered value is sent.
 */
export function buildEnvList(
  variables: EnvRow[],
  secrets: SecretRow[],
  isEdit: boolean,
): EnvVarInput[] {
  const out: EnvVarInput[] = [];
  for (const v of variables) {
    if (v.name.trim() === "") continue;
    out.push({ name: v.name.trim(), value: v.value, secret: false });
  }
  for (const s of secrets) {
    const n = s.name.trim();
    if (n === "") continue;
    if (s.value.trim() !== "") {
      out.push({ name: n, value: s.value, secret: true }); // set / change
    } else if (isEdit && s.existing) {
      out.push({ name: n, secret: true, value: null }); // keep stored
    } else {
      out.push({ name: n, value: "", secret: true }); // new secret (form validates)
    }
  }
  return out;
}

/**
 * Turn the file rows into the API files list. Rows with a blank mountPath are
 * dropped. On edit, a blank existing secret file keeps its stored content
 * (both content fields omitted); otherwise the entered content is sent.
 * Non-secret files always carry their content.
 *
 * The row's `encoding` picks the API field: "base64" rows go out as
 * `contentBase64` (arbitrary bytes - how the API is told the content may be
 * binary), text rows as `content`. The API accepts exactly one of the two.
 */
export function buildFileList(files: FileRow[], isEdit: boolean): FileInput[] {
  const out: FileInput[] = [];
  for (const f of files) {
    const mp = f.mountPath.trim();
    if (mp === "") continue;
    const base = { mountPath: mp, secret: f.secret, readOnly: f.readOnly };
    const body: Pick<FileInput, "content" | "contentBase64"> =
      f.encoding === "base64" ? { contentBase64: f.content } : { content: f.content };
    if (f.secret) {
      if (f.content.trim() !== "") {
        out.push({ ...base, ...body }); // set / change
      } else if (isEdit && f.existing) {
        out.push(base); // keep stored (content omitted)
      } else {
        out.push({ ...base, content: "" }); // new secret file (form validates)
      }
    } else {
      out.push({ ...base, ...body }); // non-secret always carries content
    }
  }
  return out;
}

/** Names the console reserves because they collide with its create/edit routes. */
export const RESERVED_WORKLOAD_NAMES = ["new", "edit"];
