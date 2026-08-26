import { describe, expect, it } from "vitest";

import {
  base64ByteSize,
  bytesToBase64,
  contentByteSize,
  downloadFilename,
  fileByteSize,
  fileDownloadPath,
  formatBytes,
} from "../src/lib/file-download";

describe("fileDownloadPath", () => {
  it("builds the console download route with the identifying params", () => {
    expect(fileDownloadPath("function", "api", "/etc/app/config.yaml", "team")).toBe(
      "/api/serverless/files?type=function&name=api&mountPath=%2Fetc%2Fapp%2Fconfig.yaml&group=team",
    );
  });

  it("URL-encodes awkward names and paths", () => {
    const path = fileDownloadPath("container", "my-app", "/etc/a b&c.txt", "a/b team");
    const q = new URL(`http://x${path}`).searchParams;
    expect(q.get("type")).toBe("container");
    expect(q.get("name")).toBe("my-app");
    expect(q.get("mountPath")).toBe("/etc/a b&c.txt");
    expect(q.get("group")).toBe("a/b team");
  });
});

describe("downloadFilename", () => {
  it("uses the mount path's last segment", () => {
    expect(downloadFilename("/etc/app/config.yaml")).toBe("config.yaml");
  });

  it("ignores a trailing slash", () => {
    expect(downloadFilename("/etc/app/")).toBe("app");
  });

  it("falls back to 'file' when the path has no segments", () => {
    expect(downloadFilename("/")).toBe("file");
    expect(downloadFilename("")).toBe("file");
  });
});

describe("contentByteSize", () => {
  it("counts bytes, not code points", () => {
    expect(contentByteSize("abc")).toBe(3);
    expect(contentByteSize("é")).toBe(2); // UTF-8
    expect(contentByteSize("")).toBe(0);
  });
});

describe("bytesToBase64", () => {
  it("encodes arbitrary (non-UTF-8) bytes", () => {
    expect(bytesToBase64(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBe("3q2+7w==");
    expect(bytesToBase64(new Uint8Array([]))).toBe("");
  });

  it("round-trips content larger than one encoding chunk", () => {
    const bytes = new Uint8Array(0x8000 + 17).map((_, i) => i % 251);
    const decoded = Uint8Array.from(atob(bytesToBase64(bytes)), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });
});

describe("base64ByteSize", () => {
  it("reports the decoded size, ignoring padding", () => {
    expect(base64ByteSize("3q2+7w==")).toBe(4); // 4 bytes
    expect(base64ByteSize("eA==")).toBe(1);
    expect(base64ByteSize("")).toBe(0);
  });

  it("tolerates line-wrapped bodies (PEM-style)", () => {
    expect(base64ByteSize("eHh4\neHh4\n")).toBe(6);
  });

  it("counts the URL-safe alphabet as significant", () => {
    expect(base64ByteSize("3q2-7w")).toBe(4); // base64url of de ad be ef
  });
});

describe("fileByteSize", () => {
  it("dispatches on the encoding", () => {
    expect(fileByteSize("3q2+7w==", "base64")).toBe(4);
    expect(fileByteSize("héllo", "text")).toBe(6);
    expect(fileByteSize("héllo", undefined)).toBe(6); // absent encoding = text
  });
});

describe("formatBytes", () => {
  it("renders bytes below 1 KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("renders KB, MB, and GB with one decimal until 100", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(300 * 1024)).toBe("300 KB");
    expect(formatBytes(2 * 1024 * 1024 + 200 * 1024)).toBe("2.2 MB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
  });

  it("promotes at the unit boundary instead of showing 1024", () => {
    expect(formatBytes(1024 * 1024 - 1)).toBe("1.0 MB"); // never "1024 KB"
    expect(formatBytes(1023 * 1024)).toBe("1023 KB");
  });
});
