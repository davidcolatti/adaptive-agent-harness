# Runbook: inspecting a run

How to read back what a run actually did, from durable evidence alone. Added by M2-T10; the design
is [ADR-0037](../decisions/0037-the-run-inspector-is-a-library-over-the-storage-port-with-a-parseargs-cli.md).

```text
pnpm harness run show <run-id>
```

It prints the run's job, route, timeline, model/tool/Jev calls, errors, result, cost and
fingerprints. It reads the `Storage` port or a local JSONL trace file, and nothing else: no log
file, no stdout capture, no running agent. That is the point rather than a limitation, and it is
what Milestone 2's "a trace reconstructs execution without application logs" means in practice.

## Where the run id comes from

`pnpm example:run` and `pnpm example:run:mock` print it twice on stderr when Supabase is
configured:

```text
Trace written to .../apps/eve-fixture-agent/.harness/traces/01a0bd00-3903-7001-9ee5-c9d68f7ecb3b.jsonl
Run row written to http://127.0.0.1:54321 as runs.id = 01a0bd00-3903-7001-9ee5-c9d68f7ecb3b
```

The JSONL filename **is** the run id, so `ls apps/*/.harness/traces/` lists every local run
newest last.

## Against Supabase

Start the stack and put its URL and key in the environment. `.env.local` is git-ignored and is
what [`supabase-local.md`](supabase-local.md) writes:

```bash
pnpm supabase:start
pnpm harness run show 01a0bd00-3903-7001-9ee5-c9d68f7ecb3b
```

`pnpm harness` loads `.env.local` itself, through Node 24's `--env-file-if-exists`, so there is
nothing to `source` first. Arguments are forwarded straight through; no `--` separator is needed.

## Against a JSONL trace, with no database

Every run writes `<app root>/.harness/traces/<run-id>.jsonl` whether or not Supabase is
configured. `--jsonl` reads it, and needs no credential, no Docker and no network:

```bash
pnpm harness run show 01a0bd00-3903-7001-9ee5-c9d68f7ecb3b \
  --jsonl apps/eve-fixture-agent/.harness/traces/01a0bd00-3903-7001-9ee5-c9d68f7ecb3b.jsonl
```

The output then carries `note: job and ledger row unavailable (trace-only source)` and its Job
section reads `(unavailable)`: a trace holds the run's narrative but not its job row or its
outcome row. Everything derivable from events — the timeline, the calls, the token totals, the
fingerprint and its component digests, and the run's status from its terminal event — is still
there. `--trace-file` is accepted as a synonym of `--jsonl`.

`--jsonl` wins over a configured store, so it also works while `.env.local` is present.

## Machine-readable output

`--json` prints the whole `RunInspection` as JSON, including the parts the text form abbreviates
(a job's full `input`, every event's untruncated summary):

```bash
pnpm harness run show <run-id> --json | jq '.cost'
pnpm harness run show <run-id> --json | jq -r '.timeline[] | "\(.sequence)\t\(.type)\t\(.latencyMs)"'
```

Turbo's build output goes to stderr, so stdout carries the JSON alone and the pipe is clean.

## Colour

ANSI colour is on only when stdout is a terminal. `--color` forces it on and `--no-color` forces
it off, which is what you want when writing the output to a file or into an issue.

## Sample output

Abridged; a real run prints every section in full.

```text
run 01a0bd00-3903-7001-9ee5-c9d68f7ecb3b
read from the Storage port

Job
───
  id:            01a0bd00-3903-7000-88ed-59a63cab5fb3
  domain:        vendor-triage@1.0.0
  type:          vendor-triage
  objective:     Triage Northwind Ledger against the supplied procurement SOP and recommend what should happen next.
  input schema:  vendor-triage.input@1.0.0
  output schema: vendor-triage.output@1.0.0
  sop:           procurement-sop
  budget:        {"maxDurationMs":120000,"maxModelCalls":8,"maxToolCalls":8}
  permissions:   lookup_vendor_evidence:read, load_skill:read
  input:
    {
      "vendorName": "Northwind Ledger",
      "procurementSop": "# Procurement SOP v1.0\n\n## Categories\n\nClassify every vendor as one of: fi…
    }

Route
─────
  route:     full-agent
  domain:    vendor-triage@1.0.0
  job type:  vendor-triage
  target:    @internal/eve-fixture-agent
  runtime:   eve@0.63.0
  attempt:   1
  fallbacks: 0 (from the ledger)

Timeline
────────
   seq       +ms  type                  latency  detail
     0         0  run.started                 -  attempt=1 domain=vendor-triage domainVersion=1.0.0 jobI…
     1        90  agent.started               -  eveEventId=evt_01M2YG0EBTCMBM3107CE7W1J72 runtime=eve s…
     2        91  model.started               -  eveEventId=evt_01M2YG0EBVGMMNGDH4MPS51N6G modelId=adapt…
     3        98  model.completed             7  eveEventId=evt_01M2YG0EC2NKRRRYG8DXWBYAKH finishReason=…
     4       104  agent.completed            14  eveEventId=evt_01M2YG0EC8TZWPQCH4FHXPZFPN turnId=turn_0
     5       110  run.completed             137  jobId=01a0bd00-3903-7000-88ed-59a63cab5fb3

Calls
─────
  model:   1 call, 7 ms total
    seq   2  adaptive-agent-harness/harness-fixture  completed       7 ms
  tool:    0
  jev:     0

Result
──────
  status:   completed (from the ledger)
  success:  true
  latency:  137 ms
  output:   (none) not persisted in Milestone 2: …

Cost
────
  cost (ledger): (none)
  cost (trace):  (none)
  input tokens:  612
  output tokens: 61
  total tokens:  673

Fingerprints
────────────
  run (ledger):   sha256:c0ab81341295c36655b5c4614d9352bd29deec74c7d75f65c82b8dd33f0f8c2d
  trace:          sha256:c0ab81341295c36655b5c4614d9352bd29deec74c7d75f65c82b8dd33f0f8c2d
  consistent:     yes, every event carries the run's fingerprint
  components:
    instructions: sha256:d57880944e71ac43a61c6b749e702f0067256c4ceaa14d9cb4b9691569977070
    …
```

