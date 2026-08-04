import { describe, expect, it } from "vitest";

import { CREATE_GRACE_MS, isNotFound, withinCreateGrace } from "../src/lib/pending-create";
import { ServerlessApiError } from "../src/lib/serverless";

describe("isNotFound", () => {
  it("matches the API's 404, by status or by envelope code", () => {
    expect(isNotFound(new ServerlessApiError("function 'fn' not found", 404))).toBe(true);
    expect(
      isNotFound(new ServerlessApiError("function 'fn' not found", undefined, "NOT_FOUND")),
    ).toBe(true);
  });

  it("does not match any other failure", () => {
    // A workload that exists but is refused, or a site that could not answer, is
    // a real error - waiting on it would hide it behind a spinner.
    expect(isNotFound(new ServerlessApiError("forbidden", 403, "FORBIDDEN"))).toBe(false);
    expect(isNotFound(new ServerlessApiError("site unreachable", 503))).toBe(false);
    expect(isNotFound(new Error("Could not reach the Serverless API"))).toBe(false);
    expect(isNotFound(undefined)).toBe(false);
  });
});

describe("withinCreateGrace", () => {
  const now = 1_700_000_000_000;

  it("is open right after the create and closed once the window passes", () => {
    expect(withinCreateGrace(String(now), now)).toBe(true);
    expect(withinCreateGrace(String(now - CREATE_GRACE_MS + 1000), now)).toBe(true);
    // Past the window the API's own NOT_FOUND is shown again, so a background
    // create that actually failed surfaces instead of polling forever.
    expect(withinCreateGrace(String(now - CREATE_GRACE_MS), now)).toBe(false);
    expect(withinCreateGrace(String(now - 24 * 60 * 60 * 1000), now)).toBe(false);
  });

  it("opens no window without a stamp this console wrote", () => {
    // Visiting a workload that does not exist must still show the error.
    expect(withinCreateGrace(undefined, now)).toBe(false);
    expect(withinCreateGrace("", now)).toBe(false);
    expect(withinCreateGrace("soon", now)).toBe(false);
    expect(withinCreateGrace("0", now)).toBe(false);
    expect(withinCreateGrace("-1", now)).toBe(false);
  });
});
