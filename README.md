# Adaptive Agent Harness

A reusable TypeScript agent harness meant to be installed into many
independent domain-agent repositories (a marketing-site agent, a paid-ads
agent, a PMM agent, and so on). Each domain repository owns its own
instructions, SOPs, tools, skills, schemas, permissions, and evals. The
harness owns the execution lifecycle: it runs a job, records what happened,
and over time uses that evidence to identify stable behavior, compile it into
a cheaper workflow, replay it against historical cases, evaluate it, and
promote it once it is proven. Ambiguous cases always fall back to the full
agent.

The long-term optimization target for any repetitive job:

```
Full Agent -> Specialized Agent -> Jev Decision -> Deterministic Code -> Direct API Call
```

The system should always use the least expensive safe primitive that
preserves the required behavior. Full detail is in
`docs/milestones/build-plan.md`.

## Status

**Milestone 0 (Repository Foundation)** is complete. **Milestone 1 (Local
Agent + Public Harness Boundary)** is next. For the current task, what works,
and the exact next step, see `docs/context/current-state.md`. That file, not
this one, is the source of truth for project status.

## Architecture

- `docs/architecture/system-map.md`: how the current system fits together.
- `docs/decisions/`: Architecture Decision Records (ADRs), explaining why the
  system is built the way it is.
- `docs/milestones/build-plan.md`: the full build plan, including
  architectural decisions, contracts, milestones, and acceptance criteria.

## Quick start

Requires Node `24.21.0` and pnpm `12.4.2` (pinned by `.node-version`/
`.nvmrc` and `packageManager` in `package.json`).

```bash
pnpm install
pnpm check
```

`pnpm check` is the single local quality gate: formatting, lint, typecheck,
tests, build, and handoff-documentation verification, in that order. It is
the same sequence CI runs.

## Repository layout

```
adaptive-agent-harness/
├── .github/workflows/ci.yml
├── .husky/                      # pre-commit, pre-push hooks
├── packages/
│   ├── config/                  # shared tsconfig bases, no runtime code
│   ├── core/                    # harness core contracts; empty until M1
│   └── testing/                 # shared test helpers
├── docs/                        # documentation; see docs/README.md
├── scripts/verify-handoff.ts    # enforces the progress/handoff protocol
├── tests/architecture/          # package dependency-boundary rules + test
├── package.json, pnpm-workspace.yaml, turbo.json, biome.json,
│   vitest.config.ts, tsconfig.json
```

Later milestones add `apps/` (example agent, playground) and further
`packages/` (`runtime-ai-sdk`, `runtime-eve`, `decision-jev`, `trace`,
`storage-supabase`, `workflow`, `registry`, `replay`, `evals`, `learner`,
`compiler`, `codegen`, `observability`) as they are built. See the
"Repository Layout" section of the build plan for the full planned shape.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install workspace dependencies. |
| `pnpm dev` | Watch builds for packages that define one. |
| `pnpm build` | Build every package. |
| `pnpm typecheck` | Typecheck every package plus root scripts/tests. |
| `pnpm test` | Run all test layers (unit, integration, contract, replay). |
| `pnpm test:unit` | Run only the unit layer (default, no live model calls). |
| `pnpm lint` | Biome lint and import-organization checks. |
| `pnpm format:check` | Biome formatting check. |
| `pnpm check:handoff` | Verify `WORKLOG.md`/`current-state.md` are present and consistent. |
| `pnpm check` | The single local quality gate: all of the above, in order. |

Per-package scripts run with `pnpm --filter <package-name> <script>`.

## Documentation map

`docs/README.md` is the entry point for every documentation category
(architecture, contracts, decisions, concepts, development, milestones,
runbooks, research, context, progress) and tells a fresh reader what to read
first.

## For coding agents

Read `AGENTS.md` before making any change. It is the canonical operating
contract for this repository, including the mandatory read order, the
non-negotiable rules, architecture boundaries, commands, definition of done,
the source-of-truth protocol for framework-facing work, and the progress/
handoff protocol.
