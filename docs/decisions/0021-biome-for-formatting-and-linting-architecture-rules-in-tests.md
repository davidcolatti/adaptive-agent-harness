---
status: accepted
date: 2026-09-19
deciders: orchestrator (Claude Fable 5.1) with repository owner constraints; recorded during M0
related: [0018, 0022, 0023]
supersedes: null
superseded_by: null
---

# ADR-0021: Biome for formatting and linting; architecture rules live in tests

## Context

Build plan M0-T3 requires Biome for formatting and baseline linting, with rules for unused
imports, suspicious code, correctness, import organization, and consistent formatting, and states
"Use TypeScript/architecture tests for rules Biome should not own." `docs/research/tooling/
2026-09-19-m0-toolchain-verification.md` §7 records what was verified against the installed
Biome (2.5.14): Biome's own linter rejected the first draft of `biome.json`, which is how two
corrections were found: `rules.recommended`/`actions.recommended` are deprecated in favor of
`preset: "recommended"`, and folder ignores must not carry a trailing `/**` since Biome 2.2.0
(`"!**/dist"`, not `"!**/dist/**"`, per rule `lint/suspicious/useBiomeIgnoreFolder`). `biome lint`
does not run assist actions, so the project's `lint` script is `biome check
--formatter-enabled=false .`, which runs the linter plus the `organizeImports` assist while
formatting stays out of scope (`--enforce-assist` defaults to `true`, so an unsorted import is an
error under `lint`, not just a suggestion). `format:check` is `biome format .` (no `--write`),
verified to exit 1 on an unformatted file and 0 once formatted. `biome check --staged` exists and
is used in the pre-commit hook (ADR-0023). Biome parses comments in `tsconfig*.json`, verified by
formatting a tsconfig containing `//` and `/* */` comments, which is why the tsconfig files in
this repository carry real explanatory comments rather than avoiding them. `vcs.useIgnoreFile:
true` makes Biome honor `.gitignore` instead of duplicating ignore patterns.

`tests/architecture/boundaries.ts` implements the M0-T3 instruction directly: a data table
(`BOUNDARY_RULES`, listing `adapterOnlyDependencies` such as `eve`, `@supabase/*`, `ai`,
`@ai-sdk/*`, `@vercel/*`, `workflow`; the `adapterPackages` allowed to depend on them; and
`forbiddenByPackage` bans narrower than the general adapter rule, such as `@internal/core` being
explicitly forbidden from every adapter-facing external surface) plus a pure function
(`findBoundaryViolations`) that checks every declared workspace package dependency against that
table and returns violations with human-readable reasons. This directly encodes build plan §4's
dependency rule in prose ("Vercel-specific behavior lives behind adapter packages", "core cannot
import domain code... eve... Supabase") as data, tested by `tests/architecture/
package-boundaries.test.ts` against the real workspace.

## Decision

Biome (pinned at 2.5.14, ADR-0018) is the sole formatter and linter for this repository; no
ESLint or Prettier configuration is present or planned. `biome.json` MUST use `preset:
"recommended"` (not the deprecated `rules.recommended`/`actions.recommended` keys) as the base
for every rule category (`correctness`, `suspicious`, `complexity`, `style`, `performance`,
`security`, `a11y`), with the explicitly enabled additions the current configuration lists:
`correctness.noUnusedImports`, `noUnusedVariables`, `noUnusedFunctionParameters`,
`noUnusedPrivateClassMembers`, `noUnusedLabels` all set to `"error"`; `style.useImportType`,
`useExportType`, `useNodejsImportProtocol` all set to `"error"`; and the `assist.actions.source.
organizeImports` action set to `"on"`. Folder ignores in `files.includes` MUST use the
bare-folder form (`"!**/dist"`) rather than a trailing-glob form, per Biome 2.2.0's
`useBiomeIgnoreFolder` rule. `lint` MUST remain `biome check --formatter-enabled=false .`
(linter plus import-organization assist, formatting excluded) and `format:check` MUST remain
`biome format .`, kept as two separate scripts specifically so a formatting failure and a
lint/correctness failure are distinguishable, non-overlapping CI/local failures (ADR-0023) rather
than one command whose failure reason a contributor has to guess at.

Dependency-boundary rules that the build plan states as architectural prose (§4 dependency rule)
MUST live as a data table plus a pure checking function in `tests/architecture/boundaries.ts`,
exercised by an architecture test against the real workspace (`tests/architecture/
package-boundaries.test.ts`), per M0-T3's instruction to keep such rules out of the linter.
Extending the boundary rules for a new package or a new adapter-only external dependency MUST be
done by editing the `BOUNDARY_RULES` constant, not by adding a bespoke assertion to the test file
or a Biome rule.

## Consequences

### Positive

- One formatter/linter with no overlapping ESLint+Prettier configuration to keep in sync removes
  an entire class of "which tool wins" conflicts and configuration drift.
- Dependency-boundary rules as data plus a pure function are independently unit-testable with
  fabricated packages (not just against the real repository), which means a new boundary rule
  can be tested in isolation before it is ever applied to real workspace packages.

### Negative

- Biome's rule surface is younger and smaller than ESLint's plugin ecosystem; a project-specific
  lint rule that an ESLint plugin might provide off the shelf may need to be hand-built as an
  architecture test instead (as already done for dependency boundaries).
- The two corrections found while drafting `biome.json` (deprecated preset keys, folder-ignore
  glob syntax) indicate Biome's configuration schema has changed across versions; any future
  Biome upgrade needs the same verify-against-the-installed-schema discipline (AD-011) rather
  than copying configuration from older Biome documentation or examples.

### Neutral

- Constrains Milestone 0 (M0-T3) and applies uniformly to every file Biome's `files.includes`
  pattern covers across the whole workspace.
- `tests/architecture/boundaries.ts` and `tests/architecture/package-boundaries.test.ts` are the
  concrete implementation; every future milestone that adds a package with an adapter role
  (`packages/runtime-eve`, `packages/decision-jev`, `packages/storage-supabase`, and so on, per
  build plan §4) must be added to `BOUNDARY_RULES.adapterPackages`.

## Alternatives considered

- **ESLint plus Prettier**: rejected in favor of a single tool (Biome) that formats and lints
  with a shared configuration file and Rust-speed execution, avoiding the two-tool
  configuration-sync burden ESLint+Prettier setups are known for.
- **dependency-cruiser (or a similar off-the-shelf architecture-boundary tool)** for the
  dependency-rule enforcement: rejected in favor of a project-owned data table plus pure
  function, per M0-T3's explicit instruction that rules Biome should not own belong in
  TypeScript/architecture tests; a hand-written table is also directly unit-testable with
  fabricated packages, which a config-driven external tool would not offer as naturally.
- **Turborepo's built-in `boundaries` feature (2.x)**: considered and rejected (recorded in the
  toolchain research note, §11 item 5); the build plan's dependency rule concerns declared
  dependencies across packages, which the test-based approach already covers and can unit-test
  with fabricated packages, so a second, tool-specific boundaries configuration was judged
  redundant.

## References

- `docs/research/tooling/2026-09-19-m0-toolchain-verification.md` §7 (Biome 2.5.14), §11 item 5
- `docs/milestones/build-plan.md` §4 dependency rule, Milestone 0 (M0-T3)
- Related ADRs: 0018, 0022, 0023
- Related code paths: `biome.json`, `tests/architecture/boundaries.ts`, `tests/architecture/
  package-boundaries.test.ts`
