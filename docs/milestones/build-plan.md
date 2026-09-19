# Adaptive Agent Harness --- Local-First Implementation Plan

**Status:** Build plan\
**Primary language:** TypeScript\
**Package manager:** pnpm\
**Source control:** GitHub\
**Initial runtime:** Local laptop only\
**Persistence:** Local Supabase via Supabase CLI/Docker\
**Agent stack:** Vercel AI SDK 7 + `eve` + AI Gateway + Jev\
**Future execution primitives:** Vercel Workflow + Vercel Sandbox\
**Audience:** Internal use\
**Reference domain:** Neutral repetitive knowledge-work agent

------------------------------------------------------------------------

## 0. Goal

Build a reusable TypeScript agent harness that can be installed into
many independent domain-agent repositories:

``` text
marketing-site-agent
        |
        +---- @internal/adaptive-agent-harness

paid-ads-agent
        |
        +---- @internal/adaptive-agent-harness

pmm-agent
        |
        +---- @internal/adaptive-agent-harness
```

The harness owns the execution lifecycle. Domain agents own their
instructions, SOPs, tools, skills, schemas, permissions, and domain
evals.

A new domain begins with the full agent doing the work. The harness
records what happens. As evidence accumulates, the harness can identify
stable behavior, compile that behavior into a cheaper workflow, replay
the candidate against historical cases, evaluate it, and eventually
promote it. Ambiguous cases continue to fall back to the full agent.

The long-term optimization target is:

``` text
Full Agent
    |
    v
Specialized Agent
    |
    v
Jev Decision
    |
    v
Deterministic Code
    |
    v
Direct API Call
```

The system should always use the **least expensive safe primitive that
preserves the required behavior**.

------------------------------------------------------------------------

# 1. Architectural Decisions

## AD-001 --- Package, not a domain monorepo

The harness is a reusable package. Future domain agents should not live
inside the harness repository.

The harness repository may contain a neutral example app for development
and integration testing.

## AD-002 --- Vercel-native, not Vercel-locked internally

Use Vercel primitives deeply where they save meaningful infrastructure
work:

-   AI SDK 7
-   `eve`
-   AI Gateway
-   Jev
-   Vercel Workflow
-   Vercel Sandbox

Do not build speculative provider portability. Create clean internal
boundaries only where they naturally improve testing and ownership.

## AD-003 --- AI SDK is the lowest agent-runtime contract

The harness should understand an internal `AgentRuntime` abstraction
modeled around AI SDK agents.

`eve` is the first-class runtime adapter and expected default.

This allows future use of another AI SDK-compatible harness without
rewriting the trace/compiler/workflow system.

## AD-004 --- Local-first

Initial milestones run completely from the developer laptop.

Do not require:

-   Vercel deployment
-   production queues
-   hosted Workflow execution
-   hosted Sandbox execution
-   automated GitHub PR creation

Supabase runs locally through the Supabase CLI/Docker initially. No hosted infrastructure is required.

## AD-005 --- Human promotion first; autonomous promotion later

Build the architecture toward:

``` text
trace
  -> learn
  -> compile
  -> sandbox/test
  -> replay
  -> eval
  -> promotion policy
  -> production workflow
```

Early versions stop before automatic promotion and require explicit
developer approval.

Autonomous promotion is a later capability and must never bypass
promotion policy.

## AD-006 --- Compiled workflows are source code

Compiled workflows are committed, inspectable artifacts.

Git stores both:

``` text
workflow.ir.json       # compiler-authoritative semantic representation
workflow.generated.ts  # deterministic generated execution source
```

The IR is the source of truth for compiled semantics. The TypeScript file
is generated from that IR and MUST NOT be manually edited. A regeneration
check in CI fails if committed generated source differs from deterministic
codegen output.

Supabase stores metadata, run history, workflow status, evaluations,
fingerprints, lineage, and a copy/reference of the promoted IR.

Git remains the canonical review/history surface for workflow
implementation.

The harness core should not own PR submission. A consuming repo may
later install a GitHub integration that takes a compiler-generated
patch/branch and opens a PR.

## AD-007 --- Typed TypeScript DSL

The public authoring experience is a typed TypeScript DSL.

A serializable intermediate representation (IR) exists underneath it
for:

-   validation
-   fingerprints
-   visualization
-   replay
-   compiler output
-   compatibility checks

The runtime must never execute arbitrary unvalidated model-generated
source directly.

## AD-008 --- Domain-isolated learning

Learning data is scoped by:

``` text
organization/workspace
  -> domain
      -> job type
```

Cross-domain reuse happens only through explicit promotion into a shared
primitive registry.

## AD-009 --- Judgment is separate from policy

Jev answers bounded questions.

TypeScript decides what follows.

Example:

``` text
Jev:
  probability lead is qualified = .93

Policy:
  >= .95 -> auto continue
  .70-.95 -> agent review
  < .70 -> reject
```

Thresholds are versioned and replayable.

## AD-010 --- Observability is part of the product

The trace is not debug logging.

Every behavior-affecting event needed for replay, evaluation, lineage,
cost analysis, or model-risk analysis must be captured as structured
data from the first working run.


## AD-011 --- No Vercel implementation detail may be guessed

Any task that touches a Vercel primitive MUST verify the current API and
runtime semantics before implementation.

The implementing agent uses this source order:

``` text
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
- claim a Vercel primitive provides behavior that its current docs do
  not establish.

When sources disagree, the lockfile-matched installed package wins.
Record the discrepancy in an ADR or research note.

### Required research checkpoint for framework-facing tasks

Before coding, add a short `Implementation references` section to the
task/work log containing:

``` text
Package + installed version
Docs/files read
Official repository/examples read
Public exports/types inspected
Exact API/pattern selected
Anything not documented that must be harness-owned
```

No framework-facing task may move to `in_progress` until this checkpoint
exists.

### eve-specific protocol

`eve` is preview software and its repository explicitly directs authors
to the docs shipped inside `node_modules/eve/docs/`.

For any `eve` task:

1. read `node_modules/eve/docs/README.md`;
2. read the relevant installed topic guide;
3. inspect the matching public export/type definition;
4. use authored filesystem slots exactly as documented;
5. run `pnpm exec eve info` after structural integration changes when the
   command applies;
6. run the documented build/check command before completion;
7. never import from an unexported `eve` internal path.

Use public authored surfaces such as tools, skills, hooks,
instrumentation, evals, sandbox configuration, subagents, schedules,
client/session APIs, and workflow tools when they match the requirement.

### Workflow SDK protocol

Before modifying the hosted workflow backend:

1. inspect the installed Workflow SDK docs/skill;
2. verify the installed package's directive and testing behavior;
3. use `"use workflow"` only for deterministic orchestration;
4. put API calls, database access, SDK calls, filesystem access,
   environment-variable reads, and other side effects in `"use step"`
   functions unless current official docs explicitly support another
   pattern;
5. use the SDK's documented retry/error/idempotency primitives rather
   than inventing equivalents;
6. verify generated source with the actual Workflow compiler/build.

The harness IR is not allowed to encode assumptions about the SDK's
private transformation internals.

### AI SDK / Jev protocol

Before modifying `decision-jev`:

1. inspect the installed `ai` package version and public types/docs;
2. verify the current Jev model identifier and supported question types
   from Vercel AI Gateway documentation;
3. isolate any experimental AI SDK API behind `decision-jev`;
4. never expose an experimental API name in the harness public API.

### Sandbox protocol

Before implementing hosted compilation/execution:

1. inspect the installed `@vercel/sandbox` docs/types;
2. inspect relevant Vercel Labs reference implementations;
3. verify authentication, creation, command, filesystem, snapshot,
   timeout, and teardown semantics;
4. encode only documented lifecycle behavior in the adapter.

## AD-012 --- Reuse documented eve capabilities instead of cloning them

The harness supplements `eve`; it does not create parallel versions of
public `eve` features without a concrete reason.

Examples:

- use `eve` hooks/instrumentation as the agent-runtime observation source
  when the documented event stream contains the needed event;
- normalize those events into the harness trace schema rather than
  parsing console logs;
- use `eve/evals` for domain-agent evals where its contract fits;
- use `eve/client` for documented programmatic/session invocation when
  invoking an eve application over its public runtime boundary;
- use `eve` approvals/tool policies for agent-side action approval;
- use documented `eve` sandbox/context APIs instead of internal runtime
  state;
- use `defineWorkflowTool` only when a durable workflow is intentionally
  exposed as a tool to an eve agent.

Harness-specific replay, compiler datasets, workflow promotion, cross-run
ledger data, and compiled-workflow routing remain harness responsibilities.

## AD-013 --- Workflow IR and generated source have a strict boundary

The compiler agent NEVER directly writes executable production workflow
source as its authoritative output.

The pipeline is:

``` text
learned evidence
      ↓
compiler optimization plan
      ↓
candidate Workflow IR
      ↓
schema + graph + permission validation
      ↓
