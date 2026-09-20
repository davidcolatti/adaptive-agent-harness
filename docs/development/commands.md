# Commands

Every script in the root `package.json`, what each one actually runs, and when to reach for it.
Run all of them from the repository root with `pnpm run <name>` (or `pnpm <name>` where the name
does not collide with a pnpm builtin).

## Root scripts

Listed in the order they appear in `package.json`.

| Command | What it runs | When to use it |
| --- | --- | --- |
| `pnpm build` | `turbo run build` | Run every workspace package's own `build` script: `tsc` to `dist` for the libraries, and `tsc` plus `eve build` for the example agent. Needed before anything consumes built output, and part of `pnpm check`. |
| `pnpm check` | `pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build && pnpm run check:handoff` | The single local quality gate. Run it before declaring a task complete. |
| `pnpm check:handoff` | `node scripts/verify-handoff.ts` | Verify `docs/context/current-state.md` and `docs/progress/WORKLOG.md` are present and internally consistent (completed entries have verification results; referenced ADRs exist). Runs as the last stage of `pnpm check`. |
| `pnpm example:run` | `turbo run build --filter=@internal/example-agent && pnpm --filter @internal/example-agent run start` | Run the vendor-triage example end to end through the harness API against `apps/example-agent`. **Needs an AI Gateway credential** (`AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`); it exits 1 with a message naming `.env.example` when neither is set. Prints the `HarnessRunResult` as JSON and exits non-zero unless the run completed. |
| `pnpm example:run:mock` | the same, with `--mock` | The same path against `apps/eve-fixture-agent`, whose model is eve's `mockModel`. **No credential.** Real eve server, real durable session, real domain and schema; only the model is scripted. This is the one to run to check the harness path still works. |

Both example commands load `.env.local` through Node 24's `--env-file-if-exists`, so a run is
recorded in Supabase when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are both in it, and
writes only its JSONL trace otherwise. Either way it exits 0 on a completed run and says on stderr
which mode it was in; see [`../runbooks/supabase-local.md`](../runbooks/supabase-local.md).
| `pnpm dev` | `turbo run dev` | Start every package's watch build (`tsc --watch`). Persistent and uncached. |
| `pnpm format` | `biome format --write .` | Rewrite files to Biome's formatting. Use while editing; this is the fix-it counterpart of `format:check`. |
| `pnpm format:check` | `biome format .` | Formatting check only, no writes. First stage of `pnpm check`; fails on an unformatted file. |
| `pnpm lint` | `biome check --formatter-enabled=false .` | Biome's linter plus the `organizeImports` assist, with formatting deliberately switched off so lint and format fail for distinct reasons. |
| `pnpm prepare` | `husky` | Installs the git hooks. You never run this by hand: pnpm runs it automatically after `pnpm install`. |
| `pnpm supabase:reset` | `supabase db reset` | Drop and recreate the local database, apply every migration in `supabase/migrations/`, then run `supabase/seed.sql`. The reproducibility gate: it is what proves the committed migrations create a clean database from zero. Needs the stack running. |
| `pnpm supabase:start` | `supabase start` | Start the local Supabase stack in Docker and print its URLs and keys. The first run pulls about a dozen images and takes minutes. **Needs Docker running.** |
| `pnpm supabase:stop` | `supabase stop` | Stop the containers, keeping the data volume. |
| `pnpm supabase:types` | `supabase gen types --lang typescript --local > packages/storage-supabase/src/database.types.ts` | Regenerate the committed database types from the running local database. The CLI has no output-file flag, so the script redirects stdout; a failed generation therefore truncates the file, and the fix is to reset and re-run. Never hand-edit the output (AGENTS.md rule 12). |
| `pnpm test` | `vitest run` | Run every Vitest project (unit, integration, contract, replay) once. Part of `pnpm check`. |
| `pnpm test:contract` | `vitest run --project contract` | Run only `*.contract.test.ts`. As of M1-T6 this starts a real `eve dev` server for `apps/eve-fixture-agent` and runs `EveAgentRuntime` against it, in about four seconds. It needs no credential and reaches no model provider. |
| `pnpm test:integration` | `vitest run --project integration` | Run only `*.integration.test.ts`. |
| `pnpm test:replay` | `vitest run --project replay` | Run only `*.replay.test.ts`. |
| `pnpm test:unit` | `vitest run --project unit` | Run only the default unit layer. This is also what the pre-push hook runs. |
| `pnpm typecheck` | `turbo run typecheck && tsc --noEmit -p tsconfig.json` | Typecheck every workspace package, then the repository root itself. Turbo only runs workspace packages, so the second half is what covers `scripts/`, `tests/` and `vitest.config.ts`. |

