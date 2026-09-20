# Migrations

Every schema change in this repository is a timestamped SQL migration committed to this
directory. Nothing mutates the schema by hand, and nothing is applied from the Supabase dashboard
without a migration to match (build plan, M2-T6).

**This directory is deliberately empty of migrations as of M2-T11.** M2-T11 only makes the local
environment reproducible; M2-T5 designs the schema and M2-T6 writes the first migration files.
An empty directory is a valid state: `supabase db reset` applies zero migrations, runs
`../seed.sql`, and exits 0, which is exactly the "clean database from zero" property the
milestone's acceptance criteria name.

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
