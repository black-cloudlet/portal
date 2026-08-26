import { describe, expect, it } from "vitest";

import { buildEnvList, buildFileList } from "../src/lib/workload-spec";

describe("buildEnvList", () => {
  it("keeps non-secret vars with their value and trims the name", () => {
    expect(buildEnvList([{ name: " FOO ", value: "bar" }], [], false)).toEqual([
      { name: "FOO", value: "bar", secret: false },
    ]);
  });

  it("drops rows with a blank name", () => {
    expect(buildEnvList([{ name: "   ", value: "x" }], [], false)).toEqual([]);
    expect(buildEnvList([], [{ name: "", value: "s", existing: false }], false)).toEqual([]);
  });

  it("sends an entered secret value (set/change)", () => {
    expect(buildEnvList([], [{ name: "TOKEN", value: "s3cret", existing: true }], true)).toEqual([
      { name: "TOKEN", value: "s3cret", secret: true },
    ]);
  });

  it("keeps a blank existing secret on edit (value null)", () => {
    expect(buildEnvList([], [{ name: "TOKEN", value: "", existing: true }], true)).toEqual([
      { name: "TOKEN", secret: true, value: null },
    ]);
  });

  it("does not 'keep' a new secret on edit (no stored value to keep)", () => {
    expect(buildEnvList([], [{ name: "TOKEN", value: "", existing: false }], true)).toEqual([
      { name: "TOKEN", value: "", secret: true },
    ]);
  });

  it("does not 'keep' on create even for an existing-flagged row", () => {
    expect(buildEnvList([], [{ name: "TOKEN", value: "", existing: true }], false)).toEqual([
      { name: "TOKEN", value: "", secret: true },
    ]);
  });
});

describe("buildFileList", () => {
  const secretKept = {
    mountPath: "/s",
    content: "",
    encoding: "text" as const,
    secret: true,
    existing: true,
  };

  it("carries content (with text encoding) for non-secret files", () => {
    expect(
      buildFileList(
        [{ mountPath: "/c", content: "hi", encoding: "text", secret: false, existing: false }],
        false,
      ),
    ).toEqual([{ mountPath: "/c", secret: false, content: "hi", encoding: "text" }]);
  });

  it("omits content to keep a blank existing secret file on edit", () => {
    const [out] = buildFileList([secretKept], true);
    expect(out).toEqual({ mountPath: "/s", secret: true });
    expect(out).not.toHaveProperty("content");
  });

  it("sends content when a secret file's content is entered", () => {
    expect(buildFileList([{ ...secretKept, content: "new" }], true)).toEqual([
      { mountPath: "/s", secret: true, content: "new", encoding: "text" },
    ]);
  });

  it("sends empty content for a brand-new secret file (form validates)", () => {
    expect(buildFileList([{ ...secretKept, existing: false }], true)).toEqual([
      { mountPath: "/s", secret: true, content: "", encoding: "text" },
    ]);
  });

  it("drops rows with a blank mount path", () => {
    expect(
      buildFileList(
        [{ mountPath: "  ", content: "x", encoding: "text", secret: false, existing: false }],
        false,
      ),
    ).toEqual([]);
  });

  it("sends a base64 row with encoding base64 (how binary is signalled)", () => {
    expect(
      buildFileList(
        [
          {
            mountPath: "/b",
            content: "3q2+7w==",
            encoding: "base64",
            secret: false,
            existing: false,
          },
        ],
        false,
      ),
    ).toEqual([{ mountPath: "/b", secret: false, content: "3q2+7w==", encoding: "base64" }]);
  });

  it("sends an entered secret base64 row with encoding base64", () => {
    expect(buildFileList([{ ...secretKept, content: "eA==", encoding: "base64" }], true)).toEqual([
      { mountPath: "/s", secret: true, content: "eA==", encoding: "base64" },
    ]);
  });

  it("still keeps a blank existing secret on edit when the row is base64", () => {
    const [out] = buildFileList([{ ...secretKept, encoding: "base64" }], true);
    expect(out).toEqual({ mountPath: "/s", secret: true });
    expect(out).not.toHaveProperty("content");
    expect(out).not.toHaveProperty("encoding");
  });
});