deterministic code generator
      ↓
TypeScript source
      ↓
format + lint + typecheck + Workflow build
      ↓
replay + eval
      ↓
promotion
```

The LLM may propose IR. The source generator is ordinary deterministic
TypeScript owned by the harness.

V1 compilation is **structural compilation** only. The compiler may
compose registered nodes, agents, tools, Jev questions, policies, and
deterministic handlers. It may not invent arbitrary executable handler
code.

Generating new executable capabilities is a later, separately gated
feature.

## AD-014 --- Every unit of work leaves a Markdown handoff

The repository maintains two mandatory progress files:

``` text
docs/context/current-state.md
docs/progress/WORKLOG.md
```

`current-state.md` is the concise current truth.

It contains:

``` text
Current milestone
Current task
Completed milestones/tasks
What works now
What is partially working
Known failures
Current blockers
Important active decisions
Uncommitted/generated artifacts
Exact next task
Exact verification command to run next
Last successful pnpm check / eve check
Last commit SHA
```

`WORKLOG.md` is append-only and records every material task.

Each entry uses:

``` md
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

A coding agent that reaches a context/session boundary MUST prioritize
the handoff update before starting unrelated work.



## AD-015 --- Workflow IR references a typed capability registry

Workflow IR never embeds arbitrary imports, executable source, or
unregistered prompt/tool definitions.

A consuming domain registers capabilities under stable, versioned IDs:

``` text
schemas
agents
tools
handlers
policies
evaluators
artifacts
```

The harness exposes a `CapabilityRegistry`.

Conceptual contract:

``` ts
type CapabilityRef = {
  id: string;
  version: string;
};

interface CapabilityRegistry {
  schemas: Registry<SchemaCapability>;
  agents: Registry<AgentCapability>;
  tools: Registry<ToolCapability>;
  handlers: Registry<CodeHandlerCapability>;
  policies: Registry<PolicyCapability>;
}
```

A workflow node references capabilities by ID/version:

``` json
{
  "id": "research",
  "type": "agent",
  "agent": {
    "id": "vendor-researcher",
    "version": "1.0.0"
  }
}
```

Validation resolves every reference before execution or source generation.

No fuzzy/latest resolution is allowed for promoted workflows. A promoted
workflow pins exact capability versions.

The registry record includes enough source metadata for deterministic
codegen:

``` text
capability ID
version
kind
package/module specifier
export name
input schema ID/version
output schema ID/version
permission declaration
behavior fingerprint
```

The source generator uses this manifest to produce imports. It never asks
the compiler LLM to invent an import path.

## AD-016 --- Internal implementation choices are recorded, not implied

The no-assumption rule applies to external framework behavior and to
project architecture.

When Vercel does not prescribe a choice, this project MAY choose one, but
the choice must be explicit.

Examples:

- canonical JSON encoding used for fingerprints;
- source-generator library;
- UUID implementation;
- database indexing strategy;
- CLI framework.

Material architecture choices receive an ADR. Small implementation
choices are recorded in the task work log.

For v1 source generation, this project chooses **ts-morph** as the
project-owned deterministic TypeScript AST/code-generation library.
This is not a Vercel requirement. Codegen consumes only validated IR and
the capability manifest, writes generated modules, then Biome formats
them.


------------------------------------------------------------------------

# 2. Target System

``` text
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

------------------------------------------------------------------------

# 3. Runtime Responsibility Matrix

  Responsibility                    Owner
  --------------------------------- -------------------------------------
  General agent behavior            `eve`
  Agent/model interface             AI SDK 7
  Model access                      AI Gateway
  Bounded probabilistic decisions   Jev
  Workflow durability later         Vercel Workflow
  Isolated code execution later     Vercel Sandbox
  Domain instructions               Consuming agent
  Domain tools                      Consuming agent
  Domain skills                     Consuming agent
  Job contract                      Harness
  Trace schema                      Harness
  Workflow IR / DSL                 Harness
  Router                            Harness
  Registry                          Harness
  Learning                          Harness
  Compiler                          Harness
  Replay                            Harness
  Promotion policy                  Harness
  Local persistence                 Supabase
  GitHub PR creation                Optional consuming-repo integration

------------------------------------------------------------------------

# 4. Repository Layout

Use a pnpm workspace from day one because package boundaries are useful
even before publishing.

``` text
adaptive-agent-harness/
├── .github/
│   ├── workflows/
│   │   └── ci.yml
│   └── pull_request_template.md
├── .husky/
├── .vscode/
├── apps/
│   ├── playground/
│   │   └── src/
│   └── example-agent/
│       ├── agent/
│       │   ├── agent.ts
│       │   ├── instructions.md
│       │   ├── skills/
│       │   ├── tools/
│       │   └── lib/
│       ├── src/
│       └── fixtures/
├── packages/
│   ├── core/
│   │   └── src/
│   ├── runtime-ai-sdk/
│   │   └── src/
│   ├── runtime-eve/
│   │   └── src/
│   ├── decision-jev/
│   │   └── src/
│   ├── trace/
│   │   └── src/
│   ├── storage-supabase/
│   │   └── src/
│   ├── workflow/
│   │   └── src/
│   ├── registry/
│   │   └── src/
│   ├── replay/
│   │   └── src/
│   ├── evals/
│   │   └── src/
│   ├── learner/
│   │   └── src/
│   ├── compiler/
│   │   └── src/
│   ├── observability/
│   │   └── src/
│   ├── testing/
│   │   └── src/
│   ├── codegen/
│   │   └── src/
│   └── config/
├── supabase/
│   ├── migrations/
│   └── seed.sql
├── docs/
│   ├── README.md                    # canonical documentation map
│   ├── context/
│   │   └── current-state.md         # concise session handoff
│   ├── progress/
│   │   ├── README.md
│   │   ├── WORKLOG.md               # append-only implementation log
│   │   └── milestones/
│   ├── architecture/
│   │   ├── system-map.md
│   │   ├── runtime.md
│   │   ├── workflow-ir.md
│   │   ├── compiler.md
│   │   ├── learning-loop.md
│   │   ├── tracing.md
│   │   ├── evals.md
│   │   ├── storage.md
│   │   └── security.md
│   ├── contracts/
│   │   ├── job.md
│   │   ├── trace-event.md
│   │   ├── workflow-ir.md
│   │   ├── agent-runtime.md
│   │   ├── decision-engine.md
│   │   └── promotion-policy.md
│   ├── concepts/
│   ├── decisions/
│   │   ├── README.md
│   │   └── 0000-template.md
│   ├── development/
│   ├── milestones/
│   ├── runbooks/
│   ├── examples/
│   └── research/
│       ├── README.md
│       └── vercel/                  # dated research notes + source links
├── scripts/
├── AGENTS.md
├── CLAUDE.md
├── README.md
├── biome.json
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.json
├── turbo.json
└── vitest.workspace.ts
```

### Dependency rule

``` text
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

Rules:

-   `core` cannot import domain code.
-   `core` cannot import `eve`.
-   `core` cannot import Supabase.
-   Vercel-specific behavior lives behind adapter packages.
-   Compiler output targets the workflow IR, not arbitrary runtime
    internals.
-   No domain package may mutate harness registry tables directly.

### Documentation rules

`docs/README.md` is the entry point for humans and coding agents.

Documentation has distinct responsibilities:

``` text
architecture/  = how the current system works
contracts/     = stable boundaries and schemas
decisions/     = why architectural choices were made
concepts/      = mental models and definitions
development/   = how to work in the repo
milestones/    = planned implementation work
runbooks/      = operational procedures
research/      = dated external research, not architectural truth
context/       = concise present-tense handoff
progress/      = chronological execution history
```

All architecture/contract documents include frontmatter:

``` yaml
---
status: active
owner: core
last_verified: YYYY-MM-DD
related:
  - docs/...
implementation:
  - packages/...
---
```

If code and docs disagree, the coding agent MUST stop treating the doc as
authoritative, verify actual behavior, and update or mark the stale doc in
the same task.


------------------------------------------------------------------------

# 5. Core Contracts

These contracts should stabilize before the compiler exists.

## Job

``` ts
type Job<TInput = unknown, TOutput = unknown> = {
  id: string;
  domain: {
    id: string;
    version: string;
  };
  jobType: string;
  objective: string;
  input: TInput;
  contracts: {
    inputSchema: string;
    outputSchema: string;
    sop: string;
  };
  budget: {
    maxCostUsd?: number;
    maxDurationMs?: number;
    maxModelCalls?: number;
    maxToolCalls?: number;
  };
  permissions: ToolGrant[];
  metadata: Record<string, JsonValue>;
};
```

## Domain definition

``` ts
type DomainDefinition<TInput, TOutput> = {
  id: string;
  version: string;
  inputSchema: Schema<TInput>;
  outputSchema: Schema<TOutput>;
  createJob(input: TInput): Job<TInput, TOutput>;
  evals: DomainEval<TInput, TOutput>[];
};
```

