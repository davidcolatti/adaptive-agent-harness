import {
  type CapabilityManifest,
  createCapabilityRegistry,
  HARNESS_RUNTIME_INFO,
  type Job,
  newJobId,
  newWorkflowVersionId,
  type Schema,
} from "@internal/core";
import { createFakeClock, createInMemoryStorage, type InMemoryStorage } from "@internal/testing";
import { type CompiledWorkflow, compileWorkflow } from "@internal/workflow";
import { beforeEach, describe, expect, it } from "vitest";
import { createWorkflowRegistry, type WorkflowRegistry } from "./workflow-registry.js";

const DOMAIN = { id: "vendor-triage", version: "1.0.0" } as const;

/** A Standard Schema that accepts anything, so the registry can hold one. */
function anySchema(): Schema<unknown, unknown> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value }),
    },
  };
}

/** A capability registry holding everything the fixture workflow names. */
function capabilities(): CapabilityManifest {
  const registry = createCapabilityRegistry();

  registry.register("schema", {
    id: "vendor.input",
    version: "1.0.0",
    module: "./schemas.js",
    exportName: "input",
    value: anySchema(),
  });
  registry.register("schema", {
    id: "vendor.output",
    version: "1.0.0",
    module: "./schemas.js",
    exportName: "output",
    value: anySchema(),
  });
  registry.register("handler", {
    id: "vendor.finalize",
    version: "1.0.0",
    module: "./handlers.js",
    exportName: "finalize",
    value: () => ({}),
  });

  return registry.toManifest();
}

const MANIFEST = capabilities();

/** The fixture workflow, compiled for real rather than hand-assembled. */
function compiled(version = "1.0.0", key = "vendor-triage"): CompiledWorkflow {
  const registry = createCapabilityRegistry();

  registry.register("schema", {
    id: "vendor.input",
    version: "1.0.0",
    module: "./schemas.js",
    exportName: "input",
    value: anySchema(),
  });
  registry.register("schema", {
    id: "vendor.output",
    version: "1.0.0",
    module: "./schemas.js",
    exportName: "output",
    value: anySchema(),
  });
  registry.register("handler", {
    id: "vendor.finalize",
    version: "1.0.0",
    module: "./handlers.js",
    exportName: "finalize",
    value: () => ({}),
  });

  return compileWorkflow(
    {
      schemaVersion: 1,
      id: key,
      version,
      domain: DOMAIN.id,
      jobType: "triage",
      inputSchema: "vendor.input@1.0.0",
      outputSchema: "vendor.output@1.0.0",
      entry: "route",
      nodes: {
        // A `branch` with an escalation default, because validation requires
        // every workflow to contain a reachable `escalate` node: north-star
        // invariant 1, "a domain can always fall back to its full agent".
        route: {
          id: "route",
          version: "1.0.0",
          type: "branch",
          on: { kind: "field", path: ["label"] },
          cases: { ok: "finalize" },
          default: "give-up",
          // A `branch` is pass-through: it outputs the value it routed, so both
          // schemas are the input's.
          inputSchema: "vendor.input@1.0.0",
          outputSchema: "vendor.input@1.0.0",
          timeoutMs: 30_000,
          retry: { maxAttempts: 1 },
          budget: {},
          permissions: [],
          input: { kind: "input" },
        },
        finalize: {
          id: "finalize",
          version: "1.0.0",
          type: "code",
          handler: { id: "vendor.finalize", version: "1.0.0" },
          inputSchema: "vendor.input@1.0.0",
          outputSchema: "vendor.output@1.0.0",
          timeoutMs: 30_000,
          retry: { maxAttempts: 1 },
          budget: {},
          permissions: [],
          input: { kind: "input" },
          next: null,
        },
        "give-up": {
          id: "give-up",
          version: "1.0.0",
          type: "escalate",
          reason: "the branch produced a label nobody enumerated",
          inputSchema: "vendor.input@1.0.0",
          outputSchema: "vendor.output@1.0.0",
          timeoutMs: 30_000,
          retry: { maxAttempts: 1 },
          budget: {},
          permissions: [],
          input: { kind: "input" },
        },
      },
    },
    registry,
  );
}

