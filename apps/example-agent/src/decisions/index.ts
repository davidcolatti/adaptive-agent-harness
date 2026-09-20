// The vendor-triage domain's decision layer (M3-T8, M3-T9).
//
// Four modules, in the order they compose: the registered questions, the
// policy that routes their answers, the engine that answers them, and the
// calibration fixture that says whether the three together behave. Re-exports
// are listed by name rather than starred, so a symbol becomes public
// deliberately.

export type {
  CalibrationCase,
  CalibrationOutcome,
  CalibrationReport,
  ConfusionCell,
  QuestionCalibration,
  RunCalibrationOptions,
} from "./calibration.js";
export { renderCalibrationReport, runCalibration } from "./calibration.js";
export {
  CALIBRATION_CASES,
  CALIBRATION_VENDORS,
  SYNTHETIC_VENDORS,
} from "./calibration-cases.js";
export type {
  CreateVendorDecisionEngineOptions,
  ResolvedDecisionEngine,
} from "./engine.js";
export {
  createVendorDecisionEngine,
  hasGatewayCredential,
  resolveDecisionEngine,
} from "./engine.js";
export type { VendorCategory } from "./questions.js";
export {
  CATEGORY_QUESTION,
  CLASSIFY_BUNDLE_ID,
  CLASSIFY_BUNDLE_VERSION,
  EVIDENCE_SUFFICIENT_QUESTION,
  EVIDENCE_SUPPORTS_QUESTION,
  LOW_RISK_QUESTION,
  TRIAGE_QUESTIONS,
  VENDOR_CATEGORIES,
} from "./questions.js";
export type {
  CreateVendorDecisionPortOptions,
  CreateVendorDecisionRegistryOptions,
} from "./registry.js";
export { createVendorDecisionPort, createVendorDecisionRegistry } from "./registry.js";
export type { TriageRoute, TriageThresholds } from "./triage-policy.js";
export {
  createTriagePolicy,
  DEFAULT_TRIAGE_THRESHOLDS,
  TRIAGE_POLICY_ID,
  TRIAGE_POLICY_VERSION,
  TRIAGE_ROUTES,
} from "./triage-policy.js";
