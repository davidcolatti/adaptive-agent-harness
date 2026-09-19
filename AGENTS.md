# AGENTS.md

This file is the canonical operating contract for every coding agent (and every
human) working in this repository. If anything elsewhere disagrees with this
file, this file wins until it is explicitly changed. `CLAUDE.md` points here
rather than duplicating it.

## Start here: mandatory read order

Before changing anything, read, in this order:

1. `AGENTS.md` (this file).
2. `docs/context/current-state.md`, the concise, present-tense truth about
   what actually works right now.
3. `docs/README.md`, the documentation map; it says what to read next.
4. The current milestone (start from `docs/milestones/build-plan.md`, the
   section matching the milestone named in `current-state.md`).
5. The architecture docs, contracts, and ADRs relevant to the area you are
   about to touch (`docs/architecture/`, `docs/contracts/`, `docs/decisions/`).
6. Installed dependency documentation, before writing any framework-facing
   code (see "Source-of-truth protocol" below).

A fresh agent with no other context must be able to follow this order alone
and understand the repository; do not skip to step 4 or 6 first.

## The thirteen non-negotiable rules

1. **Read AGENTS.md** before touching anything else in this repository.
2. **Read `docs/context/current-state.md`.** It is the truth about what
   actually works right now, not what the build plan eventually intends.
3. **Read `docs/README.md`.** It maps every documentation category and tells
   you what to read next for the task in front of you.
4. **Read the current milestone.** Per-milestone status files live in
   `docs/milestones/` (start with `docs/milestones/README.md`). Work against
   the milestone named in `current-state.md`, with `docs/milestones/build-plan.md`
   as the authoritative task list, not a future one.
5. **Read relevant architecture, contracts, and ADRs** before touching a
   boundary or a decision that already has one recorded.
6. **Inspect authoritative dependency documentation before framework-facing
   implementation.** Use installed package docs and types, not memory or a
   web example (see AD-011 and the source-of-truth protocol).
7. **Log work before and after implementation.** Append a `started` WORKLOG
   entry before material implementation and a result entry when it stops, per
   AD-014.
8. **Update documentation alongside code**, not as a follow-up task. A change
   that leaves docs stale is not done.
9. **Run required verification before declaring work complete.** Targeted
   tests first, then `pnpm check`, before an entry is marked `completed`.
10. **Never guess external APIs.** Vercel, eve, AI SDK, and Supabase behavior
    must be verified against the installed version, not assumed from memory.
11. **Never silently introduce a new architectural pattern.** Record it: an
    ADR for material choices, a WORKLOG note for small ones (AD-016).
12. **Never modify generated source directly.** `workflow.generated.ts` and
    the future `database.types.ts` are regenerated, never hand-edited.
13. **Never bypass architectural or package boundaries just to make something
    work.** Fix the boundary or write an ADR to change it deliberately; do not
    route around `tests/architecture/boundaries.ts`.

## Project summary

The adaptive agent harness is a reusable TypeScript package, not a domain
application. It is meant to be installed into many independent domain-agent
repositories (a marketing-site agent, a paid-ads agent, a PMM agent, and so
on), each of which owns its own instructions, SOPs, tools, skills, schemas,
permissions, and evals. The harness owns the execution lifecycle: it runs a
job, records what happens, and over time uses that evidence to identify stable
behavior, compile it into a cheaper workflow, replay it against historical
cases, evaluate it, and eventually promote it. Ambiguous cases always fall
back to the full agent. The long-term optimization target is:

```
Full Agent -> Specialized Agent -> Jev Decision -> Deterministic Code -> Direct API Call
```

The system should always use the least expensive safe primitive that
preserves the required behavior. Full architectural context lives in
`docs/milestones/build-plan.md`.

**Current status:** see `docs/context/current-state.md` for the current
milestone, task, and exact next step. Do not rely on this file for status; it
is not updated per-task.

## Repository layout and package ownership

What exists today:

