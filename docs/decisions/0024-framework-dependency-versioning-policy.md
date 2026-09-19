---
status: accepted
date: 2026-09-19
deciders: orchestrator (Claude Fable 5.1) with repository owner constraints; recorded during M1-T1
related: [0002, 0003, 0011, 0012, 0016, 0018, 0019, 0022]
supersedes: null
superseded_by: null
---

# ADR-0024: Framework dependency versioning policy

## Context

M1-T1 installed the first third-party framework dependencies this repository has ever had:
`eve@0.63.0` and `ai@7.0.107`, plus `ai`'s required peer `zod@4.6.5`. Every prior dependency was
build tooling, governed by ADR-0018 through ADR-0023. A framework dependency is different in kind:
its API shape is load-bearing for harness code, and AGENTS.md already forbids guessing that shape
(rule 6, rule 10, AD-011 / ADR-0011).

Three forces make an explicit policy necessary now rather than later.

**`eve` is preview software, by its own statement.** `node_modules/eve/docs/README.md` says: "eve
is in preview; the framework, APIs, documentation, and behavior may change before general
availability." ADR-0003 nevertheless makes `eve` the default runtime adapter. A framework that
may change its API between minor releases, sitting behind a boundary the harness depends on, is
a standing risk that has to be managed by process rather than by hope.

**Two packages can disagree about compatibility.** `eve@0.63.0` declares `ai: "^7.0.105"` as a
required peer dependency (`node_modules/eve/package.json`; it is the only one of eve's six peers
without an `optional: true` entry in `peerDependenciesMeta`). Today that range happens to admit
the newest `ai`, 7.0.107, so nothing had to be resolved
(`docs/research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md` §2). That will not stay true.
`ai` ships patch releases frequently, and `eve` is on a preview cadence. The tie-breaker must be
decided while it is cheap, not during the upgrade that first needs it.

**AGENTS.md already requires exact pins but does not say how they are enforced.** "Architecture
boundaries and hard prohibitions" states: "No silent dependency additions. Verify against actual
docs/types, pin to an exact version (no `^`/`~`), justify in a WORKLOG entry." Until M1-T1 there
was nothing to enforce it against, and a rule with no mechanism decays. AD-016 / ADR-0016 requires
the mechanism to be recorded rather than implied.

The existing architecture boundary (`tests/architecture/boundaries.ts`) answers a different
question. It enforces *which package* may depend on `eve`, `ai`, `@ai-sdk/*`, `@supabase/*`,
`@vercel/*` and `workflow`. It says nothing about *which version*, and it is not extended to do so
here; version policy and dependency-direction policy stay separate mechanisms.

## Decision

**Exact pins.** Every workspace package MUST declare framework dependencies at an exact version,
with no `^`, `~`, `>=`, `*` or other range operator. This covers `eve`, `ai`, `@ai-sdk/*`,
`@supabase/*`, `@vercel/*` and `workflow`, and extends to any package required to satisfy one of
their required peer dependencies. `workspace:*` remains the correct form for internal
`@internal/*` dependencies and is not affected. The pins as of M1-T1 are `eve@0.63.0`,
`ai@7.0.107` and `zod@4.6.5`.

**Required peers are declared, optional peers are not.** A required peer dependency of an
installed framework package MUST be declared explicitly, pinned, by the workspace package that
depends on that framework package. It MUST NOT be left to pnpm's automatic peer installation,
because an auto-installed peer is not visible in any manifest and therefore cannot be pinned,
reviewed, or asserted. An *optional* peer (one carrying `"optional": true` in
`peerDependenciesMeta`) MUST NOT be installed unless a task explicitly needs the feature it
enables; adding one later is its own task under this ADR. Accordingly `@internal/runtime-eve`
declares `eve`, `ai` and `zod`, and `@internal/runtime-ai-sdk` declares `ai` and `zod`. Eve's five
optional peers (`dd-trace`, `just-bash`, `braintrust`, `microsandbox`, `@opentelemetry/api`) are
deliberately absent.