## Agent runtime

``` ts
interface AgentRuntime {
  run<TInput, TOutput>(
    job: Job<TInput, TOutput>,
    context: ExecutionContext
  ): Promise<AgentExecution<TOutput>>;
}
```

## Decision engine

``` ts
interface DecisionEngine {
  evaluate<TQuestions extends QuestionSet>(
    request: DecisionRequest<TQuestions>
  ): Promise<DecisionResult<TQuestions>>;
}
```

The initial implementation is Jev.

## Workflow node

``` ts
type WorkflowNode =
  | JevNode
  | CodeNode
  | AgentNode
  | CallNode
  | ArtifactNode
  | HumanNode
  | SubworkflowNode;
```

## Control shapes

``` ts
type ControlNode =
  | ChainNode
  | BranchNode
  | MapNode
  | ReduceNode
  | BoundedLoopNode
  | EscalateNode;
```

No unbounded loop is valid.

## Capability registry

``` ts
type CapabilityRef = {
  id: string;
  version: string;
};

type CapabilityManifestEntry = {
  ref: CapabilityRef;
  kind: "schema" | "agent" | "tool" | "handler" | "policy";
  module: string;
  exportName: string;
  inputSchema?: CapabilityRef;
  outputSchema?: CapabilityRef;
  permissions: readonly string[];
  fingerprint: string;
};
```

The runtime registry contains actual executable values. The serializable
manifest contains only metadata required for validation, fingerprints,
replay lineage, and deterministic source imports.

## Fallback envelope

``` ts
type FallbackContext = {
  reason: FallbackReason;
  workflow: {
    id: string;
    version: string;
    fingerprint: string;
  };
  completedNodes: readonly {
    nodeId: string;
    outputRef: string;
    trusted: boolean;
  }[];
  evidenceRefs: readonly string[];
  remainingBudget: Budget;
};
```

Fallback invokes the registered full-agent runtime with the original
immutable `Job` plus this envelope. The adapter is responsible for
presenting it through the runtime's documented input/context surface.


------------------------------------------------------------------------

# 6. Milestone Dependency Graph

``` text
M0 Repo Foundation
 |
 v
M1 Local Agent + Public Harness Boundary
 |
 v
M2 Job / Trace / Persistence
 | \
 |  \
 |   +------> M3 Jev
 |   |
 |   +------> M4 Workflow IR + Local Runtime
 |                |
 +----------------+
          |
          v
M5 Registry + Router + Full-Agent Fallback
          |
          v
M6 Replay + Evaluation
          |
          v
M7 Learning + Retrospectives
          |
          v
M8 Compiler v1
          |
          v
M9 Generated-Code Validation + Safe Promotion
          |
          v
M10 Multi-Domain Packaging
          |
          v
M11 Production-Primitive Adapters
          |
          v
M12 Hardening + Autonomous Optimization
```

**Critical path:** M0 → M1 → M2 → M4 → M5 → M6 → M7 → M8 → M9 → M10.

**Parallel path:** M3 can proceed beside M4 after M2.

------------------------------------------------------------------------

# Milestone 0 --- Repository Foundation

## Goal

A clean repository that a human or coding agent can clone and safely
change without first negotiating tooling conventions.

## Tasks

### M0-T1 --- Bootstrap workspace

Create:

-   Git repository
-   pnpm workspace
-   Node 24 pin
-   Turborepo
-   package boundaries
-   `.editorconfig`
-   `.gitignore`
-   `.env.example`
-   root scripts

Root commands:

``` text
pnpm dev
pnpm build
pnpm test
pnpm test:unit
pnpm test:integration
pnpm lint
pnpm format
pnpm format:check
pnpm typecheck
pnpm check
```

`pnpm check` is the single local quality gate.

### M0-T2 --- TypeScript strict baseline

Enable:

-   `strict`
-   `noUncheckedIndexedAccess`
-   `exactOptionalPropertyTypes`
-   `noImplicitOverride`
-   `noFallthroughCasesInSwitch`
-   `noImplicitReturns`
-   `useUnknownInCatchVariables`
-   `forceConsistentCasingInFileNames`

Do not allow `any` in core packages except at explicit adapter
boundaries with justification.

### M0-T3 --- Biome

Use Biome for formatting and baseline linting.

Add rules for:

-   unused imports
-   suspicious code
-   correctness
-   import organization
-   consistent formatting

Use TypeScript/architecture tests for rules Biome should not own.

### M0-T4 --- Vitest

Create:

``` text
*.test.ts
*.integration.test.ts
*.contract.test.ts
*.replay.test.ts
```

Add test helpers package immediately.

### M0-T5 --- Git hooks

Use Husky.

Pre-commit:

-   Biome on staged files
-   secret scan

Pre-push:

-   typecheck
-   unit tests

Do not run expensive agent/eval tests on every commit.

### M0-T6 --- GitHub Actions

Initial CI:

``` text
install
  +-- format:check
  +-- lint
  +-- typecheck
  +-- unit
  +-- build
```

Pin lockfile usage.

### M0-T7 --- Engineering instructions

`AGENTS.md` is canonical.

Include:

-   architecture boundaries
-   package ownership
-   commands
-   definition of done
-   testing requirements
-   ADR requirement for architecture changes
-   no silent dependency additions
-   no direct database access outside storage package
-   no direct model calls outside runtime/decision adapters
-   no compiler-generated code promotion without replay/eval
-   installed dependency docs are authoritative when they differ from
    stale examples

`CLAUDE.md` should point to `AGENTS.md`, not duplicate it.

### M0-T8 --- ADR system

Create ADRs for the decisions in this document.


### M0-T9 --- Create project documentation memory

Create the full `docs/` structure from Repository Layout.

Required initial files:

``` text
docs/README.md
docs/context/current-state.md
docs/progress/README.md
docs/progress/WORKLOG.md
docs/architecture/system-map.md
docs/decisions/README.md
docs/decisions/0000-template.md
docs/development/local-setup.md
docs/development/commands.md
docs/development/source-of-truth-protocol.md
docs/research/README.md
```

`docs/README.md` links to every documentation category and tells a fresh
agent what to read first.

The read order is:

``` text
1. AGENTS.md
2. docs/context/current-state.md
3. docs/README.md
4. relevant architecture/contracts
5. relevant ADRs
6. current milestone/task
7. relevant installed framework docs
```

### M0-T10 --- Enforce work logging

Add the progress protocol to `AGENTS.md`.

Create a lightweight verification script that fails milestone/task
completion checks when:

- `docs/context/current-state.md` is missing;
- `docs/progress/WORKLOG.md` is missing;
- the current task claims `completed` without a verification section;
- an architecture ADR referenced by the task is missing.

Do not attempt to infer whether every code edit was logged. The rule is
enforced by task workflow and review, not brittle Git heuristics.

### M0-T11 --- Create framework reference procedure

Create `docs/development/source-of-truth-protocol.md`.

Document the mandatory Vercel source precedence from AD-011 and add
commands/checklists for inspecting:

``` text
node_modules/eve/docs/
eve public package exports/types
installed AI SDK docs/types
installed Workflow SDK docs/skills/types
installed Sandbox docs/types
official Vercel repositories
official vercel-labs examples
```

The file MUST state that examples discovered on the web are references,
not version authority; implementation must be reconciled with installed
package versions.

## Acceptance Criteria

-   Fresh clone → `pnpm install` → `pnpm check` succeeds.
-   Deliberate type error fails CI.
-   Deliberate formatting error fails CI.
-   Deliberate unit-test failure fails CI.
-   Workspace package boundaries build independently.
-   `AGENTS.md` is enough for a coding agent to understand the
    repository rules.
-   No AI runtime code exists yet.
-   `docs/context/current-state.md` accurately states M0 status and next step.
-   `docs/progress/WORKLOG.md` contains entries for completed M0 tasks.
-   A fresh coding agent can follow the documented read order without prior chat context.
-   The source-of-truth protocol explicitly forbids guessed Vercel APIs.

## Parallel Work

T2--T5 can run in parallel after T1. T7--T8 are independent.

## Blocked By

Nothing.

## Deliverable

A boring, high-quality TypeScript workspace.

------------------------------------------------------------------------

# Milestone 1 --- Local Agent + Public Harness Boundary

## Goal

Run one neutral `eve` agent locally through the harness API.

Do not add compilation yet.

## Neutral Reference Job

Use a **vendor triage agent**.

Input:

``` text
vendor name
vendor website text / fixture evidence
procurement SOP
```

Output:

``` text
category
risk flags
missing information
recommendation
evidence
```

Why this fixture:

-   repetitive
-   structured
-   has research-like behavior
-   supports clear bounded judgments
-   supports deterministic rules
-   can later demonstrate Jev
-   can later demonstrate early stopping
-   is not coupled to marketing or another future domain

Use deterministic local fixture tools before adding live web research.

## Tasks

### M1-T1 --- Install AI SDK and `eve`

Install current compatible versions.

