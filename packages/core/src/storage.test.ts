import { describe, expect, it } from "vitest";
import { HARNESS_RUNTIME_INFO } from "./context.js";
import { ValidationError } from "./errors.js";
import { newJobId, newRunId, newWorkflowVersionId } from "./ids.js";
import {
  DEFAULT_RUN_PAGE_SIZE,
  isRunStatus,
  MAX_PAGE_SIZE,
  parseRunRecord,
  RUN_STATUSES,
  type RunRecord,
  resolvePageLimit,
} from "./storage.js";

/**
 * The `Storage` port's own pure surface (M2-T5, M2-T7): the closed status set,
 * the page-limit rule and `parseRunRecord()`.
 *
 * The port's *behaviour* is not tested here, because there is no implementation
 * in this package to test it against; that is `storage.contract.test.ts`, which
 * runs the same suite against the in-memory implementation and against
 * Supabase. What is here is the part core owns outright.
 */

/** A valid record, so a case can state exactly the one field it is breaking. */
function makeRecord(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    runId: newRunId(),
    jobId: newJobId(),
    attempt: 1,
    domain: { id: "vendor-triage", version: "1.0.0" },
    jobType: "vendor-triage",
    status: "completed",
    success: true,
    qualityScore: null,
    costUsd: 0.02,
    latencyMs: 1200,
    modelCalls: 2,
    toolCalls: 1,
    jevCalls: 0,
    fallbackCount: 0,
    humanReview: null,
    workflowVersionId: null,
    agentVersion: `sha256:${"b".repeat(64)}`,
    behaviorFingerprint: `sha256:${"b".repeat(64)}`,
    runtime: { name: "eve", version: "0.63.0", metadata: { sessionId: "sess_1" } },
    target: "@internal/example-agent",
    startedAt: "2026-09-19T12:00:00.000Z",
    finishedAt: "2026-09-19T12:00:01.200Z",
    error: null,
    ...overrides,
  };
}

describe("RUN_STATUSES", () => {
  it("is the four states a run can be in, and `aborted` is one of them", () => {
    // `aborted` is a state rather than a kind of failure (ADR-0031): folding a
    // cancellation into `failed` would make every "how often does this domain
    // break?" query wrong.
    expect([...RUN_STATUSES]).toEqual(["running", "completed", "failed", "aborted"]);
  });

  it.each(RUN_STATUSES)("recognises `%s`", (status) => {
    expect(isRunStatus(status)).toBe(true);
  });

  it.each([["succeeded"], ["RUNNING"], [""], [null], [1]])(
    "rejects %o, which is not a status",
    (value) => {
      expect(isRunStatus(value)).toBe(false);
    },
  );
});

describe("resolvePageLimit", () => {
  it("falls back when no limit is given", () => {
    expect(resolvePageLimit(undefined, DEFAULT_RUN_PAGE_SIZE)).toBe(DEFAULT_RUN_PAGE_SIZE);
  });

  it("accepts a limit inside the range, including both ends", () => {
    expect(resolvePageLimit(1, 50)).toBe(1);
    expect(resolvePageLimit(MAX_PAGE_SIZE, 50)).toBe(MAX_PAGE_SIZE);
  });

  it.each([[0], [-1], [1.5], [MAX_PAGE_SIZE + 1], [Number.NaN]])(
    "throws rather than truncating for %o",
    (limit) => {
      // Truncating would make a short page indistinguishable from the end of
      // the data, which is the bug this rule exists to prevent.
      expect(() => resolvePageLimit(limit, 50)).toThrow(ValidationError);
    },
  );
});

describe("parseRunRecord", () => {
  it("accepts a well-formed record and returns it deep-frozen", () => {
    const record = parseRunRecord(makeRecord());

    expect(record.status).toBe("completed");
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.domain)).toBe(true);
    expect(Object.isFrozen(record.runtime)).toBe(true);
    expect(() => {
      (record as { -readonly [K in keyof RunRecord]: RunRecord[K] }).status = "failed";
    }).toThrow(TypeError);
  });

  it("accepts a running record, whose outcome columns are all empty", () => {
    const record = parseRunRecord(
      makeRecord({
        status: "running",
        success: null,
        costUsd: null,
        latencyMs: null,
        finishedAt: null,
      }),
    );

    expect(record.status).toBe("running");
    expect(record.success).toBeNull();
    expect(record.finishedAt).toBeNull();
  });

  it("accepts a workflow version id and brands it", () => {
    const workflowVersionId = newWorkflowVersionId();
    const record = parseRunRecord(makeRecord({ workflowVersionId }));

    expect(record.workflowVersionId).toBe(workflowVersionId);
  });

  it("rejects an unknown field rather than dropping it", () => {
    // A record this version does not understand was not written by this
    // version, and discarding the part it cannot read would lose data from a
    // row whose whole purpose is to be reproducible.
    expect(() => parseRunRecord(makeRecord({ costCents: 2 }))).toThrow(ValidationError);
  });

  it("reports every problem at once, each with the path to its field", () => {
    let issues: readonly { readonly path: readonly (string | number)[] }[] = [];

    try {
      parseRunRecord(
        makeRecord({
          attempt: 0,
          status: "finished",
          modelCalls: -1,
          runtime: { name: "", version: "1.0.0", metadata: {} },
          startedAt: "not a date",
        }),
      );
    } catch (error) {
      issues = (error as ValidationError).issues;
    }

    expect(issues.map((issue) => issue.path.join("."))).toEqual([
      "attempt",
      "status",
      "modelCalls",
      "runtime.name",
      "startedAt",
    ]);
  });

  it.each([
    ["runId", "not-a-uuid"],
    ["jobId", "not-a-uuid"],
    ["attempt", 0],
    ["jobType", ""],
    ["status", "finished"],
    ["success", "yes"],
    ["qualityScore", Number.POSITIVE_INFINITY],
    ["costUsd", "0.02"],
    ["latencyMs", -1],
    ["modelCalls", 1.5],
    ["toolCalls", null],
    ["jevCalls", -1],
    ["fallbackCount", "0"],
    ["humanReview", 1],
    ["workflowVersionId", "not-a-uuid"],
    ["agentVersion", ""],
    ["behaviorFingerprint", 7],
    ["target", ""],
    ["startedAt", "yesterday"],
    ["finishedAt", "tomorrow"],
    ["error", "boom"],
    ["domain", { id: "vendor-triage" }],
    ["runtime", { name: "eve" }],
  ])("rejects a bad `%s`", (field, value) => {
    expect(() => parseRunRecord(makeRecord({ [field]: value }))).toThrow(ValidationError);
  });

  it("rejects a value that is not an object at all", () => {
    expect(() => parseRunRecord(null)).toThrow(ValidationError);
    expect(() => parseRunRecord("run")).toThrow(ValidationError);
    expect(() => parseRunRecord([])).toThrow(ValidationError);
  });

  it("prefixes issue paths with the path it was given", () => {
    let issues: readonly { readonly path: readonly (string | number)[] }[] = [];

    try {
      parseRunRecord(makeRecord({ attempt: 0 }), ["rows", 3]);
    } catch (error) {
      issues = (error as ValidationError).issues;
    }

    expect(issues[0]?.path).toEqual(["rows", 3, "attempt"]);
  });

  it("keeps the harness runtime as a valid runtime, since startRun writes it", () => {
    const record = parseRunRecord(makeRecord({ runtime: HARNESS_RUNTIME_INFO }));

    expect(record.runtime.name).toBe("harness");
  });
});