**`ai` is a direct dependency of the eve adapter, not a transitive one.** `@internal/runtime-eve`
MUST declare `ai` itself, because `ai` is both a required peer of `eve` and present on eve's
public type surface: 109 of eve's shipped `.d.ts` files import from `"ai"`, including modules
reachable through public export subpaths such as `eve/models/openai`, whose `chatgpt()` and
`openai()` are declared to return `ai`'s `LanguageModel`
(`docs/research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md` §2).

**The compatibility tie-breaker: eve wins for the eve adapter.** When the newest `ai` release
falls outside the `ai` peer range declared by the installed `eve`, `@internal/runtime-eve` MUST
pin the newest `ai` version that `eve` accepts, not the newest `ai` that exists. This follows the
source-of-truth protocol's own rule that the lockfile-matched installed package wins, applied to a
disagreement between two installed packages: the adapter exists to make `eve` work, so `eve`'s
declared compatibility governs it. The discrepancy MUST be recorded in a dated research note under
`docs/research/vercel/` at the time it is observed. `@internal/runtime-ai-sdk` is not bound by
`eve`'s range and MAY pin a newer `ai`; if that ever produces two different `ai` versions in the
lockfile, resolving it (by holding `runtime-ai-sdk` back, or by upgrading `eve`) is a task with
its own ADR, not a silent lockfile edit.

**Upgrades are tasks, never incidental edits.** Changing the pinned version of any framework
dependency MUST be its own task with its own WORKLOG entry, and that entry MUST carry a fresh
`Implementation references` section produced by re-running the source-of-truth inspection against
the newly installed version, not copied from a previous entry. For `eve` specifically, the upgrade
MUST re-read `node_modules/eve/docs/` (starting at its `README.md`), because eve directs authors
to its shipped docs and those docs change with the package. An upgrade MUST NOT be performed as a
side effect of another task, and `pnpm update` MUST NOT be run across framework dependencies. A
version bump that changes the API the harness calls also requires re-reading the relevant
installed `.d.ts` before the adapter code is changed.

**Installed-version assertion tests are the enforcement mechanism.** Every workspace package that
declares a framework dependency MUST carry a co-located unit test that, for each such dependency,
reads the pinned string from its own `package.json` on disk and the `version` field from the
resolved installed `package.json` on disk, and asserts the two are equal; and that asserts the
package declares no `^` or `~` range anywhere in its manifest. The version MUST NOT be written
into the test as a literal, so that the test verifies agreement between manifest and lockfile
rather than restating a constant. `packages/runtime-eve/src/index.test.ts` and
`packages/runtime-ai-sdk/src/index.test.ts` are the reference implementations. These run in the
`unit` project and therefore in `pnpm check` and CI.

**Adapter entrypoints prove resolution.** Each adapter package's `src/index.ts` MUST, while it is
otherwise empty, re-export at least one documented public type from the framework it adapts, so
that `pnpm typecheck` fails if the public entrypoint stops resolving. It MUST NOT import from a
package-internal path, including the exported-but-internal subpaths `eve/internal/*` and
`ai/internal`.

## Consequences

### Positive

- A framework version can only change through a deliberate, logged, re-verified task. Combined
  with the assertion tests, a version that drifts between `package.json` and the lockfile fails
  `pnpm check` immediately, rather than surfacing as a confusing type error in adapter code weeks
  later.
- The preview status of `eve` becomes a managed process rather than an ambient risk: every
  upgrade is forced through a re-read of the shipped docs, which is exactly where a preview
  framework's breaking changes are described.
- Declaring required peers explicitly keeps every version that affects the harness visible in a
  manifest, reviewable in a diff, and coverable by the assertion tests.
- The tie-breaker means nobody has to decide, mid-upgrade and under pressure, whether to chase the
  newest `ai` or keep `eve` working.

### Negative

- Exact pins mean the repository receives no patch or security fix automatically. Every bump is
  manual work, and with `eve` on a preview cadence and `ai` shipping patches frequently, that cost
  is real and recurring. The project accepts it: an unreviewed API change in a runtime adapter is
  worse than a delayed patch, and AGENTS.md already forbade ranges.
