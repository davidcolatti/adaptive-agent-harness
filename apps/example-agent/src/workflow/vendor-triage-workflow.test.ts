import { canonicalWorkflowIr, createCapabilityRegistry, workflowFingerprint } from "@internal/core";
import { validateWorkflow } from "@internal/workflow";
import { describe, expect, it } from "vitest";
import { createVendorTriageRegistry } from "../capabilities.js";
import {
  compileVendorTriageWorkflow,
  vendorTriageWorkflowDefinition,
} from "./vendor-triage-workflow.js";

/**
 * The hand-authored vendor workflow as a **definition** (M4-T10): its shape,
 * and the two Milestone 4 acceptance criteria that are properties of the IR
 * rather than of a run —
 *
 * - "DSL output can be serialized to canonical IR"
 * - "Same IR produces same workflow fingerprint"
 *
 * Its sibling, `vendor-triage-run.test.ts`, covers the criteria that are
 * properties of a run.
 */

describe("the vendor-triage workflow definition", () => {
  it("declares seven nodes and enters at the classification", () => {
    expect(vendorTriageWorkflowDefinition.entry).toBe("classify");
    expect(Object.keys(vendorTriageWorkflowDefinition.nodes).sort()).toStrictEqual([
      "classify",
      "decide",
      "finalize",
      "full-agent",
      "research",
      "route",
      "verify",
    ]);
  });

  it("routes the three labels the fixture decision port can produce", () => {
    const route = vendorTriageWorkflowDefinition.nodes.route;

    expect(route).toMatchObject({
      type: "branch",
      on: { kind: "field", path: ["category"] },
      cases: { clear: "finalize", research: "research" },
      default: "full-agent",
    });
  });

  it("grants tools to the agent node and to nothing else (M4-T8)", () => {
    const granted = Object.values(vendorTriageWorkflowDefinition.nodes)
      .filter((node) => node.permissions.length > 0)
      .map((node) => node.id);

    expect(granted).toStrictEqual(["research"]);
    expect(vendorTriageWorkflowDefinition.nodes.research?.permissions).toStrictEqual([
      { toolId: "lookup_vendor_evidence", mode: "read" },
      { toolId: "load_skill", mode: "read" },
    ]);
  });

  it("gives the agent node the schemas its registered capability declares", () => {
    // The validator's step-3 rule, stated here too, because it is the reason
    // `research` binds `{ kind: "input" }` rather than the branch.
    expect(vendorTriageWorkflowDefinition.nodes.research).toMatchObject({
      inputSchema: "vendor-triage.input@1.0.0",
      outputSchema: "vendor-triage.output@1.0.0",
      input: { kind: "input" },
      agent: { id: "vendor-triage-agent", version: "1.0.0" },
    });
  });

  it("builds both composite inputs from nodes that dominate their reader", () => {
    expect(vendorTriageWorkflowDefinition.nodes.finalize).toMatchObject({
      inputSchema: "vendor-triage.finalize-input@1.0.0",
      outputSchema: "vendor-triage.output@1.0.0",
      input: {
        kind: "object",
        fields: {
          classification: { kind: "node", node: "classify" },
          request: { kind: "input" },
        },
      },
    });
    expect(vendorTriageWorkflowDefinition.nodes.decide).toMatchObject({
      inputSchema: "vendor-triage.decision-input@1.0.0",
      outputSchema: "vendor-triage.output@1.0.0",
      input: {
        kind: "object",
        fields: {
          triage: { kind: "node", node: "research" },
          verification: { kind: "node", node: "verify" },
        },
      },
    });
  });

  it("ends the default route at a reachable `escalate`, which is north-star invariant 1", () => {
    expect(vendorTriageWorkflowDefinition.nodes["full-agent"]).toMatchObject({
      type: "escalate",
      input: { kind: "node", node: "route" },
    });
    expect(vendorTriageWorkflowDefinition.nodes["full-agent"]).not.toHaveProperty("next");
  });
});

describe("the vendor-triage workflow as a compiled workflow", () => {
  it("compiles against the domain's own registry with no issues", () => {
    expect(validateWorkflow(vendorTriageWorkflowDefinition, createVendorTriageRegistry())).toEqual(
      [],
    );

    const compiled = compileVendorTriageWorkflow(createVendorTriageRegistry());

    expect(compiled.definition.entry).toBe("classify");
    expect(compiled.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("fails to compile against a registry that does not hold its capabilities", () => {
    // M4-T9's last sentence: "a workflow with a missing capability MUST fail
    // validation before any node executes". There is no way to obtain a
    // `CompiledWorkflow` from an empty registry, so there is nothing the runtime
    // could be handed, and the failure names every reference that did not
    // resolve rather than the first one.
    const issues = validateWorkflow(vendorTriageWorkflowDefinition, createCapabilityRegistry());

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map((issue) => issue.message).join("\n")).toContain(
      "finalize-clear-triage@1.0.0",
    );
    expect(() => compileVendorTriageWorkflow(createCapabilityRegistry())).toThrow(
      /workflow definition is invalid/u,
    );
  });

  it("produces the same fingerprint from two independent compiles", () => {
    expect(compileVendorTriageWorkflow(createVendorTriageRegistry()).fingerprint).toBe(
      compileVendorTriageWorkflow(createVendorTriageRegistry()).fingerprint,
    );
  });

  it("survives a JSON round trip with the same canonical bytes and the same fingerprint", () => {
    const compiled = compileVendorTriageWorkflow(createVendorTriageRegistry());
    const roundTripped: unknown = JSON.parse(JSON.stringify(compiled.definition));

    expect(canonicalWorkflowIr(roundTripped)).toBe(compiled.canonicalJson);
    expect(workflowFingerprint(roundTripped)).toBe(compiled.fingerprint);
  });

  it("fingerprints identically when the literal's key order changes", () => {
    const compiled = compileVendorTriageWorkflow(createVendorTriageRegistry());
    const reordered = Object.fromEntries(
      Object.entries(JSON.parse(compiled.canonicalJson) as Record<string, unknown>).reverse(),
    );

    expect(workflowFingerprint(reordered)).toBe(compiled.fingerprint);
  });

  it("changes its fingerprint when a node's configuration changes", () => {
    const compiled = compileVendorTriageWorkflow(createVendorTriageRegistry());
    const changed = JSON.parse(compiled.canonicalJson) as {
      nodes: { research: { timeoutMs: number } };
    };

    changed.nodes.research.timeoutMs = 90_000;

    expect(workflowFingerprint(changed)).not.toBe(compiled.fingerprint);
  });
});