## Reading the output

- **`(none)` means nobody measured it, not zero.** The mock model reports no cost, so
  `cost (ledger)` is `(none)` while the token counts are real. A fabricated `0` would be a wrong
  measurement.
- **`cost (trace)` is the ledger figure computed a second way**, summed from the run's own span
  events. If the two disagree, one of them is wrong, and that is the finding.
- **`consistent: yes`** means every trace event carries the same behavior fingerprint the ledger
  row does. A `no` names the sequences that disagree, and means two behaviors were mixed into one
  run.
- **The output value is never shown**, because Milestone 2 does not persist one:
  `HarnessRunResult.output` is returned in process and a trace payload is identity-only by rule
  (ADR-0031). The `artifacts` table is where a durable output will go; M5 fills it.
- **A run can be half-recorded and still readable.** A crash between `startRun` and the first
  flush leaves a `running` row with no trace; the inspector prints the row and
  `note: no trace events for this run`.

## A workflow run (M4-T10)

`pnpm example:run:mock -- --workflow` runs the job through the compiled vendor workflow instead of
straight through the full agent, and the inspector reads it with no change: a workflow is an
`AgentRuntime` as far as `createHarness()` is concerned. What is different in the output is the
timeline, which now carries a `node.started`/`node.completed` pair per executed node, each with
`nodeId=<id> type=<node type> attempt=<n> idempotencyKey=<key>` in its detail column, and with the
adapter's own `agent.*`, `model.*` and `decision.*` events nested between the pair of the node that
produced them. The `Route` section's `runtime` line reads `@internal/workflow@0.0.0` and `target`
reads `<agent>+workflow`, which is how a workflow run is told from a full-agent run today. An
escalated run driven by `asAgentRuntime()` — a workflow with no router in front of it — ends
`node.completed <escalate node>`, `fallback.started`, `run.failed`, and its `Errors` section prints
the whole `FallbackContext` from the `WorkflowError`'s `details`.

## A run that fell back to the full agent (M5-T5)

With the router in front of the job, an escalation is not the end of the run. `pnpm
example:run:mock -- --workflow --vendor "Aurelia Freight"` escalates and then **completes**, and
three parts of the inspection say so.

The `Route` section names the compiled version that was tried and how many times the run fell back:

```text
Route
─────
  route:     01a0c0a5-7677-7000-a57f-89a7824a1b9d
  target:    @internal/eve-fixture-agent+workflow
  runtime:   eve@0.63.0
  fallbacks: 1 (from the ledger)
```

`route:` is `runs.workflow_version_id`, which the router now fills, so a workflow run prints a
version id where a full-agent run prints `full-agent`. `runtime:` is the adapter that produced the
**final** result, which after a fallback is the full agent rather than the workflow — the workflow
is identified by the `route:` line and by the behavior fingerprint's `workflowIr` component.

The timeline shows the handoff, with the agent's own events nested inside the fallback span:

```text
     8         5  node.completed              0  attempt=1 escalateReason=the classification was not `cl…
     9         5  fallback.started            -  completedNodes=2 detail=the classification was not `cle…
    10       114  agent.started               -  eveEventId=evt_… runtime=eve s…
    11       114  model.started               -  eveEventId=evt_… modelId=adapt…
    12       120  model.completed             6  eveEventId=evt_… finishReason=…
    13       125  agent.completed            11  eveEventId=evt_… turnId=turn_0
    14       129  fallback.completed        124  agentRuntime=eve outcome=completed reason=unsupported_c…
    15       130  run.completed             140  jobId=…
```