- Declaring `zod` in two adapter packages duplicates a pin that must be kept in step by hand. The
  assertion tests catch a mismatch against the lockfile but do not force the two packages to agree
  with each other.
- The assertion tests add an obligation to every future package that takes a framework dependency,
  and the current two implementations share their shape by duplication rather than through a
  helper. Extracting one into `@internal/testing` is deferred until a third package needs it,
  rather than designed speculatively.

### Neutral

- Binds `packages/runtime-eve`, `packages/runtime-ai-sdk`, and every future package that declares
  `eve`, `ai`, `@ai-sdk/*`, `@supabase/*`, `@vercel/*` or `workflow`, which by
  `tests/architecture/boundaries.ts` means the declared adapter packages.
- Does not change `tests/architecture/boundaries.ts`. Dependency direction and dependency version
  remain separate concerns with separate mechanisms.
- Does not govern build tooling, which stays under ADR-0018, ADR-0019 and ADR-0022. Those are
  already pinned exactly by the same AGENTS.md rule.
- pnpm's `minimumReleaseAgeExclude` list in `pnpm-workspace.yaml` grows by one entry per
  deliberately-installed recent package. It is a supply-chain release-age record, not a version
  pin, and stale entries are pruned by hand because `minimumReleaseAgeExcludePrune` is left at its
  default of `false` (ADR-0018, M0 WORKLOG).

## Alternatives considered

- **Caret ranges with a lockfile as the only pin.** Rejected. It is what AGENTS.md's "pin to an
  exact version (no `^`/`~`)" already prohibits, and with a preview framework a caret range invites
  an unreviewed API change to arrive through a routine `pnpm install` on a different machine. The
  lockfile would still pin the resolved version, but the manifest would stop being a readable,
  reviewable statement of what the harness is built against.
- **Renovate or Dependabot automation for framework dependencies.** Rejected for now. Automated
  bumps cannot produce the `Implementation references` checkpoint that ADR-0011 requires, so every
  automated PR would need the same manual re-verification anyway, while creating pressure to merge
  it without one. Build tooling could reasonably be automated later; framework dependencies could
  not.
- **Always pin the newest `ai`, and let `eve` warn.** Rejected. pnpm reports an unmet peer as a
  warning, not an error, so this would let a known-incompatible pair install silently and fail at
  runtime. It also inverts the reason the eve adapter exists.
- **Pin only `eve` and take `ai` transitively.** Rejected on the evidence: `ai` is a required peer
  of `eve` and appears on eve's public type surface, so it is a dependency of the eve adapter in
  fact, and declaring it is the only way it can be pinned and asserted.
- **Encode the version policy in `tests/architecture/boundaries.ts`.** Rejected. That module
  answers "which package may depend on this", and its rule engine takes dependency *names*, not
  versions. Widening it would conflate two independent rules in one table and make both harder to
  change. Per-package assertion tests keep the failure local to the package that drifted.

## References

- `docs/research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md` §1 (installed versions), §2
  (peer dependencies, the eve-vs-ai compatibility finding, `ai` on eve's public type surface), §4
  and §6 (the public export maps and the internal subpaths that are off limits)
- `docs/development/source-of-truth-protocol.md` §1 (source precedence), §3 (the
  `Implementation references` checkpoint), §6 (the `eve` protocol and its shipped docs)
- `AGENTS.md`, "Architecture boundaries and hard prohibitions" (no silent dependency additions,
  exact pins) and "The thirteen non-negotiable rules" (6, 10)
- `docs/milestones/build-plan.md` §1 AD-011, AD-012, AD-016
- Related ADRs: 0002, 0003 (eve is the default runtime adapter), 0011 (no guessed Vercel detail),
  0012 (reuse documented eve capabilities), 0016 (record internal choices), 0018, 0019, 0022
- Related code paths: `packages/runtime-eve/package.json`,
  `packages/runtime-eve/src/index.test.ts`, `packages/runtime-ai-sdk/package.json`,
  `packages/runtime-ai-sdk/src/index.test.ts`, `pnpm-workspace.yaml`,
  `tests/architecture/boundaries.ts`