After install:

-   inspect package docs shipped with `eve`
-   record versions
-   add an ADR for versioning policy
-   avoid undocumented internal imports

### M1-T2 --- Scaffold example agent

Use normal `eve` structure:

``` text
agent/
  agent.ts
  instructions.md
  skills/
  tools/
  lib/
```

Create one read-only fixture tool.

### M1-T3 --- `defineDomain()`

Public API:

``` ts
export const vendorTriage = defineDomain({
  id: "vendor-triage",
  version: "1.0.0",
  inputSchema,
  outputSchema,
  createJob,
  evals,
});
```

### M1-T4 --- `createHarness()`

Target API:

``` ts
const harness = createHarness({
  agentRuntime,
  storage,
});

const result = await harness.run({
  domain: vendorTriage,
  input,
});
```

### M1-T5 --- AI SDK runtime contract

Implement `AgentRuntime`.

Keep AI SDK concepts at this boundary.

### M1-T6 --- Eve adapter

Implement `EveAgentRuntime`.

Do not leak `eve` session details into core contracts.

### M1-T7 --- Runtime context

Create typed `ExecutionContext` containing:

-   run ID
-   job ID
-   domain
-   attempt
-   budget
-   permissions
-   trace writer
-   abort signal
-   runtime metadata

### M1-T8 --- Error taxonomy

Define errors early:

``` text
ValidationError
BudgetExceededError
PermissionDeniedError
ToolExecutionError
AgentExecutionError
DecisionError
WorkflowError
StorageError
ReplayMismatchError
```

Every error must be serializable into a trace-safe representation.


### M1-T9 --- Domain capability registry

Implement `CapabilityRegistry` and `CapabilityManifest`.

The neutral domain must register:

``` text
input/output schemas
full agent
fixture read-only tool
one deterministic handler
one policy
```

Registration validates duplicate IDs and incompatible version metadata.

The serializable manifest MUST NOT contain function bodies or secrets.


## Acceptance Criteria

-   `pnpm example:run` executes the neutral agent locally.
-   Input is validated before execution.
-   Output is validated before success.
-   Core imports neither `eve` nor Supabase.
-   The example calls the harness API rather than the `eve` runtime
    directly.
-   A fake `AgentRuntime` can replace `EveAgentRuntime` in a unit test.
-   Cancellation/abort signal reaches the runtime.
-   One intentionally invalid output fails closed.
-   The example domain can serialize its capability manifest.
-   Duplicate capability ID/version registration fails.
-   The manifest contains module/export metadata but no executable source or secrets.

## Parallel Work

Eve adapter and neutral fixture can proceed in parallel once contracts
exist.

## Blocked By

M0.

## Deliverable

The first real reusable harness call.

------------------------------------------------------------------------

# Milestone 2 --- Job, Trace, Supabase, and Run Ledger

## Goal

Make every execution reproducible enough to inspect and later replay.

This is the most important foundation in the project.

## Tasks

### M2-T1 --- Stable identifiers

Use UUIDv7 or another sortable unique ID.

Entities:

``` text
job_id
run_id
attempt_id
trace_event_id
workflow_id
workflow_version_id
node_execution_id
decision_id
eval_run_id
learning_run_id
compiler_run_id
promotion_id
```

### M2-T2 --- Job contract

Finalize the `Job` schema.

Jobs are immutable after execution begins.

### M2-T3 --- Event trace schema

Append-only events:

``` text
run.started
run.completed
run.failed

agent.started
agent.completed
agent.failed

model.started
model.completed
model.failed

tool.started
tool.completed
tool.failed

decision.started
decision.completed
decision.failed

node.started
node.completed
node.failed

artifact.created

approval.requested
approval.resolved

fallback.started
fallback.completed

eval.completed
```

Every event contains:

-   event ID
-   run ID
-   timestamp
-   sequence
-   parent span
-   node
-   event version
-   behavior fingerprint
-   sanitized payload
-   usage
-   latency
-   error metadata

### M2-T4 --- Trace writer interface

``` ts
interface TraceWriter {
  append(event: TraceEvent): Promise<void>;
  flush(): Promise<void>;
}
```

Use a buffered writer locally but preserve event order.

### M2-T5 --- Supabase schema

Initial tables:

``` text
domains
jobs
runs
trace_events
artifacts
workflow_definitions
workflow_versions
workflow_promotions
decisions
eval_runs
eval_results
learning_runs
compiler_runs
```

Do not prematurely normalize every model/tool field into separate
tables. Store stable indexed metadata in columns and versioned payloads
in JSONB.

### M2-T6 --- Migrations

All schema changes are SQL migrations committed to Git.

Never mutate production-like schema manually from the dashboard without
generating a migration.

### M2-T7 --- Outcome ledger

One query-friendly row per run:

``` text
status
success
quality score
cost
latency
model calls
tool calls
Jev calls
fallback count
human review
workflow version
agent version
```

### M2-T8 --- Behavior fingerprint

Hash canonicalized behavior-affecting inputs:

-   agent instructions
-   SOP
-   loaded skills
-   tool definitions/version IDs
-   model configuration
-   schemas
-   workflow IR
-   policy thresholds

Do not hash timestamps or irrelevant metadata.

### M2-T9 --- Secret and sensitive-data redaction

Redact before persistence.

Create:

-   field-path redaction
-   secret-pattern redaction
-   headers redaction
-   tool-specific sanitizer hooks

Test with seeded fake secrets.

### M2-T10 --- Local run inspector

CLI:

``` text
pnpm harness run show <run-id>
```

Display:

-   job
-   route
-   timeline
-   tool/model/Jev calls
-   errors
-   result
-   cost
-   fingerprints


### M2-T11 --- Reproducible local Supabase environment

Install the Supabase CLI as a project dev dependency and initialize the
repository-local configuration.

Document and script the supported lifecycle:

``` text
pnpm supabase:start
pnpm supabase:stop
pnpm supabase:reset
pnpm supabase:types
```

These scripts wrap the current documented CLI commands:

``` text
supabase start
supabase stop
supabase db reset
supabase gen types --lang typescript --local
```

`supabase db reset` is the reproducibility gate: from an empty local
database it applies committed migrations and seed data.

Generate database types into:

``` text
packages/storage-supabase/src/database.types.ts
```

The generated type file is committed. CI checks that regeneration after
migration setup produces no diff.

Local Supabase URLs/keys are loaded from local environment configuration;
they are never copied into committed source.


## Acceptance Criteria

-   Every example execution has a durable run row and ordered trace.
-   A trace reconstructs execution without application logs.
-   Retrying creates a new attempt, not duplicate events.
-   Seeded secrets never appear in stored trace payloads.
-   Behavior fingerprint changes when instructions/SOP/policy changes.
-   Migrations can create a clean database from zero.
-   A failed run remains inspectable.
-   Storage failures cannot silently turn into successful runs.
-   `pnpm supabase:reset` recreates the database from committed migrations and seed.
-   `pnpm supabase:types` regenerates committed TypeScript database types without drift.

## Parallel Work

Supabase migrations, trace package, inspector, and redaction can proceed
in parallel after schemas stabilize.

## Blocked By

M1.

## Deliverable

A trustworthy learning dataset.

------------------------------------------------------------------------

# Milestone 3 --- Jev as a First-Class Decision Primitive

## Goal

Introduce cheap bounded judgment without mixing it with policy.

Vercel currently exposes Jev through AI Gateway as `typesafe-ai/jev`,
and AI SDK 7 exposes evaluation through the experimental evaluation API.
Keep that experimental API isolated inside the adapter package.

## Tasks

### M3-T1 --- Question contract

Support:

``` text
Boolean
Choice
Score
```

Keep harness naming aligned with AI SDK where practical.

### M3-T2 --- `JevDecisionEngine`

Implement the `DecisionEngine` interface using AI SDK evaluation.

No domain imports.

### M3-T3 --- Persist complete decision evidence

Store:

-   question ID/version
-   input-state fingerprint
-   answer
-   available probability distribution
-   confidence metadata
-   model/provider
-   cost
-   latency
-   policy version that consumed the answer

### M3-T4 --- Policy API

``` ts
const result = await decisionEngine.evaluate(...);

const route = policy.evaluate(result);
```

Policies are deterministic and unit-tested.

### M3-T5 --- Confidence bands

Support per-question calibration.

Do not define one global `.90` threshold.

Example:

``` text
auto
agent review
human review
```

### M3-T6 --- Batch decisions

Allow one shared state to answer several independent questions in one
Jev call where semantics permit.

### M3-T7 --- `verify` primitive

Given:

-   evidence
-   structured agent output
-   output schema

compile configured fields into Jev questions.

Failed fields should be able to return to the same logical agent task
with explicit repair instructions.

### M3-T8 --- Neutral fixture

Add Jev to vendor triage:

``` text
Is vendor obviously low risk?
Which vendor category applies?
Is evidence sufficient?
```

Policy decides whether to continue, research, or escalate.