```
adaptive-agent-harness/
├── .github/workflows/ci.yml
├── .husky/                      # pre-commit, pre-push
├── .vscode/
├── apps/
│   ├── eve-fixture-agent/       # credential-free mockModel eve project (M1-T6)
│   │   └── agent/               # agent.ts, instructions.md, tools/, lib/
│   └── example-agent/           # neutral vendor-triage eve project (M1-T2)
│       ├── agent/               # agent.ts, instructions.md, skills/, tools/, lib/
│       └── src/                 # domain/, capabilities, handlers, policies, run.ts
├── packages/
│   ├── config/                  # shared tsconfig bases, no runtime code
│   ├── core/                    # harness core contracts; context, errors, schema,
│   │                            #   Job, defineDomain(), AgentRuntime (M1-T3/T5/T7/T8)
│   ├── runtime-ai-sdk/          # AI SDK (`ai`) adapter; no adapter code yet
│   ├── runtime-eve/             # `eve` adapter: EveAgentRuntime (M1-T6), ./testing
│   └── testing/                 # shared test helpers; fake clock, fake AgentRuntime
├── docs/
│   ├── README.md
│   ├── context/current-state.md
│   ├── progress/
│   │   ├── README.md
│   │   ├── WORKLOG.md
│   │   └── milestones/
│   ├── architecture/            # system-map.md, runtime.md
│   ├── contracts/README.md
│   ├── concepts/README.md
│   ├── decisions/               # 0000-template.md plus ADRs 0001-0029
│   ├── development/
│   │   ├── local-setup.md
│   │   ├── commands.md
│   │   └── source-of-truth-protocol.md
│   ├── milestones/
│   │   ├── README.md
│   │   ├── build-plan.md
│   │   ├── m0-repository-foundation.md
│   │   └── m1-local-agent-and-public-harness-boundary.md
│   ├── runbooks/README.md
│   ├── research/
│   │   ├── README.md
│   │   ├── tooling/
│   │   └── vercel/
│   └── examples/README.md
├── scripts/
│   ├── verify-handoff.ts
│   └── verify-handoff.test.ts
├── tests/architecture/          # package-boundary rules and test
├── tests/toolchain/
├── package.json, pnpm-workspace.yaml, turbo.json, biome.json,
│   vitest.config.ts, tsconfig.json
```

What the build plan's Repository Layout (section 4) additionally plans, not
yet built (**planned**):

```
apps/playground/                                              (planned, unscheduled)
packages/trace/, storage-supabase/                            (planned, M2)
packages/decision-jev/                                        (planned, M3)
packages/workflow/, registry/, replay/, evals/                (planned, M4-M6)
packages/learner/, compiler/, codegen/                        (planned, M7-M8)
packages/observability/                                       (planned)
supabase/migrations/, supabase/seed.sql                       (planned, M2)
```

Per-topic architecture docs (`runtime.md`, `workflow-ir.md`, ...) and the
contract files (`job.md`, `trace-event.md`, ...) are planned and created by
the milestone that implements them; see `docs/architecture/system-map.md` and
`docs/contracts/README.md`.

### Dependency rule

```
apps/* / consuming domains
           |
           v
          core
     /      |       \
 runtime   trace   workflow
   |        |       /   \
  eve    storage registry decision
                     \      /
                      evals
                        |
                      replay
                        |
                     learner
                        |
                     compiler
```

Rules (build plan section 4):

- `core` cannot import domain code.
- `core` cannot import `eve`.
- `core` cannot import Supabase.
- Vercel-specific behavior lives behind adapter packages.
- Compiler output targets the workflow IR, not arbitrary runtime internals.
- No domain package may mutate harness registry tables directly.

**Enforcement today:** `tests/architecture/boundaries.ts` encodes this as data
(`BOUNDARY_RULES`: adapter-only third-party dependencies, the adapter packages
allowed to depend on them, the allowlist an application package may reach
anyway, and per-package extra bans) plus a pure rule engine, and
`tests/architecture/package-boundaries.test.ts` runs it against the real
workspace as part of `pnpm test:unit`. When you add a package, extend
`BOUNDARY_RULES` (and, if it is an adapter, `adapterPackages`) to cover it.
Never weaken an existing rule to make a change pass; if a rule is genuinely
wrong, that is an architecture change and needs an ADR.

