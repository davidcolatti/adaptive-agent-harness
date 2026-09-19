---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/development/source-of-truth-protocol.md
  - docs/research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md
  - docs/decisions/0025-application-packages-may-author-eve-agents-directly.md
  - docs/decisions/0024-framework-dependency-versioning-policy.md
  - docs/milestones/m1-local-agent-and-public-harness-boundary.md
implementation:
  - apps/example-agent
---

# M1-T2: scaffolding a real `eve` project inside the workspace

What the installed `eve` 0.63.0 actually required of an authored project, verified by building
one: `apps/example-agent`, the neutral vendor-triage example. Every claim below is either a quoted
line from a file under the installed `eve` package or the observed output of a command run against
this repository on 2026-09-19.

This note records findings, not architecture. The architecture decision it forced is
[ADR-0025](../../decisions/0025-application-packages-may-author-eve-agents-directly.md). The
prior survey of the same package is
[`2026-09-19-m1-eve-ai-sdk-install-survey.md`](2026-09-19-m1-eve-ai-sdk-install-survey.md); this
note does not repeat it.

Resolve the installed package before re-running anything here (pnpm isolates packages, so
`node_modules/eve` is not a directory):

```sh
EVE=$(dirname "$(node -e "console.log(require.resolve('eve/package.json', { paths: ['packages/runtime-eve'] }))")")
```

## 1. The authored layout, as the installed docs define it

`eve/docs/reference/agent-files.md` ("Agent directory layout") lists the slots under the agent
directory: `agent.ts`, `instructions.md` / `instructions.ts` / `instructions/`, `instrumentation/`,
`channels/`, `connections/`, `extensions/`, `hooks/`, `skills/`, `lib/`, `memory/`, `sandbox/`,
`tools/`, `schedules/`, `subagents/`. "Add only the files you need."

`eve/docs/concepts/project-structure.mdx` states that a single-agent project puts one root agent in
`agent/`, beside the package's own `package.json`, and keeps agent-only helpers in `agent/lib/`.

**This matches the build plan's assumption exactly.** Build plan §4 asks for
`apps/example-agent/agent/{agent.ts, instructions.md, skills/, tools/, lib/}`, and that is a valid
subset of eve's documented slots. No deviation was needed.

Two secondary points the docs settle, worth recording because they are easy to guess wrong:

