import { describe, expect, expectTypeOf, it } from "vitest";
import { type CreateJobInput, defineDomain } from "./domain.js";
import { ValidationError } from "./errors.js";
import { entityIdTimestamp, newJobId } from "./ids.js";
import { isJob, type Job, parseJob } from "./job.js";
import type { Schema, SchemaResult } from "./schema.js";

/**
 * The finalized `Job` contract (M2-T2, ADR-0032): deep immutability, the
 * boundary validator, and the creation time derived from the id.
 *
 * The fixture is built through `defineDomain()` rather than written as an
 * object literal, so what is round-tripped is a job the harness actually
 * produces. It mirrors `apps/example-agent/src/domain/` field for field,
 * including the bare unversioned `procurement-sop` reference; core's own tests
 * cannot import the example app, because nothing in `packages/*` may depend on
 * `apps/*`.
 */

interface TriageInput {
  readonly vendorName: string;
  readonly evidence: readonly string[];
}

interface TriageOutput {
  readonly category: string;
}

function schemaOf<T>(
  validate: (value: unknown) => SchemaResult<T> | Promise<SchemaResult<T>>,
): Schema<T> {
  return { "~standard": { version: 1, vendor: "harness-test", validate } };
}

const inputSchema = schemaOf<TriageInput>((value) => ({ value: value as TriageInput }));
const outputSchema = schemaOf<TriageOutput>((value) => ({ value: value as TriageOutput }));

function createJob(input: TriageInput): CreateJobInput<TriageInput> {
  return {
    jobType: "vendor-triage",
    objective: `Triage ${input.vendorName} against the supplied procurement SOP.`,
    input,
    contracts: {
      inputSchema: "vendor-triage.input@1.0.0",
      outputSchema: "vendor-triage.output@1.0.0",
      sop: "procurement-sop",
    },
    budget: { maxModelCalls: 8, maxToolCalls: 8, maxDurationMs: 120_000, maxCostUsd: 0.5 },
    permissions: [
      { toolId: "lookup_vendor_evidence", mode: "read" },
      { toolId: "publish_report", mode: "write", scope: "reports/vendor" },
    ],
    metadata: { fixtureEvidenceOnly: true, tags: ["finance"] },
  };
}

const vendorTriage = defineDomain<TriageInput, TriageOutput>({
  id: "vendor-triage",
  version: "1.0.0",
  inputSchema,
  outputSchema,
  createJob,
});

const INPUT: TriageInput = { vendorName: "Northwind Ledger", evidence: ["/security"] };

/** The example job as JSON and back, which is how M2-T5 and M6 will meet it. */
function roundTrip(job: Job<TriageInput, TriageOutput>): unknown {
  return JSON.parse(JSON.stringify(job)) as unknown;
}

/** A plain-object copy of the round-tripped job, for mutating in a rejection test. */
function invalidJob(mutate: (value: Record<string, unknown>) => void): unknown {
  const value = roundTrip(vendorTriage.createJob(INPUT)) as Record<string, unknown>;
  mutate(value);
  return value;
}

function issuePaths(thrown: unknown): unknown[] {
  expect(thrown).toBeInstanceOf(ValidationError);
  return (thrown as ValidationError).issues.map((issue) => issue.path);
}

function parseFailure(value: unknown): unknown {
  try {
    parseJob(value);
  } catch (error) {
    return error;
  }

  return expect.unreachable("expected parseJob to throw");
}

