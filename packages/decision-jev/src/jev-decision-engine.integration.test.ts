import { type BooleanQuestion, bandFor, type ChoiceQuestion, defineQuestion } from "@internal/core";
import { describe, expect, it } from "vitest";
import { createJevDecisionEngine, JEV_GATEWAY_MODEL_ID } from "./jev-decision-engine.js";

/**
 * The one test in this package that calls a real model — `live:jev` in the
 * build plan's taxonomy.
 *
 * **It skips rather than fails when no credential is present**, and prints why.
 * The milestone requires both halves of that: "decision tests use fake engines
 * by default; live Jev tests are explicitly tagged" and "live-provider tests do
 * not run on normal pre-commit". The `*.integration.test.ts` suffix keeps it out
 * of the `unit` project entirely (`vitest.config.ts`), so `pnpm test:unit` and
 * the pre-commit hook never reach it; this guard is the second line, for
 * `pnpm test`, which does run the `integration` project.
 *
 * To run it for real:
 *
 * ```sh
 * AI_GATEWAY_API_KEY=... pnpm vitest run --project integration packages/decision-jev
 * ```
 */

const CREDENTIAL_VARIABLES = ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"] as const;

const credential = CREDENTIAL_VARIABLES.find((name) => (process.env[name] ?? "") !== "");

if (credential === undefined) {
  // `process.stderr.write` rather than `console.warn`, matching
  // `run-inspector.integration.test.ts`: Vitest intercepts `console` and a
  // skipped file's console output is not shown, so a skip announced that way
  // would be silent — which is the one thing this message exists to prevent.
  process.stderr.write(
    [
      "",
      "jev-decision-engine.integration.test.ts: SKIPPING the live Jev leg (`live:jev`).",
      `  Neither ${CREDENTIAL_VARIABLES.join(" nor ")} is set, so there is no AI`,
      "  Gateway credential and no evaluation call can be made. The unit suite still",
      "  runs the adapter against `Experimental_EvaluationMockModelV4` from `ai/test`.",
      "",
      "  To run it:",
      "    AI_GATEWAY_API_KEY=... pnpm vitest run --project integration packages/decision-jev",
      "",
      "  See docs/contracts/decision-engine.md.",
      "",
    ].join("\n"),
  );
}

const LOW_RISK = defineQuestion<BooleanQuestion>({
  id: "harness.live-check.asks-for-refund",
  version: "1.0.0",
  kind: "boolean",
  prompt: "Is the customer asking for money back?",
  bands: { auto: 0.9, agentReview: 0.6 },
});

const DEPARTMENT = defineQuestion<ChoiceQuestion>({
  id: "harness.live-check.department",
  version: "1.0.0",
  kind: "choice",
  prompt: "Which team should handle this?",
  choices: ["billing", "support"],
  choiceDescriptions: {
    billing: "Payments, charges and refunds.",
    support: "Everything else.",
  },
  bands: { auto: 0.9, agentReview: 0.6 },
});

describe.skipIf(credential === undefined)("live:jev — createJevDecisionEngine", () => {
  it("answers a boolean and a choice question from one shared state", async () => {
    const engine = createJevDecisionEngine({ model: JEV_GATEWAY_MODEL_ID });

    const result = await engine.evaluate({
      state: { message: "I was charged twice. Please refund the extra charge." },
      questions: { refund: LOW_RISK, department: DEPARTMENT },
    });

    expect(result.answers.refund.kind).toBe("boolean");
    expect(result.answers.refund.value).toBe(true);
    expect(result.answers.refund.probabilityTrue).toBeGreaterThan(0.5);
    expect(bandFor(result.answers.refund, LOW_RISK.bands as never)).not.toBe("human-review");

    expect(result.answers.department.kind).toBe("choice");
    expect(["billing", "support"]).toContain(result.answers.department.value);

    expect(result.model.modelId).toContain("jev");
    expect(result.latencyMs).toBeGreaterThan(0);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
});