### M3-T9 --- Calibration fixture

Create a small labeled set.

Report:

-   confusion matrix where applicable
-   accuracy
-   uncertain-band rate
-   false-auto rate
-   fallback rate

## Acceptance Criteria

-   Jev can route at least one example-agent decision.
-   Raw Jev result is stored separately from policy outcome.
-   Changing a policy threshold can replay stored decisions without
    rerunning Jev.
-   A Jev failure escalates safely rather than silently guessing.
-   Verification can identify a deliberately unsupported field.
-   Decision tests use fake engines by default; live Jev tests are
    explicitly tagged.
-   Live-provider tests do not run on normal pre-commit.

## Parallel Work

Can run in parallel with M4 after M2.

## Blocked By

M2.

## Deliverable

A reusable System-One decision layer.

------------------------------------------------------------------------

# Milestone 4 --- Workflow IR, DSL, and Local Deterministic Runtime

## Goal

Create the inspectable compiled representation before attempting
automatic compilation.

Humans should be able to author workflows first.

## Tasks

### M4-T1 --- Serializable IR

Define versioned IR.

Example:

``` ts
type WorkflowDefinition = {
  schemaVersion: 1;
  id: string;
  domain: string;
  jobType: string;
  inputSchema: string;
  outputSchema: string;
  entry: NodeId;
  nodes: Record<NodeId, WorkflowNode>;
};
```

### M4-T2 --- Node contracts

Each node defines:

``` text
id
type
input schema
output schema
timeout
retry policy
budget
permissions
version
```

### M4-T3 --- Node types

Implement initially:

-   `code`
-   `call`
-   `jev`
-   `agent`
-   `artifact`
-   `escalate`

Reserve but do not implement until needed:

-   human
-   subworkflow

### M4-T4 --- Control shapes

Implement:

-   chain
-   branch
-   map
-   reduce
-   bounded loop

Validation rejects:

-   unreachable nodes
-   missing nodes
-   incompatible schemas
-   cycles not declared as bounded loops
-   missing escalation target
-   duplicate IDs

### M4-T5 --- Typed DSL

Example:

``` ts
export default workflow({
  id: "vendor-triage-v1",
  input: VendorInput,
  output: VendorResult,
})
  .jev("initial-classification", ...)
  .branch(...)
  .agent("research", ...)
  .code("apply-policy", ...)
  .escalate("full-agent");
```

The DSL compiles to IR.

The IR, not builder object identity, is fingerprinted.

### M4-T6 --- Local runtime

Implement a local interpreter for IR.

Do **not** build durability yet.

The runtime must:

-   validate node input
-   execute node
-   validate node output
-   emit trace events
-   enforce timeout
-   enforce budget
-   follow edges
-   persist node result

### M4-T7 --- Idempotency

Every node execution gets an idempotency key:

``` text
run + workflow version + node + logical item + attempt
```

External `call` nodes must declare whether they are:

-   read-only
-   idempotent write
-   non-idempotent write

Non-idempotent writes require explicit protection.

### M4-T8 --- Tool grants

Node permissions are explicit.

An `agent` node receives only its granted tools.

A `code` node does not inherit agent tools.


### M4-T9 --- IR canonicalization and capability resolution

Before fingerprinting or execution:

1. parse the IR with its versioned schema;
2. resolve every capability ID/version against `CapabilityRegistry`;
3. verify node input/output schemas against referenced capabilities;
4. normalize object/key ordering for canonical serialization;
5. reject unknown fields where the IR schema requires strictness;
6. produce the canonical IR bytes used for the workflow fingerprint.

A workflow with a missing capability MUST fail validation before any node
executes.

### M4-T10 --- Hand-authored compiled example


Create vendor workflow:

``` text
Jev classify
    |
    +-- clear -> code finalize
    |
    +-- research -> agent research
                       |
                       v
                   Jev verify
                       |
                       v
                   code decide
    |
    +-- uncertain -> full-agent escalation
```

## Acceptance Criteria

-   A human-authored workflow runs locally.
-   Every node validates inputs and outputs.
-   Workflow validation rejects an intentional unbounded cycle.
-   An agent node cannot call an ungranted tool.
-   A failed node is visible in the trace.
-   A retry does not duplicate a protected side effect in tests.
-   DSL output can be serialized to canonical IR.
-   Same IR produces same workflow fingerprint.

## Parallel Work

Runtime, validator, DSL, and fixture workflow can be split after IR
stabilizes.

## Blocked By

M2. Jev node completion additionally depends on M3.

## Deliverable

The first inspectable compiled workflow.

------------------------------------------------------------------------

# Milestone 5 --- Workflow Registry, Router, and Fallback

## Goal

Choose between a proven compiled workflow and the full agent.

## Tasks

### M5-T1 --- Registry model

Workflow statuses:

``` text
draft
candidate
shadow
canary
active
retired
rejected
```

### M5-T2 --- Compatibility selector

A workflow declares:

-   domain
-   job type
-   supported input schema
-   required capabilities
-   SOP compatibility
-   minimum harness version

Never route only by string name.

### M5-T3 --- Router

Initial routing is deterministic.

``` text
compatible active workflow?
  yes -> workflow
  no  -> full agent
```

Do not use an LLM to decide whether a known workflow exists.

### M5-T4 --- Fallback contract

Every compiled execution can return:

``` text
success
fallback(reason)
failure
```

Fallback reasons are typed:

``` text
low_confidence
unsupported_case
missing_evidence
budget
tool_failure
schema_mismatch
policy
workflow_error
```

### M5-T5 --- Full-agent escalation

Fallback should preserve:

-   original job
-   workflow evidence
-   completed safe node results
-   fallback reason

The full agent should not blindly repeat completed research if
trustworthy evidence already exists.


### M5-T6 --- Fallback context handoff

Construct `FallbackContext` from persisted node outputs and evidence
references.

Rules:

- only successfully validated node outputs may be marked `trusted`;
- failed/partial node output is not automatically reusable;
- original `Job` remains immutable;
- remaining budget is recalculated before full-agent invocation;
- the full-agent adapter receives the fallback envelope through its
  documented runtime boundary;
- the trace links the compiled run span to the fallback agent execution.

Add an integration test proving the full agent can consume already
completed research without the harness repeating the research tool call.

### M5-T7 --- Circuit breaker


If an active workflow exceeds configured failure/fallback thresholds
over a rolling local evaluation window, disable routing to it.

Initial version can require manual invocation.

## Acceptance Criteria

-   Same harness call can execute either workflow or full agent.
-   Unsupported jobs never force-fit into a workflow.
-   Fallback reaches the full agent with accumulated context.
-   Workflow failure does not mark the job successful.
-   Retiring an active workflow immediately returns traffic to the full
    agent.
-   Registry lookup is deterministic and unit-tested.

## Parallel Work

Registry storage and router can proceed in parallel.

## Blocked By

M4.

## Deliverable

The core compile-then-run execution loop, still without automatic
learning.

------------------------------------------------------------------------

# Milestone 6 --- Replay and Evaluation

## Goal

Prove a candidate workflow before it handles live work.

No compiler should exist before this milestone.

## Tasks

### M6-T1 --- Replay case format

A replay case contains:

-   immutable input snapshot
-   expected/accepted outcome
-   frozen evidence where applicable
-   source run ID
-   labels
-   dataset split

### M6-T2 --- Dataset splits

Support:

``` text
train
dev
reserved
```

The compiler may inspect train.

It may optimize against dev.

It must not see reserved examples before final promotion evaluation.

### M6-T3 --- Frozen-tool replay

For research/tool nodes, allow recorded tool results to replace live
external calls.

This lets the system compare reasoning/workflow changes without source
drift.


### M6-T4 --- Replay interception contract

Replay mode never silently performs a live external action.

Create a `ReplayResolver` keyed by a canonical request fingerprint:

``` text
capability ID/version
operation
sanitized canonical input
fixture/evidence version
```

For tool/call/research nodes in frozen mode:

``` text
matching recorded result -> return recorded result
no recorded result        -> fail ReplayFixtureMissing
```

Live fallback is disabled by default and can only be enabled with an
explicit replay option that is visible in the eval report.

Persist both:

- recorded result payload/reference;
- fingerprint of the request that produced it.

A replay result generated from frozen evidence is marked as replayed, not
as a new real-world observation.

### M6-T5 --- Node evals


Examples:

**Jev** - classification accuracy - false-auto rate - calibration -
uncertain rate

**Research agent** - required-fact recall - citation/evidence
completeness - verify bounce rate

**Code** - unit tests - property tests - replay diff

**Report** - record fidelity - prohibited re-decision

### M6-T6 --- Workflow eval

Measure:

``` text
quality
cost
latency
tool calls
model calls
Jev calls
fallback rate
human-review rate
```

### M6-T7 --- Baseline comparison

Every candidate compares against a named baseline:

``` text
candidate workflow v3
vs
full agent fingerprint X
```

