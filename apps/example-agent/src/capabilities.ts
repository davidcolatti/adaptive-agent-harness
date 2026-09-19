import {
  type CapabilityManifest,
  type CapabilityRegistry,
  createCapabilityRegistry,
} from "@internal/core";
import { lookupVendorEvidence } from "../agent/lib/vendor-evidence.js";
import { vendorTriageInputSchema, vendorTriageOutputSchema } from "./domain/schemas.js";
import { detectPaymentDetailChange } from "./handlers/detect-payment-detail-change.js";
import { noProceedWithOpenRiskFlags } from "./policies/no-proceed-with-open-risk-flags.js";

/**
 * The vendor-triage domain's capability registrations (M1-T9).
 *
 * Milestone 1 requires the neutral domain to register input/output schemas, the
 * full agent, the fixture read-only tool, one deterministic handler and one
 * policy. All five are here, and the manifest they produce is the artifact
 * AD-015 describes: enough metadata for validation, fingerprints, replay
 * lineage and deterministic source imports, and no executable source or secret.
 *
 * **Module specifiers are repository-relative paths.** `apps/example-agent`
 * publishes no subpath exports, and two of the five capabilities live under
 * `agent/`, which `eve` compiles and this package does not export at all. A
 * path is the one form that can name every capability consistently, and it is
 * what a consuming repository would write for its own files. M8's source
 * generator is what turns a specifier into an import statement; recording the
 * path is what stops it having to invent one.
 */

/** Where the example's files live, relative to the repository root. */
const APP = "apps/example-agent";

/** The schema capability IDs, matching the strings `createJob` already writes. */
export const VENDOR_TRIAGE_INPUT_SCHEMA_REF = "vendor-triage.input@1.0.0";

/** The output schema capability's reference, in the `id@version` string form. */
export const VENDOR_TRIAGE_OUTPUT_SCHEMA_REF = "vendor-triage.output@1.0.0";

/**
 * What the registry holds for the full agent.
 *
 * The agent itself is an `eve` definition (`agent/agent.ts`, `defineAgent`),
 * and importing it here would drag `eve` into the harness-facing half of this
 * package for no benefit: the registry needs to know *where the agent is*, not
 * *what eve makes of it*. This descriptor is that: a plain, serializable
 * statement of the authored files the agent is made of, which is also what a
 * behavior fingerprint over instructions, SOP and skills (M2-T8) will hash.
 */
export const VENDOR_TRIAGE_AGENT_DESCRIPTOR = {
  framework: "eve",
  agentDirectory: `${APP}/agent`,
  entry: `${APP}/agent/agent.ts`,
  instructions: `${APP}/agent/instructions.md`,
  skills: [`${APP}/agent/skills/triage-vendor.md`],
  tools: ["lookup_vendor_evidence"],
} as const;

/**
 * Register every vendor-triage capability into `registry`.
 *
 * Registration order matters in exactly one way: the two schemas are registered
 * first, because a capability that names an `inputSchema` or `outputSchema`
 * reference is rejected unless that schema is already registered. That rule is
 * what makes the manifest **closed**, so codegen and validation can resolve
 * every reference inside it without a second lookup table.
 *
 * @returns the same registry, so a caller can chain or inspect it.
 */
export function registerVendorTriageCapabilities(registry: CapabilityRegistry): CapabilityRegistry {
  registry.register("schema", {
    id: "vendor-triage.input",
    version: "1.0.0",
    module: `${APP}/src/domain/schemas.ts`,
    exportName: "vendorTriageInputSchema",
    value: vendorTriageInputSchema,
  });

  registry.register("schema", {
    id: "vendor-triage.output",
    version: "1.0.0",
    module: `${APP}/src/domain/schemas.ts`,
    exportName: "vendorTriageOutputSchema",
    value: vendorTriageOutputSchema,
  });

  // The full agent. `read` is the whole of what it may do: its one enabled
  // tool reads frozen fixture evidence, and `web_search`/`web_fetch` are
  // disabled at eve's own slots.
  registry.register("agent", {
    id: "vendor-triage-agent",
    version: "1.0.0",
    module: `${APP}/agent/agent.ts`,
    exportName: "default",
    inputSchema: { id: "vendor-triage.input", version: "1.0.0" },
    outputSchema: { id: "vendor-triage.output", version: "1.0.0" },
    permissions: ["read"],
    value: VENDOR_TRIAGE_AGENT_DESCRIPTOR,
  });

  // The read-only fixture tool. `module`/`exportName` name the authored `eve`
  // tool, because that is what a generated import would have to reference; the
  // registered *value* is the pure function behind it, which is the part
  // anything other than `eve` can actually call.
  registry.register("tool", {
    id: "lookup_vendor_evidence",
    version: "1.0.0",
    module: `${APP}/agent/tools/lookup_vendor_evidence.ts`,
    exportName: "default",
    permissions: ["read"],
    value: lookupVendorEvidence,
  });

  registry.register("handler", {
    id: "detect-payment-detail-change",
    version: "1.0.0",
    module: `${APP}/src/handlers/detect-payment-detail-change.ts`,
    exportName: "detectPaymentDetailChange",
    value: detectPaymentDetailChange,
  });

  registry.register("policy", {
    id: "no-proceed-with-open-risk-flags",
    version: "1.0.0",
    module: `${APP}/src/policies/no-proceed-with-open-risk-flags.ts`,
    exportName: "noProceedWithOpenRiskFlags",
    value: noProceedWithOpenRiskFlags,
  });

  return registry;
}

/** Create a registry holding exactly the vendor-triage capabilities. */
export function createVendorTriageRegistry(): CapabilityRegistry {
  return registerVendorTriageCapabilities(createCapabilityRegistry());
}

/**
 * The domain's serializable capability manifest.
 *
 * This is Milestone 1's "the example domain can serialize its capability
 * manifest" criterion as a value rather than a claim. It is built once at
 * module load, which is safe because registration is pure: it stores
 * references to already-imported values and executes none of them.
 *
 * `procurement-sop`, which `Job.contracts.sop` names, is deliberately **not**
 * registered. A SOP is content, not an executable capability, and hashing its
 * content into a behavior fingerprint is M2-T8's work; treating it as a
 * `handler` or a `policy` now would put a wrong kind on a permanent ID.
 */
export const vendorTriageManifest: CapabilityManifest = createVendorTriageRegistry().toManifest();
