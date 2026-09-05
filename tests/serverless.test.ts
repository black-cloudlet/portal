import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildFunction,
  getPodLogsSnapshot,
  getPodsSnapshot,
  getWorkloadStats,
  mintStreamTicket,
  pullContainer,
  rotateFunctionWebhook,
  workloadStreamPath,
} from "../src/lib/serverless";

const BASE = "https://serverless-api.example.com";

/** Capture the requests the client makes and reply with `body`. */
function stubFetch(body: unknown) {
  const calls: { url: string; method: string; body: string | null }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? init.body : null,
    });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return calls;
}

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

describe("getWorkloadStats", () => {
  it("calls the stats endpoint of the workload's own collection", async () => {
    const calls = stubFetch({
      status: "Ready",
      reason: null,
      replicas: 0,
      usage: null,
      regions: [],
    });

    await getWorkloadStats("function", "team", "image-resizer", "tok");
    await getWorkloadStats("container", "team", "orders-api", "tok");

    expect(calls.map((c) => c.url)).toEqual([
      `${BASE}/api/serverless/v1/groups/team/functions/image-resizer/stats`,
      `${BASE}/api/serverless/v1/groups/team/containers/orders-api/stats`,
    ]);
  });

  it("percent-encodes the group and name", async () => {
    const calls = stubFetch({
      status: "Ready",
      reason: null,
      replicas: 0,
      usage: null,
      regions: [],
    });

    await getWorkloadStats("function", "team space", "a/b", "tok");

    expect(calls[0].url).toBe(
      `${BASE}/api/serverless/v1/groups/team%20space/functions/a%2Fb/stats`,
    );
  });

  it("reads the totals and the per-region rows straight off the response", async () => {
    stubFetch({
      status: "Ready",
      reason: null,
      replicas: 3,
      usage: { cpu: "210m", memory: "355Mi" },
      regions: [
        {
          region: "central",
          status: "Ready",
          reason: null,
          replicas: 2,
          usage: { cpu: "120m", memory: "180Mi" },
        },
        { region: "south", status: "Ready", reason: null, replicas: 1, usage: null },
      ],
    });

    const stats = await getWorkloadStats("container", "team", "orders-api", "tok");

    expect(stats.replicas).toBe(3);
    expect(stats.usage?.cpu).toBe("210m");
    expect(stats.regions.map((s) => s.region)).toEqual(["central", "south"]);
    // a region that reported nothing stays null rather than becoming a zero
    expect(stats.regions[1].usage).toBeNull();
  });
});

describe("build and pull", () => {
  it("POSTs the function build trigger with no body", async () => {
    const calls = stubFetch({ status: "Pending" });

    await buildFunction("team", "image-resizer", "tok");

    expect(calls).toEqual([
      {
        url: `${BASE}/api/serverless/v1/groups/team/functions/image-resizer/build`,
        method: "POST",
        body: null,
      },
    ]);
  });

  it("POSTs the container pull trigger with no body", async () => {
    const calls = stubFetch({ status: "Pending" });

    await pullContainer("team", "orders-api", "tok");

    expect(calls).toEqual([
      {
        url: `${BASE}/api/serverless/v1/groups/team/containers/orders-api/pull`,
        method: "POST",
        body: null,
      },
    ]);
  });
});

describe("rotateFunctionWebhook", () => {
  it("POSTs the rotate endpoint with no body and returns the new token", async () => {
    const calls = stubFetch({
      url: `${BASE}/api/serverless/v1/groups/team/functions/image-resizer/build`,
      token: "new-token",
      provider: "gitlab",
      events: ["push"],
    });

    const hook = await rotateFunctionWebhook("team", "image-resizer", "tok");

    expect(calls).toEqual([
      {
        url: `${BASE}/api/serverless/v1/groups/team/functions/image-resizer/webhook/rotate`,
        method: "POST",
        body: null,
      },
    ]);
    // The token is the point of the call: it is shown, not redacted.
    expect(hook.token).toBe("new-token");
    expect(hook.events).toEqual(["push"]);
  });

  it("percent-encodes the group and name", async () => {
    const calls = stubFetch({ url: "u", token: "t", provider: "gitlab", events: ["push"] });

    await rotateFunctionWebhook("team space", "a/b", "tok");

    expect(calls[0].url).toBe(
      `${BASE}/api/serverless/v1/groups/team%20space/functions/a%2Fb/webhook/rotate`,
    );
  });
});

describe("workloadStreamPath", () => {
  it("builds the three ticketable stream paths, without query params", () => {
    const base = "/api/serverless/v1/groups/team/functions/orders";
    expect(workloadStreamPath("function", "team", "orders", { kind: "pods" })).toBe(`${base}/pods`);
    expect(workloadStreamPath("function", "team", "orders", { kind: "stats" })).toBe(
      `${base}/stats/stream`,
    );
    expect(
      workloadStreamPath("function", "team", "orders", { kind: "logs", pod: "orders-x2wql" }),
    ).toBe(`${base}/logs/pods/orders-x2wql`);
  });
});

describe("mintStreamTicket", () => {
  it("spends the token on the tickets endpoint, sending the stream path", async () => {
    const calls = stubFetch({ ticket: "t1", expiresAt: "2026-08-08T12:00:00+03:00", path: "/p" });
    const path = workloadStreamPath("container", "team", "orders-api", { kind: "stats" });

    const minted = await mintStreamTicket(path, "tok");

    expect(calls[0].url).toBe(`${BASE}/api/serverless/v1/stream-tickets`);
    expect(calls[0].method).toBe("POST");
    expect(JSON.parse(calls[0].body ?? "")).toEqual({ path });
    expect(minted.ticket).toBe("t1");
  });
});

describe("pods and pod-log snapshots", () => {
  it("asks the pods endpoint for the one-shot JSON roster", async () => {
    const calls = stubFetch({
      name: "orders",
      group: "team",
      type: "function",
      region: "c",
      pods: [],
    });

    await getPodsSnapshot("function", "team", "orders", "tok");

    expect(calls[0].url).toBe(
      `${BASE}/api/serverless/v1/groups/team/functions/orders/pods?follow=false`,
    );
  });

  it("asks the per-pod log endpoint for a snapshot, with the caller's options", async () => {
    const calls = stubFetch({
      name: "orders",
      group: "team",
      type: "function",
      region: "c",
      pod: "orders-x2wql",
      container: "user-container",
      revision: null,
      lines: [],
    });

    await getPodLogsSnapshot("function", "team", "orders", "orders-x2wql", "tok", {
      container: "user-container",
      sinceSeconds: 60,
      limitBytes: 65536,
    });

    expect(calls[0].url).toBe(
      `${BASE}/api/serverless/v1/groups/team/functions/orders/logs/pods/orders-x2wql` +
        `?follow=false&container=user-container&sinceSeconds=60&limitBytes=65536`,
    );
  });
});
