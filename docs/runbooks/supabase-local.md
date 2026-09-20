# Runbook: local Supabase lifecycle

How to start, stop, reset and regenerate types against the local Supabase stack, and what to do
when it will not cooperate. The decision record behind this setup is
[ADR-0033](../decisions/0033-supabase-cli-as-a-pinned-dev-dependency-with-reset-as-the-reproducibility-gate.md).

## Prerequisites

- **Docker must be running.** Everything below starts containers. Check with `docker info`.
- Node 24.21.0 and pnpm 12.4.2 on `PATH`, and `pnpm install` already run. That install is what
  puts the pinned Supabase CLI in `node_modules/.bin`.
- **Do not use a globally installed `supabase`.** A Homebrew or npm-global CLI is almost certainly
  a different version from the pinned one, and a different version produces a different database
  and different generated types from identical committed files. Always go through the `pnpm`
  scripts below, which resolve the pinned binary.

## The four commands

| Command | What it runs | What it does |
| --- | --- | --- |
| `pnpm supabase:start` | `supabase start` | Starts the local stack in Docker and prints the local URLs and keys. The first run pulls about a dozen images and takes several minutes; later runs take seconds. |
| `pnpm supabase:stop` | `supabase stop` | Stops the containers and **keeps** the data volume. Add `--no-backup` by hand to throw the data away as well. |
| `pnpm supabase:reset` | `supabase db reset` | Drops and recreates the database, applies every migration in `supabase/migrations/` in order, then runs `supabase/seed.sql`. This is the reproducibility gate. |
| `pnpm supabase:types` | `supabase gen types --lang typescript --local > packages/storage-supabase/src/database.types.ts` | Regenerates the committed database types from the running local database. |

## Routine: after changing the schema

A migration and its regenerated types belong in the same commit. CI's `supabase-types` job fails
otherwise.

```bash
pnpm supabase:start
pnpm exec supabase migration new <name>   # creates supabase/migrations/<timestamp>_<name>.sql
# edit the migration
pnpm supabase:reset
pnpm supabase:types
git diff -- packages/storage-supabase/src/database.types.ts   # review what the migration did
```

Reset before regenerating, always. Generating types from a database that has drifted from the
committed migrations produces a file that looks fine locally and fails in CI.

## Routine: prove reproducibility

This is the sequence CI runs, and the one to run by hand before declaring schema work done:

```bash
pnpm supabase:start
pnpm supabase:reset
pnpm supabase:types
git diff --exit-code -- packages/storage-supabase/src/database.types.ts
pnpm supabase:stop
```

The `git diff --exit-code` must be silent and exit 0. A non-empty diff means the committed types
are not what the committed migrations produce.

## Ports

| Port | Service |
| --- | --- |
| 54320 | shadow database (used by `db diff`) |
| 54321 | API gateway (REST, GraphQL, Storage, Functions) |
| 54322 | Postgres |
| 54323 | Studio |
| 54324 | Mailpit, the local email catcher |
| 54327 | analytics |
| 54329 | connection pooler (disabled in `config.toml`) |
| 8083 | edge-runtime Chrome inspector |

None of these collides with anything else the repository runs: `eve start` defaults to `$PORT`
then 3000, `eve dev` defaults to `$PORT` then 2000, and the contract suite starts `eve dev` on
`--port 0`.

## Local URLs and keys

`supabase start` and `supabase status` print them. **Never commit them, and never paste them into
a document, a WORKLOG entry or a commit message** — not even the well-known local demo keys.
`secretlint` runs on every commit, and the rule has no exemption for keys that "do not matter".

Capture them into a git-ignored `.env.local` when you need them, mapping the CLI's variable names
onto the ones `.env.example` declares:

```bash
pnpm exec supabase status -o env \
  --override-name api.url=SUPABASE_URL \
  --override-name auth.anon_key=SUPABASE_ANON_KEY \
  --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY \
  --override-name db.url=SUPABASE_DB_URL \
  > .env.local
```

