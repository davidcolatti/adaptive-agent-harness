# Migrations

Every schema change in this repository is a timestamped SQL migration committed to this
directory. Nothing mutates the schema by hand, and nothing is applied from the Supabase dashboard
without a migration to match (build plan, M2-T6).

## What is here (M2-T5, M2-T6)

Five migrations create M2-T5's thirteen tables. They are applied in filename order, and the order
is load-bearing because of the foreign keys between them:

| Migration | Tables |
| --- | --- |
| `..._domains_and_jobs.sql` | `domains`, `jobs` |
| `..._workflow_registry_tables.sql` | `workflow_definitions`, `workflow_versions`, `workflow_promotions` |
| `..._runs_outcome_ledger.sql` | `runs` (the outcome ledger; references `jobs`, `domains` and `workflow_versions`) |
| `..._trace_events_and_artifacts.sql` | `trace_events`, `artifacts` |
| `..._later_milestone_tables.sql` | `decisions`, `eval_runs`, `eval_results`, `learning_runs`, `compiler_runs` |

## What M5 added

One further migration fills the workflow registry tables the M2 file created as minimal keyed
placeholders:

| Migration | Tables |
| --- | --- |
| `..._workflow_registry_columns.sql` | `workflow_definitions`, `workflow_versions`, `workflow_promotions` (real columns; the `payload jsonb` placeholder dropped) |

The M2 migration is **not** edited. A migration is a fact about what was applied, and rewriting one
makes the committed history stop describing any database that ever existed. What the new columns
mean is [ADR-0043](../../docs/decisions/0043-the-workflow-registry-is-a-status-model-in-core-with-an-exact-match-selector.md)
and [`../../docs/contracts/workflow-registry.md`](../../docs/contracts/workflow-registry.md).

The workflow tables come before `runs` because the ledger carries a `workflow_version_id` foreign
key, and the CLI's timestamps are second-resolution, so two migrations created in the same second
sort by name instead. If you create several at once, check the resulting order rather than assuming
it.

The rules every table follows — `uuid` ids with no database default, indexed metadata in columns
and versioned payloads in `jsonb`, row-level security enabled with no policies, and minimal keyed
shapes for tables a later milestone fills — are stated at the top of the first migration and
recorded in
[ADR-0036](../../docs/decisions/0036-storage-is-a-core-port-over-a-supabase-schema-with-runs-as-the-ledger.md).
The port that writes them is
[`../../docs/contracts/storage.md`](../../docs/contracts/storage.md).

Create a migration with the pinned CLI rather than by hand, so the filename timestamp is the one
the CLI's ordering expects:

```bash
pnpm exec supabase migration new <name>
```

Then apply and verify it with the reproducibility gate:

```bash
pnpm supabase:reset
pnpm supabase:types
```

`pnpm supabase:types` rewrites `../../packages/storage-supabase/src/database.types.ts`, which is
generated and never hand-edited (AGENTS.md rule 12). Commit the regenerated file in the same
commit as the migration that changed it; the `supabase-types` CI job fails on any drift between
the two.

See [`../../docs/runbooks/supabase-local.md`](../../docs/runbooks/supabase-local.md) for the full
lifecycle and [ADR-0033](../../docs/decisions/0033-supabase-cli-as-a-pinned-dev-dependency-with-reset-as-the-reproducibility-gate.md)
for why it is set up this way.