`fallback.started` carries the reason, the `detail`, the node that gave up, the workflow's id,
version and fingerprint, and how many completed nodes the agent was offered and how many of those
were trusted. `fallback.completed` carries the agent's outcome, its usage and its runtime name.
Everything between them is the fallback agent's own work, parented on the `fallback.started` span.

The `Calls` section counts the **whole** attempt — the workflow's calls plus the agent's — because
the run cost both.

**`runs.jev_calls` is wired as of M5** and agrees with the timeline. The Calls section lists each
decision by `questionId` from the trace, and the ledger column is now a measurement of the same
thing: the workflow interpreter counts every decision it asks a `jev` node's engine for, the router
sums the compiled path's with any the full agent made after taking over, and `createHarness()`
writes the total. A run of the research route reports `jev: 2 calls` and carries `jev_calls = 2`;
one that escalated at `classify` reports one of each. See
[`../contracts/storage.md`](../contracts/storage.md) for what is and is not counted — the SQL
comment on the column still calls it a placeholder, because migrations are append-only.

**One thing the inspector still does not show for a workflow run**, M2 code that predates workflows
and not wrong in a way that misleads about what ran:

- **`TraceEvent.node` has no column of its own.** The node id is visible only because the runtime
  repeats it in the payload as `nodeId`, and a long detail line truncates.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | The inspection was printed. |
| 1 | The run was not found (`run <id> not found`), or a configured store was unreachable. |
| 2 | A usage error: an unknown subcommand, a missing or malformed run id, or no source at all. |

2 for "you typed it wrong" and 1 for "the thing you asked about is not there" are different
answers, so a script can branch on them.

## Failure: Supabase is configured but not running

```text
Supabase storage is configured (SUPABASE_URL=http://127.0.0.1:54321) but unreachable: supabase storage: `getRun` failed: TypeError: fetch failed

Start it with `pnpm supabase:start`, or inspect the run's local JSONL trace with
`pnpm harness run show <run-id> --jsonl <path>` instead.

See docs/runbooks/supabase-local.md.
```

One line, no stack, exit 1. It is the same wording `pnpm example:run` uses for the same condition,
and it never prints the service-role key.

## Failure: no source at all

With neither `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` nor `--jsonl`, the command exits 2 naming
both options rather than guessing. There is no default store.

## Failure: a subcommand that does not exist yet

Anything but `run show` exits 2 and prints the build plan's section 10 target list with each entry
marked, so you can see what the CLI will grow into:

```text
`harness workflow list` is not implemented

The CLI surface the build plan (section 10) targets, built incrementally:

  harness run <fixture>                not yet implemented
  harness run show <run-id>            available now
  harness workflow list                not yet implemented (M4)
  …
```

## Running the inspector's own Supabase test

The unit suites cover the inspector against the in-memory `Storage` and run everywhere. The
integration leg writes a run to a real local Supabase and reads it back, and **skips with a
printed reason** when the two variables are absent:

```bash
pnpm supabase:start
pnpm exec supabase status -o env \
  --override-name api.url=SUPABASE_URL \
  --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY > .env.local
set -a; . ./.env.local; set +a
pnpm test:integration
pnpm supabase:stop
```

## Related

- [`supabase-local.md`](supabase-local.md) for the local Supabase lifecycle and capturing its keys.
- [`../contracts/storage.md`](../contracts/storage.md) for what a run row and a trace hold.
- [`../contracts/trace-event.md`](../contracts/trace-event.md) for the event taxonomy the timeline
  prints.
- [`../development/commands.md`](../development/commands.md) for every root script.

## Decisions (M3-T3)

Since M3-T3 a `jev` node's judgment is persisted as well as traced, and the two are joinable. The
inspector reads the **trace**, so a `decision.started`/`decision.completed` pair appears in the
timeline and the Calls section lists each decision by its `questionId`:

```text
Calls
─────
  jev:     2 calls, 11 ms total
    seq   2  vendor-triage.classify           completed       6 ms
    seq  14  vendor-triage.evidence-supports  completed       5 ms
```

The **evidence behind each of those spans** is a row in `decisions`, which the inspector does not
print. Read it directly when you want the distribution, the confidence, the model, or the policy
that consumed the answer:

```sh
psql "$DATABASE_URL" -c "
  select node_id, question_ids, model_provider || '/' || model_id as model,
         cost_usd, latency_ms, policy->>'route' as route
  from decisions where run_id = '<run-id>' order by id;
"
```

A `policy` of `null` is not a gap: it means no policy consumed that answer. In the vendor fixture
the `classify` node is routed and the `verify` node is not, so a `research` run's two rows show one
route and one `null`, which is what "raw Jev result is stored separately from policy outcome" looks
like from the outside.

`cost_usd` is `null` on every row, and that is a measurement: the installed evaluation API exposes
no cost anywhere.
