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
| `agent/agent.ts` | `defineAgent` with an AI Gateway model id, read from `EXAMPLE_AGENT_MODEL` with eve's own default as the fallback. |
| `agent/instructions.md` | The system prompt: the five outputs, and the rule that absence of evidence is missing information rather than a pass. |
| `agent/skills/triage-vendor.md` | A load-on-demand procedure for working the SOP as a checklist. The model pulls it in with `load_skill` when a request calls for it. |
| `agent/tools/lookup_vendor_evidence.ts` | The single read-only fixture tool. Its model-facing name is the filename slug. |
| `agent/tools/web_search.ts`, `agent/tools/web_fetch.ts` | `disableTool()` at eve's own slots, so the agent cannot reach the live web. |
| `agent/lib/vendor-fixtures.ts` | Three fictional vendors and their frozen evidence documents. |
| `agent/lib/vendor-evidence.ts` | The pure lookup the tool calls, plus its unit test. |
| `src/dependency-pins.test.ts` | ADR-0024's installed-version assertion for `eve`, `ai` and `zod`. |

Everything is deterministic and offline. The milestone's instruction is to use local fixture tools
before adding live web research, so the fixture data is the whole evidence universe and the two
`disableTool()` files are what make that true rather than merely requested.

The three fixture vendors differ on purpose, so the agent has something to triage: one is well
documented, one has real gaps, and one carries an obvious payment-change risk flag. All three are
invented, and every website is a reserved `.example` domain.

### What it does not do yet

**Nothing runs it.** As of M1-T2 the example is authored files plus a pure fixture module. It makes
no model call, and the repository's tests make none either.

`createHarness()` arrives in M1-T4, and Milestone 1's acceptance criterion is that the example
calls the harness API rather than the `eve` runtime directly. `pnpm example:run` belongs to that
task. The example has no `defineDomain()` registration yet (M1-T3) and no capability manifest
(M1-T9).

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
- [The Milestone 1 status file](../milestones/m1-local-agent-and-public-harness-boundary.md): the
  task list and acceptance criteria this example is measured against.
