/**
 * The identifier and version rules every named thing in the harness obeys.
 *
 * They live in their own module because two different boundaries enforce the
 * same rule and must not drift apart: `defineDomain()` validates a domain's
 * `id`/`version` (M1-T3), and the capability registry validates a capability's
 * `id`/`version` (M1-T9). A domain reference and a capability reference are the
 * same `{ id, version }` shape, so they are the same rule, stated once.
 */

import { ValidationError, type ValidationIssue } from "./errors.js";

/**
 * The identifier rule.
 *
 * Lenient on purpose: it bans whitespace, path separators and `@` rather than
 * insisting on strict kebab-case, because a domain owns its own naming. `@` and
 * whitespace are excluded because a reference is written
 * `vendor-triage.input@1.0.0`, and an identifier containing either would make
 * that string ambiguous to parse.
 */
export const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;

/**
 * Exactly `major.minor.patch`, each a non-negative integer without leading
 * zeros. No ranges (`^1.0.0`), no pre-release and no build metadata: a version
 * is pinned by a promoted workflow (ADR-0015) and compared for equality, and
 * nothing in the harness yet defines an ordering for pre-release tags.
 */
export const EXACT_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;

/** The message {@link isCapabilityIdentifier} failures are reported with. */
export const IDENTIFIER_MESSAGE =
  "expected a non-empty identifier of letters, digits, `.`, `-` or `_`, starting with a letter or digit";

/** The message {@link isExactVersion} failures are reported with. */
export const EXACT_VERSION_MESSAGE =
  "expected an exact `major.minor.patch` version, e.g. `1.0.0`, with no range or tag";

/**
 * True when `value` is a well-formed identifier for a domain or a capability.
 *
 * The two are deliberately the same rule: `Job.domain` and `CapabilityRef` are
 * the same shape, and a domain is expected to become a registered capability's
 * namespace.
 */
export function isCapabilityIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value);
}

/** True when `value` is an exact `major.minor.patch` version string. */
export function isExactVersion(value: unknown): value is string {
  return typeof value === "string" && EXACT_VERSION_PATTERN.test(value);
}

/**
 * Collect the issues in an `{ id, version }` pair, for a caller that is
 * validating several fields and wants to report them all at once.
 *
 * `path` prefixes each issue's path, so a registry can report
 * `["ref", "id"]` while `defineDomain` reports `["id"]`.
 */
export function collectRefIssues(
  id: unknown,
  version: unknown,
  path: readonly (string | number)[] = [],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!isCapabilityIdentifier(id)) {
    issues.push({ path: [...path, "id"], message: IDENTIFIER_MESSAGE });
  }

  if (!isExactVersion(version)) {
    issues.push({ path: [...path, "version"], message: EXACT_VERSION_MESSAGE });
  }

  return issues;
}

/**
 * Throw a {@link ValidationError} carrying `issues`, or return when there are
 * none.
 *
 * Shared by `defineDomain()` and the capability registry so that every
 * identifier failure in the harness has the same error type, the same message
 * style and a path pointing at the offending field.
 */
export function throwIfIssues(message: string, issues: readonly ValidationIssue[]): void {
  if (issues.length > 0) {
    throw new ValidationError(message, { issues });
  }
}
