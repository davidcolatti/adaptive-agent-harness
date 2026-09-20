import { describe, expect, it } from "vitest";
import { renderCalibrationReport, runCalibration } from "./calibration.js";
import { CALIBRATION_CASES, CALIBRATION_VENDORS } from "./calibration-cases.js";
import { createVendorDecisionEngine } from "./engine.js";
import { TRIAGE_QUESTIONS } from "./questions.js";
import { createTriagePolicy, DEFAULT_TRIAGE_THRESHOLDS } from "./triage-policy.js";

/**
 * The calibration fixture (M3-T9).
 *
 * The numbers below are **asserted exactly**, not bounded, because the fixture
 * engine is deterministic and a calibration report whose numbers could drift
 * without a test noticing would be worse than none: a threshold change is
 * supposed to move them, and this file is what makes that movement visible in a
 * diff.
 */

function calibrate(thresholds = DEFAULT_TRIAGE_THRESHOLDS, version = "1.0.0") {
  return runCalibration({
    engine: createVendorDecisionEngine({ vendors: CALIBRATION_VENDORS }),
    questions: TRIAGE_QUESTIONS,
    policy: createTriagePolicy(thresholds, version),
    cases: CALIBRATION_CASES,
    primary: "category",
    fallbackRoute: "uncertain",
  });
}

describe("the labeled set", () => {
  it("has enough cases, and enough of each route, to say anything", () => {
    expect(CALIBRATION_CASES.length).toBeGreaterThanOrEqual(12);

    const counts = new Map<string, number>();

    for (const labeled of CALIBRATION_CASES) {
      counts.set(labeled.expectedRoute, (counts.get(labeled.expectedRoute) ?? 0) + 1);
    }

    // Every route exercised more than once, so a failure is attributable to a
    // cause rather than to one case.
    expect(counts.get("clear")).toBeGreaterThan(1);
    expect(counts.get("research")).toBeGreaterThan(1);
    expect(counts.get("uncertain")).toBeGreaterThan(1);
  });

  it("gives every case a unique id", () => {
    const ids = CALIBRATION_CASES.map((labeled) => labeled.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the three frozen demo vendors in the calibration universe unchanged", () => {
    // A calibration run and a demo run must see the same evidence for the same
    // vendor, or the report says nothing about the demo.
    expect(CALIBRATION_VENDORS.map((vendor) => vendor.vendorName)).toEqual(
      expect.arrayContaining([
        "Northwind Ledger",
        "Tessellate Analytics",
        "Cobalt Harbor Logistics",
      ]),
    );
  });
});

describe("runCalibration", () => {
  it("routes every labeled case as labeled, under the shipped thresholds", async () => {
    const report = await calibrate();

    expect(report.total).toBe(CALIBRATION_CASES.length);
    expect(report.failures).toEqual([]);
    expect(report.accuracy).toBe(1);
    // Nothing was acted on automatically and wrong, which is the metric that
    // matters. It is zero because accuracy is one; a threshold change that
    // breaks accuracy without moving this number is a change that made the
    // harness cautious rather than wrong, and the report distinguishes them.
    expect(report.falseAutoRate).toBe(0);
  });

  it("reports a fallback rate that is exactly the labeled `uncertain` cases", async () => {
    const report = await calibrate();
    const expected = CALIBRATION_CASES.filter(
      (labeled) => labeled.expectedRoute === "uncertain",
    ).length;

    expect(report.fallbackRate).toBeCloseTo(expected / CALIBRATION_CASES.length, 4);
  });

  it("reports the uncertain-band rate as the cases a person would have to look at", async () => {
    const report = await calibrate();

    // The two `uncertain` cases are the ones whose category confidence is flat,
    // so those are exactly the primary answers outside the `auto` band.
    expect(report.uncertainBandRate).toBeCloseTo(2 / CALIBRATION_CASES.length, 4);
  });

  it("builds a confusion matrix over routes, with only diagonal cells when accurate", async () => {
    const report = await calibrate();

    expect(report.confusionMatrix.every((cell) => cell.expected === cell.actual)).toBe(true);
    expect(report.confusionMatrix.reduce((sum, cell) => sum + cell.count, 0)).toBe(report.total);
  });

  it("breaks the numbers down per question, naming each one's id and version", async () => {
    const report = await calibrate();

    expect(report.perQuestion.map((question) => question.key)).toStrictEqual([
      "lowRisk",
      "category",
      "evidenceSufficient",
    ]);

    for (const question of report.perQuestion) {
      expect(question.question).toMatch(/^vendor-triage\.[a-z-]+@1\.0\.0$/u);
      expect(question.accuracy).toBe(1);
      expect(question.falseAuto).toBe(0);
    }
  });

  it("shows a tightened threshold trading accuracy for fallbacks, not for wrong answers", async () => {
    // The whole reason a calibration fixture exists: a reader can see what a
    // number change costs. Raising the category threshold above the fixture
    // engine's 0.95 sends **every** case to the fallback route, so accuracy
    // collapses while the false-auto rate stays at zero.
    const strict = await calibrate(
      {
        minimumCategoryConfidence: 0.99,
        minimumLowRiskConfidence: 0.8,
        minimumEvidenceConfidence: 0.8,
      },
      "2.0.0",
    );

    expect(strict.fallbackRate).toBe(1);
    expect(strict.falseAutoRate).toBe(0);
    expect(strict.accuracy).toBeLessThan(1);
    expect(strict.failures.length).toBeGreaterThan(0);
  });

  it("runs one engine call per case, because one case is one state", async () => {
    // M3-T6: batching is by shared state. Three questions about one vendor are
    // one call; two vendors are two.
    const calls: unknown[] = [];
    const fixture = createVendorDecisionEngine({ vendors: CALIBRATION_VENDORS });

    await runCalibration({
      engine: {
        evaluate(request) {
          calls.push(request.state);

          return fixture.evaluate(request);
        },
      },
      questions: TRIAGE_QUESTIONS,
      policy: createTriagePolicy(),
      cases: CALIBRATION_CASES,
      primary: "category",
      fallbackRoute: "uncertain",
    });

    expect(calls).toHaveLength(CALIBRATION_CASES.length);
  });
});

describe("renderCalibrationReport", () => {
  it("prints every metric and the per-question breakdown", async () => {
    const text = renderCalibrationReport(await calibrate());

    expect(text).toContain("Accuracy:");
    expect(text).toContain("Uncertain band:");
    expect(text).toContain("False auto:");
    expect(text).toContain("Fallback:");
    expect(text).toContain("Confusion matrix (expected -> actual)");
    expect(text).toContain("vendor-triage.category@1.0.0");
    expect(text).not.toContain("Failures");
  });

  it("names the failing cases when there are any", async () => {
    const text = renderCalibrationReport(
      await calibrate(
        {
          minimumCategoryConfidence: 0.99,
          minimumLowRiskConfidence: 0.8,
          minimumEvidenceConfidence: 0.8,
        },
        "2.0.0",
      ),
    );

    expect(text).toContain("Failures");
    expect(text).toContain("northwind-ledger: expected clear, got uncertain");
  });
});