### M6-T8 --- Promotion gate API

``` ts
type PromotionPolicy = {
  minimumQuality: number;
  maximumRegression: number;
  maximumFalseAutoRate: number;
  maximumFallbackRate?: number;
  requireReservedPass: boolean;
};
```

Cost improvement alone can never promote a workflow.

### M6-T9 --- Deterministic eval report

Generate Markdown/JSON report containing:

-   candidate
-   baseline
-   dataset
-   metrics
-   regressions
-   failed examples
-   recommendation status

## Acceptance Criteria

-   Historical fixture runs replay without live tools.
-   Candidate and full agent can be compared on the same evidence.
-   Reserved examples are inaccessible to compiler code.
-   A cheaper but lower-quality workflow can fail promotion.
-   Failed examples link back to traces.
-   Eval output is reproducible from committed fixtures + versioned
    workflow.

## Parallel Work

Replay runner, evaluators, and report generator can proceed in parallel.

## Blocked By

M5.

## Deliverable

A trustworthy safety gate for optimization.

------------------------------------------------------------------------

# Milestone 7 --- Learning Layer

## Goal

Turn traces into generalized observations without changing production
behavior.

Learning is advisory in this milestone.

## Tasks

### M7-T1 --- Learning batch selector

Select comparable successful/failed runs by:

-   domain
-   job type
-   behavior fingerprint
-   SOP version
-   date range
-   outcome

Do not mix incompatible policy versions.

### M7-T2 --- Per-run notes

Ask a capable agent to create concise generalized notes.

Required distinction:

``` text
BAD:
"Vendor Acme had no SOC 2."

GOOD:
"When security certification is explicitly absent, do not perform the secondary certification lookup."
```

### M7-T3 --- Batch retrospective

Given traces + notes + outcomes, identify:

-   repeated decisions
-   repeated tool sequences
-   unnecessary research
-   early-stop opportunities
-   deterministic transformations
-   bounded judgments suitable for Jev
-   direct API opportunities
-   agent-only ambiguity
-   common fallback causes

### M7-T4 --- Evidence-backed learning

Every proposed learning links to supporting run/node IDs.

No unsupported "best practice" should enter the learning store.

### M7-T5 --- Learning registry

Store:

``` text
learning
evidence count
supporting runs
contradicting runs
confidence
scope
status
```

Statuses:

``` text
observed
candidate
validated
rejected
superseded
```

### M7-T6 --- Contradiction handling

New evidence can weaken or supersede a learning.

Do not treat notes as permanent memory.

### M7-T7 --- Human review UI/CLI

CLI is enough initially:

``` text
pnpm harness learn review <learning-run>
```

## Acceptance Criteria

-   20+ fixture traces can produce a learning batch.
-   Every learning has evidence lineage.
-   Case-specific facts are rejected by tests/prompts from
    generalized-note fixtures.
-   Contradictory evidence is visible.
-   Learning has zero ability to alter routing or production execution.

## Parallel Work

Learning store and retrospective agent can proceed in parallel.

## Blocked By

M6.

## Deliverable

The system can explain what it thinks should be compiled, without acting
on it.

------------------------------------------------------------------------

# Milestone 8 --- Compiler v1

## Goal

Convert validated learnings into a candidate workflow.

The compiler should be constrained. It is not allowed to invent
arbitrary infrastructure.

## Tasks

### M8-T1 --- Compiler input contract

Compiler receives:

-   job contract
-   SOP
-   trace sample
-   validated learnings
-   available node catalog
-   tool catalog
-   schemas
-   baseline metrics
-   existing workflow if iterating

### M8-T2 --- Compiler target selection

For each stable behavior, choose:

``` text
code
Jev
direct call
specialized agent
full-agent escalation
```

Document why.

### M8-T3 --- IR-first generation

The compiler produces a candidate **IR plan first**.

Validate it before source generation.

Reject:

-   unknown tools
-   unknown schemas
-   unsupported node types
-   unbounded loops
-   undeclared writes
-   missing fallback
-   incompatible outputs

### M8-T4 --- Deterministic source generation

After IR validation and capability resolution, generate TypeScript with
the project-owned `packages/codegen` package using ts-morph.

Inputs are only:

``` text
validated canonical IR
capability manifest
codegen version
target backend
```

The generator:

1. resolves every capability reference to manifest module/export data;
2. creates static typed imports;
3. emits orchestration from known node/control templates;
4. emits no arbitrary model-provided source snippets;
5. writes `workflow.ir.json`;
6. writes `workflow.generated.ts`;
7. runs Biome formatting;
8. reparses/compiles the generated module as validation.

Generated source goes to a temporary compiler workspace and does not
overwrite active workflow code.

For local target, generated code calls harness runtime primitives.

For the later Vercel Workflow target, a separate backend emits
documented Workflow SDK directive patterns after the installed SDK has
been inspected per AD-011.

CI later runs a regeneration check:

``` text
committed IR -> codegen -> generated TS
                         == committed generated TS
```

A mismatch fails validation.

### M8-T5 --- Generated manifest

Every candidate includes:

``` text
source learning IDs
source run IDs
compiler model
compiler instructions fingerprint
target baseline
workflow fingerprint
generated files
```

### M8-T6 --- Static validation

Run:

``` text
format
lint
typecheck
unit tests
workflow validator
permission validator
```

### M8-T7 --- Candidate replay

Automatically run train/dev replay.

Do not expose reserved set to compiler repair loops.

### M8-T8 --- Compiler repair loop

Bound the repair loop.

Example:

``` text
max 3 compiler repair attempts
```

Each attempt sees explicit validation failures, not the reserved
results.

### M8-T9 --- Candidate output

Produce:

``` text
.compiler/
  <compiler-run>/
    proposal.md
    workflow.ts
    workflow.ir.json
    manifest.json
    eval-dev.json
```

## Acceptance Criteria

-   Compiler can generate a valid candidate for the neutral fixture.
-   Candidate cannot access tools absent from the catalog.
-   Candidate with unbounded loop is rejected.
-   Generated source passes typecheck before replay.
-   Compiler cannot read reserved eval results.
-   Failed generation never modifies active workflow.
-   Every generated line of behavior has compiler-run lineage at the
    file/workflow level.

## Parallel Work

IR planner, source generator, and validator can proceed in parallel
after compiler input contract stabilizes.

## Blocked By

M7.

## Deliverable

The first automated trace → workflow compilation.

------------------------------------------------------------------------

# Milestone 9 --- Safe Promotion, Shadowing, and Rollback

## Goal

Make compiled workflows operational without allowing the compiler to
silently replace behavior.

## Tasks

### M9-T1 --- Candidate lifecycle

``` text
draft
  -> candidate
  -> shadow
  -> canary
  -> active
```

Any stage can become:

``` text
rejected
retired
```

### M9-T2 --- Reserved evaluation

Only the promotion service/evaluator can access reserved cases.

Compiler cannot.

### M9-T3 --- Shadow mode

For a live/local job:

``` text
full agent -> authoritative result
workflow   -> non-authoritative result
```

Compare results and metrics.

### M9-T4 --- Canary routing

Later/local simulation:

``` text
10%
25%
50%
75%
100%
```

Initial implementation can simulate these percentages over fixture
batches rather than production traffic.

### M9-T5 --- Manual approval

CLI:

``` text
pnpm harness workflow promote <version>
```

Show eval report and require explicit confirmation.

### M9-T6 --- Git integration boundary

The harness generates:

-   patch
-   candidate branch content
-   proposed commit message
-   proposed PR body

It does **not** require GitHub write access.

Define optional `SourceControlPublisher` interface for consuming repos.

Later adapter:

``` text
GitHubSourceControlPublisher
```

can create branch/PR if a consuming agent grants permission.

### M9-T7 --- Rollback

Registry can atomically switch active workflow version.

No code deletion is required to roll back.

### M9-T8 --- Promotion audit

Store:

-   who/what promoted
-   source commit
-   eval run
-   policy
-   metrics
-   timestamp

## Acceptance Criteria

-   Candidate cannot become active without promotion policy pass.
-   Early version also requires explicit human approval.
-   Shadow workflow cannot affect authoritative output.
-   Active workflow can be rolled back to previous version.
-   Harness works without GitHub credentials.
-   Optional source-control interface proves PR ownership can remain
    with the consuming agent/repo.

## Parallel Work

Shadow runner, promotion service, and optional Git adapter interface can
proceed in parallel.

## Blocked By

M8.

## Deliverable

A safe optimization lifecycle.

------------------------------------------------------------------------

# Milestone 10 --- Multi-Domain SDK

## Goal

Prove the same harness can be installed by unrelated agents.

## Tasks

### M10-T1 --- Package public API

Target:

``` ts
import {
  createHarness,
  defineDomain,
  definePolicy,
  workflow,
} from "@internal/adaptive-agent-harness";
```

Avoid exporting internal implementation classes.

### M10-T2 --- Domain package contract

A consumer provides:

