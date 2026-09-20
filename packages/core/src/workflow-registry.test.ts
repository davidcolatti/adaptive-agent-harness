import { describe, expect, it } from "vitest";
import type { CapabilityManifest, CapabilityRef } from "./capabilities.js";
import { HARNESS_RUNTIME_INFO } from "./context.js";
import { ValidationError } from "./errors.js";
import {
  newJobId,
  newPromotionId,
  newWorkflowId,
  newWorkflowVersionId,
  type WorkflowVersionId,
} from "./ids.js";
import type { Job } from "./job.js";
import {
  parseWorkflowDefinition,
  type WorkflowDefinition,
  workflowFingerprint,
} from "./workflow-ir.js";
import {
  canTransition,
  collectRequiredCapabilities,
  compareExactVersions,
  describeWorkflowCompatibility,
  isWorkflowStatus,
  parseWorkflowPromotionRecord,
  parseWorkflowRecord,
  parseWorkflowVersionRecord,
  selectCompatibleWorkflow,
  type WORKFLOW_REJECTION_REASONS,
  WORKFLOW_STATUS_TRANSITIONS,
  WORKFLOW_STATUSES,
  type WorkflowCompatibility,
  type WorkflowStatus,
  type WorkflowVersionRecord,
} from "./workflow-registry.js";

const TIMESTAMP = "2026-09-20T12:00:00.000Z";

/** The base fields every node carries. Mirrors `workflow-ir.test.ts`. */
function base(id: string): Record<string, unknown> {
  return {
    id,
    version: "1.0.0",
    inputSchema: "vendor.input@1.0.0",
    outputSchema: "vendor.output@1.0.0",
    timeoutMs: 30_000,
    retry: { maxAttempts: 1 },
    budget: {},
    permissions: [],
    input: { kind: "input" },
  };
}

/**
 * A workflow naming one capability of every resolvable kind, plus a `jev`
 * question that must **not** appear in the required list.
 */
function definition(overrides: Record<string, unknown> = {}): WorkflowDefinition {
  return parseWorkflowDefinition({
    schemaVersion: 1,
    id: "vendor-triage",
    version: "1.0.0",
    domain: "vendor-triage",
    jobType: "triage",
    inputSchema: "vendor.input@1.0.0",
    outputSchema: "vendor.output@1.0.0",
    entry: "ask",
    nodes: {
      ask: {
        ...base("ask"),
        type: "jev",
        question: { id: "vendor.is-clear", version: "9.9.9" },
        questionKind: "boolean",
        next: "route",
      },
      route: {
        ...base("route"),
        type: "branch",
        on: { kind: "policy", policy: { id: "vendor.route", version: "1.0.0" } },
        cases: { clear: "finalize", research: "research" },
        default: "finalize",
      },
      finalize: {
        ...base("finalize"),
        type: "code",
        handler: { id: "vendor.finalize", version: "2.0.0" },
        next: null,
      },
      research: {
        ...base("research"),
        type: "agent",
        agent: { id: "vendor-researcher", version: "1.0.0" },
        next: "file",
      },
      file: {
        ...base("file"),
        type: "call",
        tool: { id: "ticketing.create", version: "3.1.0" },
        effect: "read-only",
        next: null,
      },
    },
    ...overrides,
  });
}

function compatibility(overrides: Partial<WorkflowCompatibility> = {}): WorkflowCompatibility {
  return {
    ...describeWorkflowCompatibility({ definition: definition() }, { sop: "vendor-triage-sop" }),
    ...overrides,
  };
}

function versionRecord(overrides: Partial<WorkflowVersionRecord> = {}): WorkflowVersionRecord {
  const ir = overrides.definition ?? definition();

  return parseWorkflowVersionRecord({
    id: newWorkflowVersionId(),
    workflowId: newWorkflowId(),
    definition: ir,
    fingerprint: workflowFingerprint(ir),
    status: "active",
    compatibility: compatibility(),
    createdAt: TIMESTAMP,
    statusChangedAt: TIMESTAMP,
    metadata: {},
    ...overrides,
  });
}

