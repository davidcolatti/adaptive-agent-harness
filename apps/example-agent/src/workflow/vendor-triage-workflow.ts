import type { CapabilityRegistry, WorkflowDefinition } from "@internal/core";
import { type CompiledWorkflow, compileWorkflow, workflow } from "@internal/workflow";

/**
 * Milestone 4's hand-authored compiled example (M4-T10).
 *
 * ```text
 * jev classify ──┬── clear     → code finalize                       (→ vendor-triage.output)
 *                ├── research  → agent research → jev verify → code decide
 *                └── default   → escalate full-agent
 * ```
 *
 * This is the milestone's deliverable — "the first inspectable compiled
 * workflow" — and the first one authored against a **real** capability registry
 * rather than a test fixture. `packages/workflow/src/dsl/vendor-triage.test.ts`
 * builds the same shape with placeholder references, to prove the DSL can
 * express it; this module builds it against
 * {@link createVendorTriageRegistry}'s twelve capabilities, so every reference
 * resolves to the schema, handler, agent or tool the domain actually ships.
 *
 * **Nothing here is executable content.** The definition is data: a
 * `WorkflowDefinition` that survives `JSON.stringify`, canonicalizes to stable
 * bytes and fingerprints to a stable `sha256:` digest (ADR-0029, ADR-0038). The
 * builder is a wiring front end and no consumer ever sees it (ADR-0041).
 *
 * ## The three routes
 *
 * | Label | Path | Cost |
 * | --- | --- | --- |
 * | `clear` | one decision, then deterministic code | one decision |
 * | `research` | a decision, the full agent, a second decision, then code | two decisions, one agent run |
 * | anything else | escalate to the full agent with what was established | one decision |
 *
 * That ordering is the point of the milestone: the compiled path spends a
 * model call only where a judgment is genuinely needed, and the `default` route
 * is north-star invariant 1 — a domain can always fall back to its full agent —
 * written into the graph rather than promised.
 *
 * ## The three bindings that are stated rather than derived
 *
 * The DSL derives every edge it can (`docs/contracts/workflow-dsl.md`), and
 * three here cannot be derived, each for a reason worth knowing:
 *
 * - **`research` reads `{ kind: "input" }`**, not the branch. The node runs the
 *   registered `vendor-triage-agent@1.0.0`, whose manifest entry declares
 *   `inputSchema: vendor-triage.input@1.0.0` and
 *   `outputSchema: vendor-triage.output@1.0.0`, and the validator requires a
 *   node's schemas to equal the ones its resolved capability declares. The
 *   agent therefore has to be handed the original request, which is also what it
 *   needs: it triages a vendor, not a classification of one.
 * - **`finalize` reads an `object`** of the classification and the request. A
 *   `code` node bound to the branch would receive the classification alone, and
 *   finalizing needs the vendor name and the SOP.
 * - **`decide` reads an `object`** of the agent's triage and the verification. A
 *   node bound to its predecessor would see the verification alone, and a
 *   verification is a statement *about* a triage it does not contain.
 *
 * Both `object` bindings name nodes that **dominate** the reader — `classify`
 * runs before every route, and `research` runs before `decide` on the only path
 * that reaches it — which is the rule ADR-0039 checks and the one an author is
 * most likely to get wrong.
 *
 * ## What is still a placeholder
 *
 * The two `jev` nodes name questions that no `DecisionEngine` answers yet: M3
 * owns questions, and a question is not a capability kind, so the validator
 * deliberately does not resolve them. Until M3 lands,
 * `createFixtureDecisionPort()` in `./fixture-decision-port.js` answers both
 * deterministically. It is not Jev and does not pretend to be.
 */

/** The workflow's own identifier, and the `workflowId` every idempotency key carries. */
export const VENDOR_TRIAGE_WORKFLOW_ID = "vendor-triage-v1";

/** The workflow's exact version, part of every idempotency key and of the fallback envelope. */
export const VENDOR_TRIAGE_WORKFLOW_VERSION = "1.0.0";

/**
 * The first `jev` node's question reference.
 *
 * Exported because {@link createFixtureDecisionPort} branches on it and a
 * string written twice is a string that drifts. When M3 lands, this is the
 * reference a registered question has to match.
 */
export const CLASSIFY_QUESTION_REF = "vendor-triage.classify-route@1.0.0";

/** The second `jev` node's question reference. */
export const VERIFY_QUESTION_REF = "vendor-triage.evidence-supports@1.0.0";

