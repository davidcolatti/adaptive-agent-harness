---
status: accepted
date: 2026-09-19
deciders: orchestrator (Claude Fable 5.1) with repository owner constraints; recorded during M1-T2
related: [0001, 0002, 0003, 0012, 0021, 0024]
supersedes: null
superseded_by: null
---

# ADR-0025: Application packages may author `eve` agents directly

## Context

Milestone 1 requires a neutral example domain: a vendor-triage agent that the harness runs
locally. The build plan's Repository Layout (§4) places it at `apps/example-agent/`, with the
normal `eve` authored structure underneath (`agent/agent.ts`, `agent/instructions.md`,
`agent/skills/`, `agent/tools/`, `agent/lib/`), and M1-T2 is the task that creates it.

That structure cannot exist under the boundary rule as written. `tests/architecture/boundaries.ts`
encodes the build plan's dependency rule as data: `adapterOnlyDependencies` lists `eve`,
`@supabase/*`, `ai`, `@ai-sdk/*`, `@vercel/*` and `workflow`, and Rule 2 in
`findBoundaryViolations` rejects any workspace package outside `adapterPackages` that declares one
of them. The engine applies that check to **every** package it discovers, with no distinction
between `packages/*` and `apps/*`. An `eve` project's `agent/agent.ts` calls `defineAgent`, which
is imported from `eve`; its tools call `defineTool` from `eve/tools`. So the moment
`pnpm-workspace.yaml` includes `apps/*`, the architecture test fails the example agent.

Three forces make this a decision to record rather than a line to edit.

**The build plan already separates the two kinds of package.** Its dependency diagram (§4) is
explicit about direction:

```text
apps/* / consuming domains
           |
           v
          core
```

`apps/*` sits with "consuming domains" *above* `core`, not inside the harness. ADR-0001 states the
same thing from the other side: the harness is a reusable package meant to be installed into many
independent domain-agent repositories, each owning its own instructions, SOPs, tools, skills,
schemas, permissions and evals. A real consuming domain repository will be an `eve` project that
declares `eve` in its own `package.json`. `apps/example-agent` exists precisely to be that
consumer inside this repository, so a rule that forbids it from importing `eve` is modelling the
wrong thing: it treats a domain as if it were a harness library.

**The adapter-only rule exists for a different reason, and that reason still holds.** The prose it
encodes is "Vercel-specific behavior lives behind adapter packages", together with "`core` cannot
import `eve`" and "`core` cannot import Supabase". The point is that *harness* code must not bind
itself to a vendor surface, so the harness stays swappable (ADR-0002, ADR-0003: the AI SDK is the
lowest agent-runtime contract, `eve` is the default runtime *adapter*). None of that is weakened by
a domain package authoring its own agent with `eve`: the domain is the thing the harness runs, not
part of the harness.

**AGENTS.md rule 13 forbids routing around the boundary.** "Never bypass architectural or package
boundaries just to make something work. Fix the boundary or write an ADR to change it deliberately;
do not route around `tests/architecture/boundaries.ts`." Deleting `eve` from
`adapterOnlyDependencies`, adding `@internal/example-agent` to `adapterPackages` (it is not an
adapter), or special-casing the app inside the rule engine would each be exactly the quiet
weakening that rule prohibits. ADR-0021 adds a mechanical constraint on the shape of any fix:
boundary rules live as a data table plus a pure function, and extending them means editing
`BOUNDARY_RULES`, not adding a bespoke assertion or a branch in the engine.

One further constraint comes from Milestone 1's own acceptance criteria: "The example calls the
harness API rather than the `eve` runtime directly." Authoring an agent with `eve` and *executing*
it through `eve` are separate questions, and only the first is settled here.

## Decision

**Application packages are domain consumers, not harness libraries.** A workspace package whose
directory is `apps/` or begins with `apps/` MAY declare a dependency on `eve` and on the AI SDK
authoring surface that `eve` exposes (`ai`, `@ai-sdk/*`), in order to author agents, tools, skills,
instructions, connections, channels, schedules and evals. It authors them through `eve`'s public
export map only; the exported-but-internal subpaths `eve/internal/*` and `ai/internal` remain
forbidden to every package, per the source-of-truth protocol §2.

