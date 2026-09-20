# Architecture Decision Records

This directory holds the Architecture Decision Records (ADRs) for the adaptive agent harness.
An ADR captures a significant architectural decision, the context that forced it, and its
consequences, so a future contributor (human or coding agent) can understand *why* the system is
built the way it is, not just *what* it currently looks like.

## Numbering scheme

Each ADR is a file named `NNNN-kebab-title.md`, where `NNNN` is a zero-padded, monotonically
increasing four-digit number (`0001`, `0002`, ... `0017`, ...). Numbers are assigned once and are
**never reused or renumbered**, even if an ADR is later superseded or deprecated. `0000-template.md`
is reserved for the template itself and is not a decision.

## Statuses

Every ADR's frontmatter declares exactly one status:

- `proposed`, under discussion, not yet binding.
- `accepted`, the current, binding decision.
- `superseded`, replaced by a later ADR; the frontmatter's `superseded_by` field names the
  replacement, and the replacement's `supersedes` field names this one.
- `deprecated`, no longer applicable and not replaced by a specific successor ADR.

## When an ADR is required

Per the build plan's Definition of Done (`docs/milestones/build-plan.md` §12): **any
architecture-changing task requires an ADR.** AD-016 extends the same discipline to internal
implementation choices the plan does not prescribe (for example, source-generator library, UUID
scheme, canonical JSON encoding): material ones get an ADR, small ones are recorded directly in
the task's `docs/progress/WORKLOG.md` entry instead. When in doubt, ask: "would a future engineer
need to know *why*, not just *what*, to safely change this later?" If yes, write an ADR. If it is
a small, easily-reversed implementation detail, log it in the WORKLOG.

## How to supersede an ADR

1. Write a new ADR with the next available number. Set its `supersedes` field to the old ADR's
   number.
2. In the old ADR, change `status` to `superseded` and set `superseded_by` to the new ADR's
   number. Do not delete or renumber the old file; its history remains part of the record.
3. Update the index table below for both entries.

## Reading order for a fresh contributor

Read `AGENTS.md` and `docs/context/current-state.md` first. Then read the ADRs relevant to the
milestone/task at hand; the References section of each ADR links back to the build-plan sections
and related ADRs that motivated it.

## Index

