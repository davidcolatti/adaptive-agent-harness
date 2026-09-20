import type { WorkflowDefinition } from "@internal/core";

/**
 * A workflow that has passed every check there is, and the bytes and digest
 * taken over it.
 *
 * It is the handoff between the two halves of Milestone 4. `compileWorkflow()`
 * (M4-T4, M4-T9) produces one; the local deterministic runtime (M4-T6) consumes
 * one and nothing else. That is the whole reason the type exists ahead of either
 * of them: the validator, the runtime and the DSL are built in parallel, and a
 * shared result type is what lets them be.
 *
 * **Holding a `CompiledWorkflow` means all of this is already true**, and the
 * runtime may therefore assume it rather than re-check it:
 *
 * - the definition parsed (`parseWorkflowDefinition`), so it is well formed,
 *   deep-frozen and JSON-representable;
 * - the graph is valid: no unreachable node, no missing node, no duplicate id,
 *   no incompatible schema pairing, no cycle that is not a declared bounded
 *   loop, and no `branch` without an escalation target (M4-T4);
 * - every capability reference resolved against the `CapabilityRegistry` at an
 *   exact version, so no node names something that is not registered (AD-015,
 *   ADR-0015, M4-T9);
 * - the node-level rules hold: a `code` node grants no tools, a
 *   `non-idempotent-write` `call` declares its protection (M4-T7, M4-T8).
 *
 * The inverse matters just as much: a `WorkflowDefinition` on its own carries
 * **none** of those guarantees. `parseWorkflowDefinition()` is a shape boundary
 * with no registry and no graph analysis, so a definition that parsed may still
 * name a node that does not exist. Anything that executes a workflow takes a
 * `CompiledWorkflow`, which is how "a workflow with a missing capability MUST
 * fail validation before any node executes" becomes a type-level fact rather
 * than a discipline.
 */
export interface CompiledWorkflow {
  /**
   * The parsed, deep-frozen, graph-validated definition, with every capability
   * reference resolved.
   */
  readonly definition: WorkflowDefinition;
  /**
   * The canonical JSON bytes of {@link CompiledWorkflow.definition}, from
   * `canonicalWorkflowIr()`.
   *
   * Carried rather than recomputed because the registry stores them, a diff
   * reads them and the fingerprint is taken over them; computing them three
   * times from the same frozen value would be three chances to disagree.
   */
  readonly canonicalJson: string;
  /**
   * The workflow fingerprint, `sha256:<hex>`, from `workflowFingerprint()`.
   *
   * The value `FallbackContext.workflow.fingerprint` carries, the `workflowIr`
   * component of a run's behavior fingerprint (ADR-0034), and what M6 compares
   * to decide whether two runs are comparable at all.
   */
  readonly fingerprint: string;
}
