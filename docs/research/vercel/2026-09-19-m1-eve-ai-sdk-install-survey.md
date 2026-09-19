---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/development/source-of-truth-protocol.md
  - docs/decisions/0024-framework-dependency-versioning-policy.md
  - docs/decisions/0011-no-vercel-implementation-detail-may-be-guessed.md
  - docs/decisions/0003-ai-sdk-is-the-lowest-agent-runtime-contract-eve-is-the-default-runtime-adapter.md
  - docs/milestones/m1-local-agent-and-public-harness-boundary.md
implementation:
  - packages/runtime-eve
  - packages/runtime-ai-sdk
---

# M1-T1: `eve` and AI SDK install survey

What was found in the packages actually installed by M1-T1, on 2026-09-19. This note records
findings, not architecture. Where it and an architecture doc disagree about framework behaviour,
this note is closer to ground truth, because every claim below cites a file inside `node_modules`
or a `pnpm view` query against the registry.

Per `docs/development/source-of-truth-protocol.md` §1, the lockfile-matched installed package is
the authority. Nothing in this note comes from memory or from a web page.

## 1. Installed versions

| Package | Version | Declared by |
| --- | --- | --- |
| `eve` | 0.63.0 | `packages/runtime-eve/package.json` (`dependencies`) |
| `ai` | 7.0.107 | `packages/runtime-eve` and `packages/runtime-ai-sdk` (`dependencies`) |
| `zod` | 4.6.5 | `packages/runtime-eve` and `packages/runtime-ai-sdk` (`dependencies`) |
| `@ai-sdk/gateway` | 4.0.87 | transitive, a `dependencies` entry of `ai` |
| `@ai-sdk/provider` | 4.0.17 | transitive, a `dependencies` entry of `ai` |
| `@ai-sdk/provider-utils` | 5.0.45 | transitive, a `dependencies` entry of `ai` |

All four direct declarations are exact pins, per ADR-0024. Resolved store paths on this machine:

```text
node_modules/.pnpm/eve@0.63.0_ai@7.0.107_zod@4.6.5_/node_modules/eve
node_modules/.pnpm/ai@7.0.107_zod@4.6.5/node_modules/ai
node_modules/.pnpm/zod@4.6.5/node_modules/zod
```

