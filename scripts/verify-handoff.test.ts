import { describe, expect, it } from "vitest";
import {
  hasVerificationResult,
  isCompleted,
  parseWorkLogEntries,
  referencedDecisionPrefixes,
  verifyHandoff,
} from "./verify-handoff.js";

const PREAMBLE = `# WORKLOG

Append-only implementation log.

---
`;

const COMPLETED_WITH_VERIFICATION = `## 2026-09-19 10:00 — M0-T1 — Bootstrap workspace

**Status:** completed
**Actor/session:** implementer
**Commit:** not committed

### Goal
Bootstrap the workspace.

### Verification
- \`pnpm build\` — PASS
- \`pnpm test\` — PASS

### Next exact step
Nothing.
`;

const COMPLETED_WITHOUT_VERIFICATION = `## 2026-09-19 11:00 — M0-T2 — TypeScript baseline

**Status:** completed
**Commit:** not committed

### Goal
Turn on strict mode.

### Next exact step
Nothing.
`;

const STARTED_ENTRY = `## 2026-09-19 12:00 — M0-T3 — Biome

**Status:** started

### Goal
Configure Biome.
`;

describe("parseWorkLogEntries", () => {
  it("treats text before the first heading as preamble, not an entry", () => {
    expect(parseWorkLogEntries(PREAMBLE)).toEqual([]);
  });

  it("splits on `## ` headings", () => {
    const entries = parseWorkLogEntries(PREAMBLE + COMPLETED_WITH_VERIFICATION + STARTED_ENTRY);

    expect(entries.map((entry) => entry.heading)).toEqual([
      "2026-09-19 10:00 — M0-T1 — Bootstrap workspace",
      "2026-09-19 12:00 — M0-T3 — Biome",
    ]);
  });

  it("does not split on `### ` subheadings", () => {
    const entries = parseWorkLogEntries(COMPLETED_WITH_VERIFICATION);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.body).toContain("### Verification");
  });
});

describe("isCompleted", () => {
  it("recognises a completed status", () => {
    expect(isCompleted("**Status:** completed")).toBe(true);
  });

  it("ignores started and blocked statuses", () => {
    expect(isCompleted("**Status:** started")).toBe(false);
    expect(isCompleted("**Status:** blocked")).toBe(false);
  });

  it("returns false when there is no status line", () => {
    expect(isCompleted("### Goal\nSomething.")).toBe(false);
  });
});

describe("hasVerificationResult", () => {
  it("accepts a verification section with a PASS line", () => {
    expect(hasVerificationResult(COMPLETED_WITH_VERIFICATION)).toBe(true);
  });

  it("accepts a verification section with a FAIL line", () => {
    expect(hasVerificationResult("### Verification\n- `pnpm test` — FAIL\n")).toBe(true);
  });

  it("rejects an entry with no verification section", () => {
    expect(hasVerificationResult(COMPLETED_WITHOUT_VERIFICATION)).toBe(false);
  });

  it("rejects an empty verification section", () => {
    expect(hasVerificationResult("### Verification\n\n### Next exact step\nGo.")).toBe(false);
  });

  it("does not count a PASS that appears outside the verification section", () => {
    expect(hasVerificationResult("### Goal\nMake it PASS.\n### Verification\n- none\n")).toBe(
      false,
    );
  });
});

describe("referencedDecisionPrefixes", () => {
  it("finds ADR-style references", () => {
    expect(referencedDecisionPrefixes("see ADR-0007 for details")).toEqual(["0007"]);
  });

  it("finds path-style references", () => {
    expect(referencedDecisionPrefixes("see docs/decisions/0012-workflow-ir.md")).toEqual(["0012"]);
  });

  it("deduplicates and sorts", () => {
    expect(referencedDecisionPrefixes("ADR-0003 docs/decisions/0001-x.md ADR-0003")).toEqual([
      "0001",
      "0003",
    ]);
  });

  it("ignores a placeholder that is not four digits", () => {
    expect(referencedDecisionPrefixes("ADR-NNNN and ADR-12")).toEqual([]);
  });
});

describe("verifyHandoff", () => {
  const ok = {
    currentState: "# Current state",
    workLog: PREAMBLE + COMPLETED_WITH_VERIFICATION,
    decisionPrefixes: [],
  };

  it("passes a healthy repository", () => {
    expect(verifyHandoff(ok)).toEqual([]);
  });

  it("fails when current-state.md is missing", () => {
    const problems = verifyHandoff({ ...ok, currentState: null });

    expect(problems.map((problem) => problem.code)).toEqual(["missing-current-state"]);
  });

  it("fails when the worklog is missing and stops checking entries", () => {
    const problems = verifyHandoff({ ...ok, workLog: null });

    expect(problems.map((problem) => problem.code)).toEqual(["missing-worklog"]);
  });

  it("reports both missing files", () => {
    const problems = verifyHandoff({ currentState: null, workLog: null, decisionPrefixes: [] });

    expect(problems.map((problem) => problem.code)).toEqual([
      "missing-current-state",
      "missing-worklog",
    ]);
  });

  it("fails a completed entry with no verification results", () => {
    const problems = verifyHandoff({
      ...ok,
      workLog: PREAMBLE + COMPLETED_WITHOUT_VERIFICATION,
    });

    expect(problems.map((problem) => problem.code)).toEqual([
      "completed-entry-without-verification",
    ]);
    expect(problems[0]?.message).toContain("M0-T2");
  });

  it("does not require verification on a started entry", () => {
    expect(verifyHandoff({ ...ok, workLog: PREAMBLE + STARTED_ENTRY })).toEqual([]);
  });

  it("fails when a referenced decision record does not exist", () => {
    const problems = verifyHandoff({
      ...ok,
      workLog: `${PREAMBLE + COMPLETED_WITH_VERIFICATION}\nDecided in ADR-0009.\n`,
      decisionPrefixes: ["0000"],
    });

    expect(problems.map((problem) => problem.code)).toEqual(["missing-decision-record"]);
    expect(problems[0]?.message).toContain("0009");
  });

  it("passes when the referenced decision record exists", () => {
    const problems = verifyHandoff({
      ...ok,
      workLog: `${PREAMBLE + COMPLETED_WITH_VERIFICATION}\nDecided in ADR-0009.\n`,
      decisionPrefixes: ["0000", "0009"],
    });

    expect(problems).toEqual([]);
  });
});