/**
 * How long the `research` node may take.
 *
 * Longer than the DSL's 60-second default because it is a full agent run
 * against a real model, and the same order as the domain's own
 * `maxDurationMs` for a whole job.
 */
const RESEARCH_TIMEOUT_MS = 120_000;

/**
 * The vendor workflow as IR.
 *
 * Built once at module load, which is safe because the builder is pure: it
 * resolves no capability, reads no file and executes nothing. A module holding
 * a workflow is loadable without a registry, which is exactly why the DSL does
 * not call `compileWorkflow()` itself.
 */
export const vendorTriageWorkflowDefinition: WorkflowDefinition = workflow({
  id: VENDOR_TRIAGE_WORKFLOW_ID,
  version: VENDOR_TRIAGE_WORKFLOW_VERSION,
  domain: "vendor-triage",
  jobType: "vendor-triage",
  input: "vendor-triage.input@1.0.0",
  output: "vendor-triage.output@1.0.0",
})
  // Is the frozen evidence good enough to triage in code, does it need the full
  // agent's reading, or is neither established? The judgment, and nothing else:
  // what the organization does about each answer is the graph below.
  .jev("classify", {
    question: CLASSIFY_QUESTION_REF,
    questionKind: "choice",
    outputSchema: "vendor-triage.classification@1.0.0",
  })
  .branch("route", {
    on: { kind: "field", path: ["category"] },
    cases: {
      clear: (b) =>
        b
          .code("finalize", {
            handler: "finalize-clear-triage@1.0.0",
            input: {
              kind: "object",
              fields: {
                classification: { kind: "node", node: "classify" },
                request: { kind: "input" },
              },
            },
            inputSchema: "vendor-triage.finalize-input@1.0.0",
          })
          .end(),
      research: (b) =>
        b
          .agent("research", {
            agent: "vendor-triage-agent@1.0.0",
            // M4-T8: exactly the two grants the job carries, and no more. The
            // sub-run's `ExecutionContext.permissions` is this list rather than
            // the job's, which is the boundary that enforces "an `agent` node
            // receives only its granted tools".
            permissions: [
              { toolId: "lookup_vendor_evidence", mode: "read" },
              { toolId: "load_skill", mode: "read" },
            ],
            // Stated, not derived: the registered agent declares both schemas,
            // and the validator requires the node's to equal them.
            input: { kind: "input" },
            inputSchema: "vendor-triage.input@1.0.0",
            outputSchema: "vendor-triage.output@1.0.0",
            timeoutMs: RESEARCH_TIMEOUT_MS,
          })
          .jev("verify", {
            question: VERIFY_QUESTION_REF,
            questionKind: "boolean",
            outputSchema: "vendor-triage.verification@1.0.0",
          })
          .code("decide", {
            handler: "decide-verified-triage@1.0.0",
            input: {
              kind: "object",
              fields: {
                triage: { kind: "node", node: "research" },
                verification: { kind: "node", node: "verify" },
              },
            },
            inputSchema: "vendor-triage.decision-input@1.0.0",
          })
          .end(),
    },
    // Every other label, `uncertain` included. A `default` is required, and it
    // is the escalation target: the compiled path hands the job back with what
    // it established rather than guessing.
    default: (b) =>
      b.escalate("full-agent", {
        reason:
          "the classification was not `clear` or `research`, so the compiled path has no route it can justify",
      }),
  })
  .build();

/**
 * Compile the vendor workflow against a registry.
 *
 * ```ts
 * const compiled = compileVendorTriageWorkflow(createVendorTriageRegistry());
 * const runtime = createWorkflowRuntime({ registry, agentRuntime, decisionEngine });
 * const harness = createHarness({ agentRuntime: runtime.asAgentRuntime(compiled) });
 * ```
 *
 * A function rather than a constant, because compiling needs a registry and a
 * module-level `createVendorTriageRegistry()` call would build one on import
 * for every consumer whether or not it runs a workflow. The result is a
 * {@link CompiledWorkflow}, which is the only thing the runtime accepts, so "a
 * workflow with a missing capability MUST fail validation before any node
 * executes" holds by type.
 *
 * @throws {import("@internal/core").ValidationError} if the definition is not a
 * valid graph or a reference does not resolve at its exact version. Both are
 * defects in this file or in `src/capabilities.ts`, not conditions a caller can
 * recover from.
 */
export function compileVendorTriageWorkflow(registry: CapabilityRegistry): CompiledWorkflow {
  return compileWorkflow(vendorTriageWorkflowDefinition, registry);
}