## What `pnpm check` is, exactly

`check` is declared in `package.json` as a chain of six scripts, in this order:

1. `format:check`
2. `lint`
3. `typecheck`
4. `test`
5. `build`
6. `check:handoff`

Because the stages are chained with `&&`, the first failure stops the run and the failing stage is
the one that names the problem.

## Per-package commands

Each workspace package declares its own scripts, and any of them can be run in isolation with
`pnpm --filter <package-name> <script>`.

| Package | Scripts it declares |
| --- | --- |
| `@internal/core` | `build`, `dev`, `typecheck` |
| `@internal/runtime-ai-sdk` | `build`, `dev`, `typecheck` |
| `@internal/runtime-eve` | `build`, `dev`, `typecheck` |
| `@internal/testing` | `build`, `dev`, `typecheck` |
| `@internal/config` | none (it ships only shared tsconfig bases, no runtime code) |
| `@internal/storage-supabase` | `build`, `dev`, `typecheck` |
| `@internal/trace` | `build`, `dev`, `typecheck` |
| `@internal/example-agent` | `build`, `dev`, `info`, `typecheck` |

For every package, `build` is `tsc -p tsconfig.build.json`, `dev` is the same with
`--watch --preserveWatchOutput`, and `typecheck` is `tsc --noEmit -p tsconfig.json`.

`@internal/example-agent` is the exception, because it is an `eve` application rather than a
TypeScript library: nothing imports it, so it emits no declarations and has no
`tsconfig.build.json`. Its `build` is `eve build` and its `dev` is `eve dev`; only `typecheck` is
the usual `tsc --noEmit`. It carries its own `turbo.json` (extending the root) so that Turborepo
watches `agent/**` and caches `.output/**` instead of the `src/**` and `dist/**` the root task
definitions assume.

```sh
pnpm --filter @internal/testing build
pnpm --filter @internal/core typecheck
pnpm --filter @internal/core dev
```

Running the root `pnpm build` or `pnpm typecheck` instead fans the same scripts out across the
workspace through Turborepo, honouring the `build` task's `dependsOn: ["^build"]` ordering.

## `eve` commands for the example agent

The example agent is a real `eve` project, so eve's own CLI is how you inspect it. There is no
root-level wrapper script; run the commands through the package filter.

| Command | What it does |
| --- | --- |
| `pnpm --filter @internal/example-agent run info` | `eve info`. Confirms eve discovered every authored file and prints its diagnostics, the resolved model, the artifact paths and the HTTP routes. Needs no model credential. |
| `pnpm --filter @internal/example-agent exec eve info --json` | The machine-readable form. Use it to check that a specific tool or skill was discovered; the plain-text form does not print their names. |
| `pnpm --filter @internal/example-agent run build` | `eve build`. Compiles `.eve/` artifacts and bundles the host output to `.output/`. Runs offline and needs no model credential. Part of `pnpm build` and therefore of `pnpm check`. |
| `pnpm --filter @internal/eve-fixture-agent run info` | The same diagnostic for the credential-free fixture agent. It should report `Compile ready` and exactly two tools. |
| `pnpm --filter @internal/example-agent run dev` | `eve dev`. Starts the local dev server and opens eve's terminal UI. Interactive, and it *does* reach a model, so it needs a credential. Not part of any gate. |

`eve` 0.63.0 ships **no `eve check` command**; `eve info` is the equivalent diagnostic, and it
requires an authored `agent/` directory to run at all. Both commands write `.eve/` and `.output/`
inside the app; both directories are git-ignored build artifacts.