**Applications are domain consumers, not harness libraries** (ADR-0025). A
package under `apps/*` may depend on `eve`, `ai` and `@ai-sdk/*` to author
agents, because a real consuming domain repository is an `eve` project; that
allowance is the explicit `appPackagesMayDependOn` allowlist and reaches no
`packages/*` package. `@supabase/*`, `@vercel/*` and `workflow` stay
adapter-only for applications too, and execution still goes through the harness
API rather than the `eve` runtime.

## Architecture boundaries and hard prohibitions

- **No silent dependency additions.** Verify against actual docs/types, pin
  to an exact version (no `^`/`~`), justify in a WORKLOG entry, and add an ADR
  if it is a material choice.
- **No direct database access outside `packages/storage-supabase`** (M2).
- **No direct model calls outside runtime/decision adapter packages**:
  `runtime-ai-sdk`, `runtime-eve`, `decision-jev` (M1/M3). No harness package
  calls a model provider or `eve` directly. An `apps/*` domain package authors
  its agent with `eve` (ADR-0025), but runs it through the harness API, not the
  `eve` runtime.
- **No compiler-generated code promotion without replay and eval.** A
  generated workflow is never trusted because the compiler produced it.
- **Installed dependency docs are authoritative** when they differ from a
  stale blog post, an older example, or memory. See the source-of-truth
  protocol below.
- **Generated files are never hand-edited.** `workflow.generated.ts` and the
  future `database.types.ts` are regenerated from their inputs (IR,
  migrations); a regeneration mismatch is a CI failure, not a hand patch.
- **No `any` in core packages** except at an explicit adapter boundary with a
  justification comment (M0-T2).
- **No unbounded loops in workflow definitions.** Every loop is a declared
  bounded loop; validation rejects undeclared cycles.
- **Secrets are never committed.** Hooks scan staged files (`secretlint`), but
  the rule is on the agent: never stage credentials, tokens, or `.env` files.

## Commands

Every root script (`package.json`):

| Command | Purpose |
| --- | --- |
| `pnpm dev` | `turbo run dev`; persistent watch builds for packages that define one. |
| `pnpm build` | `turbo run build`; compiles each package to `dist/`. |
| `pnpm typecheck` | `turbo run typecheck && tsc --noEmit -p tsconfig.json`; the second half covers `scripts/`, `tests/`, and `vitest.config.ts`, which turbo does not reach. |
| `pnpm test` | `vitest run`; all four test-layer projects. |
| `pnpm test:unit` | `vitest run --project unit`; default layer, no live model calls. |
| `pnpm test:integration` | `vitest run --project integration`; may use local Supabase. |
| `pnpm test:contract` | `vitest run --project contract`; adapter contract suites. |
| `pnpm test:replay` | `vitest run --project replay`; frozen-evidence replay tests. |
| `pnpm lint` | `biome check --formatter-enabled=false .`; lint rules and import organization only. |
| `pnpm format` | `biome format --write .`. |
| `pnpm format:check` | `biome format .`; fails on unformatted files. |
| `pnpm check:handoff` | `node scripts/verify-handoff.ts`; enforces the handoff protocol (see below). |
| `pnpm example:run` | Run the vendor-triage example end to end through the harness against `apps/example-agent`. Needs an AI Gateway credential. |
| `pnpm example:run:mock` | The same path against `apps/eve-fixture-agent`, whose model is eve's `mockModel`. No credential. |
| `pnpm check` | The single local quality gate: `format:check && lint && typecheck && test && build && check:handoff`, in that order. |
| `pnpm prepare` | `husky`; installs git hooks (`.husky/pre-commit`, `.husky/pre-push`). |

Per-package scripts run the same way everywhere else in the workspace:
`pnpm --filter <package-name> <script>`, e.g.
`pnpm --filter @internal/core build`. Each package that has one exposes
`build`, `dev`, and `typecheck`.

**Test taxonomy** (build plan section 8), matching the Vitest project names in
`vitest.config.ts`:

- `*.test.ts`: unit project (`unit`). Default layer, no live model calls, use
  fakes (fake agent runtime, fake Jev engine, fake tools).