function job(overrides: Partial<Job> = {}): Job {
  return {
    id: newJobId(),
    domain: { ...DOMAIN },
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

const ENVIRONMENT = {
  manifest: MANIFEST,
  harnessVersion: HARNESS_RUNTIME_INFO.version,
};

describe("createWorkflowRegistry", () => {
  let storage: InMemoryStorage;
  let registry: WorkflowRegistry;

  beforeEach(() => {
    storage = createInMemoryStorage();
    registry = createWorkflowRegistry({
      storage,
      clock: createFakeClock({ start: new Date("2026-09-20T12:00:00.000Z") }),
    });
  });

  it("registers a compiled workflow as a draft, never as anything else", async () => {
    const version = await registry.register(compiled(), {
      domain: { ...DOMAIN },
      actor: "david",
      sop: "vendor-triage-sop",
    });

    // AD-005: nothing reaches traffic without a human saying so.
    expect(version.status).toBe("draft");
    expect(version.createdAt).toBe("2026-09-20T12:00:00.000Z");
    expect(version.statusChangedAt).toBe("2026-09-20T12:00:00.000Z");
    expect(version.metadata.registeredBy).toBe("david");
    expect(storage.workflowPromotions).toEqual([]);
  });

  it("derives compatibility from the IR and pins capabilities exactly", async () => {
    const version = await registry.register(compiled(), {
      domain: { ...DOMAIN },
      actor: "david",
      sop: "vendor-triage-sop",
    });

    expect(version.compatibility.domainId).toBe("vendor-triage");
    expect(version.compatibility.jobType).toBe("triage");
    expect(version.compatibility.inputSchema).toBe("vendor.input@1.0.0");
    expect(version.compatibility.sop).toBe("vendor-triage-sop");
    expect(version.compatibility.minHarnessVersion).toBe(HARNESS_RUNTIME_INFO.version);
    expect(version.compatibility.requiredCapabilities).toEqual([
      { id: "vendor.finalize", version: "1.0.0" },
      { id: "vendor.input", version: "1.0.0" },
      { id: "vendor.output", version: "1.0.0" },
    ]);
  });

  it("carries the compiled workflow's own fingerprint rather than recomputing one", async () => {
    const workflow = compiled();
    const version = await registry.register(workflow, {
      domain: { ...DOMAIN },
      actor: "david",
      sop: "vendor-triage-sop",
    });

    expect(version.fingerprint).toBe(workflow.fingerprint);
  });

  it("puts a second version of the same workflow under the same workflow id", async () => {
    const first = await registry.register(compiled("1.0.0"), {
      domain: { ...DOMAIN },
      actor: "david",
      sop: "vendor-triage-sop",
    });
    const second = await registry.register(compiled("2.0.0"), {
      domain: { ...DOMAIN },
      actor: "david",
      sop: "vendor-triage-sop",
    });

    expect(second.workflowId).toBe(first.workflowId);
    expect(storage.workflows).toHaveLength(1);
    expect(storage.workflowVersions).toHaveLength(2);
  });

  it("refuses to register the same IR twice", async () => {
    await registry.register(compiled(), {
      domain: { ...DOMAIN },
      actor: "david",
      sop: "vendor-triage-sop",
    });

    await expect(
      registry.register(compiled(), {
        domain: { ...DOMAIN },
        actor: "david",
        sop: "vendor-triage-sop",
      }),
    ).rejects.toThrow(/fingerprint/u);
  });

  it("refuses a domain that disagrees with the IR", async () => {
    await expect(
      registry.register(compiled(), {
        domain: { id: "other-domain", version: "1.0.0" },
        actor: "david",
        sop: "vendor-triage-sop",
      }),
    ).rejects.toThrow(/the workflow's domain is/u);
  });

  it("promotes through the transition table and records every move", async () => {
    const version = await registry.register(compiled(), {
      domain: { ...DOMAIN },
      actor: "david",
      sop: "vendor-triage-sop",
    });

    await registry.promote(version.id, "candidate", { actor: "david", reason: "evals ready" });
    const active = await registry.promote(version.id, "active", { actor: "david" });

    expect(active.status).toBe("active");

    const history = await storage.listWorkflowPromotions(version.id);

    expect(history.map((row) => `${row.fromStatus}->${row.toStatus}`)).toEqual([
      "draft->candidate",
      "candidate->active",
    ]);
    expect(history[0]?.actor).toBe("david");
    expect(history[0]?.reason).toBe("evals ready");
    expect(history[1]?.reason).toBeNull();
  });

  it("refuses an illegal transition", async () => {
    const version = await registry.register(compiled(), {
      domain: { ...DOMAIN },
      actor: "david",
      sop: "vendor-triage-sop",
    });

    await expect(registry.promote(version.id, "active", { actor: "david" })).rejects.toThrow(
      /cannot transition/u,
    );
  });

  it("refuses to promote a version that does not exist", async () => {
    await expect(
      registry.promote(newWorkflowVersionId(), "candidate", { actor: "david" }),
    ).rejects.toThrow(/no workflow version/u);
  });

  it("retires an active version, and traffic stops reaching it immediately", async () => {
    const version = await registry.register(compiled(), {
      domain: { ...DOMAIN },
      actor: "david",
      sop: "vendor-triage-sop",
    });

    await registry.promote(version.id, "candidate", { actor: "david" });
    await registry.promote(version.id, "active", { actor: "david" });

    expect((await registry.resolve(job(), ENVIRONMENT)).kind).toBe("match");

    await registry.retire(version.id, { actor: "david", reason: "superseded" });

    // No cache sits between the registry and the store, so "immediately" is a
    // property of the design rather than of an invalidation step.
    expect(await registry.findActive({ domainId: DOMAIN.id, jobType: "triage" })).toEqual([]);

    const selection = await registry.resolve(job(), ENVIRONMENT);

    expect(selection.kind).toBe("none");
    expect(selection.kind === "none" && selection.rejections).toEqual([]);
  });

  it("findActive returns only active versions of the asked-for domain and type", async () => {
    const mine = await registry.register(compiled("1.0.0"), {
      domain: { ...DOMAIN },
      actor: "david",
      sop: "vendor-triage-sop",
    });
    await registry.register(compiled("2.0.0"), {
      domain: { ...DOMAIN },
      actor: "david",
      sop: "vendor-triage-sop",
    });

    await registry.promote(mine.id, "candidate", { actor: "david" });
    await registry.promote(mine.id, "active", { actor: "david" });

    const active = await registry.findActive({ domainId: DOMAIN.id, jobType: "triage" });

    expect(active.map((version) => version.id)).toEqual([mine.id]);
    expect(await registry.findActive({ domainId: DOMAIN.id, jobType: "other" })).toEqual([]);
    expect(await registry.findActive({ domainId: "other", jobType: "triage" })).toEqual([]);
  });

  it("resolve routes to the newest active version when two match", async () => {
    const older = await registry.register(compiled("1.0.0"), {
      domain: { ...DOMAIN },
      actor: "david",
      sop: "vendor-triage-sop",
    });
    const newer = await registry.register(compiled("2.0.0"), {
      domain: { ...DOMAIN },
      actor: "david",
      sop: "vendor-triage-sop",
    });

    for (const version of [older, newer]) {
      await registry.promote(version.id, "candidate", { actor: "david" });
      await registry.promote(version.id, "active", { actor: "david" });
    }

    const selection = await registry.resolve(job(), ENVIRONMENT);

    expect(selection.kind === "match" && selection.version.id).toBe(newer.id);
  });

  it("resolve explains why an active version was refused", async () => {
    const version = await registry.register(compiled(), {
      domain: { ...DOMAIN },
      actor: "david",
      sop: "vendor-triage-sop",
    });

    await registry.promote(version.id, "candidate", { actor: "david" });
    await registry.promote(version.id, "active", { actor: "david" });

    const selection = await registry.resolve(
      job({
        contracts: {
          inputSchema: "vendor.input@2.0.0",
          outputSchema: "vendor.output@1.0.0",
          sop: "vendor-triage-sop",
        },
      }),
      ENVIRONMENT,
    );

    expect(selection.kind).toBe("none");
    expect(selection.kind === "none" && selection.rejections[0]?.reason).toBe(
      "input-schema-mismatch",
    );
  });

  it("resolve returns `none` for a domain with nothing registered at all", async () => {
    const selection = await registry.resolve(job(), ENVIRONMENT);

    expect(selection).toEqual({ kind: "none", rejections: [] });
  });
});
