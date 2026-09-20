import {
  createExecutionContext,
  createTraceRecorder,
  type JevNode,
  type JsonValue,
  newJobId,
  newRunId,
  validateWith,
} from "@internal/core";
import { createRecordingTraceWriter } from "@internal/testing";
import { describe, expect, it } from "vitest";
import { PROCUREMENT_SOP } from "../domain/procurement-sop.js";
import {
  vendorTriageClassificationSchema,
  vendorTriageVerificationSchema,
} from "../domain/schemas.js";
import { createFixtureDecisionPort } from "./fixture-decision-port.js";
import { vendorTriageWorkflowDefinition } from "./vendor-triage-workflow.js";

/**
 * The placeholder decision port (M4-T10), and the two properties that make it
 * usable as a stand-in for M3: its answers are deterministic, and they validate
 * against the `jev` nodes' own `outputSchema`s.
 *
 * The nodes are taken from the real workflow rather than written here, so a
 * question reference that drifts is a failing test rather than a silent
 * mismatch.
 */

/** The `classify` node, from the workflow itself. */
const CLASSIFY = vendorTriageWorkflowDefinition.nodes.classify as JevNode;

/** The `verify` node, from the workflow itself. */
const VERIFY = vendorTriageWorkflowDefinition.nodes.verify as JevNode;

/** A context of the shape the runtime hands the port. Nothing here reads it. */
function context() {
  return createExecutionContext({
    runId: newRunId(),
    jobId: newJobId(),
    domain: { id: "vendor-triage", version: "1.0.0" },
    attempt: 1,
    budget: {},
    permissions: [],
    recorder: createTraceRecorder({ runId: newRunId(), writer: createRecordingTraceWriter() }),
    signal: new AbortController().signal,
  });
}

/** Ask the port one question. */
function ask(node: JevNode, input: JsonValue): Promise<JsonValue> {
  return createFixtureDecisionPort().decide({ node, input, context: context() });
}

/** A job input for one vendor. */
function request(vendorName: string): JsonValue {
  return { vendorName, procurementSop: PROCUREMENT_SOP };
}

describe("the fixture decision port's `classify` answers", () => {
  it("routes a well-documented vendor to `clear`", async () => {
    await expect(ask(CLASSIFY, request("Northwind Ledger"))).resolves.toMatchObject({
      category: "clear",
      vendorName: "Northwind Ledger",
    });
  });

  it("routes a vendor whose evidence has to be read to `research`", async () => {
    await expect(ask(CLASSIFY, request("Tessellate Analytics"))).resolves.toMatchObject({
      category: "research",
    });
  });

  it("routes the payment-change vendor to `research`", async () => {
    await expect(ask(CLASSIFY, request("Cobalt Harbor Logistics"))).resolves.toMatchObject({
      category: "research",
    });
  });

  it("routes a vendor that is not on file to `uncertain`", async () => {
    await expect(ask(CLASSIFY, request("Aurelia Freight"))).resolves.toMatchObject({
      category: "uncertain",
    });
  });

  it("routes an input with no vendor name to `uncertain` rather than throwing", async () => {
    await expect(ask(CLASSIFY, { procurementSop: PROCUREMENT_SOP })).resolves.toMatchObject({
      category: "uncertain",
    });
  });

  it("answers with a value the node's own `outputSchema` accepts", async () => {
    const answer = await ask(CLASSIFY, request("Northwind Ledger"));

    await expect(
      validateWith(vendorTriageClassificationSchema, answer, { label: "classify" }),
    ).resolves.toBeDefined();
  });

  it("is deterministic across calls", async () => {
    await expect(ask(CLASSIFY, request("Cobalt Harbor Logistics"))).resolves.toEqual(
      await ask(CLASSIFY, request("Cobalt Harbor Logistics")),
    );
  });
});

describe("the fixture decision port's `verify` answers", () => {
  it("supports a triage that cites at least one source", async () => {
    const answer = await ask(VERIFY, {
      evidence: [{ claim: "It files customs paperwork.", source: "vendor website, /about" }],
    });

    expect(answer).toMatchObject({ supported: true, citedSources: ["vendor website, /about"] });
    await expect(
      validateWith(vendorTriageVerificationSchema, answer, { label: "verify" }),
    ).resolves.toBeDefined();
  });

  it("refuses a triage that cites nothing", async () => {
    await expect(ask(VERIFY, { evidence: [] })).resolves.toMatchObject({
      supported: false,
      citedSources: [],
    });
  });

  it("refuses a triage with no `evidence` field at all", async () => {
    await expect(ask(VERIFY, { category: "logistics" })).resolves.toMatchObject({
      supported: false,
    });
  });
});

describe("the fixture decision port's boundary", () => {
  it("refuses a question this workflow does not ask, rather than answering by default", async () => {
    const unknown: JevNode = { ...CLASSIFY, question: { id: "some.other", version: "2.0.0" } };

    await expect(ask(unknown, request("Northwind Ledger"))).rejects.toThrow(
      /does not answer.*M3 owns the real questions/su,
    );
  });
});
