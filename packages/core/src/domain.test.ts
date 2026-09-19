import { describe, expect, expectTypeOf, it } from "vitest";
import { type CreateJobInput, type DomainDefinition, defineDomain } from "./domain.js";
import { ValidationError } from "./errors.js";
import type { Job } from "./job.js";
import type { Schema, SchemaResult } from "./schema.js";

interface TriageInput {
  readonly vendorName: string;
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
    jobType: "triage",
    objective: `Triage ${input.vendorName}.`,
    input,
    contracts: {
      inputSchema: "triage.input@1.0.0",
      outputSchema: "triage.output@1.0.0",
      sop: "triage-sop",
    },
  };
}

function define(
  overrides: Partial<Parameters<typeof defineDomain<TriageInput, TriageOutput>>[0]> = {},
): DomainDefinition<TriageInput, TriageOutput> {
  return defineDomain<TriageInput, TriageOutput>({
    id: "triage",
    version: "1.0.0",
    inputSchema,
    outputSchema,
    createJob,
    ...overrides,
  });
}

describe("defineDomain", () => {
  it("returns the configured definition", () => {
    const domain = define({
      evals: [{ id: "case-1", description: "a case", input: { vendorName: "Acme" } }],
    });

    expect(domain.id).toBe("triage");
    expect(domain.version).toBe("1.0.0");
    expect(domain.inputSchema).toBe(inputSchema);
    expect(domain.outputSchema).toBe(outputSchema);
    expect(domain.evals).toHaveLength(1);
  });

  it("defaults `evals` to an empty list rather than leaving it absent", () => {
    expect(define().evals).toEqual([]);
  });

  it("copies `evals` so the caller's array cannot be mutated into the definition", () => {
    const evals = [{ id: "case-1", description: "a case", input: { vendorName: "Acme" } }];
    const domain = define({ evals });

    evals.push({ id: "case-2", description: "another", input: { vendorName: "Other" } });

    expect(domain.evals).toHaveLength(1);
  });

  it("freezes the definition, so a registered domain cannot be repointed", () => {
    const domain = define();

    expect(Object.isFrozen(domain)).toBe(true);
    expect(Object.isFrozen(domain.evals)).toBe(true);
  });

  it.each([
    ["an empty id", ""],
    ["whitespace", "   "],
    ["an id containing a space", "vendor triage"],
    ["an id starting with a dash", "-triage"],
    ["an id containing the reference delimiter", "triage@1"],
    ["an id containing a path separator", "domains/triage"],
  ])("rejects %s", (_label, id) => {
    expect(() => define({ id })).toThrow(ValidationError);
  });

  it.each([
    ["a two-part version", "1.0"],
    ["a caret range", "^1.0.0"],
    ["a tilde range", "~1.0.0"],
    ["a pre-release tag", "1.0.0-beta.1"],
    ["a leading v", "v1.0.0"],
    ["a leading zero", "01.0.0"],
    ["an empty version", ""],
  ])("rejects %s", (_label, version) => {
    expect(() => define({ version })).toThrow(ValidationError);
  });

  it("names the offending field in the error's issues", () => {
    try {
      define({ id: "", version: "nope" });
      expect.unreachable("expected defineDomain to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues.map((issue) => issue.path)).toEqual([
        ["id"],
        ["version"],
      ]);
    }
  });

  it.each(["inputSchema", "outputSchema"] as const)(
    "rejects a %s that is not a schema",
    (field) => {
      expect(() => define({ [field]: {} as Schema<never> })).toThrow(
        `defineDomain: \`${field}\` is not a Standard Schema`,
      );
    },
  );

  it("rejects a `createJob` that is not a function", () => {
    expect(() =>
      define({
        createJob: undefined as unknown as (input: TriageInput) => CreateJobInput<TriageInput>,
      }),
    ).toThrow(ValidationError);
  });
});

describe("DomainDefinition.createJob", () => {
  it("stamps the domain reference from the definition", () => {
    const job = define().createJob({ vendorName: "Acme" });

    expect(job.domain).toEqual({ id: "triage", version: "1.0.0" });
  });

  it("generates a unique id per job", () => {
    const domain = define();
    const first = domain.createJob({ vendorName: "Acme" });
    const second = domain.createJob({ vendorName: "Acme" });

    expect(first.id).not.toBe(second.id);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("carries the domain's own fields through", () => {
    const job = define().createJob({ vendorName: "Acme" });

    expect(job.jobType).toBe("triage");
    expect(job.objective).toBe("Triage Acme.");
    expect(job.input).toEqual({ vendorName: "Acme" });
    expect(job.contracts).toEqual({
      inputSchema: "triage.input@1.0.0",
      outputSchema: "triage.output@1.0.0",
      sop: "triage-sop",
    });
  });

  it("applies the conservative defaults for what the domain left out", () => {
    const job = define().createJob({ vendorName: "Acme" });

    // No budget is unlimited, not zero; no permissions grants nothing.
    expect(job.budget).toEqual({});
    expect(job.permissions).toEqual([]);
    expect(job.metadata).toEqual({});
  });

  it("keeps what the domain did supply", () => {
    const domain = define({
      createJob: (input) => ({
        ...createJob(input),
        budget: { maxModelCalls: 4 },
        permissions: [{ toolId: "lookup", mode: "read" }],
        metadata: { fixture: true },
      }),
    });

    const job = domain.createJob({ vendorName: "Acme" });

    expect(job.budget).toEqual({ maxModelCalls: 4 });
    expect(job.permissions).toEqual([{ toolId: "lookup", mode: "read" }]);
    expect(job.metadata).toEqual({ fixture: true });
  });

  it("freezes the job, because a job is immutable once execution begins", () => {
    const job = define().createJob({ vendorName: "Acme" });

    expect(Object.isFrozen(job)).toBe(true);
    expect(Object.isFrozen(job.contracts)).toBe(true);
    expect(Object.isFrozen(job.permissions)).toBe(true);
  });

  it("does not validate its input, because the harness owns that choke point", () => {
    const rejecting = schemaOf<TriageInput>(() => ({ issues: [{ message: "always invalid" }] }));
    const domain = define({ inputSchema: rejecting });

    expect(() => domain.createJob({ vendorName: "Acme" })).not.toThrow();
  });

  it.each([
    ["a missing jobType", { jobType: "" }, ["jobType"]],
    ["a blank objective", { objective: "   " }, ["objective"]],
    [
      "a missing sop reference",
      { contracts: { inputSchema: "a", outputSchema: "b", sop: "" } },
      ["contracts", "sop"],
    ],
  ])("rejects %s from the domain's createJob", (_label, override, path) => {
    const domain = define({
      createJob: (input) => ({ ...createJob(input), ...override }),
    });

    try {
      domain.createJob({ vendorName: "Acme" });
      expect.unreachable("expected createJob to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues[0]?.path).toEqual(path);
    }
  });

  it("types the job with the domain's input and output types", () => {
    const domain = define();

    expectTypeOf(domain.createJob).returns.toEqualTypeOf<Job<TriageInput, TriageOutput>>();
  });
});
