---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/milestones/build-plan.md
  - docs/decisions/README.md
  - docs/decisions/0025-application-packages-may-author-eve-agents-directly.md
  - docs/decisions/0027-standard-schema-is-the-harness-schema-contract.md
  - docs/decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md
  - docs/decisions/0034-behavior-fingerprint-is-component-wise-and-supplied-by-the-domain.md
  - docs/contracts/README.md
  - docs/research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md
  - docs/research/vercel/2026-09-19-m1-eve-project-scaffold.md
  - docs/research/vercel/2026-09-19-m1-eve-programmatic-execution.md
  - docs/architecture/runtime.md
  - docs/decisions/0028-eve-agent-runtime-is-a-url-only-client-that-observes-the-eve-event-stream.md
  - docs/decisions/0033-supabase-cli-as-a-pinned-dev-dependency-with-reset-as-the-reproducibility-gate.md
  - docs/runbooks/supabase-local.md
implementation:
  - apps/eve-fixture-agent
  - apps/example-agent
  - packages/core
  - packages/testing
  - packages/config
  - packages/runtime-eve
  - packages/runtime-ai-sdk
  - packages/storage-supabase
  - supabase
  - tests/architecture/boundaries.ts
---

# System map

This document is the single orientation page for the harness architecture. It reproduces the
target system, the runtime responsibility matrix and the package dependency rule from
`../milestones/build-plan.md` (sections 2, 3 and 4), then states honestly how much of that target
actually exists today.

The build plan is authoritative for the target. This document is authoritative for the *current*
state. Where the two disagree, the build plan describes the future and this file describes the
present; where this file disagrees with the code, the code wins and this file must be corrected in
the same task that found the discrepancy.

## 1. Target system

Reproduced verbatim from the build plan, section 2 ("Target System").

```text
                         Domain Package
              instructions / SOP / skills / tools
                            schemas / evals
                                 |
                                 v
                           Job Contract
                                 |
                                 v
                         Execution Router
                         /              \
                  workflow match       no match
                       |                  |
                       v                  v
                 Compiled Runtime     Full Agent
                       |                  |
        +--------------+-------------+    |
        |              |             |    |
       Jev            Code         Agent  |
        |              |             |    |
        +--------------+-------------+----+
                       |
                       v
                 Normalized Trace
                       |
               +-------+--------+
               |                |
               v                v
             Result          Learning
                                |
                                v
                            Compiler
                                |
                                v
                        Candidate Workflow
                                |
                                v
                    Validate / Replay / Evals
                                |
                                v
                         Promotion Decision
                                |
                                v
                        Workflow Registry
```

None of this pipeline is implemented yet. See "Current state (Milestone 0)" below.

## 2. Runtime responsibility matrix

Reproduced from the build plan, section 3. Every responsibility/owner pairing is preserved; only
the table formatting is changed from the plan's fixed-width layout to Markdown.

| Responsibility | Owner |
| --- | --- |
| General agent behavior | `eve` |
| Agent/model interface | AI SDK 7 |
| Model access | AI Gateway |
| Bounded probabilistic decisions | Jev |
| Workflow durability later | Vercel Workflow |
| Isolated code execution later | Vercel Sandbox |
| Domain instructions | Consuming agent |
| Domain tools | Consuming agent |
| Domain skills | Consuming agent |
| Job contract | Harness |
| Trace schema | Harness |
| Workflow IR / DSL | Harness |
| Router | Harness |
| Registry | Harness |
| Learning | Harness |
| Compiler | Harness |
| Replay | Harness |
| Promotion policy | Harness |
| Local persistence | Supabase |
| GitHub PR creation | Optional consuming-repo integration |

The two columns matter for boundaries: anything owned by the *harness* is a contract this
repository defines and may change only through an ADR. Anything owned by `eve`, the AI SDK, AI
Gateway, Jev, Vercel Workflow, Vercel Sandbox or Supabase is a third-party surface that must be
reached through an adapter package, never imported from `core`.

## 3. Package dependency rule

Reproduced verbatim from the build plan, section 4 ("Dependency rule").