There is no `pnpm example:run` yet. That acceptance criterion belongs to M1-T4, once
`createHarness()` exists: the example is required to execute through the harness API, not through
the `eve` runtime directly.


## Test-file taxonomy

The build plan's Testing Strategy section (section 8) defines the test layers; `vitest.config.ts`
implements them as four Vitest projects selected by filename suffix. `pnpm test:unit` and friends
select one with `vitest run --project <name>`.

| File suffix | Vitest project | What belongs there |
| --- | --- | --- |
| `*.test.ts` | `unit` | The default layer. No live model calls: fake agent runtime, fake decision engine, fake tools, in-memory registries. |
| `*.integration.test.ts` | `integration` | May use a local Supabase. Still avoids live model calls unless explicitly tagged. |

The `Storage` contract suite and the schema integration suite both **skip with a printed reason**
when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are not set, so `pnpm check` passes on a
machine with no Docker. The runbook's "run the storage tests against a real database" section is
how to actually run them.
| `*.contract.test.ts` | `contract` | Validates adapter compatibility for `AgentRuntime`, `DecisionEngine`, `Storage`, `WorkflowExecutor` and `SourceControlPublisher`. Every implementation of a port runs the same contract suite. |
| `*.replay.test.ts` | `replay` | Historical / frozen evidence, replayed without re-research. |

Two implementation details worth knowing, both from `vitest.config.ts`:

- The `unit` project excludes the three suffixed patterns explicitly, because `**/*.test.ts` also
  matches `*.integration.test.ts`.
- `passWithNoTests` is set once at the root because Vitest 5 treats it as a non-project option.
  That is what lets the `integration`, `contract` and `replay` layers exit 0 before they have any
  files, which is the state of the repository in Milestone 0.

Live-provider suites (tagged `live:ai`, `live:jev`, `live:eve`) are run manually or in a separate
CI job and are not part of any of the four projects above.

## How CI mirrors `pnpm check`

`.github/workflows/ci.yml` defines a single `check` job on `ubuntu-latest`, triggered by pushes to
`main` and by every pull request, with in-flight runs on the same ref cancelled. Its steps, in
order:

1. **Checkout** (`actions/checkout@v7`).
2. **Set up pnpm** (`pnpm/action-setup@v6`) with no `version` input, so the pnpm version comes from
   the `packageManager` field and CI cannot drift from local.
3. **Set up Node** (`actions/setup-node@v7`) with `node-version-file: .node-version` and
   `cache: pnpm`. It runs after the pnpm setup because the pnpm cache needs `pnpm store path`.
4. **Install**: `pnpm install --frozen-lockfile`.
5. **Format**: `pnpm run format:check`.
6. **Lint**: `pnpm run lint`.
7. **Typecheck**: `pnpm run typecheck`.
8. **Test**: `pnpm run test`.
9. **Build**: `pnpm run build`.
10. **Handoff documentation**: `pnpm run check:handoff`.

Steps 5 through 10 are `pnpm check` broken out into separately named steps, in the same order, so
a red build names the gate that failed instead of just saying `check` failed.

A second job, `supabase-types`, runs alongside it on the same triggers (M2-T11). It installs the
same way, then runs `pnpm supabase:start`, `pnpm supabase:reset`, `pnpm supabase:types`,
`git diff --exit-code -- packages/storage-supabase/src/database.types.ts`, and
`pnpm supabase:stop` with `if: always()`. It is a separate job because it needs Docker and spends
minutes pulling images, while `check` must stay the fast gate. A migration committed without its
regenerated types fails at the `git diff` step. See
[ADR-0033](../decisions/0033-supabase-cli-as-a-pinned-dev-dependency-with-reset-as-the-reproducibility-gate.md).

## Related

- [`../runbooks/supabase-local.md`](../runbooks/supabase-local.md) for operating the local Supabase
  stack: the schema-change routine, port collisions, a wedged stack, and capturing local keys into
  a git-ignored `.env.local`.
- [`local-setup.md`](local-setup.md) for prerequisites, the git hooks and editor setup.
- [`../research/tooling/2026-09-19-m0-toolchain-verification.md`](../research/tooling/2026-09-19-m0-toolchain-verification.md)
  for why each tool is configured the way it is.
