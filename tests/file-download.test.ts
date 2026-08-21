import { describe, expect, it } from "vitest";

import {
  contentByteSize,
  downloadFilename,
  fileDownloadPath,
  formatBytes,
} from "../src/lib/file-download";

describe("fileDownloadPath", () => {
  it("builds the console download route with the identifying params", () => {
    expect(fileDownloadPath("function", "api", "/etc/app/config.yaml")).toBe(
      "/api/serverless/files?type=function&name=api&mountPath=%2Fetc%2Fapp%2Fconfig.yaml",
    );
  });

  it("URL-encodes awkward names and paths", () => {
    const path = fileDownloadPath("container", "my-app", "/etc/a b&c.txt");
    const q = new URL(`http://x${path}`).searchParams;
    expect(q.get("type")).toBe("container");
    expect(q.get("name")).toBe("my-app");
    expect(q.get("mountPath")).toBe("/etc/a b&c.txt");
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

describe("formatBytes", () => {
  it("renders bytes below 1 KB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });

  it("renders KB and MB with one decimal until 100", () => {
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(300 * 1024)).toBe("300 KB");
    expect(formatBytes(2 * 1024 * 1024 + 200 * 1024)).toBe("2.2 MB");
  });
});
