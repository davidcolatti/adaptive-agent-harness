# Worked examples

## `apps/example-agent` — the vendor-triage example agent

The repository's first worked example, created by M1-T2. It lives at
[`apps/example-agent`](../../apps/example-agent) and is a real `eve` project: what a consuming
domain repository would write, not a harness-flavoured imitation of one.

It is the neutral reference job Milestone 1 specifies. Given a vendor name, vendor evidence text
and a procurement SOP, it produces a category, risk flags, missing information, a recommendation,
and the evidence each rests on. The domain was chosen for being repetitive, structured, and
research-like while staying uncoupled from any future real domain.

### What is in it

| Path | What it holds |
| --- | --- |
| `agent/agent.ts` | `defineAgent` with `defaultTools: false` and an AI Gateway model id, read from `EXAMPLE_AGENT_MODEL` with eve's own default as the fallback. |
| `agent/instructions.md` | The system prompt: the five outputs, and the rule that absence of evidence is missing information rather than a pass. |
| `agent/skills/triage-vendor.md` | A load-on-demand procedure for working the SOP as a checklist. The model pulls it in with `load_skill` when a request calls for it. |
| `agent/tools/lookup_vendor_evidence.ts` | The single read-only fixture tool. Its model-facing name is the filename slug. |
| `agent/tools/load_skill.ts` | A one-line re-export restoring eve's framework `load_skill`, the one optional default this agent needs, after `defaultTools: false` removed all eight. |
| `agent/lib/vendor-fixtures.ts` | Three fictional vendors and their frozen evidence documents. |
| `agent/lib/vendor-evidence.ts` | The pure lookup the tool calls, plus its unit test. |
| `src/domain/schemas.ts` | The `zod` input and output schemas, field names matching the instructions. |
| `src/domain/procurement-sop.ts` | The invented SOP the fixture evals triage against. |
| `src/domain/index.ts` | The `defineDomain()` call: `vendorTriage`, with its job factory and two fixture evals. |
| `src/capabilities.ts` | The capability registrations: both schemas, the agent, the tool, the handler and the policy. |
| `src/handlers/detect-payment-detail-change.ts` | The deterministic handler: an unverified banking-detail change, found by a pure function. |
| `src/policies/no-proceed-with-open-risk-flags.ts` | The policy: no unconditional `proceed` while a risk flag is open. |
| `src/run.ts` | The `pnpm example:run` entrypoint: start an eve server, build an `EveAgentRuntime`, run the domain through `createHarness()`, print the result. |
| `src/dependency-pins.test.ts` | ADR-0024's installed-version assertion for `eve`, `ai` and `zod`. |

### The two halves, and the line between them

`agent/` is authored for `eve`. `src/domain/` is authored for the harness.
**Neither imports the other's framework**: nothing under `agent/` imports
`@internal/core`, and nothing under `src/domain/` imports `eve`. That is what a
real consuming domain repository looks like under
[ADR-0025](../decisions/0025-application-packages-may-author-eve-agents-directly.md):
it authors an agent the normal way and runs it through the harness API.

`eve` compiles only `agent/`, so `src/` is invisible to it. `eve info` reports
1 skill and **2 tools**: `lookup_vendor_evidence` and `load_skill`. It reported
nine until M1-T6 set `defaultTools: false`, which removed `bash`, `read_file`,
`write_file`, `todo`, `ask_question`, `task_cancel` and `agent` along with the
two web tools M1-T2 had already disabled by file. `agent` is the one worth
naming: it is enabled by default even with no subagent declared, and a model
calling it spawns a second full copy of this agent in its own durable session,
whose usage and tool calls `EveAgentRuntime` would never see.

### The domain definition

`src/domain/index.ts` exports `vendorTriage`, built by `defineDomain()` (M1-T3):

```ts
export const vendorTriage = defineDomain({
  id: "vendor-triage",
  version: "1.0.0",
  inputSchema: vendorTriageInputSchema,
  outputSchema: vendorTriageOutputSchema,
  createJob,
  evals: [/* two fixture cases */],
});
```