describe("a job is deeply immutable", () => {
  it("freezes the nested budget, permissions, metadata and input", () => {
    const job = vendorTriage.createJob(INPUT);

    expect(Object.isFrozen(job)).toBe(true);

    // The four that a one-level `Object.freeze` would have left mutable, and
    // the two that would have silently widened what an execution may do.
    expect(() => {
      (job.budget as { maxCostUsd?: number }).maxCostUsd = 1e9;
    }).toThrow(TypeError);
    expect(() => {
      (job.permissions[0] as { mode: string }).mode = "write";
    }).toThrow(TypeError);
    expect(Object.isFrozen(job.permissions)).toBe(true);
    expect(() => {
      (job.metadata as { approved?: boolean }).approved = true;
    }).toThrow(TypeError);
    expect(() => {
      (job.input as { vendorName: string }).vendorName = "Someone Else";
    }).toThrow(TypeError);
    expect(() => {
      (job.input.evidence as string[]).push("/forged");
    }).toThrow(TypeError);
    expect(() => {
      (job.contracts as { sop: string }).sop = "other-sop";
    }).toThrow(TypeError);
  });

  it("stays frozen through the metadata a run merges into it", () => {
    // The shape `createHarness()` builds for its effective job: a spread of the
    // job with merged fields, deep-frozen again.
    const job = vendorTriage.createJob(INPUT);
    const nested = job.metadata.tags;

    expect(Object.isFrozen(nested)).toBe(true);
  });
});