```text
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

Rules, as the plan states them:

- `core` cannot import domain code.
- `core` cannot import `eve`.
- `core` cannot import Supabase.
- Vercel-specific behavior lives behind adapter packages.
- Compiler output targets the workflow IR, not arbitrary runtime internals.
- No domain package may mutate harness registry tables directly.

## Current state (Milestone 1, in progress)

Six packages and two applications exist. Everything else in the repository layout is planned.

- `packages/config` (`@internal/config`) holds the shared TypeScript config bases
  (`tsconfig.base.json`, `tsconfig.package.json`). It contains no runtime code and no `src/`
  directory.
- `packages/testing` (`@internal/testing`) is the test-helpers package required by M0-T4. It
  holds `createFakeClock` (M0-T4), `createFakeAgentRuntime` (M1-T5), the scripted
  `AgentRuntime` that lets a unit test replace `EveAgentRuntime` without either knowing, and
  `createRecordingTraceWriter` (M1-T4), the counterpart to core's no-op writer. It is the
  one library package that depends on `@internal/core`, which is library-to-library and therefore
  unaffected by the boundary rule.

  **The dependency runs one way only, and must keep doing so.** M1-T4 briefly added
  `@internal/testing` to `@internal/core`'s `devDependencies` so the harness's own tests could
  use these helpers, and reverted it: even a dev-only edge in that direction makes the workspace
  graph cyclic, which pnpm warns about on every install and which turbo refuses as a `build` task
  cycle unless `packages/core` overrides the root task definition. A cyclic graph plus a
  per-package turbo override is a new architectural pattern, and it is not worth sixty lines of
  test code. `packages/core/src/harness.test.ts` declares its own local scripted runtime,
  recording trace writer and fixed clock inline, and a comment there says why. This package stays
  the canonical home for fakes that **consuming** packages and applications share, which is the
  direction the dependency rule already allows:
  `apps/example-agent/src/domain/harness.test.ts` uses all three.
- `packages/core` (`@internal/core`) holds the harness contracts added by M1-T3, M1-T4, M1-T5,
  M1-T7, M1-T8 and M1-T9. It is no longer the empty boundary Milestone 0 left behind.

  - The **execution context** (M1-T7): `ExecutionContext` plus `DomainRef`, `Budget`, `ToolGrant`
    and `RuntimeInfo`, with a `createExecutionContext()` factory that applies the documented
    defaults. Documented in [`../contracts/execution-context.md`](../contracts/execution-context.md).
  - The **error taxonomy** (M1-T8): the nine classes the build plan names, under one abstract
    `HarnessError` with a stable `code` discriminant, plus `serializeError()` and the whitelisted,
    stack-free `SerializedHarnessError` shape that [ADR-0026](../decisions/0026-harness-errors-serialize-to-a-whitelisted-trace-safe-shape.md)
    records. Documented in [`../contracts/errors.md`](../contracts/errors.md).
  - A **JSON value model** (`JsonValue`, `JsonObject`) that every serializable field is typed
    with, and the **trace contract** (M2-T3): the closed `TraceEventType` taxonomy, the
    fifteen-field `TraceEvent`, the `TraceWriter` the build plan states verbatim, and
    `createTraceRecorder()`, the per-run minter that owns a run's `sequence` and is what
    `ExecutionContext.trace` holds. Persistence is deliberately elsewhere, in `packages/trace`.
    Documented in [`../contracts/trace-event.md`](../contracts/trace-event.md) and
    [ADR-0031](../decisions/0031-trace-event-taxonomy-recorder-owned-sequencing-and-the-buffered-writer.md).
  - The **schema boundary**, `Job` and `DomainDefinition` (M1-T3): `Schema<TOutput, TInput>` is a
    harness-owned copy of the Standard Schema v1 interface, so a domain authors its schemas in
    `zod` while this package imports nothing
    ([ADR-0027](../decisions/0027-standard-schema-is-the-harness-schema-contract.md)).
    `validateWith()` is the single point where a schema failure becomes a `ValidationError`.
    `defineDomain()` validates a domain's id, version and schemas and returns a frozen
    definition whose `createJob` stamps the domain reference and generates the job id. Documented
    in [`../contracts/domain-definition.md`](../contracts/domain-definition.md) and
    [`../contracts/job.md`](../contracts/job.md).
  - The **agent runtime contract** (M1-T5): `AgentRuntime.run(job, context)` and the
    `AgentExecution` union (`completed` / `failed` / `aborted`), carrying usage, runtime info and
    optional metadata. No `eve` or AI SDK concept appears in it. Documented in
    [`../contracts/agent-runtime.md`](../contracts/agent-runtime.md).

  - **`createHarness()`** (M1-T4): the public entry point, and the single choke point where a
    run's input is validated before execution and a runtime's claimed output is re-validated
    before success. It emits `run.started` plus one terminal event per run, holds no state
    between runs, and omits the build plan's `storage` option until M2 defines that contract.
    Documented in [`../contracts/harness.md`](../contracts/harness.md).
  - The **capability registry** (M1-T9): `CapabilityRegistry`, `CapabilityManifest` and the five
    kinds build plan section 5 fixes, with registration validating duplicate IDs, a fixed kind per
    ID, and schema references that must already be registered so the manifest is closed. The
    serializable manifest is typed so that it cannot carry a function or a secret. Its behavior
    fingerprints rest on `canonicalJson()` and `fingerprint()`, an RFC 8785-style canonical
    encoding hashed with SHA-256 via the Node built-in `node:crypto`
    ([ADR-0029](../decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md)).
    Documented in [`../contracts/capability-registry.md`](../contracts/capability-registry.md).
  - The **behavior fingerprint** (M2-T8): `BehaviorDescriptor`, one field per behavior-affecting
    input the build plan names, and `createBehaviorFingerprint()`, which returns one `sha256:`
    digest per component plus the composite, so a reader can say *which* component changed rather
    than only that something did. The descriptor is supplied by the domain
    (`DomainDefinition.behavior`) because the eve adapter never reads an agent's files (ADR-0028)
    and the application authors the agent (ADR-0025); `createHarness()` resolves it once per run
    before `run.started`, stamps the composite on every trace event and on the run result, and
    writes the component digests into the `run.started` payload
    ([ADR-0034](../decisions/0034-behavior-fingerprint-is-component-wise-and-supplied-by-the-domain.md)).
    Documented in [`../contracts/behavior-fingerprint.md`](../contracts/behavior-fingerprint.md).

  Of build plan section 5, `DecisionEngine` (M3) is still to come and `FallbackContext` waits for
  M4. The package still declares no third-party dependency and must keep none; `node:crypto` is a
  Node built-in, not a dependency, and `@internal/testing` is a devDependency used only by tests.
- `packages/runtime-eve` (`@internal/runtime-eve`) and `packages/runtime-ai-sdk`
  (`@internal/runtime-ai-sdk`) were created by M1-T1 to hold the framework dependencies it
  installed: `eve@0.63.0`, `ai@7.0.107` and `zod@4.6.5` for the first,
  `ai@7.0.107` and `zod@4.6.5` for the second. Both are exact pins under ADR-0024, and both are
  already listed in `BOUNDARY_RULES.adapterPackages`, so they are the only packages permitted to
  declare those dependencies.

  **`packages/runtime-eve` holds the first real adapter, as of M1-T6.** `EveAgentRuntime`
  implements `AgentRuntime` over `eve/client`: it takes a server URL, runs a job as one turn of
  one fresh session, requests the domain's output schema per turn, and consumes the turn's event
  stream live so it can trace, police permissions and enforce the budget as the run proceeds. It
  never spawns a process; `startEveDevServer()` behind the package's `./testing` subpath is what
  a test or a demonstration uses to get a server.

  **No `eve` type crosses the package boundary.** Session and turn ids leave only as opaque
  strings inside `RuntimeInfo.metadata` and trace payloads, which is ADR-0003's line. How it
  works, what it enforces and what it cannot yet enforce: [`runtime.md`](runtime.md), decided in
  [ADR-0028](../decisions/0028-eve-agent-runtime-is-a-url-only-client-that-observes-the-eve-event-stream.md).

  **`packages/runtime-ai-sdk` still contains no adapter.** Its `src/index.ts` re-exports one
  documented public type (`LanguageModel` from `ai`), which proves the entrypoint resolves under
  typecheck and nothing more. Each package's unit test asserts that the installed version matches
  its own pin and that it declares no `^`/`~` range, which is ADR-0024's enforcement mechanism.

  What the installed packages document is recorded in
  [`../research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md`](../research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md)
  and, for driving an agent from TypeScript,
  [`../research/vercel/2026-09-19-m1-eve-programmatic-execution.md`](../research/vercel/2026-09-19-m1-eve-programmatic-execution.md).
- `apps/example-agent` (`@internal/example-agent`) was created by M1-T2. It is the neutral
  vendor-triage fixture domain, authored as a real `eve` project: `agent/agent.ts`,
  `agent/instructions.md`, one Markdown skill under `agent/skills/`, one read-only fixture tool
  under `agent/tools/`, and the frozen fixture data plus its pure lookup under `agent/lib/`. It
  declares `eve`, `ai` and `zod` at the same exact pins the adapters use.

  M1-T3 added its other half, `src/domain/`: the `zod` input and output schemas, the invented
  procurement SOP the fixture evals triage against, and the `defineDomain()` call that registers
  `vendorTriage`. It therefore also depends on `@internal/core` (`workspace:*`). The two halves do
  not cross: nothing under `agent/` imports the harness, nothing under `src/domain/` imports
  `eve`, and `eve` compiles only `agent/`.

  It is **not** an adapter and **not** a harness package. It is a domain consumer, which is the
  distinction [ADR-0025](../decisions/0025-application-packages-may-author-eve-agents-directly.md)
  records: an `apps/*` package may author agents with `eve`, while `@supabase/*`, `@vercel/*` and
  `workflow` stay adapter-only for it too. **Nothing executes it yet.** `eve info` discovers it
  with zero diagnostics and `eve build` bundles it, but no harness call exists until
  `createHarness()` lands in M1-T4, and Milestone 1's acceptance criterion is that the example
  calls the harness API rather than the `eve` runtime directly.

  What the installed `eve` required of the scaffold is recorded in
  M1-T6 added `src/run.ts`, the `pnpm example:run` entrypoint, and hardened the agent with
  `defaultTools: false` plus a one-line re-export restoring `load_skill`, so `eve info` now
  reports exactly two tools instead of nine. The package therefore also depends on
  `@internal/runtime-eve`, and its `build` compiles `src/` with `tsc` before running `eve build`,
  because Node 24 strips types but does not rewrite a relative `./x.js` specifier to `./x.ts`.

  [`../research/vercel/2026-09-19-m1-eve-project-scaffold.md`](../research/vercel/2026-09-19-m1-eve-project-scaffold.md).
- `apps/eve-fixture-agent` (`@internal/eve-fixture-agent`) was created by M1-T6. It is a
  credential-free `eve` project whose model is eve's own `mockModel` with a scripted responder,
  and it exists so `EveAgentRuntime`'s contract tests and `pnpm example:run:mock` have a real eve
  server to run against without reaching a model provider. It is a separate app root because an
  eve app root is the nearest enclosing `package.json` and eve recognizes the project only once
  `eve` is in its dependencies, so a fixture cannot live inside `packages/runtime-eve`.

  It authors two tools: `echo_fixture`, which the fixture jobs grant, and `forbidden_tool`, which
  they deliberately do not.
- `packages/storage-supabase` (`@internal/storage-supabase`) was created by M2-T11 and holds
  exactly one thing: `src/database.types.ts`, the TypeScript types generated from the local
  Supabase database. **There is no adapter in it yet.** M2-T5 adds the `Storage` port and the
  Supabase `TraceSink` that sits behind `createBufferedTraceWriter()`, and decides then whether the
  package declares `@supabase/supabase-js`; nothing here calls Supabase at runtime, so that
  dependency is deliberately not installed.

  It was already a declared adapter in `BOUNDARY_RULES.adapterPackages` before it existed, which is
  why M2-T11 changed nothing in `tests/architecture/boundaries.ts`: the boundary was reserved ahead
  of the package, exactly as intended. It is therefore the only workspace package permitted to
  depend on `@supabase/*`, and AGENTS.md's "no direct database access outside
  `packages/storage-supabase`" is the prose form of the same rule.

  `src/database.types.ts` is **generated and never hand-edited** (AGENTS.md rule 12). It carries no
  hand-written header on purpose: a header would be deleted by the next generation and would then
  register as drift in the CI job whose whole purpose is to detect drift. `biome.json` carries an
  `overrides` entry disabling the **formatter** for that one path, because the generator's output
  omits the semicolons Biome's formatter would add; linting still applies to it.
- `supabase/` at the repository root is the committed local-database definition, added by M2-T11:
  `config.toml` (the CLI's 2.117.0 defaults, with `project_id = "adaptive-agent-harness"`),
  `migrations/` (empty of migrations until M2-T6, with a `README.md` explaining that), `seed.sql`
  (empty until there is a schema to seed), and the CLI's own `.gitignore` for `.temp` and
  `.branches`. The pinned CLI (`supabase@2.117.0`, a root dev dependency) is driven only through
  the four `pnpm supabase:*` scripts, `supabase db reset` is the reproducibility gate, and the
  `supabase-types` CI job fails on generated-type drift. Decided in
  [ADR-0033](../decisions/0033-supabase-cli-as-a-pinned-dev-dependency-with-reset-as-the-reproducibility-gate.md),
  operated per [`../runbooks/supabase-local.md`](../runbooks/supabase-local.md).

### Package status

Milestone attributions below are "the milestone that first needs the package", read off the build
plan's milestone sections.

| Package | Status |
| --- | --- |
| `packages/config` | exists (Milestone 0) |
| `packages/core` | exists (Milestone 0; contracts from M1-T3/T4/T5/T7/T8/T9) |
| `packages/testing` | exists (Milestone 0; fake `AgentRuntime` added in M1-T5) |
| `packages/runtime-ai-sdk` | exists (M1-T1, dependency boundary only; `AgentRuntime` is M1-T5) |
| `packages/runtime-eve` | exists (M1-T1 dependency boundary; `EveAgentRuntime` and the `./testing` dev-server helper added in M1-T6) |
| `packages/registry` | planned (M5), **workflow** registry; the *capability* registry is in `packages/core` (M1-T9) |
| `apps/example-agent` | exists (M1-T2 eve project, M1-T3 domain, M1-T9 capabilities, M1-T6 `src/run.ts`; runs through `createHarness()` with either runtime) |
| `apps/eve-fixture-agent` | exists (M1-T6, credential-free `mockModel` fixture for the contract tests and `example:run:mock`) |
| `packages/trace` | exists (M2-T4, M2-T9): `createBufferedTraceWriter()`, `TraceSink`, the in-memory and JSONL sinks, and the redaction layer above them |
| `packages/storage-supabase` | exists (M2-T11, the generated `Database` type only); the `Storage` adapter and the Supabase `TraceSink` are M2-T5 |
| `packages/observability` | planned (M2) |
| `packages/decision-jev` | planned (M3) |
| `packages/workflow` | planned (M4) |
| `packages/replay` | planned (M6) |
| `packages/evals` | planned (M6) |
| `packages/learner` | planned (M7) |
| `packages/compiler` | planned (M8) |
| `packages/codegen` | planned (M8) |
| `apps/playground` | planned (unscheduled) |

`apps/playground` appears in the build plan's repository layout but no milestone section assigns
it, so it has no scheduled milestone.

### Source files

`EveAgentRuntime` (M1-T6) is the first code that calls a framework; `packages/runtime-ai-sdk`
still calls nothing. The source files in the workspace packages are:

- `packages/core/src/index.ts` (the named re-export barrel)
- `packages/core/src/json.ts`, `context.ts`, `trace.ts`, `errors.ts` and their four co-located
  `*.test.ts` files (the M1-T7 and M1-T8 contracts described above)
- `packages/core/src/schema.ts`, `job.ts`, `domain.ts`, `agent-runtime.ts` and their four
  co-located `*.test.ts` files. `job.ts` gained runtime code in M2-T2: `parseJob()` and `isJob()`,
  the boundary that turns a stored value back into a `Job`, with `job.test.ts` covering them and
  the JSON round trip.
- `packages/core/src/harness.ts` (M1-T4), `capabilities.ts`, `fingerprint.ts` and
  `identifiers.ts` (M1-T9), with a co-located test for each except `identifiers.ts`, whose two
  rules are exercised through `domain.test.ts` and `capabilities.test.ts`
- `packages/core/src/ids.ts` and `ids.test.ts` (M2-T1): the sortable RFC 9562 UUIDv7 scheme and
  the twelve branded entity-id types, minted at the two call sites in `domain.ts` and
  `harness.ts`. Distinct from `identifiers.ts`, which rules on the `{ id, version }` names a
  human writes rather than the ids a machine mints. M2-T2 added `entityIdTimestamp()` here, which reads
  a job's creation time out of its id and is why no entity carries a `createdAt` field.
- `packages/core/src/behavior.ts` and `behavior.test.ts` (M2-T8): the `BehaviorDescriptor` type,
  `createBehaviorFingerprint()`, `resolveBehaviorFingerprint()` and the two comparisons M6 and M7
  will make, `behaviorFingerprintsMatch()` and `diffBehaviorComponents()`. It builds on
  `fingerprint.ts` and changes nothing about it: ADR-0029 owns *how* a digest is made, ADR-0034
  owns *what* goes in. Wired through `domain.ts` (the optional `behavior` source) and `harness.ts`
  (resolution before the first event).
- `packages/core/src/freeze.ts` and `freeze.test.ts` (M2-T2): `deepFreeze()`, the whole of the
  harness's freezing surface. It is what makes "jobs are immutable after execution begins" reach a
  nested budget or tool grant, and it recurses into arrays and plain objects only, so a job is
  deeply immutable exactly as far as it is JSON-representable (ADR-0032).
- `packages/trace/src/index.ts`, `buffered-trace-writer.ts`, `sink.ts`, `jsonl-sink.ts` and their
  co-located `*.test.ts` files (M2-T4): the buffered, order-preserving `TraceWriter`, the
  `TraceSink` interface beneath it, and the in-memory and JSONL sinks. `node:fs/promises` and
  `node:path` only; no third-party dependency. M2-T5's Supabase sink is another `TraceSink`, and
  belongs in `packages/storage-supabase` rather than here.
- `packages/trace/src/redaction.ts`, `secret-patterns.ts`, `redacting-trace-writer.ts` and their
  two co-located `*.test.ts` files (M2-T9): the pure redactor over the JSON value model, the
  documented default secret-pattern set, and the `TraceWriter` decorator that applies it. The
  decorator sits **above** the buffered writer, so nothing unredacted is ever buffered or
  persisted, and every sink behind it inherits the guarantee
  ([ADR-0035](../decisions/0035-redaction-is-a-trace-writer-decorator-placed-before-buffering.md),
  [`../contracts/redaction.md`](../contracts/redaction.md)). No third-party dependency here either:
  the redactor uses `@internal/core` types and the JavaScript standard library only.
- `packages/storage-supabase/src/index.ts` (one re-export of the generated `Database` type) and
  `src/database.types.ts` (generated by `pnpm supabase:types`, committed, never hand-edited)
- `packages/testing/src/index.ts`
- `packages/testing/src/clock.ts`
- `packages/testing/src/clock.test.ts`
- `packages/testing/src/fake-agent-runtime.ts` and `fake-agent-runtime.test.ts`
- `packages/testing/src/recording-trace-writer.ts` and `recording-trace-writer.test.ts`
- `packages/runtime-eve/src/index.ts` and `index.test.ts`
- `packages/runtime-eve/src/eve-agent-runtime.ts` (the adapter, including the M2-T3 mapping from
  eve's stream events onto the trace taxonomy), `eve-events.ts` (reading eve's stream events and
  projecting them into identity-only trace payloads), `eve-schema.ts` (lowering a
  `Schema<T>` to the JSON Schema eve wants), with `eve-agent-runtime.test.ts` (unit, faked
  transport) and `eve-agent-runtime.contract.test.ts` (contract, real server)
- `packages/runtime-eve/src/testing/index.ts` and `testing/dev-server.ts` (the `./testing`
  subpath: `startEveDevServer()`)
- `packages/runtime-ai-sdk/src/index.ts` and `index.test.ts`
- `apps/example-agent/agent/agent.ts`, `agent/lib/agent-config.ts` (M2-T8: the authored runtime
  configuration as one constant, so `agent.ts` and `src/behavior.ts` cannot disagree about which
  model the agent runs), `agent/tools/lookup_vendor_evidence.ts`,
  `agent/tools/load_skill.ts` (a one-line re-export restoring the one default tool the skill
  needs, after `defaultTools: false` removed all eight), `agent/lib/vendor-fixtures.ts`, `agent/lib/vendor-evidence.ts` and its test,
  `src/domain/schemas.ts`, `src/domain/procurement-sop.ts`, `src/domain/index.ts`,
  `src/domain/domain.test.ts` and `src/domain/harness.test.ts`, `src/capabilities.ts` with its
  test, `src/behavior.ts` with its test (M2-T8: the domain's `BehaviorSource`, gathering the
  instructions, skills, tools, schemas, model configuration and policy thresholds it runs under),
  `src/handlers/detect-payment-detail-change.ts` and
  `src/policies/no-proceed-with-open-risk-flags.ts` with theirs, `src/run.ts` (the
  `pnpm example:run` entrypoint), and `src/dependency-pins.test.ts`
- `apps/eve-fixture-agent/agent/agent.ts` (the scripted `mockModel`), `agent/instructions.md`,
  `agent/tools/echo_fixture.ts`, `agent/tools/forbidden_tool.ts`,
  `agent/lib/json-schema-value.ts` with its test, and `src/dependency-pins.test.ts`

The two files in `packages/runtime-ai-sdk` contain one type re-export and one dependency-pin test
each. The example agent's files are authored `eve` definitions plus frozen fixture data: they are
compiled by `eve`, not by anything in this workspace, and none of them calls a model. There is no
agent runtime, no model call and no Supabase dependency anywhere in the workspace. `@internal/core` still declares no runtime dependency; its only devDependencies are
`@internal/config` for the tsconfig bases and `vitest` for its co-located tests. The supporting TypeScript
outside the packages is tooling only: `scripts/verify-handoff.ts` (and its test),
`tests/architecture/`, and `tests/toolchain/` (the `@internal/source` condition test and, from
M2-T11, the Supabase CLI pin test).

## How the boundary is enforced today

The dependency rule is not documentation-only. It is a test that runs against the real workspace.

- [`tests/architecture/boundaries.ts`](../../tests/architecture/boundaries.ts) is the rule engine.
  It defines a data table, `BOUNDARY_RULES`, and pure functions over it. The table has four
  parts:
  - `adapterOnlyDependencies`: third-party package name patterns that only a declared adapter may
    depend on. Today that is `eve`, `@supabase/*`, `ai`, `@ai-sdk/*`, `@vercel/*` and `workflow`.
    This is how "Vercel-specific behavior lives behind adapter packages" becomes mechanical.
  - `adapterPackages`: the workspace packages allowed to depend on those patterns. The list is
    populated ahead of the packages themselves (`@internal/runtime-eve`, `@internal/decision-jev`,
    `@internal/storage-supabase`, `@internal/runtime-ai-sdk`, `@internal/workflow-vercel`,
    `@internal/sandbox-vercel`), so a milestone that adds an adapter does not have to redesign the
    table under time pressure.
  - `appPackagesMayDependOn`: the subset of `adapterOnlyDependencies` that a package under
    `apps/*` may depend on anyway, today `eve`, `ai` and `@ai-sdk/*`. This is
    [ADR-0025](../decisions/0025-application-packages-may-author-eve-agents-directly.md): an
    application is a domain consumer, and a real consuming domain repository is an `eve` project,
    so it must be able to author agents. `@supabase/*`, `@vercel/*` and `workflow` are
    deliberately absent, and the allowance reaches no `packages/*` package.
  - `forbiddenByPackage`: narrower per-package bans. `@internal/core` is listed explicitly,
    because it is the boundary the plan names by hand.

  The functions are `matchesPattern` (exact name, or `@scope/*`), `findBoundaryViolations`
  (takes the workspace as data and returns every violation) and `formatViolations` (renders them
  into the assertion message). Because the engine is pure and takes packages as data, it can be
  unit-tested with fabricated packages instead of by breaking the real repository.

- [`tests/architecture/package-boundaries.test.ts`](../../tests/architecture/package-boundaries.test.ts)
  reads the real `pnpm-workspace.yaml` and every workspace `package.json`, then runs the engine
  against them. It executes on every `pnpm test` and therefore on every `pnpm check`, on the
  pre-push hook, and in CI.

This is live as of M1-T1: `eve` and `ai` are installed, so any library package that declares a
dependency on them without being in `adapterPackages` fails the test. It was proven by adding `eve`
to `@internal/core` and watching the test fail naming the adapter-only rule (M1-T1 WORKLOG entry),
and re-proven in M1-T2 by adding `@supabase/supabase-js` to `apps/example-agent` and watching the
same rule bite an application package that is otherwise allowed `eve`. Adapter status is a
deliberate, reviewable edit to `BOUNDARY_RULES`, not an accident. Version policy is separate and
lives in ADR-0024.

## Per-topic architecture documents

The build plan's repository layout lists further documents under `docs/architecture/`:
`runtime.md`, `workflow-ir.md`, `compiler.md`, `learning-loop.md`, `tracing.md`, `evals.md`,
`storage.md` and `security.md`. **None of them exist yet, and none should be created yet.**

Each is written by the milestone that first implements its topic, describing what the code
actually does, not preemptively as an empty placeholder. An empty or speculative architecture
document is worse than a missing one: it invites a future agent to treat a guess as authoritative.
Until then, this file plus the build plan are the architecture record.