| Number | Title | Status |
|---|---|---|
| [0000](0000-template.md) | Template | n/a |
| [0001](0001-harness-is-a-reusable-package-not-a-domain-monorepo.md) | Harness is a reusable package, not a domain monorepo | accepted |
| [0002](0002-vercel-native-architecture-without-internal-vercel-lock-in.md) | Vercel-native architecture without internal Vercel lock-in | accepted |
| [0003](0003-ai-sdk-is-the-lowest-agent-runtime-contract-eve-is-the-default-runtime-adapter.md) | AI SDK is the lowest agent-runtime contract; eve is the default runtime adapter | accepted |
| [0004](0004-local-first-development-no-hosted-infrastructure-until-later-milestones.md) | Local-first development; no hosted infrastructure until later milestones | accepted |
| [0005](0005-human-reviewed-promotion-precedes-autonomous-promotion.md) | Human-reviewed promotion precedes autonomous promotion | accepted |
| [0006](0006-compiled-workflows-are-committed-source-ir-is-authoritative.md) | Compiled workflows are committed source; IR is authoritative, generated TypeScript is never hand-edited | accepted |
| [0007](0007-typed-typescript-dsl-over-a-serializable-ir.md) | Typed TypeScript DSL over a serializable IR; runtime never executes unvalidated generated source | accepted |
| [0008](0008-learning-is-domain-isolated-and-scoped-by-organization-domain-job-type.md) | Learning is domain-isolated and scoped by organization -> domain -> job type | accepted |
| [0009](0009-judgment-jev-is-separate-from-policy-thresholds-versioned-and-replayable.md) | Judgment (Jev) is separate from policy (TypeScript thresholds), thresholds versioned and replayable | accepted |
| [0010](0010-observability-trace-is-a-product-surface-captured-from-the-first-run.md) | Observability/trace is a product surface, captured from the first run | accepted |
| [0011](0011-no-vercel-implementation-detail-may-be-guessed.md) | No Vercel implementation detail may be guessed; mandatory source precedence and research checkpoint | accepted |
| [0012](0012-reuse-documented-eve-capabilities-instead-of-cloning-them.md) | Reuse documented eve capabilities instead of cloning them | accepted |
| [0013](0013-strict-boundary-between-workflow-ir-and-generated-source.md) | Strict boundary between workflow IR and generated source; v1 is structural compilation only | accepted |
| [0014](0014-every-unit-of-work-leaves-a-markdown-handoff.md) | Every unit of work leaves a Markdown handoff (WORKLOG + current-state) | accepted |
| [0015](0015-workflow-ir-references-a-typed-versioned-capability-registry.md) | Workflow IR references a typed, versioned capability registry; promoted workflows pin exact versions | accepted |
| [0016](0016-internal-implementation-choices-ts-morph-as-v1-code-generator.md) | Internal implementation choices are recorded explicitly; ts-morph is the v1 deterministic code generator | accepted |
| [0017](0017-owner-decided-product-constraints.md) | Owner-decided product constraints without a single natural ADR home | accepted |
| [0018](0018-pnpm-workspace-turborepo-and-node-24-pin.md) | pnpm workspace, Turborepo, and Node 24 pin | accepted |
| [0019](0019-typescript-6-strict-baseline-and-tsc-only-builds.md) | TypeScript 6 strict baseline and tsc-only builds | accepted |
| [0020](0020-internal-source-export-condition-for-workspace-resolution.md) | `@internal/source` export condition for workspace resolution | accepted |
| [0021](0021-biome-for-formatting-and-linting-architecture-rules-in-tests.md) | Biome for formatting and linting; architecture rules live in tests | accepted |
| [0022](0022-vitest-projects-and-test-file-taxonomy.md) | Vitest projects and test-file taxonomy | accepted |
| [0023](0023-git-hooks-secret-scanning-and-ci-gates.md) | Git hooks, secret scanning, and CI gates | accepted |
| [0024](0024-framework-dependency-versioning-policy.md) | Framework dependency versioning policy | accepted |
| [0025](0025-application-packages-may-author-eve-agents-directly.md) | Application packages may author `eve` agents directly | accepted |
| [0026](0026-harness-errors-serialize-to-a-whitelisted-trace-safe-shape.md) | Harness errors serialize to a whitelisted, stack-free trace-safe shape | accepted |
| [0027](0027-standard-schema-is-the-harness-schema-contract.md) | Standard Schema is the harness schema contract, declared structurally in core | accepted |
| [0028](0028-eve-agent-runtime-is-a-url-only-client-that-observes-the-eve-event-stream.md) | `EveAgentRuntime` is a URL-only client that observes the eve event stream | accepted |
| [0029](0029-canonical-json-and-sha-256-behavior-fingerprints.md) | Canonical JSON (RFC 8785-style) and `sha256:`-prefixed behavior fingerprints | accepted |
| [0030](0030-sortable-uuidv7-entity-identifiers-owned-not-delegated.md) | Sortable UUIDv7 entity identifiers, owned rather than delegated to Node | accepted |
| [0031](0031-trace-event-taxonomy-recorder-owned-sequencing-and-the-buffered-writer.md) | Trace event taxonomy, recorder-owned sequencing, and the buffered writer | accepted |

Entries 0001-0017 were recorded during Milestone 0 (M0-T8) from the build plan's architectural
decisions (AD-001 through AD-016) and pre-M0 owner-decided product constraints, dated 2026-09-19
with deciders "project owner (build plan); recorded during M0".

Entries 0018-0023 record the Milestone 0 toolchain (pnpm/Turborepo/Node, TypeScript, the
`@internal/source` workspace-resolution condition, Biome, Vitest, and git hooks/secret
scanning/CI), grounded in `docs/research/tooling/2026-09-19-m0-toolchain-verification.md`, dated
2026-09-19 with deciders "orchestrator (Claude Fable 5.1) with repository owner constraints;
recorded during M0".

Entry 0024 records the framework dependency versioning policy adopted when Milestone 1 installed
the first framework dependencies (`eve`, `ai`), grounded in
`docs/research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md`.

Entry 0025 records that application packages under `apps/*` are domain consumers rather than
harness libraries, and may therefore author agents with `eve` directly, while `@supabase/*`,
`@vercel/*` and `workflow` stay adapter-only for everyone. It was forced by M1-T2, the task that
scaffolded `apps/example-agent`, and is grounded in
`docs/research/vercel/2026-09-19-m1-eve-project-scaffold.md`.

