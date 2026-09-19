# Milestone 0, Repository Foundation

**Goal (from the build plan):** a clean repository that a human or coding agent can clone and
safely change without first negotiating tooling conventions.

**Deliverable:** a boring, high-quality TypeScript workspace.

**Blocked by:** nothing.

**Parallel work:** T2 through T5 can run in parallel after T1. T7 and T8 are independent.

Status source: `../progress/WORKLOG.md`. Every work-log heading follows the pattern
`## YYYY-MM-DD HH:mm — Mx-Ty — <title>`; the evidence column below cites the `Mx-Ty — <title>`
portion, and all M0 entries so far carry the date `2026-09-19`.

## Tasks

| Task | Description | Status | Evidence |
| --- | --- | --- | --- |
| M0-T1 | Bootstrap the pnpm workspace, Node 24 pin, Turborepo, package boundaries, dotfiles and root scripts. | completed | WORKLOG.md, "M0-T1 — Bootstrap workspace" |
| M0-T2 | Enable the TypeScript strict baseline (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and the rest). | completed | WORKLOG.md, "M0-T2 — TypeScript strict baseline" (plus the follow-up entry "M0-T2 — Follow-up: hold @types/node on the Node 24 line") |
| M0-T3 | Adopt Biome for formatting and baseline linting; put rules Biome should not own into architecture tests. | completed | WORKLOG.md, "M0-T3 — Biome and the architecture boundary test" |
| M0-T4 | Set up Vitest with the four test-file layers and add the test-helpers package. | completed | WORKLOG.md, "M0-T4 — Vitest and the test-helpers package" |
| M0-T5 | Add Husky git hooks: Biome plus secret scan pre-commit, typecheck plus unit tests pre-push. | completed | WORKLOG.md, "M0-T5 — Git hooks" |
| M0-T6 | Add the initial GitHub Actions CI pipeline with a pinned lockfile install. | completed | WORKLOG.md, "M0-T6 — GitHub Actions" |
| M0-T7 | Write the canonical engineering instructions in `AGENTS.md`, with `CLAUDE.md` pointing at it. | completed | `../../AGENTS.md`, `../../CLAUDE.md`, `../../README.md`, `../../.github/pull_request_template.md`; WORKLOG.md, "M0-T7 — Engineering instructions" |
| M0-T8 | Create ADRs for the decisions in the build plan. | completed | `../decisions/README.md` plus ADR files `0000-template.md` through `0023-git-hooks-secret-scanning-and-ci-gates.md` |
| M0-T9 | Create the project documentation memory: the full `docs/` structure and its required initial files. | completed | `../README.md`, this file, `m1-local-agent-and-public-harness-boundary.md`, `../architecture/system-map.md`; WORKLOG.md, "M0-T9 — Project documentation memory" |
| M0-T10 | Enforce work logging: add the progress protocol to `AGENTS.md` and add the handoff verification script. | completed | WORKLOG.md, "M0-T10 — Enforce work logging"; `scripts/verify-handoff.ts` |
| M0-T11 | Create the framework reference procedure, `docs/development/source-of-truth-protocol.md`. | completed | `../development/source-of-truth-protocol.md`; WORKLOG.md, "M0-T11 — Framework reference procedure" |

### Notes

- **M0-T8** is complete but larger than the build plan implies. The plan says "create ADRs for the
  decisions in this document", which is ADRs 0001 to 0017 (AD-001 through AD-016 plus owner
  constraints). The repository additionally carries 0018 to 0023, recording the Milestone 0
  toolchain choices under AD-016. See `../decisions/README.md` for the index and the two
  provenance notes at its end.
- The build plan's Repository Layout section lists `vitest.workspace.ts`. Vitest 5 uses
  `test.projects` in `vitest.config.ts` instead; there is no `vitest.workspace.ts` in this
  repository. See ADR-0022.

## Acceptance criteria