**The allowance is an explicit allowlist, expressed as data.** `BoundaryRules` gains a required
field, `appPackagesMayDependOn: readonly DependencyPattern[]`, whose value is
`["eve", "ai", "@ai-sdk/*"]`. `findBoundaryViolations` skips an adapter-only dependency for a
package in `apps/**` when, and only when, that dependency matches a pattern in this list. The rule
engine stays pure and gains no knowledge of any particular package name. The field is required
rather than optional so that a future rules table has to state its position deliberately.

**`apps/*` MUST NOT depend on `@supabase/*`, `@vercel/*` or `workflow` directly.** Those three stay
adapter-only for every package in the workspace, applications included. Storage and hosted workflow
durability are harness responsibilities reached through harness adapters (`storage-supabase`,
`workflow-vercel`, `sandbox-vercel`); a domain that reached them directly would bypass the run
ledger, the trace schema and the promotion machinery those adapters exist to own. They are
therefore deliberately absent from `appPackagesMayDependOn`.

**The adapter-only rule is unchanged for every `packages/*` package.** No library package outside
`adapterPackages` may depend on any `adapterOnlyDependencies` pattern, and the explicit
`forbiddenByPackage` ban on `@internal/core` (`eve`, `@supabase/*`, `ai`, `@ai-sdk/*`, `workflow`,
`@vercel/*`) stands exactly as it did. `@internal/core` still may not import `eve`, and the
application allowance does not reach it. Rule 3 (`forbiddenByPackage`) continues to apply to
application packages, so a future explicit ban on a named app still bites.

**Execution goes through the harness API, not the `eve` runtime.** This ADR permits an application
package to *author* with `eve`. It does not permit an application to drive an `eve` session
directly as its execution path. Milestone 1's acceptance criterion "the example calls the harness
API rather than the `eve` runtime directly" is the complementary rule, and its enforcement lands in
M1-T4, when `createHarness()` exists and the example's entrypoint calls it. Until that entrypoint
exists there is nothing to enforce: as of M1-T2 the example agent is authored files plus a pure
fixture module, and calls no runtime at all.

**Extending the allowlist is itself an architecture change.** Adding a pattern to
`appPackagesMayDependOn` requires an ADR superseding or amending this one, with the same reasoning
about whether the surface is a domain-authoring concern or a harness responsibility.

## Consequences

### Positive