Entry 0026 records what "trace-safe" means for the M1-T8 error taxonomy: serialization is a
whitelist of `name`, `code`, `message`, `details` and a depth-bounded `cause`, stacks are excluded
by default, and every failure carries a stable `code` that survives serialization and class
renames. It is grounded in `docs/contracts/errors.md` and `packages/core/src/errors.ts`.

Entry 0027 answers what `Schema<T>` is in the build plan's `DomainDefinition`, which M1-T3 had to
settle: the harness adopts Standard Schema v1 and `@internal/core` declares it structurally rather
than importing a schema library, so the package keeps zero dependencies while a domain authors its
schemas in `zod`. It is grounded in the installed `zod@4.6.5` types
(`zod/v4/core/standard-schema.d.ts`) and the published specification at
<https://standardschema.dev>, and implemented in `packages/core/src/schema.ts`.

Entry 0029 answers what a behavior fingerprint is, which M1-T9 was the first task to need: the
harness owns an RFC 8785-style canonical JSON encoding and hashes it with SHA-256, emitting
`sha256:<hex>` so the algorithm can change later without a stored value becoming ambiguous.
AD-016 names "canonical JSON encoding used for fingerprints" as its first example of a choice that
must be recorded rather than implied. It also records that the Node built-in `node:crypto` is
permitted inside `@internal/core`, because a built-in adds nothing to `package.json`, the
lockfile, or what `tests/architecture/boundaries.ts` can see, so the zero-dependency rule is
unchanged. It is implemented in `packages/core/src/fingerprint.ts` and consumed by
`packages/core/src/capabilities.ts`.

Entry 0030 answers what a stable identifier is, which M2-T1 was the first task to need: the harness
mints RFC 9562 UUIDv7 ids in `packages/core/src/ids.ts`, branded into twelve mutually incompatible
types, one per entity the build plan names. AD-016 names "UUID implementation" as one of its
examples of a choice that must be recorded rather than implied. It also records why the Node 24
built-in `crypto.randomUUIDv7()` is **not** used: its own documentation says the embedded timestamp
"is not guaranteed to be strictly increasing", and on the pinned Node 24.21.0 about half of 20 000
consecutive ids were not, because ids minted inside one millisecond are ordered only by their
random bits. Sortability is the property M2-T1 exists to buy, so the harness owns the generator and
adds the RFC 9562 §6.2 monotonic counter the built-in lacks. It is implemented in
`packages/core/src/ids.ts` and wired at the two call sites in `packages/core/src/domain.ts` and
`packages/core/src/harness.ts`.

Entry 0031 settles M2-T3 and M2-T4 together, because both turn on one question the build plan
leaves open: who assigns a run's `sequence`. The taxonomy is closed and is the plan's list plus
`run.aborted`, which the harness already emits and which is not a failure; "parent span" is a
`parentId` pointing at a `*.started` event's own id rather than a separate span entity; `attempt`
stays an ordinal until M2-T5's ledger decides when an attempt becomes a row; a run-scoped
`TraceRecorder` in `@internal/core` owns `sequence`, `id`, `attempt`, `version` and
`behaviorFingerprint`, and `ExecutionContext.trace` carries it, which is what stops the harness and
the eve adapter each numbering their events from 0 inside one run; `EveAgentRuntime` maps eve's
stream onto the taxonomy instead of emitting `eve.<type>`, and the ADR lists the eve events that
are deliberately not trace events; and the new `@internal/trace` package holds
`createBufferedTraceWriter()`, whose sink failures surface as a `StorageError` that leaves
`harness.run()` rather than a run reported as completed. It is documented in
`docs/contracts/trace-event.md`.

Entry 0032 finalizes the `Job` contract, which M2-T2 was the task to do. It changes no field and
settles five things the build plan's field list does not: immutability is **deep** (`deepFreeze`
rather than `Object.freeze`, so a nested budget or tool grant cannot be widened after the job
exists), the **effective job is the job** (the harness applies a run's overrides while building it,
so the value the runtime receives is the one a trace records and persistence stores, under the id
the domain minted), a job carries **no `createdAt`** because a UUIDv7 `JobId` already embeds its
creation millisecond and `entityIdTimestamp()` reads it back, `parseJob()` is the **boundary** that
turns a stored value back into a job with every problem reported at a path, and an **attempt is not
part of a job** because it belongs to a run, which is the question ADR-0030 explicitly deferred to
M2-T2. It is implemented in `packages/core/src/job.ts`, `freeze.ts`, `json.ts`, `ids.ts`,
`domain.ts` and `harness.ts`, and documented in `docs/contracts/job.md`.