- `*.integration.test.ts`: `integration` project. May use local Supabase.
- `*.contract.test.ts`: `contract` project. Validates adapter compatibility
  (`AgentRuntime`, `DecisionEngine`, `Storage`, `WorkflowExecutor`,
  `SourceControlPublisher`); every implementation runs the same suite.
- `*.replay.test.ts`: `replay` project. Historical/frozen evidence.
- Live-provider tests are tagged `live:ai`, `live:jev`, `live:eve`, run
  manually or in a separate CI job, and never run in pre-commit.

**Toolchain pins:** Node is pinned by `.node-version` and `.nvmrc`
(`24.21.0`); pnpm is pinned by `packageManager` in `package.json`
(`pnpm@12.4.2`). CI reads `.node-version` via `actions/setup-node`.
`engines.node` in `package.json` is declarative only: pnpm 12.4.2 does not
fail installs on the project's own `engines` field (verified, see
`docs/research/tooling/2026-09-19-m0-toolchain-verification.md`); the Node
pin is enforced by `.node-version`/`.nvmrc` locally and by CI.

## Definition of done and testing requirements

A task is not done until:

- code is formatted;
- lint passes;
- typecheck passes;
- appropriate unit/contract/integration tests exist;
- public behavior is documented;
- errors are typed;
- trace behavior is considered;
- security/permission impact is considered;
- migrations are included if storage changes;
- no unrelated architecture boundary is violated;
- `pnpm check` passes;
- `docs/progress/WORKLOG.md` contains the task result and verification;
- `docs/context/current-state.md` is updated with the exact next step;
- framework-facing tasks include their implementation references and
  installed versions.

Architecture-changing tasks also require an ADR.

**Testing requirements** (build plan section 8): the four layers and their
rules are covered under "Test taxonomy" in Commands, above. Additionally,
security tests must cover prompt injection in evidence, forged tool results,
unauthorized tool requests, secrets in tool output, malicious compiler
proposals, path traversal in artifacts, and unbounded workflow attempts.

## Source-of-truth protocol

Any task that touches a Vercel primitive (AI SDK, `eve`, AI Gateway, Jev,
Workflow, Sandbox) must verify current API and runtime semantics before
implementation (AD-011). Full detail and checklists:
`docs/development/source-of-truth-protocol.md`.

The mandatory source precedence, in order:

```
1. Installed package docs matching pnpm-lock.yaml
2. Installed package public TypeScript exports/types
3. Official Vercel GitHub repository source and examples
4. Official Vercel documentation
5. Official vercel-labs reference implementations
6. Harness-owned design only when the behavior is not provided publicly
```

The agent MUST NOT:

- invent an import path;
- infer a method signature from memory;
- copy an old blog example without checking the installed version;
- assume preview APIs are unchanged;
- reach into unexported package internals;
- claim a Vercel primitive provides behavior that its current docs do not
  establish.

When sources disagree, the lockfile-matched installed package wins. Record the
discrepancy in an ADR or research note.

**Required research checkpoint for framework-facing tasks:** before coding,
add a short `Implementation references` section to the WORKLOG entry
containing package + installed version, docs/files read, official
repository/examples read, public exports/types inspected, the exact
API/pattern selected, and anything not documented that must be harness-owned.
No framework-facing task may move to `in_progress` until this checkpoint
exists.

**eve-specific note:** `eve` is preview software, and its repository directs
authors to the docs shipped inside `node_modules/eve/docs/`. Once `eve` is
installed (Milestone 1), that directory is authoritative for any `eve` task,
read before the relevant installed topic guide, before inspecting the
matching public export/type definition, and before using authored filesystem
slots. `eve` is installed as of M1-T1, at the version pinned by
`packages/runtime-eve/package.json`; `ai` is pinned by the same file and by
`packages/runtime-ai-sdk/package.json`. Version changes follow ADR-0024. Note
that `eve` 0.63.0 ships no `eve check` command; `eve info` is the equivalent
diagnostic, and it requires an authored `agent/` directory to run.

## Progress and handoff protocol

The repository maintains two mandatory progress files, `docs/context/current-state.md`
(concise current truth) and `docs/progress/WORKLOG.md`
(append-only implementation log), per AD-014.