The schemas are plain `zod`. The harness never sees `zod`: `@internal/core`
declares the Standard Schema shape structurally, so a `zod` schema satisfies
`Schema<T>` with no adapter ([ADR-0027](../decisions/0027-standard-schema-is-the-harness-schema-contract.md)).
The contract details are in
[`docs/contracts/domain-definition.md`](../contracts/domain-definition.md).

`createJob` produces a `vendor-triage` job with an objective naming the vendor,
the three string contract references, a budget of 8 model calls, 8 tool calls
and 120 seconds, and two `read` permissions, `lookup_vendor_evidence` and
`load_skill`, matching exactly the two tools `eve info --json` reports. The
second is a framework tool rather than an authored one: it adds no execution
surface by itself, and it is the only way the model can pull the on-demand
`agent/skills/triage-vendor.md` into a turn. `EveAgentRuntime` checks a grant
by tool name when the model asks, so an ungranted tool fails the run closed.

The two evals are built from the fixture vendors: `Northwind Ledger`, which is
well documented and should not be escalated, and `Cobalt Harbor Logistics`,
whose unverified banking-detail change must raise a risk flag and must not be
waved through. **Nothing runs them yet**; M6 owns evals.

`src/domain/domain.test.ts` validates real inputs and outputs through
`validateWith()`, including an output that invents a decision the SOP does not
allow. That is the schema-level form of Milestone 1's "one intentionally invalid
output fails closed"; the end-to-end form is in `src/domain/harness.test.ts`,
below.

Everything is deterministic and offline. The milestone's instruction is to use local fixture tools
before adding live web research, so the fixture data is the whole evidence universe, and
`defaultTools: false` is what makes that true rather than merely requested: with `web_search` and
`web_fetch` gone there is no live source to reach.

The three fixture vendors differ on purpose, so the agent has something to triage: one is well
documented, one has real gaps, and one carries an obvious payment-change risk flag. All three are
invented, and every website is a reserved `.example` domain.

### Running it through the harness

`src/domain/harness.test.ts` runs the real domain end to end through
[`createHarness()`](../contracts/harness.md) with `createFakeAgentRuntime()` standing in for
`EveAgentRuntime`:

```ts
const harness = createHarness({ agentRuntime, trace });
const result = await harness.run({ domain: vendorTriage, input });
```

The harness validates the input against `vendorTriage.inputSchema`, calls
`vendorTriage.createJob(input)`, hands the job and an `ExecutionContext` to the
[`AgentRuntime`](../contracts/agent-runtime.md), and re-validates the returned output against
`vendorTriage.outputSchema` before returning it. The test covers a valid Northwind Ledger output
completing, an output that invents a decision the SOP does not allow failing closed with
`code: "VALIDATION"` and no `output` field, and an invalid input throwing before the runtime is
reached. It makes no model call and reads no credential.

That is Milestone 1's "a fake `AgentRuntime` can replace `EveAgentRuntime` in a unit test"
applied to the real domain, and the end-to-end form of "one intentionally invalid output fails
closed".

### The capability manifest

`src/capabilities.ts` registers the five kinds M1-T9 requires, in the order registration demands
(schemas first, because a capability naming a schema reference is rejected unless that schema is
already registered):

| Kind | Reference | Value held at runtime |
| --- | --- | --- |
| `schema` | `vendor-triage.input@1.0.0` | the `zod` input schema |
| `schema` | `vendor-triage.output@1.0.0` | the `zod` output schema |
| `agent` | `vendor-triage-agent@1.0.0` | a plain descriptor naming the authored `eve` files |
| `tool` | `lookup_vendor_evidence@1.0.0` | the pure `lookupVendorEvidence` function |
| `handler` | `detect-payment-detail-change@1.0.0` | a pure detector over the fixture evidence |
| `policy` | `no-proceed-with-open-risk-flags@1.0.0` | a pure threshold over a `VendorTriageOutput` |

`vendorTriageManifest` is the serializable form. Its test asserts that it round-trips through
JSON, that every entry carries a module, an export name and a `sha256:` fingerprint, that
registering twice fails, and that the serialized string contains no `=>`, no `function`, and no
credential. The handler and the policy are the only two capabilities the registry *and* a future
compiled workflow can call directly; the agent entry is a descriptor precisely so that nothing
under `src/` has to import `eve`.

