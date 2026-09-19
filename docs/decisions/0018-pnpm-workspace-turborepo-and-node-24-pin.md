---
status: accepted
date: 2026-09-19
deciders: orchestrator (Claude Fable 5.1) with repository owner constraints; recorded during M0
related: [0011, 0016, 0023]
supersedes: null
superseded_by: null
---

# ADR-0018: pnpm workspace, Turborepo, and Node 24 pin

## Context

The build plan requires a pnpm workspace from day one (§4 Repository Layout: "Use a pnpm
workspace from day one because package boundaries are useful even before publishing") and a
Node 24 pin, Turborepo, and package boundaries as part of M0-T1 ("Bootstrap workspace"). The
project owner's fixed toolchain (recorded in ADR-0002) is TypeScript, pnpm, and GitHub.

`docs/research/tooling/2026-09-19-m0-toolchain-verification.md` records what was actually
verified against the installed toolchain on 2026-09-19 (Node v24.21.0, pnpm 12.4.2, turbo
2.11.2). Three facts from that research directly shape this ADR:

- **pnpm 12 reads its settings from `pnpm-workspace.yaml`, not `.npmrc`.** Verified: with
  `engine-strict=true` in `.npmrc`, `pnpm config get engine-strict` returned `undefined`; moving
  `engineStrict: true` into `pnpm-workspace.yaml` made `pnpm config get engineStrict` return
  `true`. `.npmrc` was deleted rather than left in place looking effective, and none exists in
  the repository today.
- **Documented deviation: pnpm 12.4.2 does not fail on the root project's own `engines` field.**
  pnpm's own docs state installation "will always fail if a project (not a dependency) specifies
  an incompatible version in its `engines` field." Verified twice (in this repository and in a
  clean scratch project) that this is not the installed behavior: with `engines.node` set to an
  impossible range, both `pnpm install` and `pnpm install --force` exited 0, with and without
  `engineStrict`. `engineStrict` in pnpm 12.4.2 gates dependencies only, never the root project
  itself.
- **`minimumReleaseAgeExclude` in `pnpm-workspace.yaml` is pnpm-managed.** pnpm 12 applies a
  supply-chain release-age gate and records deliberately installed newer packages in that list
  itself; it is not a file contributors hand-edit.

## Decision

The workspace root MUST declare `packages: ["packages/*"]` in `pnpm-workspace.yaml` (workspace
member discovery), and pnpm-specific settings (`engineStrict`, `minimumReleaseAgeExclude`) MUST
live in `pnpm-workspace.yaml`, never in `.npmrc`, which MUST NOT exist in this repository.
`package.json` MUST declare an exact `packageManager` field (`pnpm@12.4.2`) so
`pnpm/action-setup` and any contributor's corepack-aware tooling resolve the same pnpm build (see
ADR-0023). Node 24 MUST be pinned by both `.node-version` and `.nvmrc` (currently `24.21.0`), and
CI MUST read the same pin via `actions/setup-node`'s `node-version-file` input rather than a
hard-coded version string. `engines.node` MUST remain declared in `package.json`
(`">=24 <25"`) as documentation for consumers and for `engineStrict`'s dependency-level check,
with the explicit understanding, recorded here and in the research note, that this field does
**not** cause `pnpm install` to fail on the root project itself in pnpm 12.4.2; enforcement of
the Node version for contributors and CI comes entirely from `.node-version`/`.nvmrc` plus
`actions/setup-node`, not from `engines`. `minimumReleaseAgeExclude` MUST be treated as
pnpm-managed and MUST NOT be hand-edited by contributors.

Turborepo (`turbo.json`) orchestrates per-package `build`, `typecheck`, and `dev` tasks. `build`
declares `dependsOn: ["^build"]` so a package builds only after its workspace dependencies have
(required by the `@internal/source` export-condition split, ADR-0020); `typecheck` declares no
dependencies because the `@internal/source` condition lets `tsc --noEmit` read a dependency's
source directly; `dev` is `cache: false, persistent: true`. Turbo only runs workspace packages,
never the repository root, so `pnpm typecheck` is `turbo run typecheck && tsc --noEmit -p
tsconfig.json`, the second half covering `scripts/`, `tests/`, and root config files that live
outside any workspace package. Every dependency in every `package.json` MUST be pinned to an
exact version (no `^` or `~` ranges), matching what is verified installed today (typescript
6.0.3, turbo 2.11.2, @biomejs/biome 2.5.14, vitest 5.0.1, vite 8.3.0, @types/node on the 24.x
line matching the Node pin, husky 9.1.7, secretlint 13.0.5, yaml 2.9.1).

## Consequences

### Positive

- A single settings surface (`pnpm-workspace.yaml`) for pnpm behavior avoids the
  looks-effective-but-is-not trap the research note documents for `.npmrc` under pnpm 12.
- Exact version pins plus a frozen lockfile in CI (ADR-0023) make dependency resolution fully
  reproducible across contributors and CI, with no silent minor/patch drift.
- `^build` plus the `@internal/source` condition (ADR-0020) means `typecheck` never waits on a
  build, keeping the fast local loop fast while `build` still produces dependency-ordered,
  dist-based output for consumers.

### Negative

- `engines.node` cannot be relied upon as a hard install-time gate against the root project's own
  Node mismatch in pnpm 12.4.2; this must be re-verified on any future pnpm major upgrade, since
  the behavior could change and silently weaken the documented rationale for relying on
  `.node-version`/CI instead.
- Exact-version pinning means every dependency bump is a deliberate, reviewed `package.json`
  change rather than an automatic patch/minor update; this is a real ongoing maintenance cost the
  project accepts in exchange for reproducibility.

### Neutral

- Constrains Milestone 0 (M0-T1 Bootstrap workspace) and every later milestone that adds a new
  `packages/*` member, which must be added to `pnpm-workspace.yaml`'s discovery pattern (already
  satisfied by the `packages/*` glob) and pinned exactly in its `package.json`.
- Constrains `pnpm-workspace.yaml`, `package.json`, `turbo.json`, `.node-version`, `.nvmrc`.

## Alternatives considered

- **npm or Yarn workspaces**: not considered viable; the project owner fixed pnpm as the package
  manager (ADR-0002) before M0 began, independent of any per-tool tradeoff analysis.
- **Nx as the task orchestrator**: rejected in favor of Turborepo's simpler task-graph model
  (`dependsOn`, `inputs`, `outputs`, `cache`, `persistent`), which is sufficient for the three
  tasks (`build`, `typecheck`, `dev`) this repository currently needs and avoids Nx's larger
  plugin/generator surface for a workspace this small.
- **No task orchestrator, calling `tsc`/build scripts directly per package via a shell loop**:
  rejected; it would lose Turbo's dependency-ordered execution (`^build`) and caching, both of
  which are load-bearing for keeping `pnpm build` and `pnpm typecheck` fast as the number of
  packages grows past three.

## References

- `docs/research/tooling/2026-09-19-m0-toolchain-verification.md` §1 (installed versions), §3
  (pnpm 12), §8 (Turborepo 2.11.2)
- `docs/milestones/build-plan.md` §4 Repository Layout, Milestone 0 (M0-T1)
- Related ADRs: 0002, 0011, 0016, 0023
- Related code paths: `pnpm-workspace.yaml`, `package.json`, `turbo.json`, `.node-version`,
  `.nvmrc`