``` text
domain ID
version
job types
schemas
SOP
agent runtime
tools
skills
evals
policies
```

### M10-T3 --- Namespace isolation

Registry keys include domain and job type.

No workflow from domain A is eligible for domain B unless explicitly
published as shared.

### M10-T4 --- Shared primitive registry

Create explicit shared primitives:

``` text
shared/
  verify-evidence
  research-entity
  classify-intent
```

Promotion into shared requires:

-   multiple-domain evidence
-   compatible contracts
-   explicit approval

### M10-T5 --- Second neutral domain

Create a second unrelated fixture, such as document intake triage.

Do not reuse vendor-specific code.

### M10-T6 --- Installation test

Create a separate fixture workspace that installs the built package
tarball exactly like a future independent repo.

### M10-T7 --- Version compatibility

Harness exposes version metadata.

Workflows declare minimum compatible harness version.

## Acceptance Criteria

-   Two unrelated example domains use the same harness.
-   Neither imports the other's code.
-   Workflow registry never cross-routes by accident.
-   Package can be packed and installed into a clean fixture repo.
-   Core API is documented.
-   A breaking internal refactor does not require domain changes if
    public contracts remain stable.

## Parallel Work

Second fixture and package hardening can proceed in parallel.

## Blocked By

M9.

## Deliverable

Proof that this is a harness, not a vendor-triage application.

------------------------------------------------------------------------

# Milestone 11 --- Vercel Production-Primitive Adapters

## Goal

Keep local semantics while preparing for hosted execution.

Do this only after the local architecture works.

## Tasks

### M11-T1 --- Vercel Workflow adapter

Map workflow runtime semantics onto durable Workflow execution.

Preserve:

-   node IDs
-   trace IDs
-   idempotency
-   retries
-   timeouts
-   fallback

The local interpreter remains the fast test runtime.

### M11-T2 --- Vercel Sandbox adapter

Use Sandbox for:

-   generated workflow validation
-   compiler code execution
-   tests
-   temporary worktrees
-   risky code-node execution where appropriate

Local process execution remains available for development.

### M11-T3 --- AI Gateway configuration

Centralize:

-   model aliases
-   provider settings
-   budgets
-   retry/fallback policy
-   ZDR where required

### M11-T4 --- Eve production adapter validation

Verify:

-   approvals
-   subagents
-   durable sessions
-   skills
-   tool grants
-   tracing hooks

against current installed `eve` APIs.

### M11-T5 --- Hosted/local parity tests

Same fixture must produce contract-compatible results through:

``` text
local runtime
Vercel Workflow adapter
```

## Acceptance Criteria

-   Core/domain code does not change when execution moves from local
    interpreter to Workflow adapter.
-   Compiler validation can run through Sandbox adapter.
-   Trace IDs survive adapter boundaries.
-   Hosted-specific failures map to harness error taxonomy.
-   Local tests do not require Vercel infrastructure.

## Parallel Work

Workflow and Sandbox adapters can proceed in parallel.

## Blocked By

M10.

## Deliverable

A clear path from laptop harness to hosted agent platform.

------------------------------------------------------------------------

# Milestone 12 --- Hardening and Autonomous Optimization

## Goal

Allow the system to optimize itself safely within explicit boundaries.

## Tasks

### M12-T1 --- Automated learning schedule

Trigger learning after:

-   N comparable runs
-   fallback spike
-   cost regression
-   quality regression
-   manual request

### M12-T2 --- Automatic candidate generation

Validated learnings may trigger compiler runs.

Still no direct promotion.

### M12-T3 --- Automatic shadow evaluation

Candidates passing static validation can automatically enter shadow.

### M12-T4 --- Optional autonomous promotion

Only enable after enough evidence.

Requirements:

-   promotion policy passes
-   reserved set passes
-   minimum sample size
-   no critical eval failures
-   no new external-write permission
-   no SOP incompatibility
-   no security-sensitive change
-   rollback target exists

Keep feature disabled by default.

### M12-T5 --- Drift detection

Watch:

-   fallback rate
-   confidence distribution
-   quality
-   cost
-   latency
-   tool error rate
-   schema mismatch rate

A material drift can demote a workflow.

### M12-T6 --- Policy replay

When policy thresholds change:

1.  replay stored Jev probabilities;
2.  recompute decisions;
3.  identify changed outcomes;
4.  only rerun research when the underlying evidence is stale or
    insufficient.

### M12-T7 --- SOP migration analysis

When SOP version changes:

-   identify affected workflow nodes;
-   invalidate incompatible active workflows;
-   replay reusable evidence where valid;
-   require new promotion.

### M12-T8 --- Security review

Threat-model:

-   prompt injection
-   tool privilege escalation
-   generated-code execution
-   trace poisoning
-   compiler poisoning
-   secret leakage
-   malicious evidence
-   replay tampering
-   unauthorized workflow promotion

## Acceptance Criteria

-   Compiler can run automatically without gaining promotion authority.
-   Drift can automatically stop an unsafe workflow.
-   Policy-only changes can replay without unnecessary agent/research
    calls.
-   SOP incompatibility prevents stale workflow routing.
-   Autonomous promotion, if enabled, is controlled by explicit policy
    and can be disabled globally.
-   Security test fixtures cover malicious inputs and tool-grant bypass
    attempts.

## Blocked By

M11.

## Deliverable

The complete adaptive compile-then-run harness.

------------------------------------------------------------------------

# 7. Work That Can Compound in Parallel

Once M2 exists, use parallel tracks.

``` text
TRACK A — Execution
M3 Jev
M4 Workflow
M5 Router

TRACK B — Data
Trace quality
Supabase queries
Run inspector
Cost accounting

TRACK C — Evaluation
Fixtures
Labels
Replay
Metrics

TRACK D — Developer Experience
CLI
Docs
Example agent
Test helpers
```

After M6:

``` text
TRACK A — Learning
notes
retrospectives
learning registry

TRACK B — Compiler
IR planning
generation
validation

TRACK C — Safety
reserved evals
promotion policy
shadow/canary
```

Do not parallelize work by violating dependency order. In particular:

-   no compiler before replay;
-   no autonomous promotion before promotion gates;
-   no production durability before local runtime semantics are stable.

------------------------------------------------------------------------

# 8. Testing Strategy

## Unit tests

Default test layer.

No live model calls.

Use:

-   fake agent runtime
-   fake Jev engine
-   fake tools
-   in-memory workflow registry where appropriate

## Contract tests

Validate adapter compatibility:

``` text
AgentRuntime
DecisionEngine
Storage
WorkflowExecutor
SourceControlPublisher
```

Every implementation runs the same contract suite.

## Integration tests

May use local Supabase.

Still avoid live model calls unless explicitly tagged.

## Live provider tests

Tagged:

``` text
live:ai
live:jev
live:eve
```

Run manually or in a separate CI job.

## Replay tests

Historical/frozen evidence.

These become increasingly important as the project matures.

## Security tests

Include:

-   prompt injection in evidence
-   forged tool result
-   unauthorized tool request
-   secret in tool output
-   malicious compiler proposal
-   path traversal in artifacts
-   unbounded workflow attempt

------------------------------------------------------------------------

# 9. Supabase Data Model --- Initial Shape

``` text
domains
-------
id
version
created_at

jobs
----
id
domain_id
job_type
input
contract_versions
created_at

runs
----
id
job_id
attempt
status
execution_mode
workflow_version_id nullable
behavior_fingerprint
started_at
completed_at
cost_usd
latency_ms
quality_score
fallback_count

trace_events
------------
id
run_id
sequence
parent_id
node_id
event_type
event_version
payload
usage
latency_ms
created_at

decisions
---------
id
run_id
node_id
engine
question_version
state_fingerprint
result
provider_metadata
policy_version
created_at

workflow_definitions
--------------------
id
domain_id
job_type

workflow_versions
-----------------
id
workflow_definition_id
version
status
schema_version
ir
fingerprint
source_commit nullable
minimum_harness_version
created_at

eval_runs
---------
id
workflow_version_id
baseline_fingerprint
dataset_version
status
summary
created_at

eval_results
------------
id
eval_run_id
case_id
metric
value
details

learning_runs
-------------
id
domain_id
job_type
source_filter
status
summary
created_at

compiler_runs
-------------
id
learning_run_id
baseline_workflow_version_id nullable
status
manifest
created_at

workflow_promotions
-------------------
id
workflow_version_id
from_status
to_status
eval_run_id
actor
policy_version
created_at
```

Add indexes based on actual query plans, not guesses.

------------------------------------------------------------------------

# 10. CLI Surface

Build the CLI incrementally.

Target:

``` text
harness run <fixture>
harness run show <run-id>

harness workflow list
harness workflow inspect <version>
harness workflow validate <path>
harness workflow replay <version>
harness workflow promote <version>
harness workflow rollback <version>

harness eval run <version>
harness eval show <eval-id>

harness learn run --domain ...
harness learn review <learning-id>

harness compile <learning-id>
harness compile show <compiler-id>
```