function manifestOf(refs: readonly CapabilityRef[]): CapabilityManifest {
  return {
    version: 1,
    entries: refs.map((ref) => ({
      ref,
      kind: "handler" as const,
      module: "./x.js",
      exportName: "x",
      permissions: [],
      fingerprint: `sha256:${"a".repeat(64)}`,
    })),
  };
}

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: newJobId(),
    domain: { id: "vendor-triage", version: "1.0.0" },
    jobType: "triage",
    objective: "Triage a vendor.",
    input: { vendor: "acme" },
    contracts: {
      inputSchema: "vendor.input@1.0.0",
      outputSchema: "vendor.output@1.0.0",
      sop: "vendor-triage-sop",
    },
    budget: {},
    permissions: [],
    metadata: {},
    ...overrides,
  };
}

/** The environment in which everything matches, so a test changes one thing. */
function environment(overrides: Record<string, unknown> = {}) {
  return {
    manifest: manifestOf(collectRequiredCapabilities(definition())),
    harnessVersion: HARNESS_RUNTIME_INFO.version,
    ...overrides,
  };
}

describe("workflow statuses (M5-T1)", () => {
  it("is the build plan's seven states, in its order", () => {
    expect(WORKFLOW_STATUSES).toEqual([
      "draft",
      "candidate",
      "shadow",
      "canary",
      "active",
      "retired",
      "rejected",
    ]);
  });

  it("recognizes members and rejects everything else", () => {
    for (const status of WORKFLOW_STATUSES) {
      expect(isWorkflowStatus(status)).toBe(true);
    }

    expect(isWorkflowStatus("promoted")).toBe(false);
    expect(isWorkflowStatus("")).toBe(false);
    expect(isWorkflowStatus(undefined)).toBe(false);
    expect(isWorkflowStatus(1)).toBe(false);
  });

  it("has a transition entry for every status and lists only real statuses", () => {
    expect(Object.keys(WORKFLOW_STATUS_TRANSITIONS).sort()).toEqual([...WORKFLOW_STATUSES].sort());

    for (const targets of Object.values(WORKFLOW_STATUS_TRANSITIONS)) {
      for (const target of targets) {
        expect(WORKFLOW_STATUSES).toContain(target);
      }
    }
  });

  it("allows exactly the documented transitions and no others", () => {
    const allowed: readonly (readonly [WorkflowStatus, WorkflowStatus])[] = [
      ["draft", "candidate"],
      ["draft", "rejected"],
      ["candidate", "shadow"],
      ["candidate", "canary"],
      ["candidate", "active"],
      ["candidate", "rejected"],
      ["shadow", "canary"],
      ["shadow", "active"],
      ["shadow", "retired"],
      ["shadow", "rejected"],
      ["canary", "active"],
      ["canary", "retired"],
      ["canary", "rejected"],
      ["active", "retired"],
    ];

    for (const from of WORKFLOW_STATUSES) {
      for (const to of WORKFLOW_STATUSES) {
        const expected = allowed.some(([left, right]) => left === from && right === to);

        expect(canTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it("treats `retired` and `rejected` as terminal and refuses a self-transition", () => {
    for (const to of WORKFLOW_STATUSES) {
      expect(canTransition("retired", to)).toBe(false);
      expect(canTransition("rejected", to)).toBe(false);
    }

    for (const status of WORKFLOW_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("never routes back into `draft`", () => {
    for (const from of WORKFLOW_STATUSES) {
      expect(canTransition(from, "draft")).toBe(false);
    }
  });
});

describe("collectRequiredCapabilities (M5-T2)", () => {
  it("collects every schema, handler, tool, agent and policy the IR names", () => {
    expect(collectRequiredCapabilities(definition())).toEqual([
      { id: "ticketing.create", version: "3.1.0" },
      { id: "vendor-researcher", version: "1.0.0" },
      { id: "vendor.finalize", version: "2.0.0" },
      { id: "vendor.input", version: "1.0.0" },
      { id: "vendor.output", version: "1.0.0" },
      { id: "vendor.route", version: "1.0.0" },
    ]);
  });

  it("excludes a `jev` node's question, which is M3's to resolve", () => {
    const ids = collectRequiredCapabilities(definition()).map((ref) => ref.id);

    expect(ids).not.toContain("vendor.is-clear");
  });

  it("deduplicates and sorts, so equal requirements produce equal lists", () => {
    const first = collectRequiredCapabilities(definition());
    const second = collectRequiredCapabilities(definition());

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.filter((ref) => ref.id === "vendor.input")).toHaveLength(1);
  });

  it("pins the exact version a node names, never a looser one", () => {
    const refs = collectRequiredCapabilities(definition());

    expect(refs.find((ref) => ref.id === "vendor.finalize")?.version).toBe("2.0.0");
  });
});

describe("describeWorkflowCompatibility (M5-T2)", () => {
  it("derives the six declarations from the IR plus the SOP", () => {
    const declared = describeWorkflowCompatibility(
      { definition: definition() },
      { sop: "vendor-triage-sop" },
    );

    expect(declared.domainId).toBe("vendor-triage");
    expect(declared.jobType).toBe("triage");
    expect(declared.inputSchema).toBe("vendor.input@1.0.0");
    expect(declared.outputSchema).toBe("vendor.output@1.0.0");
    expect(declared.sop).toBe("vendor-triage-sop");
    expect(declared.requiredCapabilities.length).toBeGreaterThan(0);
  });

  it("defaults the minimum harness version to the running harness", () => {
    expect(
      describeWorkflowCompatibility({ definition: definition() }, { sop: "vendor-triage-sop" })
        .minHarnessVersion,
    ).toBe(HARNESS_RUNTIME_INFO.version);
  });

  it("omits `sopFingerprint` entirely when the author did not supply one", () => {
    const declared = describeWorkflowCompatibility(
      { definition: definition() },
      { sop: "vendor-triage-sop" },
    );

    expect("sopFingerprint" in declared).toBe(false);
  });

  it("carries a supplied `sopFingerprint`", () => {
    const declared = describeWorkflowCompatibility(
      { definition: definition() },
      { sop: "vendor-triage-sop", sopFingerprint: `sha256:${"b".repeat(64)}` },
    );

    expect(declared.sopFingerprint).toBe(`sha256:${"b".repeat(64)}`);
  });

  it("rejects a malformed SOP or minimum version rather than storing it", () => {
    expect(() =>
      describeWorkflowCompatibility({ definition: definition() }, { sop: "not a sop" }),
    ).toThrow(ValidationError);

    expect(() =>
      describeWorkflowCompatibility(
        { definition: definition() },
        { sop: "vendor-triage-sop", minHarnessVersion: "^1.0.0" },
      ),
    ).toThrow(ValidationError);
  });

  it("is frozen, because a stored declaration is read by a pure selector", () => {
    const declared = describeWorkflowCompatibility(
      { definition: definition() },
      { sop: "vendor-triage-sop" },
    );

    expect(Object.isFrozen(declared)).toBe(true);
    expect(Object.isFrozen(declared.requiredCapabilities)).toBe(true);
  });
});

describe("compareExactVersions", () => {
  it("orders numerically rather than lexicographically", () => {
    expect(compareExactVersions("0.10.0", "0.9.0")).toBe(1);
    expect(compareExactVersions("0.9.0", "0.10.0")).toBe(-1);
    expect(compareExactVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareExactVersions("2.0.0", "1.999.999")).toBe(1);
  });

  it("rejects anything that is not an exact version", () => {
    expect(() => compareExactVersions("^1.0.0", "1.0.0")).toThrow(ValidationError);
    expect(() => compareExactVersions("1.0.0", "1.0")).toThrow(ValidationError);
  });
});

describe("parseWorkflowRecord", () => {
  it("round-trips a well-formed record, deep-frozen", () => {
    const id = newWorkflowId();
    const record = parseWorkflowRecord({
      id,
      domainId: "vendor-triage",
      domainVersion: "1.0.0",
      workflowKey: "vendor-triage",
      jobType: "triage",
      createdAt: TIMESTAMP,
    });

    expect(record.id).toBe(id);
    expect(record.workflowKey).toBe("vendor-triage");
    expect(Object.isFrozen(record)).toBe(true);
  });

  it("rejects an unknown field, a bad id and a bad timestamp at once", () => {
    try {
      parseWorkflowRecord({
        id: "not-a-uuid",
        domainId: "vendor-triage",
        domainVersion: "1.0.0",
        workflowKey: "vendor-triage",
        jobType: "triage",
        createdAt: "yesterday",
        extra: 1,
      });
      expect.unreachable("expected a ValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const paths = (error as ValidationError).issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("extra");
      expect(paths).toContain("id");
      expect(paths).toContain("createdAt");
    }
  });
});

describe("parseWorkflowVersionRecord", () => {
  it("round-trips a well-formed record", () => {
    const record = versionRecord();

    expect(record.status).toBe("active");
    expect(record.definition.id).toBe("vendor-triage");
    expect(record.compatibility.jobType).toBe("triage");
    expect(Object.isFrozen(record)).toBe(true);
  });

  it("recomputes the fingerprint and rejects one that does not match the IR", () => {
    const ir = definition();

    try {
      parseWorkflowVersionRecord({
        id: newWorkflowVersionId(),
        workflowId: newWorkflowId(),
        definition: ir,
        fingerprint: `sha256:${"0".repeat(64)}`,
        status: "draft",
        compatibility: compatibility(),
        createdAt: TIMESTAMP,
        statusChangedAt: TIMESTAMP,
        metadata: {},
      });
      expect.unreachable("expected a ValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const issue = (error as ValidationError).issues.find(
        (one) => one.path.join(".") === "fingerprint",
      );
      expect(issue?.message).toMatch(/fingerprint of the stored definition/u);
    }
  });

  it("rejects an unknown status", () => {
    const ir = definition();

    expect(() =>
      parseWorkflowVersionRecord({
        id: newWorkflowVersionId(),
        workflowId: newWorkflowId(),
        definition: ir,
        fingerprint: workflowFingerprint(ir),
        status: "promoted",
        compatibility: compatibility(),
        createdAt: TIMESTAMP,
        statusChangedAt: TIMESTAMP,
        metadata: {},
      }),
    ).toThrow(ValidationError);
  });

  it("rejects a compatibility whose capability reference is malformed", () => {
    const ir = definition();

    try {
      parseWorkflowVersionRecord({
        id: newWorkflowVersionId(),
        workflowId: newWorkflowId(),
        definition: ir,
        fingerprint: workflowFingerprint(ir),
        status: "draft",
        compatibility: {
          ...compatibility(),
          requiredCapabilities: [{ id: "ok", version: "^1.0.0" }],
        },
        createdAt: TIMESTAMP,
        statusChangedAt: TIMESTAMP,
        metadata: {},
      });
      expect.unreachable("expected a ValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(
        (error as ValidationError).issues.some((issue) =>
          issue.path.join(".").startsWith("compatibility.requiredCapabilities.0"),
        ),
      ).toBe(true);
    }
  });
});

describe("parseWorkflowPromotionRecord", () => {
  it("round-trips a legal transition", () => {
    const record = parseWorkflowPromotionRecord({
      id: newPromotionId(),
      workflowVersionId: newWorkflowVersionId(),
      fromStatus: "candidate",
      toStatus: "active",
      actor: "david",
      reason: "evals cleared",
      createdAt: TIMESTAMP,
    });

    expect(record.toStatus).toBe("active");
    expect(record.reason).toBe("evals cleared");
  });

  it("refuses a ledger row recording a transition the table forbids", () => {
    try {
      parseWorkflowPromotionRecord({
        id: newPromotionId(),
        workflowVersionId: newWorkflowVersionId(),
        fromStatus: "retired",
        toStatus: "active",
        actor: "david",
        reason: null,
        createdAt: TIMESTAMP,
      });
      expect.unreachable("expected a ValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect(
        (error as ValidationError).issues.some((issue) => /cannot transition/u.test(issue.message)),
      ).toBe(true);
    }
  });

  it("requires an actor, because promotion is human-invoked (AD-005)", () => {
    expect(() =>
      parseWorkflowPromotionRecord({
        id: newPromotionId(),
        workflowVersionId: newWorkflowVersionId(),
        fromStatus: "draft",
        toStatus: "candidate",
        actor: "   ",
        reason: null,
        createdAt: TIMESTAMP,
      }),
    ).toThrow(ValidationError);
  });
});

describe("selectCompatibleWorkflow (M5-T2)", () => {
  it("selects the one active version whose declarations all match", () => {
    const version = versionRecord();
    const selection = selectCompatibleWorkflow(job(), [version], environment());

    expect(selection.kind).toBe("match");
    expect(selection.kind === "match" && selection.version.id).toBe(version.id);
  });

  it("returns `none` with no rejections when there are no candidates at all", () => {
    const selection = selectCompatibleWorkflow(job(), [], environment());

    expect(selection).toEqual({ kind: "none", rejections: [] });
  });

  it("never looks at the workflow's name: a renamed IR still matches", () => {
    const renamed = definition({ id: "something-else" });
    const version = versionRecord({
      definition: renamed,
      fingerprint: workflowFingerprint(renamed),
    });

    expect(selectCompatibleWorkflow(job(), [version], environment()).kind).toBe("match");
  });

  const rejects = (
    version: WorkflowVersionRecord,
    reason: (typeof WORKFLOW_REJECTION_REASONS)[number],
    env = environment(),
    which = job(),
  ): void => {
    const selection = selectCompatibleWorkflow(which, [version], env);

    expect(selection.kind).toBe("none");
    expect(selection.kind === "none" && selection.rejections[0]?.reason).toBe(reason);
    expect(selection.kind === "none" && selection.rejections[0]?.versionId).toBe(version.id);
  };

  it("rejects a version that is not active, whatever else matches", () => {
    for (const status of WORKFLOW_STATUSES) {
      if (status === "active") {
        continue;
      }

      rejects(versionRecord({ status }), "not-active");
    }
  });

  it("rejects a domain mismatch", () => {
    rejects(
      versionRecord({ compatibility: compatibility({ domainId: "other-domain" }) }),
      "domain-mismatch",
    );
  });

  it("rejects a job-type mismatch", () => {
    rejects(
      versionRecord({ compatibility: compatibility({ jobType: "other-type" }) }),
      "job-type-mismatch",
    );
  });

  it("rejects an input-schema mismatch by reference, not by shape", () => {
    rejects(
      versionRecord({ compatibility: compatibility({ inputSchema: "vendor.input@2.0.0" }) }),
      "input-schema-mismatch",
    );
  });

  it("rejects an output-schema mismatch", () => {
    rejects(
      versionRecord({ compatibility: compatibility({ outputSchema: "vendor.output@2.0.0" }) }),
      "output-schema-mismatch",
    );
  });

  it("rejects a capability that is registered at a different version (AD-015)", () => {
    const shifted = collectRequiredCapabilities(definition()).map((ref) =>
      ref.id === "vendor.finalize" ? { id: ref.id, version: "2.0.1" } : ref,
    );

    rejects(versionRecord(), "missing-capability", environment({ manifest: manifestOf(shifted) }));
  });

  it("rejects a capability that is not registered at all", () => {
    rejects(versionRecord(), "missing-capability", environment({ manifest: manifestOf([]) }));
  });

  it("rejects an SOP mismatch", () => {
    rejects(versionRecord({ compatibility: compatibility({ sop: "other-sop" }) }), "sop-mismatch");
  });

  it("rejects an SOP fingerprint mismatch when both sides have one", () => {
    rejects(
      versionRecord({
        compatibility: compatibility({ sopFingerprint: `sha256:${"b".repeat(64)}` }),
      }),
      "sop-fingerprint-mismatch",
      environment({ sopFingerprint: `sha256:${"c".repeat(64)}` }),
    );
  });

  it("matches when only one side has an SOP fingerprint", () => {
    const declared = versionRecord({
      compatibility: compatibility({ sopFingerprint: `sha256:${"b".repeat(64)}` }),
    });

    expect(selectCompatibleWorkflow(job(), [declared], environment()).kind).toBe("match");
    expect(
      selectCompatibleWorkflow(
        job(),
        [versionRecord()],
        environment({ sopFingerprint: `sha256:${"c".repeat(64)}` }),
      ).kind,
    ).toBe("match");
  });

  it("rejects a workflow needing a newer harness, and accepts an older minimum", () => {
    rejects(
      versionRecord({ compatibility: compatibility({ minHarnessVersion: "1.0.0" }) }),
      "harness-too-old",
      environment({ harnessVersion: "0.9.0" }),
    );

    expect(
      selectCompatibleWorkflow(
        job(),
        [versionRecord({ compatibility: compatibility({ minHarnessVersion: "1.0.0" }) })],
        environment({ harnessVersion: "1.4.0" }),
      ).kind,
    ).toBe("match");
  });

  it("reports the first failing check, in the documented order", () => {
    const version = versionRecord({
      status: "draft",
      compatibility: compatibility({ domainId: "other-domain", jobType: "other-type" }),
    });

    const selection = selectCompatibleWorkflow(job(), [version], environment());

    expect(selection.kind === "none" && selection.rejections[0]?.reason).toBe("not-active");
  });

  it("collects one rejection per candidate, each naming its version", () => {
    const first = versionRecord({ status: "draft" });
    const second = versionRecord({ compatibility: compatibility({ jobType: "other" }) });

    const selection = selectCompatibleWorkflow(job(), [first, second], environment());

    expect(selection.kind).toBe("none");
    expect(selection.kind === "none" && selection.rejections.map((one) => one.reason)).toEqual([
      "not-active",
      "job-type-mismatch",
    ]);
    expect(selection.kind === "none" && selection.rejections.map((one) => one.versionId)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("breaks a tie on the newest version id, whatever order the candidates arrive in", () => {
    const older = versionRecord();
    const newer = versionRecord();

    expect((newer.id as string) > (older.id as string)).toBe(true);

    for (const candidates of [
      [older, newer],
      [newer, older],
    ]) {
      const selection = selectCompatibleWorkflow(job(), candidates, environment());

      expect(selection.kind === "match" && selection.version.id).toBe(newer.id);
    }
  });

  it("is pure: the same inputs give the same answer, and nothing is mutated", () => {
    const candidates = [versionRecord(), versionRecord({ status: "retired" })];
    const frozen = JSON.stringify(candidates);

    const first = selectCompatibleWorkflow(job(), candidates, environment());
    const second = selectCompatibleWorkflow(job(), candidates, environment());

    expect(first.kind === "match" && first.version.id).toBe(
      second.kind === "match" ? second.version.id : ("" as WorkflowVersionId),
    );
    expect(JSON.stringify(candidates)).toBe(frozen);
  });
});
