# Commands

Every script in the root `package.json`, what each one actually runs, and when to reach for it.
Run all of them from the repository root with `pnpm run <name>` (or `pnpm <name>` where the name
does not collide with a pnpm builtin).

## Root scripts

Listed in the order they appear in `package.json`.

| Command | What it runs | When to use it |
| --- | --- | --- |
| `pnpm build` | `turbo run build` | Compile every workspace package to `dist` via each package's own `build` script. Needed before anything consumes built output, and part of `pnpm check`. |
| `pnpm check` | `pnpm run format:check && pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run build && pnpm run check:handoff` | The single local quality gate. Run it before declaring a task complete. |
| `pnpm check:handoff` | `node scripts/verify-handoff.ts` | Verify `docs/context/current-state.md` and `docs/progress/WORKLOG.md` are present and internally consistent (completed entries have verification results; referenced ADRs exist). Runs as the last stage of `pnpm check`. |
| `pnpm dev` | `turbo run dev` | Start every package's watch build (`tsc --watch`). Persistent and uncached. |
| `pnpm format` | `biome format --write .` | Rewrite files to Biome's formatting. Use while editing; this is the fix-it counterpart of `format:check`. |
| `pnpm format:check` | `biome format .` | Formatting check only, no writes. First stage of `pnpm check`; fails on an unformatted file. |
| `pnpm lint` | `biome check --formatter-enabled=false .` | Biome's linter plus the `organizeImports` assist, with formatting deliberately switched off so lint and format fail for distinct reasons. |
| `pnpm prepare` | `husky` | Installs the git hooks. You never run this by hand: pnpm runs it automatically after `pnpm install`. |
| `pnpm test` | `vitest run` | Run every Vitest project (unit, integration, contract, replay) once. Part of `pnpm check`. |
| `pnpm test:contract` | `vitest run --project contract` | Run only `*.contract.test.ts`. |
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
| `@internal/testing` | `build`, `dev`, `typecheck` |
| `@internal/config` | none (it ships only shared tsconfig bases, no runtime code) |

In all cases `build` is `tsc -p tsconfig.build.json`, `dev` is the same with
`--watch --preserveWatchOutput`, and `typecheck` is `tsc --noEmit -p tsconfig.json`.

```sh
pnpm --filter @internal/testing build
pnpm --filter @internal/core typecheck
pnpm --filter @internal/core dev
```

Running the root `pnpm build` or `pnpm typecheck` instead fans the same scripts out across the
workspace through Turborepo, honouring the `build` task's `dependsOn: ["^build"]` ordering.

## Test-file taxonomy

The build plan's Testing Strategy section (section 8) defines the test layers; `vitest.config.ts`
implements them as four Vitest projects selected by filename suffix. `pnpm test:unit` and friends
select one with `vitest run --project <name>`.

| File suffix | Vitest project | What belongs there |
| --- | --- | --- |
| `*.test.ts` | `unit` | The default layer. No live model calls: fake agent runtime, fake decision engine, fake tools, in-memory registries. |
| `*.integration.test.ts` | `integration` | May use a local Supabase. Still avoids live model calls unless explicitly tagged. |
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

## Related

- [`local-setup.md`](local-setup.md) for prerequisites, the git hooks and editor setup.
- [`../research/tooling/2026-09-19-m0-toolchain-verification.md`](../research/tooling/2026-09-19-m0-toolchain-verification.md)
  for why each tool is configured the way it is.