The CLI becomes the initial control plane. Do not build a dashboard
until the CLI becomes painful.

------------------------------------------------------------------------

# 11. GitHub and Pull Requests

PR submission is **not** a core harness responsibility.

The core compiler produces a safe candidate artifact:

``` text
candidate workflow source
IR
manifest
eval report
suggested commit message
suggested PR description
```

A consuming repository can optionally provide:

``` ts
interface SourceControlPublisher {
  publishCandidate(candidate: CandidateArtifact): Promise<PublishResult>;
}
```

A future GitHub adapter may:

1.  create a branch;
2.  write generated workflow files;
3.  commit;
4.  push;
5.  open a PR.

This keeps GitHub credentials and repository mutation under the control
of the agent/repository using the harness.

For local development, the first implementation should simply write
candidates under `.compiler/<run-id>/`.

------------------------------------------------------------------------

# 12. Definition of Done for Every Task

A task is not done until:

-   code is formatted;
-   lint passes;
-   typecheck passes;
-   appropriate unit/contract/integration tests exist;
-   public behavior is documented;
-   errors are typed;
-   trace behavior is considered;
-   security/permission impact is considered;
-   migrations are included if storage changes;
-   no unrelated architecture boundary is violated;
-   `pnpm check` passes;
-   `docs/progress/WORKLOG.md` contains the task result and verification;
-   `docs/context/current-state.md` is updated with the exact next step;
-   framework-facing tasks include their implementation references and installed versions.

Architecture-changing tasks also require an ADR.

------------------------------------------------------------------------

# 13. What Not to Build Early

Avoid these until the preceding milestone proves the need:

-   custom visual workflow editor
-   dashboard
-   generic plugin marketplace
-   multi-tenant auth
-   hosted control plane
-   custom queue
-   custom durable workflow engine
-   custom sandbox
-   custom model gateway
-   YAML workflow language
-   automatic GitHub writes
-   autonomous promotion
-   cross-domain automatic learning
-   vector database just because agents are involved

The project should remain surprisingly small until the compiler actually
works.

------------------------------------------------------------------------

# 14. First End-to-End Proof

The first major proof should look like this:

## Phase A --- Full agent only

Run 50--100 neutral vendor-triage fixtures through the full agent.

Capture:

-   trace
-   cost
-   latency
-   tool calls
-   outcome
-   eval

## Phase B --- Learn

The learning system identifies patterns such as:

``` text
obvious low-risk cases need no research
certain categories require one specific lookup
missing mandatory evidence always escalates
several output fields are deterministic
```

## Phase C --- Compile

Compiler proposes:

``` text
Jev initial classify
    |
    +-- obvious clear
    |      |
    |      v
    |   code finalize
    |
    +-- needs research
    |      |
    |      v
    |   small research agent
    |      |
    |      v
    |   Jev verify
    |      |
    |      v
    |   code decide
    |
    +-- uncertain
           |
           v
       full agent
```

## Phase D --- Replay

Compare candidate with full agent on frozen evidence.

## Phase E --- Reserved evaluation

Candidate must preserve quality within policy.

## Phase F --- Promote

Human explicitly promotes workflow.

## Phase G --- New jobs

Most routine cases use the compiled workflow.

Tail cases return to the full agent.

Those fallback traces become the next learning batch.

That closed loop is the point at which the harness thesis is proven.

------------------------------------------------------------------------

# 15. Recommended Build Order

Do not try to build all packages at once.

Use this exact sequence:

``` text
1. Repository
2. One local full agent
3. Job contract
4. Trace + Supabase
5. Jev
6. Human-authored workflow
7. Router + fallback
8. Replay
9. Evals
10. Learning notes
11. Batch retrospective
12. Compiler IR proposal
13. Generated workflow source
14. Static validation
15. Replay candidate
16. Promotion lifecycle
17. Second domain
18. Vercel Workflow adapter
19. Vercel Sandbox adapter
20. Autonomous optimization
```

Each step leaves a usable system behind.

At steps 1--4, you have an observable agent harness.

At steps 5--7, you have a hybrid agent/workflow runtime.

At steps 8--9, you have a safe optimization testbed.

At steps 10--16, you have AgentRun-style compilation.

At step 17, you prove reuse.

At steps 18--20, you turn the local architecture into a
production-capable adaptive platform.

------------------------------------------------------------------------


# 16. Mandatory Task Execution Protocol

Every coding task, regardless of milestone, follows this exact lifecycle:

``` text
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

If interrupted after step 3, steps 7 and 8 become the highest-priority
work before continuing feature implementation.

## No-assumption stop condition

When an implementation detail is not established by the current public
API/docs/types:

``` text
STOP guessing
    ↓
search installed docs/types
    ↓
search official Vercel repo/docs/vercel-labs
    ↓
still undocumented?
    ↓
record open technical decision
    ↓
design a harness-owned abstraction explicitly
```

The agent may make ordinary internal engineering choices where the
framework imposes no contract, but it must label those as project
decisions and capture architectural ones in an ADR.


# 17. North-Star Invariants

These should remain true even as implementation changes:

1.  A domain can always fall back to its full agent.
2.  A compiled workflow is never trusted because the compiler wrote it.
3.  Every workflow version is inspectable.
4.  Every behavior-affecting version is fingerprinted.
5.  Every node has typed input and output.
6.  Every loop is bounded.
7.  Every external write has explicit permission semantics.
8.  Jev judgment and application policy remain separate.
9.  Historical evidence can be replayed without unnecessary re-research.
10. The compiler cannot see the reserved evaluation set.
11. Learning from one domain does not silently alter another.
12. Cost improvement cannot compensate for an unacceptable quality
    regression.
13. Generated code cannot directly self-promote.
14. The harness remains useful even if learning/compilation is turned
    off.
15. Local development remains a first-class path.


---


# Appendix — Bridge Audit Checklist

Before a milestone begins, verify its incoming and outgoing bridges.

| From | To | Required bridge |
|---|---|---|
| domain | harness | `DomainDefinition` + capability registry |
| harness | eve | documented runtime/client/hooks adapter |
| eve events | harness trace | explicit normalization map |
| job | route | immutable job + compatibility lookup |
| IR | runtime | schema validation + capability resolution |
| IR | source | deterministic codegen |
| source | Vercel Workflow | installed-SDK-verified backend |
| node | tool/API | explicit capability + permission grant |
| Jev | policy | typed result/probability, deterministic policy |
| workflow | full agent | `FallbackContext` |
| real run | replay | stored canonical request/result references |
| replay | eval | immutable case + dataset version |
| learning | compiler | evidence-linked validated learnings |
| compiler | candidate | IR only |
| candidate | active | static checks + dev + reserved + approval |
| active | rollback | registry pointer to prior promoted version |
| task | next session | WORKLOG + current-state Markdown |

No milestone is considered implementation-ready if one of its bridges is
undefined.

---

# Appendix A — Verified Vercel Reference Set for Implementation

These are starting references only. The installed lockfile-matched docs
remain authoritative during implementation.

## eve

- Official repository: `github.com/vercel/eve`
- Installed docs entrypoint: `node_modules/eve/docs/README.md`
- Public package README documents filesystem-first authored slots and
  public subpath exports.
- `eve/hooks` is the documented observe-only runtime event extension
  point; hooks run after events are durably recorded.
- `eve/client` is the documented typed programmatic client for sessions,
  runs, streaming, tests, and server-to-server callers.
- `eve/evals` provides `defineEval` and runs through the same HTTP surface
  used by the agent.
- Workflow tools use `defineWorkflowTool` and Workflow SDK semantics when
  a workflow is intentionally a tool of an eve agent.

## Workflow SDK

- Official repository: `github.com/vercel/workflow`
- Official examples: `github.com/vercel/workflow-examples`
- Official Vercel Labs workshop: `github.com/vercel-labs/workflow-workshop`
- `"use workflow"` marks deterministic durable orchestration.
- `"use step"` marks atomic/retryable work with full runtime access.
- Side effects/API/DB/SDK calls belong in steps under the documented
  model.
- Workflow code is compiler-transformed; generated workflows must be
  validated by the actual installed Workflow build pipeline.

## AI SDK + Jev

- AI SDK 7 is Vercel's underlying TypeScript agent layer and the layer
  used by eve.
- Jev is available through AI Gateway as `typesafe-ai/jev`.
- Current Vercel documentation exposes Jev through AI SDK's experimental
  evaluation API and documents Choice, Score, and Boolean questions.
- Because the evaluation API is experimental, the harness isolates it in
  `decision-jev`.

## Vercel Labs examples

When a task needs a working implementation reference, search
`vercel-labs` before designing from scratch. Relevant examples currently
include code execution with Vercel Sandbox, computer-use Sandbox
snapshots, GitHub agents, and Workflow SDK workshops.

These repositories demonstrate patterns; they do not override the API
contract of installed package versions.
