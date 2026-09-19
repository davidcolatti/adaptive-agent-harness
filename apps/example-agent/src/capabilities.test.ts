import { createCapabilityRegistry, formatCapabilityRef, ValidationError } from "@internal/core";
import { describe, expect, it } from "vitest";
import {
  createVendorTriageRegistry,
  registerVendorTriageCapabilities,
  VENDOR_TRIAGE_AGENT_DESCRIPTOR,
  vendorTriageManifest,
} from "./capabilities.js";
import { vendorTriage } from "./domain/index.js";
import { detectPaymentDetailChange } from "./handlers/detect-payment-detail-change.js";
import { noProceedWithOpenRiskFlags } from "./policies/no-proceed-with-open-risk-flags.js";

describe("the vendor-triage capability manifest", () => {
  it("registers the five kinds Milestone 1 requires", () => {
    expect(
      vendorTriageManifest.entries.map(
        (entry) => `${entry.kind}:${formatCapabilityRef(entry.ref)}`,
      ),
    ).toEqual([
      "schema:vendor-triage.input@1.0.0",
      "schema:vendor-triage.output@1.0.0",
      "agent:vendor-triage-agent@1.0.0",
      "tool:lookup_vendor_evidence@1.0.0",
      "handler:detect-payment-detail-change@1.0.0",
      "policy:no-proceed-with-open-risk-flags@1.0.0",
    ]);
  });

  it("records module and export metadata for every entry, with a fingerprint", () => {
    for (const entry of vendorTriageManifest.entries) {
      expect(entry.module).toMatch(/^apps\/example-agent\/.+\.ts$/u);
      expect(entry.exportName.length).toBeGreaterThan(0);
      expect(entry.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
    }
  });

  it("declares `read` for the agent and the tool, and nothing for the pure capabilities", () => {
    const permissions = Object.fromEntries(
      vendorTriageManifest.entries.map((entry) => [entry.ref.id, entry.permissions]),
    );

    expect(permissions["vendor-triage-agent"]).toEqual(["read"]);
    expect(permissions.lookup_vendor_evidence).toEqual(["read"]);
    expect(permissions["detect-payment-detail-change"]).toEqual([]);
    expect(permissions["no-proceed-with-open-risk-flags"]).toEqual([]);
  });

  it("points the agent at both registered schemas, so the manifest is closed", () => {
    const agent = vendorTriageManifest.entries.find((entry) => entry.kind === "agent");

    expect(agent?.inputSchema).toEqual({ id: "vendor-triage.input", version: "1.0.0" });
    expect(agent?.outputSchema).toEqual({ id: "vendor-triage.output", version: "1.0.0" });
  });

  it("serializes and round-trips through JSON", () => {
    const serialized = JSON.stringify(vendorTriageManifest);

    expect(JSON.parse(serialized)).toEqual(vendorTriageManifest);
    expect(vendorTriageManifest.version).toBe(1);
  });

  it("contains no executable source and no secret", () => {
    const serialized = JSON.stringify(vendorTriageManifest);

    expect(serialized).not.toContain("=>");
    expect(serialized).not.toContain("function");
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("process.env");
    // The descriptor's own fields are values, not the manifest's: the manifest
    // records where the agent is, not what the agent is made of.
    expect(serialized).not.toContain(VENDOR_TRIAGE_AGENT_DESCRIPTOR.instructions);
  });

  it("is stable: registering twice produces identical fingerprints", () => {
    const again = createVendorTriageRegistry().toManifest();

    expect(again).toEqual(vendorTriageManifest);
  });
});

describe("the vendor-triage runtime registry", () => {
  it("resolves the string contract references a job already carries", () => {
    const registry = createVendorTriageRegistry();
    const job = vendorTriage.createJob({
      vendorName: "Northwind Ledger",
      procurementSop: "# SOP",
    });

    expect(registry.resolve("schema", job.contracts.inputSchema)).toBe(vendorTriage.inputSchema);
    expect(registry.resolve("schema", job.contracts.outputSchema)).toBe(vendorTriage.outputSchema);
    // `procurement-sop` is content, not a capability, so nothing resolves it.
    // Fingerprinting SOP content is M2-T8's work.
    expect(job.contracts.sop).toBe("procurement-sop");
  });

  it("holds the executable values, which the manifest does not", () => {
    const registry = createVendorTriageRegistry();

    expect(registry.resolve("handler", "detect-payment-detail-change@1.0.0")).toBe(
      detectPaymentDetailChange,
    );
    expect(registry.resolve("policy", "no-proceed-with-open-risk-flags@1.0.0")).toBe(
      noProceedWithOpenRiskFlags,
    );
    expect(registry.resolve("agent", "vendor-triage-agent@1.0.0")).toBe(
      VENDOR_TRIAGE_AGENT_DESCRIPTOR,
    );
  });

  it("refuses a duplicate registration", () => {
    const registry = createVendorTriageRegistry();

    expect(() => registerVendorTriageCapabilities(registry)).toThrow(ValidationError);
  });

  it("registers into a caller-supplied registry", () => {
    const registry = registerVendorTriageCapabilities(createCapabilityRegistry());

    expect(registry.entries()).toHaveLength(6);
    expect(registry.has("tool", "lookup_vendor_evidence@1.0.0")).toBe(true);
  });
});