`.env.local` is ignored by both the root `.gitignore` and `supabase/.gitignore`. Confirm with
`git check-ignore -v .env.local` if you are unsure.

**`>` overwrites the file.** `eve link` also writes an AI Gateway credential into `.env.local`, so
if you have linked a Vercel project, append with `>>` instead and remove the previous Supabase
block by hand, rather than clobbering the Gateway key. `SUPABASE_SERVICE_ROLE_KEY` is server-side
only: it bypasses row-level security and must never reach a client or an agent tool.

## When something goes wrong

### Docker is not running

`supabase start` fails while trying to reach the Docker daemon. Start Docker Desktop (or your
daemon), wait for it to report ready, then retry. `docker run --rm hello-world` is the quickest
way to confirm the daemon actually works before blaming the CLI.

### A port is already in use

The error names the port. Find the holder and decide which one moves:

```bash
lsof -nP -iTCP:54322 -sTCP:LISTEN
```

Most often it is a second Supabase stack from another repository on the same machine. Stop that
one instead of changing this repository's ports:

```bash
pnpm exec supabase stop --all      # stops every local Supabase instance on the machine
```

Change a port in `supabase/config.toml` only as a last resort. It is committed, so the change
applies to everyone and to CI, and it needs a WORKLOG note saying why.

### The stack is wedged, or a reset will not finish

Stop it and throw the data away, then start clean. This destroys local data and is safe precisely
because everything that matters is committed:

```bash
pnpm exec supabase stop --no-backup
pnpm supabase:start
pnpm supabase:reset
```

If containers survive that, remove them and their volumes directly:

```bash
docker ps -a --filter name=supabase_ --format '{{.Names}}'
docker rm -f $(docker ps -aq --filter name=supabase_)
docker volume ls --filter name=supabase_ --format '{{.Name}}'
docker volume rm $(docker volume ls -q --filter name=supabase_)
```

Both commands match every project's containers and volumes on the machine, not only this one.
Narrow them with `--filter name=supabase_..._adaptive-agent-harness` if you run more than one.

### `pnpm supabase:types` left a broken or empty file

`supabase gen types` writes to stdout and the script redirects it, so a failed generation
truncates the file. Fix the underlying failure (usually: the stack is not running, or the reset
failed), then regenerate:

```bash
pnpm supabase:start
pnpm supabase:reset
pnpm supabase:types
```

If the file is still wrong, restore it and try again: `git checkout -- packages/storage-supabase/src/database.types.ts`.

### The CLI reports `Skipping migration README.md...`

Expected and harmless. `supabase/migrations/README.md` explains what the directory is for, and the
CLI mentions every file there that is not a `<timestamp>_name.sql` migration. A `.gitkeep` produces
the identical line. Do take the message seriously when it names a file you meant to be a migration:
it means the filename does not match the required pattern, so the migration was **not** applied.

### Generated types differ in CI but not locally

Almost always a stale local database. Reset first, then regenerate, then compare:

```bash
pnpm supabase:reset && pnpm supabase:types && git diff -- packages/storage-supabase/src/database.types.ts
```

If it still differs, check that your CLI is the pinned one (`pnpm exec supabase --version` must
match the `supabase` pin in the root `package.json`) rather than a global install shadowing it.
`pnpm test:unit` asserts that agreement, so a failing `supabase CLI pin` test is the same diagnosis.

## Related

- [ADR-0033](../decisions/0033-supabase-cli-as-a-pinned-dev-dependency-with-reset-as-the-reproducibility-gate.md),
  why the CLI is pinned, why reset is the gate, and why the generated file is committed.
- [`../development/commands.md`](../development/commands.md) for every root script.
- [`../development/local-setup.md`](../development/local-setup.md) for prerequisites.
- `supabase/migrations/README.md` for how a migration is created.
