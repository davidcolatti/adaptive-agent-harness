#!/usr/bin/env node
/**
 * M0-T10 — handoff verification.
 *
 * Fails when the repository's mandatory handoff files (AD-014) are missing or
 * internally inconsistent:
 *
 *   1. `docs/context/current-state.md` is missing;
 *   2. `docs/progress/WORKLOG.md` is missing;
 *   3. a WORKLOG entry whose `**Status:**` line says `completed` has no
 *      `### Verification` section containing a PASS or FAIL result;
 *   4. the WORKLOG references a decision record (`ADR-1234` or
 *      `docs/decisions/1234-...`) whose 4-digit prefix has no file under
 *      `docs/decisions/`.
 *
 * Per the build plan, this deliberately does NOT try to infer whether every
 * code edit was logged. That rule is enforced by task workflow and review.
 *
 * Run with `pnpm check:handoff`. Node 24 executes this TypeScript file directly
 * via type stripping, so the script uses no dependency outside `node:*`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CURRENT_STATE_PATH = "docs/context/current-state.md";
export const WORKLOG_PATH = "docs/progress/WORKLOG.md";
export const DECISIONS_DIR = "docs/decisions";

export interface HandoffInput {
  /** Contents of `docs/context/current-state.md`, or `null` when missing. */
  readonly currentState: string | null;
  /** Contents of `docs/progress/WORKLOG.md`, or `null` when missing. */
  readonly workLog: string | null;
  /**
   * The 4-digit prefixes of the decision records that exist, e.g. `["0000",
   * "0001"]`. An empty list means there are no decision records yet.
   */
  readonly decisionPrefixes: readonly string[];
}

export interface HandoffProblem {
  /** Stable identifier, useful for tests and for grepping CI logs. */
  readonly code:
    | "missing-current-state"
    | "missing-worklog"
    | "completed-entry-without-verification"
    | "missing-decision-record";
  /** Message printed to stderr, one per line. */
  readonly message: string;
}

interface WorkLogEntry {
  /** The `## ` heading text, used to identify the entry in messages. */
  readonly heading: string;
  /** The entry body, excluding the heading line. */
  readonly body: string;
}

/**
 * Split a WORKLOG into entries. Entries are delimited by `## ` headings;
 * anything before the first such heading is file preamble and is not an entry.
 */
export function parseWorkLogEntries(workLog: string): WorkLogEntry[] {
  const entries: WorkLogEntry[] = [];
  let current: { heading: string; lines: string[] } | null = null;

  for (const line of workLog.split("\n")) {
    if (line.startsWith("## ") && !line.startsWith("### ")) {
      if (current !== null) {
        entries.push({ heading: current.heading, body: current.lines.join("\n") });
      }
      current = { heading: line.slice(3).trim(), lines: [] };
      continue;
    }
    current?.lines.push(line);
  }

  if (current !== null) {
    entries.push({ heading: current.heading, body: current.lines.join("\n") });
  }

  return entries;
}

/** True when the entry's `**Status:**` line reports completion. */
export function isCompleted(entryBody: string): boolean {
  const match = /^\s*\*\*Status:\*\*\s*(.*)$/m.exec(entryBody);
  if (match === null) {
    return false;
  }
  const status = match[1] ?? "";
  return /\bcompleted\b/i.test(status);
}

/**
 * True when the entry has a `### Verification` section containing at least one
 * line with a PASS or FAIL result.
 */
export function hasVerificationResult(entryBody: string): boolean {
  const lines = entryBody.split("\n");
  let inVerification = false;

  for (const line of lines) {
    if (line.startsWith("### ")) {
      inVerification = line.slice(4).trim().toLowerCase() === "verification";
      continue;
    }
    if (line.startsWith("## ")) {
      inVerification = false;
      continue;
    }
    if (inVerification && /\b(PASS|FAIL)\b/.test(line)) {
      return true;
    }
  }

  return false;
}

/**
 * Every 4-digit decision-record number referenced by the text, as
 * `ADR-1234` or as a `docs/decisions/1234-` path.
 */
export function referencedDecisionPrefixes(text: string): string[] {
  const prefixes = new Set<string>();

  for (const match of text.matchAll(/\bADR-(\d{4})\b/g)) {
    const prefix = match[1];
    if (prefix !== undefined) {
      prefixes.add(prefix);
    }
  }
  for (const match of text.matchAll(/docs\/decisions\/(\d{4})-/g)) {
    const prefix = match[1];
    if (prefix !== undefined) {
      prefixes.add(prefix);
    }
  }

  return [...prefixes].sort();
}

/** Run every handoff rule and return the problems found, in reporting order. */
export function verifyHandoff(input: HandoffInput): HandoffProblem[] {
  const problems: HandoffProblem[] = [];

  if (input.currentState === null) {
    problems.push({
      code: "missing-current-state",
      message: `${CURRENT_STATE_PATH} is missing. AD-014 requires a concise present-tense handoff file.`,
    });
  }

  if (input.workLog === null) {
    problems.push({
      code: "missing-worklog",
      message: `${WORKLOG_PATH} is missing. AD-014 requires an append-only implementation log.`,
    });
    // Nothing else can be checked without the log.
    return problems;
  }

  for (const entry of parseWorkLogEntries(input.workLog)) {
    if (isCompleted(entry.body) && !hasVerificationResult(entry.body)) {
      problems.push({
        code: "completed-entry-without-verification",
        message: `${WORKLOG_PATH}: entry "${entry.heading}" is marked completed but has no "### Verification" section containing a PASS or FAIL result.`,
      });
    }
  }

  const available = new Set(input.decisionPrefixes);
  for (const prefix of referencedDecisionPrefixes(input.workLog)) {
    if (!available.has(prefix)) {
      problems.push({
        code: "missing-decision-record",
        message: `${WORKLOG_PATH} references decision record ${prefix}, but no file starting with "${prefix}-" exists in ${DECISIONS_DIR}/.`,
      });
    }
  }

  return problems;
}

function readFileOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function readDecisionPrefixes(directory: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const prefixes: string[] = [];
  for (const entry of entries) {
    const match = /^(\d{4})-/.exec(entry);
    if (match?.[1] !== undefined) {
      prefixes.push(match[1]);
    }
  }
  return prefixes;
}

/** Read the repository and run {@link verifyHandoff}. Returns a process exit code. */
export function main(repoRoot: string): number {
  const problems = verifyHandoff({
    currentState: readFileOrNull(resolve(repoRoot, CURRENT_STATE_PATH)),
    workLog: readFileOrNull(resolve(repoRoot, WORKLOG_PATH)),
    decisionPrefixes: readDecisionPrefixes(resolve(repoRoot, DECISIONS_DIR)),
  });

  if (problems.length === 0) {
    process.stdout.write("check:handoff — OK\n");
    return 0;
  }

  process.stderr.write(`check:handoff — ${problems.length} problem(s):\n`);
  for (const problem of problems) {
    process.stderr.write(`  [${problem.code}] ${problem.message}\n`);
  }
  return 1;
}

if (import.meta.main) {
  process.exitCode = main(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
}