- **A flat layout also exists.** `agent-files.md` ("Flat layout") documents agent files directly in
  the app root without an `agent/` directory. The nested layout was chosen because
  `project-structure.mdx` recommends it ("Prefer the nested layouts ... to keep application files
  separate from agent definitions") and because it is what the build plan specifies. `eve info`
  reports `Layout  nested`, confirming which one was detected.
- **Evals live beside `agent/`, not inside it** (`agent-files.md`). M1 has no evals yet; when they
  arrive they belong at `apps/example-agent/evals/`, not under `agent/`.

## 2. Identity comes from the filesystem

`eve/docs/reference/typescript-api.md` states it as a rule: "Identity comes from the filesystem,
not a field you set. A tool at `agent/tools/get_weather.ts` is `get_weather` ... so no definition
carries a `name` or `id`." `agent-files.md` ("Naming from paths") gives the same mapping for
connections (`agent/connections/linear.ts` → `linear`) and skills (`agent/skills/summarize.md` →
`summarize`).

For the agent itself: "A standalone root agent uses its package name (without an npm scope), or its
app directory name when no name is set." The package is `@internal/example-agent`, so the agent
name is `example-agent` either way.

Consequence for this repository: the tool file is named `lookup_vendor_evidence.ts` because that
underscore-cased slug is the name the model sees. Renaming the file renames the tool.

## 3. The `define*` surface actually used

Verified against the shipped declaration files, not the prose:

| Helper | Import path | Declaration inspected |
| --- | --- | --- |
| `defineAgent` | `eve` | `$EVE/dist/src/public/index.d.ts`, then `dist/src/public/definitions/agent.d.ts` |
| `defineTool` | `eve/tools` | `$EVE/dist/src/public/tools/index.d.ts`, then `dist/src/tools/definition.d.ts` |
| `disableTool` | `eve/tools` | same index |
| `never` (approval policy) | `eve/tools/approval` | `$EVE/dist/src/public/tools/approval/index.d.ts`, which exports `always`, `auto`, `never`, `once` |

`defineTool` has two overloads. The first requires `outputSchema` to be a `StandardJSONSchemaV1`;
the second makes `outputSchema` an optional plain JSON Schema object and infers the output type
from the `execute` return. The example uses the second, so the tool's output type comes from the
pure `lib/` function rather than from a duplicated schema. `eve/docs/tools/overview.mdx` documents
`outputSchema` as optional ("When a tool returns structured data, add an optional `outputSchema`").

`defineAgent`'s `model` field: `dist/src/shared/agent-definition.d.ts:54` declares
`PublicAgentStaticModelDefinition = string | LanguageModel`, and `eve/docs/agent-config.md` says
`model` accepts "a gateway model id string, which routes through the Vercel AI Gateway", or a
provider-authored `LanguageModel`. `agent-config.md` also states that `agent.ts` is optional but
`model` becomes **required** once the file exists, and that eve's own default for a scaffolded
project is `openai/gpt-5.6-luna-fast`.

## 4. There is no read-only or side-effect flag on a tool

This was the one question the installed package does not answer the way the task assumed.
`dist/src/tools/definition.d.ts` declares the complete authored tool shape, and its fields are:
`description`, `inputSchema`, `outputSchema?`, `execute`, `label?`, `approval?`, `approvalKey?`,
`toModelOutput?`, `availableInSubagents?`, `execution?`. **There is no `readOnly`, no `sideEffects`,
and no permission field.**

The nearest documented mechanism is the per-tool approval policy
(`eve/docs/tools/overview.mdx`, "Gate a tool on human approval"), which expresses whether a human
must sign off, not whether the tool mutates anything. eve's own `docs/README.md` puts the
responsibility on the deployer: "Require human approval or other safeguards for sensitive,
irreversible, regulated ... or external side-effecting actions."

So "read-only" is a harness-owned property here, per the source-of-truth protocol §11. The example
expresses it three ways, none of which is a framework guarantee:

1. `approval: never()` on the tool, which is the documented way to state that no sign-off is
   needed;
2. a doc comment on the tool module saying what it does and does not touch;
3. the implementation living in a pure module (`agent/lib/vendor-evidence.ts`) that imports only
   frozen data, with a unit test that exercises it directly.

The third is the only one with teeth, and it is the reason the tool is a two-line wrapper over a
`lib/` function rather than a self-contained module. A future milestone that needs machine-readable
tool permissions (M1-T9's `CapabilityManifest` is the likely place) will have to define them in the
harness; eve does not supply them.

## 5. Relative imports need the `.js` extension, and eve accepts it

eve's own examples show extensionless relative imports (`import { buildInstructionsPrompt } from
"./lib/prompts";` in `eve/docs/instructions.mdx`). This repository typechecks with
`module: nodenext` (`packages/config/tsconfig.base.json`), under which TypeScript requires the
`.js` extension on a relative ESM import.

**Verified: eve's compiler resolves `./vendor-evidence.js` to the TypeScript source.** The authored
files use `.js` extensions throughout, `tsc --noEmit` passes, and `eve info` reports
`Diagnostics  0 errors, 0 warnings` with the tool discovered. No `moduleResolution: bundler`
override was needed, so the example agent typechecks under the same language baseline as every
other package in the repository.

## 6. eve's optional default tools include live web access

`eve info` on the first scaffold reported **11 tools** for an agent that authors exactly one. The
other ten are eve's defaults. `eve/docs/concepts/built-in-tools.md` lists them and states the
override rule: "Each default occupies the same `agent/tools/<name>.ts` slot you would author
yourself, so an authored definition replaces it and `disableTool()` removes it."

Two of those defaults were `web_search` and `web_fetch`, which give the agent live web research.
That contradicts the milestone's own instruction for this fixture domain: "Use deterministic local
fixture tools before adding live web research" (build plan, Milestone 1, Neutral Reference Job).

The fix is the documented one, applied per tool:

```ts title="agent/tools/web_search.ts"
import { disableTool } from "eve/tools";

export default disableTool();
```

`defineAgent({ defaultTools: false })` is also documented, and was **not** used: it removes every
optional default, including `load_skill`, which this agent's skill needs in order to be loadable at
all. Two one-line files are the narrower instrument.

> **Superseded by M1-T6 (2026-09-19).** The trade was re-made once there was a runtime to run the
> agent, and it went the other way. `apps/example-agent/agent/agent.ts` now sets
> `defaultTools: false`, `agent/tools/load_skill.ts` re-adds the one default the skill needs with
> the documented one-line re-export (`export { default } from "eve/tools/load_skill";`), and the
> two `disableTool()` files are gone as redundant. `eve info --json` reports exactly two tools,
> `load_skill` and `lookup_vendor_evidence`. The paragraph below anticipated the reason and named
> the wrong worry: the decisive tool is not `bash` but `agent`, because a model calling it spawns
> a second full copy of the agent in its own durable session, on a different event stream, whose
> usage and tool calls `EveAgentRuntime`'s accounting would never see. See ADR-0028 and
> `docs/architecture/runtime.md`.

After the change, `eve info` reports 9 tools: `bash`, `read_file`, `write_file`, `todo`,
`load_skill`, `ask_question`, `task_cancel`, `agent`, and the authored
`lookup_vendor_evidence`.

Recorded for later: `bash`, `read_file` and `write_file` still operate on eve's sandbox, and
`agent` delegates to a fresh copy of the root agent. None of them reaches the network, but none of
them is deterministic either. Whether the harness wants a domain running with eve's default tool
set at all is a real question for M1-T6 and for M1-T9's capability manifest; it is not settled
here, and nothing was assumed about it.

## 7. Commands that were run, and what they produced

`eve info`, from `apps/example-agent` (repository root path elided):

```text
☰eve  v0.63.0
Application
App Root      <repo>/apps/example-agent
Agent Root    <repo>/apps/example-agent/agent
Layout        nested
Compile       ready
Diagnostics   0 errors, 0 warnings
Instructions  instructions.md (system)
Skills        1 skill
Tools         9 tools
Subagents     0 subagents
Schedules     0 schedules

Artifacts
Compiled Manifest   <repo>/apps/example-agent/.eve/compile/compiled-agent-manifest.json
Discovery Manifest  <repo>/apps/example-agent/.eve/discovery/agent-discovery-manifest.json
Diagnostics         <repo>/apps/example-agent/.eve/discovery/diagnostics.json
Module Map          <repo>/apps/example-agent/.eve/compile/module-map.mjs
Metadata            <repo>/apps/example-agent/.eve/compile/compile-metadata.json
Workflow Build      <repo>/node_modules/.pnpm/eve@0.63.0_ai@7.0.107_zod@4.6.5_/node_modules/eve/.eve/workflow-cache/4194dfb53951
Output              <repo>/apps/example-agent/.output

Instructions
Instructions  instructions.md (system)

Messaging
Workflow ID  workflow//eve//workflowEntry
Source Dir   <repo>/node_modules/.pnpm/eve@0.63.0_ai@7.0.107_zod@4.6.5_/node_modules/eve/dist/src/execution
Create       POST /eve/v1/session
Messages     POST /eve/v1/session/:sessionId
Stream       GET /eve/v1/session/:sessionId/stream
```

`eve info --json` is the machine-readable form. Its top-level keys are `appRoot`, `agentRoot`,
`layout`, `status`, `diagnostics`, `model`, `instructions`, `skills`, `tools`, `subagents`,
`schedules`, `channels`, `messaging`, `artifacts`. It reports `status: "ready"`,
`model: "openai/gpt-5.6-luna-fast"`, `skills: ["triage-vendor"]`, and the nine tools above. The
plain-text form does **not** print tool or skill names, so `--json` is the one to use when
verifying that a specific capability was discovered.

`eve build` succeeded offline with no credential configured, exit 0, producing a nitro server
bundle at `apps/example-agent/.output` (10.1 MB, 2.31 MB gzipped; `eve+zod.mjs` is 7.47 MB of it).
Scratch directories under `.eve/builds/` are removed after each run, as
`eve/docs/reference/cli.md` describes.

**No model was called.** Neither command contacts a provider, which is why both run in a repository
with no `AI_GATEWAY_API_KEY`.

## 8. Artifacts eve writes into the project

Running `eve info` or `eve build` creates two directories inside the app that are not source:

- `.eve/` — `agent-summary.json`, `builds/`, `cache/`, `compile/`, `discovery/`, `locks/`.
- `.output/` — the built nitro server.

Both are now in `.gitignore`. Biome honours `.gitignore` (`vcs.useIgnoreFile: true`), so neither is
linted or formatted. They are also outside every `include` in the app's `tsconfig.json`, and
`.eve/builds/` holds no `.test.ts` file, so Vitest does not collect anything from them (verified;
the unit project's exclude list covers `dist` and `.turbo`, not `.eve`, so this was checked rather
than assumed).

## 9. Open questions this task deliberately did not answer

Per the no-assumption stop condition, recorded rather than guessed:

- **How to run the agent programmatically is still unestablished**, exactly as M1-T1 left it.
  `eve/client` (`Client`, `ClientSession`) is the documented programmatic surface and
  `eve/docs/guides/client/overview.mdx` is the page to read. M1-T2 did not read it, because
  nothing in this task executes the agent.
- **`eve` has no documented non-interactive local run command that works without a model
  credential.** `eve dev` opens the terminal UI, `eve start` serves a built `.output/`, and
  `eve invoke` sends a message; all of them reach a model. That is why no `example:run` script
  exists yet; that acceptance criterion belongs to M1-T4, after `createHarness()`.
- **Whether a tool's `execute` can run outside eve's runtime context is untested.** The `ctx`
  parameter is documented as "live only while authored code is running, so reaching for it at
  module top level throws" (`eve/docs/reference/typescript-api.md`). The example's tool ignores
  `ctx` entirely, so the question did not arise; a harness that wants to call an eve tool directly
  will have to answer it.
- **What model configuration the harness should impose is unsettled.** The example reads
  `EXAMPLE_AGENT_MODEL` with eve's own default as a fallback. Whether the harness selects the model
  instead of the domain is an M1-T4/M1-T6 decision.
