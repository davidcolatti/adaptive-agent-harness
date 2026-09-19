---
status: accepted
date: 2026-09-19
deciders: orchestrator (Claude Fable 5.1) with repository owner constraints; recorded during M0
related: [0018, 0020, 0021]
supersedes: null
superseded_by: null
---

# ADR-0022: Vitest projects and test-file taxonomy

## Context

Build plan M0-T4 requires four test-file suffixes (`*.test.ts`, `*.integration.test.ts`,
`*.contract.test.ts`, `*.replay.test.ts`) and a test-helpers package "immediately." §4
Repository Layout lists `vitest.workspace.ts` as part of the intended file tree.

`docs/research/tooling/2026-09-19-m0-toolchain-verification.md` §6 documents a deviation from
that layout: **`vitest.workspace.ts` is not used**, because the installed Vitest 5.0.1 dist
contains no reference to it; Vitest 5 expects `test.projects` inside a single `vitest.config.ts`
instead. The build plan's repository layout listing `vitest.workspace.ts` is stale for this
installed version, and the repository uses one root `vitest.config.ts` with four named projects
(`unit`, `integration`, `contract`, `replay`) instead. Projects are selected with `--project
<name>`, confirmed against the installed `vitest --help` output, which is why `package.json`
defines `test:unit`, `test:integration`, `test:contract`, and `test:replay` as `vitest run
--project <name>`, alongside a plain `test` = `vitest run` that runs every project.

Two further verified facts shape the configuration. **`passWithNoTests` is root-only**: the
installed Vitest 5 types list it in `NonProjectOptions`, so it cannot be set per project, and it
is set once at the root so `integration`, `contract`, and `replay` (which have no files yet) can
still exit zero. **`configDefaults.exclude` is only `["**/node_modules/**", "**/.git/**"]`** in
Vitest 5 (read at runtime from the installed package, not assumed from memory or older docs), so
`vitest.config.ts` explicitly adds `**/dist/**` and `**/.turbo/**` to the exclude list every
project uses. Because the `unit` project's `**/*.test.ts` pattern would also match
`*.integration.test.ts`, `*.contract.test.ts`, and `*.replay.test.ts` (all valid matches for the
glob), the `unit` project's `exclude` list additionally excludes those three specialized suffixes
explicitly, so a file is picked up by exactly one project, not by `unit` plus its specialized
project.

`vite` (8.3.0) is declared as a direct `devDependency` of the workspace root because Vitest 5
lists it as a non-optional `peerDependency` (`^6.4.0 || ^7.0.0 || ^8.0.0`), and `vitest.config.ts`
imports `defaultServerConditions`/`defaultExternalConditions` from it directly (ADR-0020), which
requires `vite` to be an explicit, resolvable dependency rather than an implicit transitive one.

`@internal/testing` was created immediately, per M0-T4, as the shared test-helpers package. Its
only exported member at the end of Milestone 0 is `createFakeClock` (`packages/testing/src/
clock.ts`, re-exported from `packages/testing/src/index.ts`): a deterministic, manually-advanced
time source, motivated by the fact that trace events, run ledgers, and replay fixtures are all
timestamped and tests asserting on them need controlled, not wall-clock, time.

## Decision

Test discovery and execution MUST use a single root `vitest.config.ts` with four named
`test.projects` entries (`unit`, `integration`, `contract`, `replay`), not a
`vitest.workspace.ts` file; the build plan's repository-layout mention of `vitest.workspace.ts`
is recorded here as stale for the installed Vitest version and MUST NOT be reintroduced without
first re-verifying that the installed Vitest version supports it. The file-suffix taxonomy from
build plan §4/§8 MUST be preserved exactly: `*.test.ts` for the default (`unit`) layer,
`*.integration.test.ts`, `*.contract.test.ts`, and `*.replay.test.ts` for the three specialized
layers, each matched by its own project's `include` pattern, with the `unit` project's `exclude`
list explicitly excluding the three specialized suffixes so no file is double-counted.
`passWithNoTests: true` MUST be set once, at the root `test` level, never per project, since
Vitest 5's types do not support the latter. `configDefaults.exclude` MUST be spread and extended
with `**/dist/**` and `**/.turbo/**` in every project's `exclude` list, rather than assuming
Vitest's own defaults already cover build output and task caches. `vite` MUST remain a direct
root `devDependency`, pinned exactly (ADR-0018), reflecting its status as vitest's non-optional
peer rather than an implicit transitive dependency.

`@internal/testing` is the single shared test-helpers package for the whole workspace; new
cross-package test utilities are added here, not duplicated per package. `createFakeClock` is
its sole M0 export and MUST remain the pattern for future time-dependent test helpers: a
deterministic, explicitly-advanced clock rather than a mocked global `Date`/`setTimeout`.

## Consequences

### Positive

- A single `vitest.config.ts` with named projects keeps test configuration in one place while
  still letting `pnpm test:unit` (the fast, pre-push-suitable layer, ADR-0023) run independently
  of the slower `integration`/`contract`/`replay` layers.
- Layers with no files yet (`integration`, `contract`, `replay` at the end of Milestone 0) still
  pass, so `pnpm check` is green from the start rather than blocked on layers that have no
  content until later milestones populate them.

### Negative

- Departing from the build plan's documented `vitest.workspace.ts` layout means any future reader
  following the build plan's repository-layout section literally will look for a file that does
  not exist; this ADR and the toolchain research note are the record of why, and the build plan's
  layout section itself should be treated as stale on this specific point per its own
  documentation rules (build plan §4: "If code and docs disagree, the coding agent MUST stop
  treating the doc as authoritative, verify actual behavior, and update or mark the stale doc").
- The `unit` project's exclude list must be kept in sync with the specialized-suffix list by
  hand; adding a fifth test-file suffix in a later milestone requires updating both the new
  project's `include` and the `unit` project's `exclude`.

### Neutral

- Constrains Milestone 0 (M0-T4) and every later milestone's test files, which must use one of
  the four suffixes to land in the correct project.
- Constrains `vitest.config.ts`, `package.json` (`test`, `test:unit`, `test:integration`,
  `test:contract`, `test:replay` scripts), and `packages/testing`.

## Alternatives considered

- **Per-package Vitest configuration invoked through Turborepo** (a `test` task per package
  instead of one root runner): rejected; it would fragment the four-layer taxonomy across every
  package's own config and lose the single point of truth for exclude patterns and
  `passWithNoTests`, for no benefit at the current package count.
- **`node:test`** as the runner instead of Vitest: rejected; Vitest's project system directly
  matches the plan's four-layer taxonomy, integrates with the `@internal/source` export condition
  (ADR-0020) via Vite's resolution pipeline, and was already the toolchain the research note
  verified; `node:test` would require rebuilding equivalent project/tag/exclude machinery by
  hand.

## References

- `docs/research/tooling/2026-09-19-m0-toolchain-verification.md` §6 (Vitest 5.0.1 and Vite
  8.3.0)
- `docs/milestones/build-plan.md` §4 Repository Layout, §8 Testing Strategy, Milestone 0 (M0-T4)
- Related ADRs: 0018, 0020, 0021
- Related code paths: `vitest.config.ts`, `package.json`, `packages/testing/src/clock.ts`,
  `packages/testing/src/index.ts`
