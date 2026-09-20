---
status: accepted
date: 2026-09-19
deciders: orchestrator (Claude Fable 5.1) with repository owner constraints; recorded during M2-T11
related: [0004, 0011, 0018, 0023, 0024, 0030, 0031, 0032]
supersedes: null
superseded_by: null
---

# ADR-0033: The Supabase CLI is a pinned dev dependency, and `db reset` is the reproducibility gate

## Context

M2-T11 is the task that gates M2-T5 through M2-T10. Schema, migrations, the outcome ledger,
redaction and the run inspector all define behaviour against a real database, and none of them can
be verified end to end without one. Milestone 2's deliverable is "a trustworthy learning dataset",
and a dataset is only trustworthy if the database that holds it can be rebuilt, byte for byte in
its schema, from what is committed.

ADR-0004 fixes the shape of the answer: local-first, no hosted infrastructure until later
milestones. So the database is a local Supabase stack in Docker, not a hosted project. What M2-T11
has to decide is how that stack is obtained, operated and kept honest.

Four forces make the decision non-obvious.

**A CLI is a version too.** The development host for this repository already had a Supabase CLI on
its `PATH`, installed by Homebrew at 2.105.0, twelve minor versions behind the current release. The
CLI decides which Postgres image the local stack runs, what `supabase/config.toml` means, and what
shape `supabase gen types` emits. A contributor on 2.105.0 and a contributor on 2.117.0 can run
identical commands against identical committed files and get different databases and different
generated types. AGENTS.md already forbids that class of drift for libraries ("pin to an exact
version (no `^`/`~`)") and ADR-0024 gives the mechanism, but neither had been applied to a tool
invoked as a binary rather than imported as a module.

**Generated types are the seam where drift hides.** `packages/storage-supabase/src/database.types.ts`
is derived from the migrations. AGENTS.md rule 12 already names it, before it existed, as a file
that is regenerated and never hand-edited. But "never hand-edited" is unenforceable by itself: the
real failure is subtler and much more likely, which is a migration landing in one commit and its
regenerated types landing in another, or never. Between those commits, the compiler believes a
schema the database does not have.

**A reset that works only on a machine that has been running for a while is not a reset.** The
property Milestone 2's acceptance criteria actually need is that a *clean* database plus the
committed migrations plus the committed seed produces the working state. A database that has
accumulated state from previous manual work can hide a missing migration indefinitely.

**Local Supabase prints credentials.** `supabase start` finishes by printing a publishable key, a
secret key, a JWT secret, an anon key, a service-role key and two S3 protocol keys. They are
well-known local development values, not production secrets, but the repository runs `secretlint`
on every commit and AGENTS.md states flatly that secrets are never committed. A policy that says
"these particular keys are fine" would teach every future contributor and coding agent to argue
about which keys are fine.

## Decision

**The Supabase CLI is a project dev dependency, pinned exactly.** `supabase@2.117.0` is declared in
the root `package.json` `devDependencies` with no range operator, and every invocation goes through
a root `pnpm` script so it resolves from `node_modules/.bin` rather than from the contributor's
`PATH`. A globally installed CLI, of any version, is never used by this repository and never
required by it. The npm package ships the platform binary as an optional dependency
(`@supabase/cli-<platform>@2.117.0` and seven siblings), not as a postinstall download, so this
works under pnpm 12's blocked lifecycle scripts with no `onlyBuiltDependencies` entry.

**It is pinned at the workspace root, not inside `packages/storage-supabase`.** The CLI is a tool
the whole repository drives, not a library that package imports. `packages/storage-supabase` holds
the CLI's *output*. This is the same distinction ADR-0024 draws between framework dependencies,
which are co-located with the adapter that calls them, and build tooling, which lives at the root.

**ADR-0024's assertion-test mechanism extends to it.** `tests/toolchain/supabase-cli-pin.test.ts`
reads the pinned string from the root manifest and the `version` field from the installed
`supabase/package.json`, both from disk, and asserts they agree; it asserts the pin carries no range
operator; and it asserts the four lifecycle scripts still wrap the four CLI commands verbatim. No
version literal appears in the test, so the test proves manifest and lockfile agree rather than
restating a constant. It runs in the `unit` project and therefore in `pnpm check` and in CI. It
lives under `tests/toolchain/` rather than co-located, because the dependency it guards is the root's.

**Upgrading the CLI is a task, exactly as ADR-0024 requires for a framework dependency.** It needs
its own WORKLOG entry with a fresh `Implementation references` section produced against the newly
installed version, because a CLI upgrade can change `config.toml` semantics, the Postgres image and
the generated type shape at once.

**`supabase db reset` is the reproducibility gate, and reset means from empty.** The committed
state is `supabase/config.toml`, `supabase/migrations/*.sql` and `supabase/seed.sql`. Reset drops
and recreates the database, applies every committed migration in order, then runs the seed. Nothing
else is a supported way to change the local schema: no `psql` by hand, no Studio, no dashboard. A
change that survives only because a particular database already had it is exactly the failure this
gate exists to catch.

**The generated types file is committed, and CI fails on drift.** `pnpm supabase:types` is the only
thing that writes `packages/storage-supabase/src/database.types.ts`. The `supabase-types` job in
`.github/workflows/ci.yml` starts Supabase, resets, regenerates and runs
`git diff --exit-code` against that one path. It is a second job rather than extra steps on `check`,
because it needs Docker and spends minutes pulling images, and `check` must stay the fast gate that
mirrors `pnpm check`.

**The generated file carries no hand-written header, deliberately.** A header added by hand would
be deleted by the next generation and would then show up as drift in the CI job whose entire purpose
is to detect drift. The "generated, never hand-edit" statement therefore lives where it survives
regeneration: AGENTS.md rule 12, the package's own `src/index.ts`, the runbook, and this ADR.

**Local URLs and keys are captured into a git-ignored env file, never into a tracked one.** The
supported capture is `supabase status -o env`, with `--override-name` mapping the CLI's names onto
the ones `.env.example` already declares, redirected into `.env.local`. No key value is written into
a tracked file, a document, a WORKLOG entry or a commit message, **including** the well-known local
demo keys. The rule is unconditional on purpose: a rule with an exemption for "keys that do not
matter" requires every future contributor to correctly judge which keys those are, and the cost of
one wrong judgement is much larger than the cost of never making it.

## Consequences

### Positive

- Two contributors and CI run the same CLI version, so the same committed files produce the same
  database and the same generated types. The drift the Homebrew 2.105.0 on the development host
  would have introduced is structurally impossible rather than merely discouraged.
- A migration that lands without its regenerated types turns red in CI on the commit that
  introduced it, naming the one file that is wrong. This is the failure mode most likely to
  actually occur, and it is now cheap to see.
- Reset-from-empty means "migrations can create a clean database from zero" is continuously
  verified rather than assumed, which is one of Milestone 2's acceptance criteria stated directly.
- The env-file policy needs no judgement calls at the moment of use, which is when judgement is
  worst.

### Negative

- The `supabase-types` CI job is slow and Docker-dependent. The first run on a cold runner spends
  several minutes pulling about a dozen images. It is the price of checking the property on every
  pull request rather than trusting a contributor to have checked it.
- Pinning exactly means no automatic CLI patches, including security ones, and the Supabase CLI
  ships far more often than the frameworks ADR-0024 governs. Every bump is manual work.
- The local stack is heavy: fourteen containers for what is currently an empty schema. Nothing
  smaller was chosen, for the reason given under Alternatives.
- `supabase gen types` in 2.117.0 has no output-file flag, so `pnpm supabase:types` uses shell
  redirection. A failed generation therefore truncates the committed file. The CI gate catches it
  and the runbook says to re-run after a successful reset, but a contributor can briefly leave a
  broken file in the working tree.
- `supabase/migrations/README.md` makes the CLI print `Skipping migration README.md...` on every
  start and reset. A `.gitkeep` was measured and produces the identical line, so the noise is not
  avoidable by naming; the README was kept because it is worth more than the line costs.

### Neutral

- Binds `packages/storage-supabase`, the `supabase/` directory, the four root scripts and the
  `supabase-types` CI job. It does not change `tests/architecture/boundaries.ts`:
  `@internal/storage-supabase` was already a declared adapter and `@supabase/*` was already
  adapter-only, so the boundary needed no edit for this task.
- Does not decide anything about `@supabase/supabase-js`. That package is deliberately **not**
  installed yet; whether the adapter uses it, `postgres-js`, or the REST API directly is M2-T5's
  decision, made when there is a schema to talk to.
- `supabase/config.toml` is committed at the CLI's defaults with one value examined rather than
  changed: `project_id` defaulted to the working-directory name, `adaptive-agent-harness`, which is
  the stable value wanted. Ports were checked for collisions rather than moved (see References).
- Does not govern hosted Supabase. ADR-0004 keeps hosted infrastructure out until a later
  milestone, and the migration path to one is not designed here.

## Alternatives considered

- **A globally installed Supabase CLI, documented as a prerequisite.** Rejected. It is what the
  development host already had, at 2.105.0, and it is precisely the drift this ADR exists to
  prevent: the prerequisite documentation would say a version, nothing would check it, and a
  contributor twelve minor versions behind would get a different database from identical committed
  files. It would also put the CLI outside ADR-0024's assertion mechanism, which is the only thing
  in this repository that has ever caught a version disagreement.
- **A plain Postgres in Docker Compose, without Supabase.** Rejected, though it is genuinely
  lighter: fourteen containers for an empty schema is real overhead. But the build plan's runtime
  responsibility matrix assigns local persistence to Supabase, not to Postgres, and the harness will
  reach it through `@supabase/*` from M2-T5. Developing against bare Postgres would mean the thing
  developed against and the thing shipped against differ in their auth model, their row-level
  security, their PostgREST surface and their generated types, and `supabase gen types --local`
  would have nothing to point at. The gap would be discovered at the worst moment.
- **A hosted Supabase project for development.** Rejected by ADR-0004 (local-first, no hosted
  infrastructure until later milestones) and independently by this task's own requirement: `db reset`
  against a shared hosted database is destructive to everyone else using it, so the reproducibility
  gate could not be run at all, let alone on every pull request.
- **Checking type drift inside `pnpm check` instead of in a separate CI job.** Rejected. `pnpm check`
  is the fast local gate that runs on every task and in the pre-push path; making it require Docker
  and several minutes of image pulls would get it run less often, which costs more than it buys.
  The separate job checks the same property on every pull request.
- **Not committing the generated types, generating them at build time instead.** Rejected. It would
  make every build require Docker and a running database, including CI jobs that have no business
  touching one, and it would make the schema the compiler is typed against invisible in code review.
  A committed generated file is reviewable: the diff shows exactly what a migration did to the type
  surface.
- **Adding a hand-written "generated, do not edit" header to `database.types.ts`.** Rejected on
  mechanism. The next `pnpm supabase:types` deletes it, and the `supabase-types` job then reports
  drift on a file nobody changed. Making the script prepend the header instead was considered and
  also rejected: it would stop the script being a verbatim wrapper of the documented CLI command,
  which is what the build plan specifies and what the pin test asserts.

## References

- `docs/milestones/build-plan.md` Milestone 2, M2-T11 (the four scripts, the four wrapped CLI
  commands, reset as the reproducibility gate, the generated-types path, and the two acceptance
  criteria `pnpm supabase:reset` and `pnpm supabase:types`); section 3 (local persistence is
  Supabase); AD-004, AD-011, AD-016
- `AGENTS.md`: rule 12 (generated files are never hand-edited, naming `database.types.ts`), "No
  silent dependency additions", "No direct database access outside `packages/storage-supabase`",
  "Secrets are never committed"
- Installed CLI 2.117.0, read via `pnpm exec supabase <cmd> --help`: `init` is non-interactive
  unless `-i`; `gen types` has **no** output-file flag; `status` supports the global
  `-o env` and `--override-name`; `stop --no-backup` is what deletes data volumes. Recorded in full
  in the M2-T11 `started` WORKLOG entry's `Implementation references`.
- Port survey (no collision): Supabase uses API 54321, DB 54322, shadow DB 54320, Studio 54323,
  local SMTP 54324, analytics 54327, pooler 54329 (disabled), edge-runtime inspector 8083;
  `eve start` defaults to `$PORT` then 3000 and `eve dev` to `$PORT` then 2000
  (`eve/docs/reference/cli.md`), and the contract suite uses `--port 0`.
- Related ADRs: 0004 (local-first), 0011 (no guessed detail; source precedence), 0018 (pnpm
  workspace and the release-age gate), 0023 (hooks, secret scanning and CI gates), 0024 (exact pins
  and installed-version assertion tests, whose mechanism this reuses), 0030/0031/0032 (the M2
  contracts the schema in M2-T5 will persist)
- Related code paths: `package.json` (the pin and the four scripts), `pnpm-lock.yaml`,
  `supabase/config.toml`, `supabase/seed.sql`, `supabase/migrations/README.md`,
  `packages/storage-supabase/`, `tests/toolchain/supabase-cli-pin.test.ts`, `biome.json` (the
  formatter override for the generated file), `.github/workflows/ci.yml` (`supabase-types`),
  `docs/runbooks/supabase-local.md`