describe("a job's creation time comes from its id", () => {
  it("has no `createdAt` field to disagree with the id", () => {
    const job = vendorTriage.createJob(INPUT);

    expect(Object.keys(job)).toEqual([
      "id",
      "domain",
      "jobType",
      "objective",
      "input",
      "contracts",
      "budget",
      "permissions",
      "metadata",
    ]);
  });

  it("reads the creation instant back out of the id", () => {
    const before = Date.now();
    const job = vendorTriage.createJob(INPUT);

    const createdAt = entityIdTimestamp(job.id);

    expect(createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(createdAt.getTime()).toBeLessThanOrEqual(Date.now() + 1);
  });
});

describe("parseJob", () => {
  it("round-trips a real job through JSON without losing anything", () => {
    const job = vendorTriage.createJob(INPUT);

    expect(parseJob(roundTrip(job))).toEqual(job);
  });

  it("round-trips a job whose optional fields are all absent", () => {
    const minimal = defineDomain<TriageInput, TriageOutput>({
      id: "vendor-triage",
      version: "1.0.0",
      inputSchema,
      outputSchema,
      createJob: (input) => ({
        jobType: "vendor-triage",
        objective: "Triage.",
        input,
        contracts: {
          inputSchema: "vendor-triage.input@1.0.0",
          outputSchema: "vendor-triage.output@1.0.0",
          sop: "procurement-sop",
        },
      }),
    });

    const job = minimal.createJob(INPUT);

    // An absent budget dimension is unlimited, not zero, and it stays absent.
    expect(parseJob(roundTrip(job))).toEqual(job);
    expect(parseJob(roundTrip(job)).budget).toEqual({});
  });

  it("returns a deep-frozen job, because a job read back is still a job", () => {
    const parsed = parseJob(roundTrip(vendorTriage.createJob(INPUT)));

    expect(Object.isFrozen(parsed)).toBe(true);
    expect(() => {
      (parsed.budget as { maxCostUsd?: number }).maxCostUsd = 1e9;
    }).toThrow(TypeError);
    expect(() => {
      (parsed.permissions[0] as { mode: string }).mode = "write";
    }).toThrow(TypeError);
  });

  it("returns `Job<unknown, unknown>`, leaving the narrowing to the caller", () => {
    // The input's type belongs to the domain, whose schema is the only thing
    // that can check it, and the output's is phantom.
    expectTypeOf<ReturnType<typeof parseJob>>().toEqualTypeOf<Job<unknown, unknown>>();
  });

  it("drops nothing and keeps the scope on a narrowed grant", () => {
    const parsed = parseJob(roundTrip(vendorTriage.createJob(INPUT)));

    expect(parsed.permissions).toEqual([
      { toolId: "lookup_vendor_evidence", mode: "read" },
      { toolId: "publish_report", mode: "write", scope: "reports/vendor" },
    ]);
  });

  it.each([
    ["null", null],
    ["a string", "a job"],
    ["an array", []],
    ["a class instance", new Date()],
  ])("rejects %s as not a job at all", (_label, value) => {
    expect(issuePaths(parseFailure(value))).toEqual([[]]);
  });

  it.each([
    [
      "a v4 id",
      (job: Record<string, unknown>) => (job.id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"),
    ],
    [
      "an uppercase id",
      (job: Record<string, unknown>) => (job.id = String(newJobId()).toUpperCase()),
    ],
    ["a missing id", (job: Record<string, unknown>) => delete job.id],
  ])("rejects %s", (_label, mutate) => {
    expect(issuePaths(parseFailure(invalidJob(mutate)))).toEqual([["id"]]);
  });

  it.each([
    [
      "a domain that is a string",
      (job: Record<string, unknown>) => (job.domain = "vendor-triage"),
      [["domain"]],
    ],
    [
      "a domain with a ranged version",
      (job: Record<string, unknown>) => (job.domain = { id: "vendor-triage", version: "^1.0.0" }),
      [["domain", "version"]],
    ],
    ["a blank jobType", (job: Record<string, unknown>) => (job.jobType = "   "), [["jobType"]]],
    [
      "a missing objective",
      (job: Record<string, unknown>) => delete job.objective,
      [["objective"]],
    ],
  ])("rejects %s", (_label, mutate, paths) => {
    expect(issuePaths(parseFailure(invalidJob(mutate)))).toEqual(paths);
  });

  it.each([
    [
      "an input schema reference with no version",
      (contracts: Record<string, unknown>) => (contracts.inputSchema = "vendor-triage.input"),
      [["contracts", "inputSchema"]],
    ],
    [
      "an output schema reference that is not a string",
      (contracts: Record<string, unknown>) => (contracts.outputSchema = 1),
      [["contracts", "outputSchema"]],
    ],
    [
      "a SOP reference containing a space",
      (contracts: Record<string, unknown>) => (contracts.sop = "procurement sop"),
      [["contracts", "sop"]],
    ],
    [
      "an empty SOP reference",
      (contracts: Record<string, unknown>) => (contracts.sop = ""),
      [["contracts", "sop"]],
    ],
    [
      "an unknown contract field",
      (contracts: Record<string, unknown>) => (contracts.policy = "some-policy"),
      [["contracts", "policy"]],
    ],
  ])("rejects %s", (_label, mutate, paths) => {
    const thrown = parseFailure(
      invalidJob((job) => {
        mutate(job.contracts as Record<string, unknown>);
      }),
    );

    expect(issuePaths(thrown)).toEqual(paths);
  });

  it("accepts the bare unversioned SOP reference the example domain writes", () => {
    const parsed = parseJob(roundTrip(vendorTriage.createJob(INPUT)));

    expect(parsed.contracts.sop).toBe("procurement-sop");
  });

  it.each([
    ["a negative limit", { maxCostUsd: -1 }, [["budget", "maxCostUsd"]]],
    ["a non-finite limit", { maxDurationMs: Number.MAX_VALUE * 2 }, [["budget", "maxDurationMs"]]],
    ["a fractional call count", { maxModelCalls: 1.5 }, [["budget", "maxModelCalls"]]],
    ["a string limit", { maxToolCalls: "8" }, [["budget", "maxToolCalls"]]],
    ["an unknown dimension", { maxTokens: 100 }, [["budget", "maxTokens"]]],
  ])("rejects a budget with %s", (_label, override, paths) => {
    const thrown = parseFailure(
      invalidJob((job) => {
        job.budget = { ...(job.budget as object), ...override };
      }),
    );

    expect(issuePaths(thrown)).toEqual(paths);
  });

  it("accepts a fractional cost, because money is not a count", () => {
    const parsed = parseJob(
      invalidJob((job) => {
        job.budget = { maxCostUsd: 0.25 };
      }),
    );

    expect(parsed.budget).toEqual({ maxCostUsd: 0.25 });
  });

  it.each([
    ["not an array", (job: Record<string, unknown>) => (job.permissions = {}), [["permissions"]]],
    [
      "a grant with an unknown mode",
      (job: Record<string, unknown>) => (job.permissions = [{ toolId: "t", mode: "admin" }]),
      [["permissions", 0, "mode"]],
    ],
    [
      "a grant with no toolId",
      (job: Record<string, unknown>) => (job.permissions = [{ mode: "read" }]),
      [["permissions", 0, "toolId"]],
    ],
    [
      "a grant with an empty scope",
      (job: Record<string, unknown>) =>
        (job.permissions = [{ toolId: "t", mode: "read", scope: "" }]),
      [["permissions", 0, "scope"]],
    ],
    [
      "a grant with an unknown field",
      (job: Record<string, unknown>) =>
        (job.permissions = [{ toolId: "t", mode: "read", expiresAt: 1 }]),
      [["permissions", 0, "expiresAt"]],
    ],
  ])("rejects permissions that are %s", (_label, mutate, paths) => {
    expect(issuePaths(parseFailure(invalidJob(mutate)))).toEqual(paths);
  });

  it.each([
    [
      "metadata that is an array",
      (job: Record<string, unknown>) => (job.metadata = []),
      [["metadata"]],
    ],
    [
      "metadata holding a value JSON cannot represent",
      (job: Record<string, unknown>) => (job.metadata = { at: new Date() }),
      [["metadata"]],
    ],
    [
      "an input holding a value JSON cannot represent",
      (job: Record<string, unknown>) => (job.input = { vendorName: () => undefined }),
      [["input"]],
    ],
    ["a missing input", (job: Record<string, unknown>) => delete job.input, [["input"]]],
  ])("rejects %s", (_label, mutate, paths) => {
    expect(issuePaths(parseFailure(invalidJob(mutate)))).toEqual(paths);
  });

  it("rejects an unknown top-level field rather than silently dropping it", () => {
    const thrown = parseFailure(
      invalidJob((job) => {
        job.createdAt = "2026-09-19T00:00:00.000Z";
      }),
    );

    expect(issuePaths(thrown)).toEqual([["createdAt"]]);
  });

  it("reports every problem at once, each at the path that caused it", () => {
    const thrown = parseFailure(
      invalidJob((job) => {
        job.id = "not-an-id";
        job.jobType = "";
        job.budget = { maxModelCalls: -1 };
      }),
    );

    expect(issuePaths(thrown)).toEqual([["id"], ["jobType"], ["budget", "maxModelCalls"]]);
  });

  it("prefixes every issue with the caller's path", () => {
    try {
      parseJob({}, ["row", "job"]);
      expect.unreachable("expected parseJob to throw");
    } catch (error) {
      expect(issuePaths(error)).toEqual([
        ["row", "job", "id"],
        ["row", "job", "domain"],
        ["row", "job", "jobType"],
        ["row", "job", "objective"],
        ["row", "job", "input"],
        ["row", "job", "contracts"],
        ["row", "job", "budget"],
        ["row", "job", "permissions"],
        ["row", "job", "metadata"],
      ]);
    }
  });
});

describe("isJob", () => {
  it("accepts a real job and a round-tripped one", () => {
    const job = vendorTriage.createJob(INPUT);

    expect(isJob(job)).toBe(true);
    expect(isJob(roundTrip(job))).toBe(true);
  });

  it("rejects what `parseJob` rejects", () => {
    expect(isJob(null)).toBe(false);
    expect(isJob({})).toBe(false);
    expect(isJob(invalidJob((job) => (job.id = "not-an-id")))).toBe(false);
  });

  it("freezes nothing, because a predicate should not change its argument", () => {
    const value = roundTrip(vendorTriage.createJob(INPUT)) as Record<string, unknown>;

    expect(isJob(value)).toBe(true);
    expect(Object.isFrozen(value)).toBe(false);
    expect(Object.isFrozen(value.budget)).toBe(false);
  });

  it("narrows to a job", () => {
    const value: unknown = vendorTriage.createJob(INPUT);

    if (isJob(value)) {
      expectTypeOf(value).toEqualTypeOf<Job<unknown, unknown>>();
    }
  });
});
