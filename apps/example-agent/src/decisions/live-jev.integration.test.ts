import { describe, expect, it } from "vitest";
import { PROCUREMENT_SOP } from "../domain/procurement-sop.js";
import { renderCalibrationReport, runCalibration } from "./calibration.js";
import { CALIBRATION_CASES } from "./calibration-cases.js";
import { hasGatewayCredential, resolveDecisionEngine } from "./engine.js";
import { TRIAGE_QUESTIONS } from "./questions.js";
import { createTriagePolicy } from "./triage-policy.js";

/**
 * The live Jev path for the vendor-triage fixture, tagged `live:jev`
 * (M3-T8, M3-T9).
 *
 * **It skips with a printed reason when no credential is set**, and it is named
 * `*.integration.test.ts` so the `unit` project — the one pre-commit runs —
 * excludes it by suffix. Both halves are acceptance criteria of Milestone 3:
 * "decision tests use fake engines by default; live Jev tests are explicitly
 * tagged", and "live-provider tests do not run on normal pre-commit".
 *
 * What it checks is deliberately weak, and the reason is worth stating: a real
 * model's answers are not deterministic, so asserting on a specific route would
 * be a flaky test dressed up as a correctness one. It asserts the **contract**
 * — that the answers come back in the right shape, under the right keys, with a
 * confidence the bands can act on — and then prints the calibration report,
 * which is the thing a person reads before changing a threshold.
 */

const CONFIGURED = hasGatewayCredential();

if (!CONFIGURED) {
  process.stderr.write(
    [
      "",
      "live-jev.integration.test.ts: SKIPPING the live Jev leg of the vendor-triage fixture.",
      "  Neither AI_GATEWAY_API_KEY nor VERCEL_OIDC_TOKEN is set, so there is no Gateway",
      "  to call. Every other decision test in this package runs against the deterministic",
      "  fixture engine and asserts the same contract.",
      "",
      "  To run it: set AI_GATEWAY_API_KEY (or VERCEL_OIDC_TOKEN) and",
      "    pnpm test:integration",
      "",
    ].join("\n"),
  );
}

describe.skipIf(!CONFIGURED)("live Jev (live:jev)", () => {
  it("answers the three registered questions about one vendor in one call", async () => {
    const { engine, kind } = resolveDecisionEngine();

    expect(kind).toBe("jev");

    const result = await engine.evaluate({
      state: { vendorName: "Northwind Ledger", procurementSop: PROCUREMENT_SOP },
      questions: TRIAGE_QUESTIONS,
    });

    expect(Object.keys(result.answers)).toStrictEqual([
      "lowRisk",
      "category",
      "evidenceSufficient",
    ]);
    expect(typeof result.answers.lowRisk?.value).toBe("boolean");
    expect(result.model.modelId).toContain("jev");
    // The policy is the same one the demo uses, and it must produce one of the
    // three routes whatever the model said.
    expect(["clear", "research", "uncertain"]).toContain(
      createTriagePolicy().evaluate(result).route,
    );
  });

  it("calibrates the labeled set against the live model and prints the report", async () => {
    const report = await runCalibration({
      engine: resolveDecisionEngine().engine,
      questions: TRIAGE_QUESTIONS,
      policy: createTriagePolicy(),
      cases: CALIBRATION_CASES,
      primary: "category",
      fallbackRoute: "uncertain",
    });

    process.stdout.write(renderCalibrationReport(report));

    // No accuracy threshold is asserted. A number a live model has to clear
    // would make this test a gate on the provider rather than on the harness,
    // and the whole point of the report is that a person reads it.
    expect(report.total).toBe(CALIBRATION_CASES.length);
    expect(report.perQuestion).toHaveLength(3);
  }, 120_000);
});
