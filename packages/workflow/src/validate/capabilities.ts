import {
  type CapabilityKind,
  type CapabilityManifestEntry,
  type CapabilityRegistry,
  formatCapabilityRef,
  type NodeCapabilityRef,
  type ValidationIssue,
  type WorkflowDefinition,
} from "@internal/core";
import { nodeEntries } from "./graph.js";

/**
 * Capability resolution (M4-T9, steps 2 and 3).
 *
 * AD-015 is the rule this implements: workflow IR embeds no import, no source
 * and no unregistered definition, so everything a workflow does is named by a
 * `{ id, version }` reference that must resolve against the domain's
 * `CapabilityRegistry` before anything runs. "A workflow with a missing
 * capability MUST fail validation before any node executes" is exactly this
 * pass, and `CompiledWorkflow` is what carries the result as a fact.
 *
 * Two deliberate limits:
 *
 * - **Exact versions only.** `registry.has()` is asked for the reference as
 *   written; there is no "latest", no range and no fallback to another version.
 *   AD-015 requires a promoted workflow to pin exact capability versions, and a
 *   validator that resolved loosely would be the thing that unpinned them.
 * - **A `jev` node's `question` is not resolved.** A question is not one of the
 *   five capability kinds — M3 owns the question contract and the
 *   `DecisionEngine` — so there is nothing here to resolve it against.
 *   Validating that a named question exists is M3's boundary, applied when a
 *   workflow is registered (M5). The node carries `questionKind` precisely so
 *   that M4 can validate everything around the question without M3 being
 *   present (ADR-0038).
 */

/** Index the registry's manifest once, so each reference costs one lookup. */
function indexEntries(registry: CapabilityRegistry): Map<string, CapabilityManifestEntry> {
  const index = new Map<string, CapabilityManifestEntry>();

  for (const entry of registry.entries()) {
    index.set(`${entry.kind}:${formatCapabilityRef(entry.ref)}`, entry);
  }

  return index;
}

/**
 * Every id registered as a `tool`, at any version.
 *
 * A {@link ToolGrant} names a tool id and no version, because it is permission
 * to use a tool rather than a pinned dependency on one, so this is the set a
 * grant is checked against.
 */
export function registeredToolIds(registry: CapabilityRegistry): ReadonlySet<string> {
  const ids = new Set<string>();

  for (const entry of registry.entries()) {
    if (entry.kind === "tool") {
      ids.add(entry.ref.id);
    }
  }

  return ids;
}

/**
 * Resolve every capability reference a workflow makes, and check that the
 * schemas a resolved capability declares are the schemas the node declares.
 *
 * The second half is what makes resolution more than an existence check. A
 * handler registered with `inputSchema: vendor.candidate@1.0.0` and a `code`
 * node declaring `inputSchema: vendor.notes@1.0.0` both resolve, and the
 * workflow is still wrong: the node's contract and the capability's contract
 * disagree, and the run would fail at the first validation. A manifest entry
 * that declares no schema says nothing, and nothing is checked.
 */
export function collectCapabilityIssues(
  definition: WorkflowDefinition,
  registry: CapabilityRegistry,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const index = indexEntries(registry);

  const requireRef = (
    kind: CapabilityKind,
    ref: NodeCapabilityRef | string,
    path: readonly (string | number)[],
  ): CapabilityManifestEntry | undefined => {
    const formatted = typeof ref === "string" ? ref : formatCapabilityRef(ref);
    const entry = index.get(`${kind}:${formatted}`);

    if (entry === undefined) {
      issues.push({
        path,
        message: `no \`${kind}\` capability \`${formatted}\` is registered; a workflow resolves every reference at an exact version before it runs`,
      });
    }

    return entry;
  };

  requireRef("schema", definition.inputSchema, ["inputSchema"]);
  requireRef("schema", definition.outputSchema, ["outputSchema"]);

  for (const [id, node] of nodeEntries(definition)) {
    const at = (...rest: readonly (string | number)[]): readonly (string | number)[] => [
      "nodes",
      id,
      ...rest,
    ];

    requireRef("schema", node.inputSchema, at("inputSchema"));
    requireRef("schema", node.outputSchema, at("outputSchema"));

    /** Check a resolved capability's declared schemas against the node's. */
    const checkDeclaredSchemas = (
      entry: CapabilityManifestEntry | undefined,
      field: "handler" | "tool" | "agent",
    ): void => {
      if (entry === undefined) {
        return;
      }

      if (
        entry.inputSchema !== undefined &&
        formatCapabilityRef(entry.inputSchema) !== node.inputSchema
      ) {
        issues.push({
          path: at("inputSchema"),
          message: `expected \`${formatCapabilityRef(entry.inputSchema)}\`, the \`inputSchema\` the \`${entry.kind}\` capability \`${formatCapabilityRef(entry.ref)}\` declares in its \`${field}\`; got \`${node.inputSchema}\``,
        });
      }

      if (
        entry.outputSchema !== undefined &&
        formatCapabilityRef(entry.outputSchema) !== node.outputSchema
      ) {
        issues.push({
          path: at("outputSchema"),
          message: `expected \`${formatCapabilityRef(entry.outputSchema)}\`, the \`outputSchema\` the \`${entry.kind}\` capability \`${formatCapabilityRef(entry.ref)}\` declares in its \`${field}\`; got \`${node.outputSchema}\``,
        });
      }
    };

    switch (node.type) {
      case "code":
        checkDeclaredSchemas(requireRef("handler", node.handler, at("handler")), "handler");
        break;
      case "reduce":
        checkDeclaredSchemas(requireRef("handler", node.handler, at("handler")), "handler");
        break;
      case "call":
        checkDeclaredSchemas(requireRef("tool", node.tool, at("tool")), "tool");
        break;
      case "agent":
        checkDeclaredSchemas(requireRef("agent", node.agent, at("agent")), "agent");
        break;
      case "branch":
        if (node.on.kind === "policy") {
          requireRef("policy", node.on.policy, at("on", "policy"));
        }
        break;
      case "loop":
        if (node.until.kind === "policy") {
          requireRef("policy", node.until.policy, at("until", "policy"));
        }
        break;
      default:
        // `jev` resolves nothing (its question is M3's, not a capability kind);
        // `artifact`, `escalate`, `chain` and `map` name no capability beyond
        // the two schemas already checked above.
        break;
    }
  }

  return issues;
}