- The example domain can be what it claims to be: a normal `eve` project, authored the way the
  installed `eve` docs describe, with no special-casing and no vendored copy of eve's authoring
  helpers. What a consuming repository would write is what this repository contains, so the example
  keeps its value as a worked example (ADR-0012's reuse rule, applied to the domain side).
- The boundary now models the build plan's own diagram instead of flattening it. "`apps/*` /
  consuming domains" above `core` is expressed in the rule engine rather than only in prose, so the
  difference between a domain and a harness library is mechanical.
- The dangerous half of the adapter rule is untouched and remains testable. `@supabase/*`,
  `@vercel/*` and `workflow` stay behind adapters for everyone, and the `@internal/core` ban is
  unchanged, so the rules the build plan names by hand still fail closed.
- The allowance is reviewable in a three-element array. A future agent widening it has to edit a
  named field in `BOUNDARY_RULES` and justify it, which is a visible diff, not an invisible branch.

### Negative

- The boundary rule is now asymmetric, and asymmetric rules are easier to misread. A contributor
  who remembers "nothing may import `eve` except an adapter" now has an exception to hold in mind.
  The mitigation is that the exception is named in data, documented in `boundaries.ts` and in
  AGENTS.md, and covered by unit tests that state both directions.
- Nothing yet prevents the example agent from *executing* through `eve` directly rather than
  through the harness. That gap is real between M1-T2 and M1-T4, and it is not closed by a test in
  this task. It is recorded here so the M1-T4 agent knows the criterion is its responsibility.
- A future `apps/*` package could take the allowance as licence to become a second harness. The
  directional rule that a `packages/*` package may not depend on an `apps/*` package (Rule 1 in the
  engine) limits the damage but does not prevent an application from accumulating logic that
  belongs in `core`.

### Neutral

- Binds `tests/architecture/boundaries.ts`, `tests/architecture/package-boundaries.test.ts`, and
  every present and future package under `apps/`. Today that is `apps/example-agent`
  (`@internal/example-agent`); `apps/playground` appears in the build plan's layout with no
  milestone assigned.
- Does not change `adapterOnlyDependencies` or `adapterPackages`. `@internal/example-agent` is
  **not** an adapter and is deliberately not added to `adapterPackages`; if it were, it would be
  permitted `@supabase/*` and `@vercel/*` as well, which is exactly what this decision refuses.
- Does not govern which *version* of `eve`, `ai` or `zod` an application pins. That remains
  ADR-0024: exact pins, required peers declared explicitly, upgrades as their own re-verified task,
  and a co-located installed-version assertion test in every package that declares a framework
  dependency. `apps/example-agent` carries one.
- Does not change `pnpm-workspace.yaml`'s meaning beyond adding `apps/*` to its `packages:` globs,
  which is what makes the app a workspace member the architecture test discovers at all.

## Alternatives considered

- **Add `@internal/example-agent` to `adapterPackages`.** Rejected. It is not an adapter: it holds
  no `AgentRuntime` implementation and translates nothing for the harness. Worse, `adapterPackages`
  is an all-or-nothing allowance over every `adapterOnlyDependencies` pattern, so this would
  silently grant the example domain `@supabase/*`, `@vercel/*` and `workflow` too, which is the
  opposite of the intent. It would also corrupt the meaning of a list that six real adapter
  packages depend on being precise.
- **Remove `eve` from `adapterOnlyDependencies`.** Rejected outright. That is the single rule the
  build plan states most emphatically ("`core` cannot import `eve`"; "Vercel-specific behavior
  lives behind adapter packages"), and deleting it to make one app compile is the quiet weakening
  AGENTS.md rule 13 exists to prevent. The `forbiddenByPackage` entry for `@internal/core` would
  still catch core specifically, but every other library package would lose the protection.
- **Special-case the app by name inside `findBoundaryViolations`.** Rejected under ADR-0021, which
  requires boundary rules to be data in `BOUNDARY_RULES` checked by a pure function, precisely so
  the engine can be unit-tested with fabricated packages. A hard-coded package name in the engine
  is untestable in isolation and invisible to anyone reading the rules table.
- **A blanket exemption for `apps/*` from all adapter-only dependencies.** Rejected. It is simpler
  to implement and simpler to state, but it would let a domain package talk to Supabase or the
  hosted Workflow SDK directly, bypassing the run ledger, the trace schema and the promotion
  machinery. "No domain package may mutate harness registry tables directly" (build plan §4) would
  become unenforceable by this test. The allowlist keeps the permission as narrow as the authoring
  need.
- **Keep the example agent outside the pnpm workspace entirely**, as a directory the architecture
  test does not discover. Rejected. It would make the example invisible to `pnpm typecheck`,
  `pnpm build`, the boundary test and CI, so nothing would verify that it still compiles against
  the pinned `eve`, and the acceptance criterion `pnpm example:run` would have no workspace package
  to run. An untested example decays into a wrong example.
- **Vendor a thin harness-owned wrapper around `defineAgent`/`defineTool` so the app imports
  `@internal/...` instead of `eve`.** Rejected under ADR-0012's reuse rule and the build plan's
  scope discipline: it clones a documented `eve` capability for no benefit, breaks `eve`'s
  path-derived discovery contract (`eve info` reads the authored files), and would make the example
  stop resembling what a real consuming repository writes.

## References

- `docs/milestones/build-plan.md` §4 (Repository Layout: `apps/example-agent/agent/{agent.ts,
  instructions.md, skills/, tools/, lib/}`; Dependency rule and its diagram), Milestone 1 (M1-T2,
  and the acceptance criterion "The example calls the harness API rather than the `eve` runtime
  directly")
- `AGENTS.md`, "The thirteen non-negotiable rules" (13), "Repository layout and package ownership"
  (Dependency rule, Enforcement today), "Architecture boundaries and hard prohibitions"
- `docs/development/source-of-truth-protocol.md` §2 (no reaching into package internals), §6 (the
  `eve` protocol and its authored filesystem slots)
- `docs/research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md` §4 (eve's public export map and
  the off-limits `./internal/*` subpaths)
- `docs/research/vercel/2026-09-19-m1-eve-project-scaffold.md` (what the installed `eve` requires of
  an authored project, and the `eve info` output for this one)
- Related ADRs: 0001 (harness is a reusable package, not a domain monorepo), 0002, 0003 (eve is the
  default runtime *adapter*), 0012 (reuse documented eve capabilities), 0021 (architecture rules
  live in tests, as data plus a pure function), 0024 (framework dependency versioning policy)
- Related code paths: `tests/architecture/boundaries.ts`,
  `tests/architecture/package-boundaries.test.ts`, `pnpm-workspace.yaml`,
  `apps/example-agent/package.json`