Every WORKLOG entry uses this exact template:

```md
## YYYY-MM-DD HH:mm — Mx-Ty — <task title>

**Status:** started | blocked | completed
**Actor/session:** <human or coding agent>
**Commit:** <sha or "not committed">

### Goal
...

### Implementation references
- package/version:
- installed docs read:
- official docs/repos/examples read:
- public types/exports inspected:
- selected documented pattern:

### Work completed
- ...

### Files changed
- ...

### Verification
- `command` — PASS/FAIL
- ...

### Decisions / deviations
- ...

### Known issues / blockers
- ...

### Next exact step
...
```

Rules:

1. log a `started` entry before material implementation;
2. update/append the result when the task stops for any reason;
3. update `current-state.md` before ending the session;
4. never mark a task complete without verification results;
5. record failed attempts when they teach something relevant;
6. include source links/paths for Vercel-facing technical choices;
7. milestone completion archives a snapshot under
   `docs/progress/milestones/mX.md`;
8. generated code/compiler runs link back to their run IDs and work-log
   entry.

`current-state.md` contains: current milestone, current task, completed
milestones/tasks, what works now, what is partially working, known failures,
current blockers, important active decisions, uncommitted/generated
artifacts, exact next task, exact verification command to run next, last
successful `pnpm check` / `eve check`, and last commit SHA.

`pnpm check:handoff` (`scripts/verify-handoff.ts`, the last stage of
`pnpm check` and the last step of CI) fails when:

1. `docs/context/current-state.md` is missing;
2. `docs/progress/WORKLOG.md` is missing;
3. a WORKLOG entry whose `**Status:**` line says `completed` has no
   `### Verification` section containing a `PASS` or `FAIL` result;
4. the WORKLOG references a decision record (`ADR-1234` or
   `docs/decisions/1234-...`) whose 4-digit prefix has no file under
   `docs/decisions/`.

It deliberately does not try to infer whether every code edit was logged;
that is enforced by task workflow and review, not brittle git heuristics.

**Session-boundary rule:** a coding agent that reaches a context or session
boundary must prioritize the handoff update (WORKLOG + current-state.md)
before starting unrelated work. If interrupted mid-task, recording the result
and updating the handoff outranks continuing feature implementation.

## Task execution lifecycle

Every coding task, regardless of milestone, follows this exact lifecycle:

```
1. READ HANDOFF
   AGENTS.md
   docs/context/current-state.md
   current milestone/task

2. ESTABLISH SOURCES
   inspect installed package versions
   read lockfile-matched docs/types
   read official Vercel repo/examples when relevant
   write Implementation references to WORKLOG

3. START TASK
   append `started` entry to WORKLOG
   update current-state current task

4. IMPLEMENT
   smallest change that satisfies the task
   no unrelated refactors

5. VERIFY LOCALLY
   targeted tests first
   typecheck/lint/build as applicable
   framework-specific official verification commands
   `pnpm check` before completion

6. UPDATE TECHNICAL DOCS
   contracts/architecture/runbooks/ADR as required

7. RECORD RESULT
   append/update WORKLOG with files, commands, PASS/FAIL, deviations

8. UPDATE HANDOFF
   current-state:
     what now works
     blockers
     exact next task
     exact first command

9. COMMIT
   include task ID in commit message where practical
   record SHA in WORKLOG/current-state
```

If interrupted after step 3, steps 7 and 8 become the highest-priority work
before continuing feature implementation.

**No-assumption stop condition:** when an implementation detail is not
established by the current public API/docs/types:

```
STOP guessing
    v
search installed docs/types
    v
search official Vercel repo/docs/vercel-labs
    v
still undocumented?
    v
record open technical decision
    v
design a harness-owned abstraction explicitly
```

You may make ordinary internal engineering choices where the framework
imposes no contract, but label those as project decisions and capture
architectural ones in an ADR.

## ADR requirement

Any architecture-changing task requires an ADR (build plan section 12).
AD-016 extends this to unprescribed internal choices (source-generator
library, UUID scheme, canonical JSON encoding): material ones get an ADR,
small ones go in the WORKLOG entry. When in doubt, ask whether a future
engineer would need to know *why*, not just *what*; if yes, write an ADR.