The two new pure modules are worth reading together, because they are the shape of the
optimization target `Full Agent -> ... -> Deterministic Code`:
`detectPaymentDetailChange` flags Cobalt Harbor Logistics and deliberately does **not** flag
Northwind Ledger or Tessellate Analytics, and `noProceedWithOpenRiskFlags` refuses only an
unconditional `proceed`, because the other three outcomes leave a human in the loop.

`procurement-sop`, which `Job.contracts.sop` names, is deliberately not registered: a SOP is
content, not an executable capability, and fingerprinting its content is M2-T8's work.

### Running it for real

`pnpm example:run` is the end-to-end demonstration M1-T6 added. It starts an `eve dev` server for
this app, points an [`EveAgentRuntime`](../architecture/runtime.md) at it, runs the domain through
`createHarness()`, prints the `HarnessRunResult` as JSON, stops the server, and exits non-zero
unless the run completed.

```sh
pnpm example:run        # this agent, a real Gateway model. Needs a credential.
pnpm example:run:mock   # apps/eve-fixture-agent, eve's mockModel. Needs none.
```

`pnpm example:run` needs `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`, because `agent/agent.ts`
names a Gateway model id. Without one it exits 1 and points at `.env.example`.

`pnpm example:run:mock` is the same script, the same domain, the same adapter and a real eve
server, pointed at [`apps/eve-fixture-agent`](../../apps/eve-fixture-agent) instead. Only the
model is scripted, so it needs no credential and reaches no provider. It is the command to run to
check that the harness path still works.

**What the mock run cannot tell you** is whether a real model produces a useful triage. Its output
is built from the domain's own output schema, so it is correctly shaped and says nothing.

### `apps/eve-fixture-agent` — the credential-free fixture

A second, much smaller eve project, added by M1-T6, whose model is eve's own `mockModel` with a
scripted responder. It exists so `EveAgentRuntime` has a real HTTP surface, a real durable session
and a real cancellable turn to be tested against with no model provider in the picture. Its two
tools are `echo_fixture`, which the fixture jobs grant, and `forbidden_tool`, which they
deliberately do not, so a contract test can watch a run fail closed on an ungranted tool.

It is a separate app root rather than a mode of this one because an eve app root is the nearest
enclosing `package.json`, and eve recognizes a project only once `eve` appears in its
dependencies. A fixture therefore cannot hide inside `packages/runtime-eve`.

### Running the discovery check

`eve info` confirms that eve discovered every authored file and reports its diagnostics. It needs
no model credential.

```sh
pnpm --filter @internal/example-agent run info
pnpm --filter @internal/example-agent exec eve info --json   # machine-readable; lists tool names
```

The plain-text form does not print individual tool or skill names, so use `--json` when checking
that one specific capability was discovered.

`eve` writes `.eve/` and `.output/` inside the app when these commands run. Both are git-ignored
build artifacts, not source.

### Where the details are recorded

- [ADR-0025](../decisions/0025-application-packages-may-author-eve-agents-directly.md): why an
  `apps/*` package may depend on `eve` at all, and which surfaces stay adapter-only for it.
- [`docs/research/vercel/2026-09-19-m1-eve-project-scaffold.md`](../research/vercel/2026-09-19-m1-eve-project-scaffold.md):
  what the installed `eve` 0.63.0 actually required, including the absence of any read-only flag on
  a tool definition and the exact `eve info` output.
- [`docs/architecture/runtime.md`](../architecture/runtime.md) and
  [ADR-0028](../decisions/0028-eve-agent-runtime-is-a-url-only-client-that-observes-the-eve-event-stream.md):
  how `EveAgentRuntime` runs this agent, what it enforces, and what it cannot yet enforce.
- [`docs/research/vercel/2026-09-19-m1-eve-programmatic-execution.md`](../research/vercel/2026-09-19-m1-eve-programmatic-execution.md):
  how a TypeScript caller drives an eve agent at all, verified against the installed version.
- [The Milestone 1 status file](../milestones/m1-local-agent-and-public-harness-boundary.md): the
  task list and acceptance criteria this example is measured against.
