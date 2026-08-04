import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getWorkloadStats } from "../src/lib/serverless";

const BASE = "https://serverless-api.example.com";

/** Capture the URL the client calls and reply with `body`. */
function stubFetch(body: unknown) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return calls;
}

describe("getWorkloadStats", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.PORTAL_SERVERLESS_API_URL;
    process.env.PORTAL_SERVERLESS_API_URL = BASE;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.PORTAL_SERVERLESS_API_URL;
    else process.env.PORTAL_SERVERLESS_API_URL = saved;
    vi.unstubAllGlobals();
  });

  it("calls the stats endpoint of the workload's own collection", async () => {
    const calls = stubFetch({ overallStatus: "Ready", replicas: 0, usage: null, sites: [] });

    await getWorkloadStats("function", "team", "image-resizer", "tok");
    await getWorkloadStats("container", "team", "orders-api", "tok");

    expect(calls).toEqual([
      `${BASE}/api/v1/groups/team/functions/image-resizer/stats`,
      `${BASE}/api/v1/groups/team/containers/orders-api/stats`,
    ]);
  });

  it("percent-encodes the group and name", async () => {
    const calls = stubFetch({ overallStatus: "Ready", replicas: 0, usage: null, sites: [] });

    await getWorkloadStats("function", "team space", "a/b", "tok");

    expect(calls[0]).toBe(`${BASE}/api/v1/groups/team%20space/functions/a%2Fb/stats`);
  });

  it("reads the totals and the per-site rows straight off the response", async () => {
    stubFetch({
      overallStatus: "Ready",
      replicas: 3,
      usage: { cpu: "210m", memory: "355Mi" },
      sites: [
        { site: "central", status: "Ready", replicas: 2, usage: { cpu: "120m", memory: "180Mi" } },
        { site: "south", status: "Ready", replicas: 1, usage: null },
      ],
    });

    const stats = await getWorkloadStats("container", "team", "orders-api", "tok");

    expect(stats.replicas).toBe(3);
    expect(stats.usage?.cpu).toBe("210m");
    expect(stats.sites.map((s) => s.site)).toEqual(["central", "south"]);
    // a site that reported nothing stays null rather than becoming a zero
    expect(stats.sites[1].usage).toBeNull();
  });
});