The build plan's Milestone 0 acceptance criteria. All eleven are PASS by inspection or local proof;
criteria 2 to 4 are PASS by local proof only, since CI itself has not yet run (see below).

| # | Criterion | Status | Basis |
| --- | --- | --- | --- |
| 1 | Fresh clone, `pnpm install`, `pnpm check` succeeds. | PASS by inspection | The M0-T1 work-log verification section records `pnpm install` PASS and `pnpm check` PASS (all six stages, from a clean `dist`). The M0-T6 entry re-ran each CI command individually, all PASS, plus `pnpm install --frozen-lockfile` PASS. |
| 2 | Deliberate type error fails CI. | PASS by local proof; CI itself unexecuted | M0-T2 work-log gate-break proof: a deliberate type error in `packages/core/src/__gate-proof.ts` failed `pnpm typecheck` with exit 2 and TS2322, and a second proof in `scripts/__gate-proof.ts` showed root scripts are covered too. Both reverted, PASS after. |
| 3 | Deliberate formatting error fails CI. | PASS by local proof; CI itself unexecuted | M0-T3 work-log gate-break proof: a badly formatted file made `pnpm format:check` fail with exit 1 and the expected Biome diff. Reverted, PASS after. |
| 4 | Deliberate unit-test failure fails CI. | PASS by local proof; CI itself unexecuted | M0-T4 work-log gate-break proof: a deliberately failing unit test made `pnpm test:unit` fail with exit 1, `AssertionError: expected 1 to be 2`. Reverted, PASS after. |
| 5 | Workspace package boundaries build independently. | PASS by inspection | M0-T1 work-log verification lines: `pnpm --filter @internal/testing build` PASS and `pnpm --filter @internal/core build` PASS, each building independently, alongside a full `pnpm build`. |
| 6 | `AGENTS.md` is enough for a coding agent to understand the repository rules. | PASS | Orchestrator review of `AGENTS.md` claim by claim against `package.json`, `vitest.config.ts`, `biome.json`, the git hooks, the CI workflow, `tests/architecture/boundaries.ts`, and `scripts/verify-handoff.ts`. |
| 7 | No AI runtime code exists yet. | PASS by inspection | Only `packages/core`, `packages/testing` and `packages/config` exist. `packages/core/src/index.ts` is an empty boundary (a comment and `export {}`); `packages/testing/src/` holds only `index.ts`, `clock.ts` and `clock.test.ts`; `packages/config` has no runtime code. No `eve`, AI SDK or Supabase dependency is declared anywhere. See `../architecture/system-map.md`. |
| 8 | `docs/context/current-state.md` accurately states M0 status and next step. | PASS | `docs/context/current-state.md` was rewritten by the orchestrator at session close with the completed tasks, verification results, the next task, and the first command to run. |
| 9 | `docs/progress/WORKLOG.md` contains entries for completed M0 tasks. | PASS by inspection | The file carries dated entries for the session start, M0-T1 through M0-T6, M0-T10, a tooling task-group result, and an M0-T2 follow-up. Every completed task above has a matching entry. |
| 10 | A fresh coding agent can follow the documented read order without prior chat context. | PASS | `docs/README.md` states the read order; an orchestrator link check over 47 Markdown files under `docs/` plus `AGENTS.md`, `README.md`, and `CLAUDE.md` found 0 broken relative links. |
| 11 | The source-of-truth protocol explicitly forbids guessed Vercel APIs. | PASS | `docs/development/source-of-truth-protocol.md` sections 1, 2, 4, and 5 forbid guessed Vercel APIs explicitly. |

### Why criteria 2 to 4 are not a plain PASS

The three gate-break criteria say "fails CI". Each gate has been broken deliberately and observed
to fail *locally*, running the identical commands CI runs, in the identical order. CI itself has
never executed: per the M0-T6 work-log entry, the workflow has not been run because there is no
remote and nothing has been committed. The first push should be watched, and these three should be
upgraded to a plain PASS only after a real CI run reproduces the local result.