ADRs live in `docs/decisions/`, numbered `NNNN-kebab-title.md`, zero-padded
and monotonically increasing, never reused or renumbered. `0000-template.md`
is the template. Full process (statuses, how to supersede, reading order) is
in `docs/decisions/README.md`. ADRs 0001-0017 record the build plan's
decisions and owner constraints; ADRs 0018-0023 record the Milestone 0
toolchain decisions, grounded in the toolchain research note
(`docs/research/tooling/2026-09-19-m0-toolchain-verification.md`). ADR-0024
records the framework dependency versioning policy adopted in M1-T1, grounded
in `docs/research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md`. ADR-0025
records that `apps/*` packages are domain consumers and may author `eve` agents
directly, grounded in
`docs/research/vercel/2026-09-19-m1-eve-project-scaffold.md`. ADR-0026 records
what "trace-safe" means for the M1-T8 error taxonomy: a whitelisted, stack-free
serialization with a stable `code` discriminant. ADR-0027 records the M1-T3
schema contract: Standard Schema v1, declared structurally in `@internal/core`
so the package keeps zero dependencies while domains author schemas in `zod`.
ADR-0028 records the M1-T6 `eve` adapter design: `EveAgentRuntime` is a URL-only client that
never spawns a process, observes a run through the `eve/client` event stream, enforces permissions
and budget itself, and reads terminal state from turn boundary events. It **amends ADR-0012**'s
"MUST go through `eve/hooks`" to "the documented eve event stream, via `eve/hooks` in-process or
`eve/client` from a caller". It is grounded in
`docs/research/vercel/2026-09-19-m1-eve-programmatic-execution.md` and described in
`docs/architecture/runtime.md`.
ADR-0029 records the M1-T9 fingerprint scheme: RFC 8785-style canonical JSON and
`sha256:`-prefixed digests, with `node:crypto` permitted in `@internal/core`
because a Node built-in is not a third-party dependency.
The next free number is 0030.

## Scope discipline

Avoid building these until the preceding milestone actually proves the need
(build plan section 13):

- custom visual workflow editor
- dashboard
- generic plugin marketplace
- multi-tenant auth
- hosted control plane
- custom queue
- custom durable workflow engine
- custom sandbox
- custom model gateway
- YAML workflow language
- automatic GitHub writes
- autonomous promotion
- cross-domain automatic learning
- vector database just because agents are involved

The project should remain surprisingly small until the compiler actually
works. Prefer an honest empty boundary over speculative code: `packages/core`
stayed intentionally empty (`export {}`) through Milestone 0 rather than
inventing placeholder abstractions early, and began filling only when M1-T7 and
M1-T8 had a real contract to put there. The same rule still applies to what is
not yet written: `TraceEvent` in core is a five-field M1 placeholder because
M2-T3 owns the real schema, `DomainEval` is the smallest shape a fixture case
needs because M6 owns evals, and no capability-registry type exists until
M1-T9 needs it.

## Git discipline

- Make logical commits per task, with the task ID (e.g. `M0-T7`) in the
  commit message where practical.
- Never rewrite history or another agent's/human's committed work.
- Hooks must not be bypassed. `--no-verify` is only acceptable with a WORKLOG
  entry explaining why it was necessary.
- Branch off `main` for work when a remote exists. No remote is required to
  do local work; nothing here depends on one existing.

## North-star invariants

These should remain true even as implementation changes:

1. A domain can always fall back to its full agent.
2. A compiled workflow is never trusted because the compiler wrote it.
3. Every workflow version is inspectable.
4. Every behavior-affecting version is fingerprinted.
5. Every node has typed input and output.
6. Every loop is bounded.
7. Every external write has explicit permission semantics.
8. Jev judgment and application policy remain separate.
9. Historical evidence can be replayed without unnecessary re-research.
10. The compiler cannot see the reserved evaluation set.
11. Learning from one domain does not silently alter another.
12. Cost improvement cannot compensate for an unacceptable quality
    regression.
13. Generated code cannot directly self-promote.
14. The harness remains useful even if learning/compilation is turned off.
15. Local development remains a first-class path.
