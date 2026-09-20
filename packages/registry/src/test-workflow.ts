import {
  type CapabilityRegistry,
  createCapabilityRegistry,
  type Job,
  newJobId,
  type Schema,
  type WorkflowDefinition,
} from "@internal/core";
import { type CompiledWorkflow, compileWorkflow } from "@internal/workflow";

/**
 * The fixture workflow the router and circuit-breaker tests route to.
 *
 * It is small and it is **compiled for real** rather than hand-assembled,
 * because a `CompiledWorkflow` is a claim that the graph validated and every
 * capability resolved, and a test that fabricated one would be testing the
 * router against a workflow the runtime would refuse.
 *
 * ```text
 * route (branch on `label`)
 *   ├─ ok        → finalize (code)   → end
 *   ├─ escalate  → assist (agent)    → give-up (escalate)
 *   └─ default                       → give-up (escalate)
 * ```
 *
 * The three routes exist to cover the three things the router has to do with a
 * `WorkflowRunResult`: complete, escalate after a node that a fallback may
 * trust, and escalate after one it may not. `route` is a `branch` and `finalize`
 * is `code`, both deterministic and therefore trusted; `assist` is an `agent`
 * and therefore not (ADR-0040).
 */

export const FIXTURE_DOMAIN = { id: "vendor-triage", version: "1.0.0" } as const;

/** A Standard Schema that accepts anything. The graph, not the data, is the subject here. */
function anySchema(): Schema<unknown, unknown> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value }),
    },
  };
}

/** Everything the fixture workflow names, registered at its exact version. */
export function createFixtureCapabilities(
  options: { readonly finalize?: () => unknown } = {},
): CapabilityRegistry {
  const registry = createCapabilityRegistry();

  for (const id of ["vendor.input", "vendor.output"]) {
    registry.register("schema", {
      id,
      version: "1.0.0",
      module: "./schemas.js",
      exportName: id,
      value: anySchema(),
    });
  }

  registry.register("handler", {
    id: "vendor.finalize",
    version: "1.0.0",
    module: "./handlers.js",
    exportName: "finalize",
    value: options.finalize ?? ((): unknown => ({ decision: "clear" })),
  });

  registry.register("agent", {
    id: "vendor.assistant",
    version: "1.0.0",
    module: "./agent.js",
    exportName: "default",
    inputSchema: { id: "vendor.input", version: "1.0.0" },
    outputSchema: { id: "vendor.output", version: "1.0.0" },
    permissions: ["read"],
    value: { id: "vendor.assistant", instructions: "assist" },
  });

  return registry;
}

const COMMON = {
  version: "1.0.0",
  timeoutMs: 30_000,
  retry: { maxAttempts: 1 },
  budget: {},
  permissions: [],
} as const;

/** The fixture definition, at `version` and under workflow key `key`. */
export function fixtureDefinition(version = "1.0.0", key = "vendor-triage"): WorkflowDefinition {
  return {
    schemaVersion: 1,
    id: key,
    version,
    domain: FIXTURE_DOMAIN.id,
    jobType: "triage",
    inputSchema: "vendor.input@1.0.0",
    outputSchema: "vendor.output@1.0.0",
    entry: "route",
    nodes: {
      route: {
        ...COMMON,
        id: "route",
        type: "branch",
        on: { kind: "field", path: ["label"] },
        cases: { ok: "finalize", escalate: "assist" },
        default: "give-up",
        // A `branch` is pass-through: it outputs the value it routed.
        inputSchema: "vendor.input@1.0.0",
        outputSchema: "vendor.input@1.0.0",
        input: { kind: "input" },
      },
      finalize: {
        ...COMMON,
        id: "finalize",
        type: "code",
        handler: { id: "vendor.finalize", version: "1.0.0" },
        inputSchema: "vendor.input@1.0.0",
        outputSchema: "vendor.output@1.0.0",
        input: { kind: "input" },
        next: null,
      },
      assist: {
        ...COMMON,
        id: "assist",
        type: "agent",
        agent: { id: "vendor.assistant", version: "1.0.0" },
        inputSchema: "vendor.input@1.0.0",
        outputSchema: "vendor.output@1.0.0",
        input: { kind: "input" },
        next: "give-up",
      },
      "give-up": {
        ...COMMON,
        id: "give-up",
        type: "escalate",
        reason: "the compiled path has no route it can justify",
        inputSchema: "vendor.input@1.0.0",
        outputSchema: "vendor.output@1.0.0",
        input: { kind: "input" },
      },
    },
  };
}

/** The fixture workflow, compiled against `registry`. */
export function compileFixture(
  registry: CapabilityRegistry,
  version = "1.0.0",
  key = "vendor-triage",
): CompiledWorkflow {
  return compileWorkflow(fixtureDefinition(version, key), registry);
}

/** A job for the fixture domain, with `label` choosing the route. */
export function fixtureJob(label: string, overrides: Partial<Job> = {}): Job {
  return {
    id: newJobId(),
    domain: { ...FIXTURE_DOMAIN },
    jobType: "triage",
    objective: "Triage a vendor.",
    input: { label, vendor: "acme" },
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