`pnpm install` appended `@ai-sdk/gateway@4.0.87`, `@ai-sdk/provider-utils@5.0.45`, `ai@7.0.107`
and `eve@0.63.0` to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`, which is the documented
behaviour of pnpm's supply-chain release-age gate for a deliberate install. `@ai-sdk/provider`
and `zod` were old enough to pass the gate without an exclusion.

## 2. Peer dependencies

`node_modules/eve/package.json`:

```json
"peerDependencies": {
  "@opentelemetry/api": "^1.0.0",
  "ai": "^7.0.105",
  "braintrust": "^3.0.0",
  "dd-trace": "^6.13.0",
  "just-bash": "^3.1.0",
  "microsandbox": "^0.5.0"
},
"peerDependenciesMeta": {
  "@opentelemetry/api": { "optional": true },
  "braintrust": { "optional": true },
  "dd-trace": { "optional": true },
  "just-bash": { "optional": true },
  "microsandbox": { "optional": true }
}
```

`ai` is the **only required** peer of `eve`; the other five carry an `optional: true` entry in
`peerDependenciesMeta` and are deliberately not installed. They correspond to opt-in features
(Datadog and OpenTelemetry instrumentation, Braintrust eval reporting, and the `just-bash` and
`microsandbox` sandbox backends) that Milestone 1 does not use.

`node_modules/ai/package.json` declares one peer and **no** `peerDependenciesMeta`, so it is
required:

```json
"peerDependencies": { "zod": "^3.25.76 || ^4.1.8" }
```

`eve` also declares `engines.node: ">=24"` and `ai` declares `engines.node: ">=22"`. The
repository's Node 24.21.0 pin (ADR-0018) satisfies both, and `pnpm-workspace.yaml` sets
`engineStrict: true`, so an incompatible Node would fail the install.

### Compatibility finding: there is no eve-vs-ai conflict

`ai@7.0.107` satisfies `eve@0.63.0`'s `ai: "^7.0.105"` peer range. The current `ai` release is
also the eve-compatible one, so ADR-0024's tie-breaker (eve-compatible `ai` wins for the eve
adapter) did not have to be exercised. This was the main open question going into the task and it
resolved cleanly.

### `ai` is on eve's public type surface

The task asked whether `@internal/runtime-eve` must declare `ai` itself, or whether reaching it
transitively through `eve` would do. The installed types answer it: 109 of eve's shipped `.d.ts`
files import from `"ai"`, including files reachable through public export subpaths. Two concrete
citations:

- `node_modules/eve/dist/src/public/models/openai/index.d.ts` line 1 is
  `import type { LanguageModel } from "ai";`, and both `chatgpt()` and `openai()` are declared to
  return `LanguageModel`.
- `node_modules/eve/dist/src/shared/agent-definition.d.ts` line 1 is
  `import type { CallSettings, LanguageModel } from "ai";`. That module backs
  `PublicAgentDefinition`, which is what the public `AgentDefinition` type aliases
  (`node_modules/eve/dist/src/public/definitions/agent.d.ts` line 17).

So `ai` is both a required peer and a type the eve adapter will handle directly. It is declared
as a direct `dependencies` entry of `@internal/runtime-eve`, not left transitive.

## 3. `eve` shipped docs inventory

`node_modules/eve/docs/` exists, as `docs/development/source-of-truth-protocol.md` §6 assumes.
Its `README.md` opens with "This folder is for app authors using eve as a framework" and states
"eve is in preview; the framework, APIs, documentation, and behavior may change before general
availability."

The directory holds 110 files (the page files plus a `meta.json` ordering file per
subdirectory). Grouped by area, with the entry point of each group:

| Area | Files | What it covers |
| --- | --- | --- |
| Entry points | `README.md`, `getting-started.mdx`, `meta.json` | Task-to-page index and the 20-step "read this first" order |
| Reference | `reference/agent-files.md`, `reference/cli.md`, `reference/typescript-api.md`, `reference/telemetry.md` | Filesystem discovery rules, every CLI command, the `define*` helper surface and import paths, telemetry fields |
| Concepts | `concepts/project-structure.mdx`, `state.md`, `context-control.md`, `sessions-runs-and-streaming.md`, `execution-model-and-durability.mdx`, `default-harness.md`, `built-in-tools.md`, `security-model.md` | The durable runtime model, session state, what the model sees |
| Agent config | `agent-config.md`, `instructions.mdx`, `skills.mdx`, `extensions.md`, `install-integrations.mdx`, `responsible-use.md` | `defineAgent` settings, instructions, skills, extension packaging |
| Tools | `tools/overview.mdx`, `tools/human-in-the-loop.md`, `tools/workflows.mdx` | `defineTool`, approvals and mid-turn questions, `defineWorkflowTool` |
| Subagents / schedules / sandbox | `subagents/index.mdx`, `schedules.mdx`, `sandbox.mdx` | Delegation, recurring jobs, isolated execution |
| Connections | `connections/overview.mdx`, `connections/mcp.mdx`, `connections/openapi.mdx` | External HTTP and MCP integrations |
| Channels | `channels/overview.mdx`, `channels/custom.mdx` plus 12 platform pages (slack, discord, teams, telegram, twilio, github, linear, linq, photon, chat-sdk, mcp, eve) | Messaging surfaces |
| Memory | `memory/overview.mdx`, `memory/file.md`, `memory/custom-provider.md` | Memory providers and scopes |
| Evals | `evals/overview.mdx`, `assertions.mdx`, `cases.mdx`, `judge.mdx`, `reporters.mdx`, `running.mdx`, `targets.mdx` | `defineEval`, assertions, judges, reporters |
| Guides | 29 files under `guides/` including `auth-and-route-protection.md`, `session-context.md`, `hooks.md`, `dynamic-capabilities.md`, `evaluate.md`, `remote-agents.md`, `dev-tui.md`, `deployment/*`, `frontend/*`, `client/*`, `instrumentation/*` | Operational and frontend integration guidance |
| Patterns | `patterns/durable-cross-channel-notifications.md`, `dynamic-scheduling.md`, `multi-tenant-approvals.md`, `multi-tenant-auth.md`, `multi-tenant-memory.md` | Worked multi-tenant and durability patterns |
| Protocols | `protocols/acp.md`, `protocols/ucp.mdx` | Agent/universal connection protocol surfaces |
| Tutorial | 10 files under `tutorial/` starting at `first-agent.mdx` | End-to-end walkthrough |

The pages read in full for this task were `docs/README.md`, `docs/reference/typescript-api.md`
and `docs/reference/cli.md`. The rest are inventoried, not read; M1-T2 and M1-T6 read the ones
they need.

### The authored filesystem shape

`docs/README.md` ("The public mental model") states the slots M1-T2 will scaffold: instructions in
`instructions.md` or `instructions.ts`, procedures in `skills/`, typed integrations in `tools/`,
MCP servers in `connections/`, the sandbox override in `sandbox/`, messaging in `channels/`,
shared authored code in `lib/`, child agents in `subagents/`, recurring jobs in `schedules/`, and
additive runtime config in `agent.ts`. This matches the structure the build plan's M1-T2 asks for.

## 4. `eve` public export map

`node_modules/eve/package.json` declares 79 export entries. `docs/reference/typescript-api.md`
states the governing rule directly: "The package's export map defines the full contract; source
files that are not reachable through an exported package subpath are framework internals."

Public subpaths, grouped:

- Root and authoring: `.`, `./tools`, `./skills`, `./instructions`, `./connections`, `./context`,
  `./hooks`, `./schedules`, `./memory`, `./memory/scope`, `./memory/file`, `./memory/file/vercel`.
- Built-in tool definitions: `./tools/bash`, `./tools/read_file`, `./tools/write_file`,
  `./tools/todo`, `./tools/web_fetch`, `./tools/web_search`, `./tools/load_skill`, `./tools/glob`,
  `./tools/grep`, `./tools/sleep`, `./tools/agent`, `./tools/agent-router`,
  `./tools/ask_question`, `./tools/connection_search`, `./tools/task_cancel`, `./tools/approval`,
  `./tools/workflow`, `./workflow-modules`.
- Models and evaluation: `./models`, `./models/openai`, `./models/anthropic`, `./ai`, `./evals`,
  `./evals/expect`, `./evals/loaders`, `./evals/reporters`.
- Sandboxes: `./sandbox`, `./sandbox/docker`, `./sandbox/just-bash`, `./sandbox/microsandbox`,
  `./sandbox/vercel`.
- Channels: `./channels` plus `./channels/{auth,eve,mcp,slack,discord,teams,telegram,twilio,github,linear,linq,photon,chat-sdk}`.
- Clients and frameworks: `./client`, `./react`, `./vue`, `./svelte`, `./next`, `./nuxt`,
  `./sveltekit`, `./vercel`, `./local-dev`, `./agents/auth`.
- Instrumentation and extension: `./instrumentation`, `./instrumentation/otel`, `./extension`,
  `./setup`, `./setup/scaffold`, `./self-modification`, `./self-modification/agent`,
  `./self-modification/config`, `./self-modification/sandbox`.
- Manifest: `./package.json` (which is what the version-assertion tests resolve).

**Off limits:** `./internal/workflow-step-execution` and `./internal/programmatic-source-loader`.
They are exported, but named `internal`; AGENTS.md rule 6 and the source-of-truth protocol §2
forbid reaching into package internals, so the harness must not import either.

The `.` entrypoint's declaration file is one line, `export * from "#public/index.js"`, resolved
through eve's own `imports` map (`"#*.js"` to `./dist/src/*.js`). The concrete public root
surface is therefore `node_modules/eve/dist/src/public/index.d.ts`, which exports `defineAgent`,
`defineDynamic`, `defineRemoteAgent`, `defineWorkspaceAgent`, and the agent-config types
`AgentDefinition`, `AgentModelDefinition`, `AgentLimitsDefinition`, `AgentReasoningDefinition`,
`AgentCompactionDefinition`, `AgentExperimentalDefinition`, `AgentWorkflowDefinition` and
related.

`@internal/runtime-eve/src/index.ts` re-exports `AgentDefinition` as `EveAgentDefinition`. That is
the smoke surface: it proves the documented root entrypoint resolves and typechecks from the
adapter package. It is not the adapter.

## 5. `eve` CLI

`node_modules/eve/package.json` declares `"bin": { "eve": "./bin/eve.js" }`.
`docs/reference/cli.md` documents these commands: `eve`, `eve init`, `eve info`, `eve build`,
`eve start`, `eve dev`, `eve invoke`, `eve logs`, `eve traces`, `eve link`, `eve deploy`,
`eve eval`, `eve channels list`, `eve extension init`, `eve extension build`, plus model-settings
and registry-item subcommands.

**There is no `eve check` command.** A grep for `eve check` across all 110 shipped doc files
returns only prose sentences ("eve checks that team's AI Gateway access ..."). AGENTS.md and
`current-state.md` mention `eve check` as a possible framework verification command; on 0.63.0 the
equivalent is `eve info`, described as "Run this first when something behaves unexpectedly. It
confirms a file was discovered, lists the active surface, and surfaces discovery diagnostics".

**`eve info` cannot run yet**, and that is the expected result. From `packages/runtime-eve`:

```text
$ pnpm --filter @internal/runtime-eve exec eve info
☰eve  v0.63.0
Invalid eve project at .../packages/runtime-eve: found no agent files.
```

The CLI needs an authored `agent/` directory, which M1-T2 creates. It was not forced. The command
did confirm that the installed binary runs and reports version 0.63.0.

## 6. AI SDK public export map and types

`node_modules/ai/package.json` declares four export entries only:

```json
{
  "./package.json": "./package.json",
  ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js", "default": "./dist/index.js" },
  "./internal": { "types": "./dist/internal/index.d.ts", "...": "..." },
  "./test": { "types": "./dist/test/index.d.ts", "...": "..." }
}
```

`ai/internal` is off limits for the same reason eve's `./internal/*` subpaths are. `ai/test` is a
legitimate public testing surface (documented at `docs/03-ai-sdk-core/55-testing.mdx`) and is the
natural home for the fake model M1-T5's tests will need, but M1-T1 does not use it.

The entire non-test public surface lives behind `.`, declared in
`node_modules/ai/dist/index.d.ts`. The exports relevant to a future `AgentRuntime`, all taken from
the declaration file's final `export { ... }` statement and its three re-export statements:

| Export | Kind | Notes |
| --- | --- | --- |
| `generateText` | function | Declared at `dist/index.d.ts:4858`. Single non-streaming call. |
| `streamText` | function | Declared at `dist/index.d.ts:3495`. Streaming equivalent. |
| `ToolLoopAgent` | class | The agent loop. Also re-exported under the alias `Experimental_Agent`. |
| `ToolLoopAgentSettings` | type | Its settings; aliased `Experimental_AgentSettings`. |
| `Agent`, `AgentCallParameters`, `AgentStreamParameters` | types | The non-experimental agent-shaped types. |
| `LanguageModel`, `CallSettings`, `ModelMessage`, `Prompt`, `StepResult`, `StopCondition` | types | The model-call vocabulary the adapter boundary will translate. |
| `tool`, `dynamicTool`, `ToolSet`, `Tool`, `ToolExecutionOptions`, `InferToolInput`, `InferToolOutput` | functions and types | Re-exported from `@ai-sdk/provider-utils`. |
| `gateway`, `createGateway`, `GatewayModelId` | value and types | Re-exported from `@ai-sdk/gateway`. |
| `stepCountIs`, `hasToolCall`, `isStepCount` | functions | Loop stop conditions. |
| `AISDKError`, `APICallError`, `NoSuchToolError`, `InvalidToolInputError`, `RetryError`, and the rest | error classes | Partly re-exported from `@ai-sdk/provider`. Relevant to M1-T8's error taxonomy. |

Two naming points worth carrying into M1-T5, because they are easy to get wrong from memory:

1. The class is `ToolLoopAgent`, not `Agent`. `Agent` is a *type* in 7.0.107. The alias
   `Experimental_Agent` points at `ToolLoopAgent`.
2. Per AGENTS.md's source-of-truth protocol §8 ("never expose an experimental API name in the
   harness public API"), the harness must use `ToolLoopAgent` rather than the
   `Experimental_*` aliases if it uses the class at all.

### The gateway default

`node_modules/ai/README.md` states: "By default, the AI SDK uses the Vercel AI Gateway to give you
access to all major providers out of the box. Just pass a model string for any supported model",
with the example `model: 'anthropic/claude-opus-4.6'`.
`node_modules/ai/docs/02-getting-started/00-choosing-a-provider.mdx` adds that the gateway
authenticates with OIDC or an `AI_GATEWAY_API_KEY` environment variable.

`@ai-sdk/gateway` is a direct `dependencies` entry of `ai`, so the gateway path needs **no**
additional install. This is why M1-T1 declares no `@ai-sdk/*` provider package: the built-in
gateway path is available with `ai` alone, and choosing a direct provider is M1-T5's decision, not
this task's.

`@internal/runtime-ai-sdk/src/index.ts` re-exports `LanguageModel` as `AiSdkLanguageModel` as its
smoke surface, for the same reason the eve adapter re-exports `AgentDefinition`.

## 7. AI SDK shipped docs

`ai` ships a `docs/` directory (`"directories": { "doc": "./docs" }`), 100+ `.mdx` files mirroring
the published documentation site. The groups most relevant to M1: `03-agents/` (overview, building
agents, workflows, loop control, call options, tool approvals, subagents),
`03-ai-sdk-core/` (generating text, structured data, tools and tool calling, runtime and tool
context, settings, error handling, testing, telemetry), and `02-foundations/`.

**A caveat that matters.** The shipped `.mdx` files are un-substituted templates: 82 of them
contain literal `__PROVIDER_IMPORT__` and `__MODEL__` placeholders where the published site
injects a provider. For example `docs/03-agents/02-building-agents.mdx` shows

```ts
import { ToolLoopAgent } from 'ai';
__PROVIDER_IMPORT__;

const myAgent = new ToolLoopAgent({ model: __MODEL__, ... });
```

The prose and API names in these files are authoritative for 7.0.107; the model argument in their
examples is not a literal. Read the model shape from the declaration file, not from the example.

## 8. Not documented, or harness-owned

Per the source-of-truth protocol §11, recorded rather than guessed:

- **Nothing in `eve` or `ai` provides the harness's own contracts.** `Job`, `defineDomain()`,
  `createHarness()`, `ExecutionContext`, `CapabilityRegistry`, the trace schema, the workflow IR
  and the promotion policy are harness-owned by ADR-0001 and the build plan's responsibility
  matrix. Neither package was searched for an equivalent because neither claims to provide one.
- **The `AgentRuntime` boundary is harness-owned.** `ai` provides `ToolLoopAgent`,
  `generateText` and `streamText`; `eve` provides `defineAgent` and a durable session runtime.
  Neither exposes a swappable runtime interface of the shape ADR-0003 requires, so M1-T5 designs
  it and M1-T6 adapts `eve` onto it.
- **`eve check` does not exist** (section 5). Wherever the repository's own docs imply a framework
  verification command named `eve check`, the 0.63.0 equivalent is `eve info`.
- **Whether `eve` can be driven programmatically without the CLI is not yet established.** The
  shipped docs describe a filesystem-first authoring model plus `eve dev`/`eve build`/`eve start`.
  `eve/client` (`Client`, `ClientSession`) is the documented programmatic surface, and
  `docs/guides/client/overview.mdx` is the page to read. M1-T6 must read it before designing
  `EveAgentRuntime`; M1-T1 deliberately did not guess.
- **The five optional eve peers are not installed.** If a later milestone wants OpenTelemetry
  export, Braintrust eval reporting, or the `just-bash`/`microsandbox` sandbox backends, that is
  an explicit install task under ADR-0024, not an implicit one.

## 9. What contradicted prior expectations

- The repository's own `current-state.md` recorded `eve` 0.63.0 as "observed 2026-09-19 (registry
  error message, not yet verified as the version to use)". It is confirmed as the current version
  and it installs cleanly on Node 24.21.0.
- `AGENTS.md` and `current-state.md` both reference `eve check`. That command does not exist in
  0.63.0 (section 5). This is the one genuine docs-vs-installed-package discrepancy found, and it
  is resolved in favour of the installed package.
- `ai`'s agent class is `ToolLoopAgent`, not `Agent`. Anyone writing M1-T5 from recollection of an
  earlier AI SDK 5/6 preview would get this wrong.
- The AI SDK's shipped docs contain unresolved template placeholders (section 7), so they are less
  copy-pasteable than the published site. The declaration file is the better source for shapes.
