import {
  type CapabilityRegistry,
  canonicalWorkflowIr,
  parseWorkflowDefinition,
  ValidationError,
  workflowFingerprint,
} from "@internal/core";
import type { CompiledWorkflow } from "./compiled.js";
import { validateWorkflow } from "./validate/index.js";

/**
 * Compile an untrusted value into a {@link CompiledWorkflow} (M4-T4, M4-T9).
 *
 * This is the only way to obtain a `CompiledWorkflow`, and holding one is the
 * statement that every check in Milestone 4 has already passed. M4-T9 fixes the
 * order, and the order is the point:
 *
 * 1. **parse** with the versioned schema (`parseWorkflowDefinition()`), which
 *    also rejects unknown fields and deep-freezes the result;
 * 2. **validate the graph and the node rules** — missing nodes, ownership,
 *    reachability, cycles, bindings, grants, protection, escalation;
 * 3. **resolve every capability** against the registry at its exact version, and
 *    check the schemas a resolved capability declares against the node's;
 * 4. **canonicalize** the definition (`canonicalWorkflowIr()`), and
 * 5. **fingerprint** exactly those bytes (`workflowFingerprint()`).
 *
 * Steps 2 and 3 are reported together, in one `ValidationError` carrying every
 * issue, because an author fixing a workflow wants the list rather than the
 * first item of it. Steps 4 and 5 happen only after both pass, so a canonical
 * byte string and a fingerprint never exist for a workflow that cannot run —
 * which is what stops an invalid workflow being stored, compared or promoted on
 * the strength of a digest that looks legitimate.
 *
 * ```ts
 * const compiled = compileWorkflow(JSON.parse(row.ir), registry);
 * // compiled.definition is parsed, frozen and graph-valid
 * // compiled.fingerprint is `sha256:<64 hex>`
 * ```
 *
 * @throws {ValidationError} from `parseWorkflowDefinition()` when the value is
 * not a well-formed definition, or from this function when it is well formed and
 * not a valid workflow.
 */
export function compileWorkflow(
  definition: unknown,
  registry: CapabilityRegistry,
): CompiledWorkflow {
  const parsed = parseWorkflowDefinition(definition);
  const issues = validateWorkflow(parsed, registry);

  if (issues.length > 0) {
    throw new ValidationError("compileWorkflow: workflow definition is invalid", { issues });
  }

  return Object.freeze({
    definition: parsed,
    canonicalJson: canonicalWorkflowIr(parsed),
    fingerprint: workflowFingerprint(parsed),
  });
}
