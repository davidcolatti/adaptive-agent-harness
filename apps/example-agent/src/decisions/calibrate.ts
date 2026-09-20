import { renderCalibrationReport, runCalibration } from "./calibration.js";
import { CALIBRATION_CASES, CALIBRATION_VENDORS } from "./calibration-cases.js";
import {
  createVendorDecisionEngine,
  hasGatewayCredential,
  resolveDecisionEngine,
} from "./engine.js";
import { TRIAGE_QUESTIONS } from "./questions.js";
import { createTriagePolicy } from "./triage-policy.js";

/**
 * `pnpm --filter @internal/example-agent run calibrate` (M3-T9).
 *
 * Runs the labeled set through whichever engine this machine can reach and
 * prints the report. **With no AI Gateway credential it uses the deterministic
 * fixture engine**, so the command works on any machine and its numbers are
 * reproducible; with `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN` set it
 * calibrates **live Jev**, which is the run whose numbers would actually decide
 * a threshold.
 *
 * The two are not interchangeable and the output says which one ran. A fixture
 * run proves the metrics and the labeled set are coherent; only a live run says
 * anything about a model.
 *
 * It exits non-zero when any case is routed differently from its label, so it
 * can gate a change to a threshold in CI on a machine that has a credential.
 */
async function main(): Promise<number> {
  const live = hasGatewayCredential();
  // The fixture engine is built over the **calibration** universe, which adds
  // the synthetic vendors to the frozen three. Live Jev needs no such thing: it
  // reads whatever state it is handed.
  const { engine, description } = live
    ? resolveDecisionEngine()
    : {
        engine: createVendorDecisionEngine({ vendors: CALIBRATION_VENDORS }),
        description:
          "the deterministic fixture engine over the calibration evidence universe (no AI Gateway credential; set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN to calibrate live Jev)",
      };

  process.stderr.write(`Calibrating against ${description}.\n\n`);

  const report = await runCalibration({
    engine,
    questions: TRIAGE_QUESTIONS,
    policy: createTriagePolicy(),
    cases: CALIBRATION_CASES,
    primary: "category",
    fallbackRoute: "uncertain",
  });

  process.stdout.write(renderCalibrationReport(report));

  return report.failures.length === 0 ? 0 : 1;
}

process.exitCode = await main();
