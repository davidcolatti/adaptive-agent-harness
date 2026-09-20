# Local setup

How to get this repository running on a new machine. Clone, install, `pnpm check`, and everything
in the repository works except the local database. That one needs Docker, and is covered under
"Docker, for the local database" below.

## Prerequisites

| Tool | Exact version | Pinned by |
| --- | --- | --- |
| Node.js | 24.21.0 | `.node-version` and `.nvmrc` |
| pnpm | 12.4.2 | the `packageManager` field in the root `package.json` |

Both pins are exact on purpose. The root `package.json` also declares
`engines.node: ">=24 <25"`, but that field is documentation only: pnpm 12.4.2 does not fail an
install when the running Node violates a project's own `engines.node`, which was verified
directly and is written up in
[`docs/research/tooling/2026-09-19-m0-toolchain-verification.md`](../research/tooling/2026-09-19-m0-toolchain-verification.md)
section 3. The Node version is enforced locally by `.node-version` / `.nvmrc` and in CI by
`actions/setup-node` reading `node-version-file: .node-version`.

Any version manager that understands `.node-version` or `.nvmrc` works (`nvm`, `fnm`, `n`,
`asdf`, `mise`). Install Node 24.21.0, then confirm:

```sh
node --version   # v24.21.0
```

## Getting pnpm 12.4.2

### Normal path: Corepack

Corepack ships with Node and reads the `packageManager` field, so it installs and runs the exact
pinned pnpm version without a global install:

```sh
corepack enable
corepack prepare pnpm@12.4.2 --activate
pnpm --version   # 12.4.2
```

### Documented fallback: npm global install

Corepack is the normal way to get the pinned version, but the shim can fail to download pnpm. That
is not hypothetical here: on the machine that bootstrapped this repository the Corepack shim failed
to fetch pnpm 12, which is recorded in the "Environment notes" section of the Milestone 0 entry in
`docs/progress/WORKLOG.md`. The supported fallback is a plain global install of the same exact
version:

```sh
npm install -g pnpm@12.4.2
pnpm --version   # 12.4.2
```

Either route is fine as long as `pnpm --version` prints `12.4.2`. Do not use a different major:
pnpm 12 reads its settings from `pnpm-workspace.yaml` rather than `.npmrc`, and this repository
relies on that.

## Docker, for the local database

**Docker is required for Milestone 2 onward, and for nothing else.** `pnpm install`, `pnpm check`
and `pnpm example:run:mock` all work without it. Only the four `pnpm supabase:*` scripts need a
running Docker daemon, because the local Supabase stack is a set of containers.

Install Docker Desktop (or any Docker daemon) and confirm it works before the first start:

```sh
docker run --rm hello-world
```

The Supabase CLI itself is **not** a prerequisite. It is pinned in the root `package.json` at an
exact version and installed by `pnpm install`, so `pnpm supabase:start` runs the version this
repository states rather than whatever happens to be on your `PATH`. If you have a Homebrew or
npm-global `supabase`, leave it alone and never invoke it here; a different CLI version produces a
different database and different generated types from identical committed files. That is
[ADR-0033](../decisions/0033-supabase-cli-as-a-pinned-dev-dependency-with-reset-as-the-reproducibility-gate.md).

The first start pulls about a dozen container images and takes several minutes. Later starts take
seconds:

```sh
pnpm supabase:start
```

It binds ports 54320 to 54324, 54327 and 8083 (and 54329 when the connection pooler is enabled,
which it is not). None of those collides with `eve dev` (port 2000 by default) or `eve start`
(3000). Stop the stack when you are done, which keeps the data volume:

```sh
pnpm supabase:stop
```

`supabase start` prints local URLs and keys on the way up. **Never commit them or paste them into
a document**, not even the well-known local demo keys. The runbook,
[`../runbooks/supabase-local.md`](../runbooks/supabase-local.md), has the supported way to capture
them into a git-ignored `.env.local`, plus what to do when a port collides, when Docker is down,
and when the stack needs wiping.

## What you do not need

Nothing else. There is nothing to start and nothing to copy before `pnpm install` works, and
`pnpm check` needs neither Docker nor a credential.

`.env.example` exists so the variable names are discoverable early, and every line in it is
commented out for exactly that reason. It records:

- Milestone 1: `AI_GATEWAY_API_KEY` or `VERCEL_OIDC_TOKEN`, and the optional
  `EXAMPLE_AGENT_MODEL`.
- Milestone 2: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server side only,
  never exposed to a client or an agent tool).

Copy `.env.example` to `.env` and fill values in when the milestone that introduces them starts.
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are what `createSupabaseStorage()` reads (M2-T5),
and what `pnpm example:run:mock` checks before deciding whether to record a run row. Both or
neither: one without the other counts as not configured. `SUPABASE_ANON_KEY` is optional and only
the row-level-security cases in the schema integration suite use it.

Local Supabase values go in `.env.local` instead, which the runbook generates for you. Neither
file is ever committed.

### What needs a model credential, and what does not

`pnpm check` needs **none**, and neither does anything it runs. That includes `pnpm test:contract`,
which as of M1-T6 starts a real `eve dev` server and runs `EveAgentRuntime` against it; the fixture
agent's model is eve's own `mockModel`, and the helper that starts the server strips
`AI_GATEWAY_API_KEY` and `VERCEL_OIDC_TOKEN` from the child so a logged-in machine cannot quietly
reach a provider.

Exactly one command needs a credential:

| Command | Credential |
| --- | --- |
| `pnpm example:run` | `AI_GATEWAY_API_KEY` **or** `VERCEL_OIDC_TOKEN`. It exits 1 with a message naming `.env.example` when neither is set. |
| `pnpm example:run:mock` | none. Same harness path, scripted model. |

Neither example command needs Supabase. With `.env.local` present and holding the two Supabase
variables, both additionally write a durable run row and trace; without it they write only the
JSONL trace and say so. The `start` script loads the file with Node 24's
`--env-file-if-exists=../../.env.local`, so nothing has to be exported by hand.
| `pnpm --filter @internal/example-agent run dev` | a credential, because eve's terminal UI reaches a real model. |

`eve link` writes a Gateway credential into `.env.local` for you if the project is linked to a
Vercel project; `eve dev`'s `/login` stores one in the OS secret store instead. Never commit
either.

## Setup sequence

```sh
git clone <repository-url>
cd adaptive-agent-harness
pnpm install
pnpm check
```

`pnpm check` is the single local quality gate. It runs, in order, `format:check`, `lint`,
`typecheck`, `test`, `build` and `check:handoff`. If it exits 0, your machine is set up correctly.
See [`commands.md`](commands.md) for what each script does and how to run a narrower slice while
you work.

## What `pnpm install` does beyond installing dependencies

The root `package.json` declares `"prepare": "husky"`. pnpm runs `prepare` automatically after a
successful install, so the install also installs the git hooks: Husky 9 creates `.husky/_` and sets
`core.hooksPath` to it. You can confirm this after the first install:

```sh
git config core.hooksPath   # .husky/_
```

There is no separate "install the hooks" step, and no `husky install` command in Husky 9. If the
hooks ever stop firing, re-run `pnpm install`.

## Editor setup

The repository ships VS Code settings so that editor behaviour matches the `pnpm check` gates
instead of fighting them.

- `.vscode/extensions.json` recommends one extension, `biomejs.biome`. Install it when the editor
  offers.
- `.vscode/settings.json` sets Biome as the default formatter for JavaScript, TypeScript, JSON and
  JSONC, turns on `editor.formatOnSave`, and runs Biome's `source.fixAll` and
  `source.organizeImports` code actions on save. Import order is enforced by `pnpm lint`, so
  organise-on-save is what keeps you from tripping that gate.
- The same file pins `typescript.tsdk` to the workspace TypeScript in `node_modules/typescript/lib`
  and sets `files.eol` to `\n`, matching Biome's `lineEnding: "lf"`.

Other editors are fine; run Biome through `pnpm format` and `pnpm lint` instead.

## How the git hooks behave

Both hooks are plain shell files in `.husky/` and both begin with `set -e`, which is mandatory:
without it only the last command's exit code reaches git, so an earlier failure is masked.

### `.husky/pre-commit`

Fast, staged-file-only checks.

1. If nothing is staged (`git diff --cached --name-only --diff-filter=ACMR` is empty), the hook
   exits 0 immediately.
2. Secret scan first, because a leaked credential is the most serious thing a commit can carry. The
   staged paths are piped into `secretlint` explicitly (`-z` into `xargs -0`, with `--no-glob`),
   because secretlint has no staged mode of its own.
3. Then `biome check --staged --no-errors-on-unmatched`, which covers formatting, lint rules and
   import organisation on the staged files only.

One caveat inherent to step 2: secretlint reads the working-tree file rather than the staged blob,
so a partially staged file is scanned in full.

### `.husky/pre-push`

Whole-repository checks that are still cheap enough to run before a push:

1. `pnpm run typecheck`
2. `pnpm run test:unit`

These are not restricted to staged files. Integration, contract, replay and live-provider suites
are deliberately **not** run here because they are more expensive; they belong to CI or to a manual
run. If you want the full gate before pushing, run `pnpm check` yourself.

## The `"@internal/source"` export condition, in two sentences

Every workspace package's `package.json` exposes `"@internal/source": "./src/index.ts"` in its
`exports` map alongside the normal `types` and `default` conditions that point into `dist`, and the
tsconfig files used for typechecking enable it through `"customConditions": ["@internal/source"]`.
The effect is that typechecking and tests resolve a workspace dependency to its TypeScript source
directly, so neither ever requires a prior `pnpm build`.

Full detail, including the build configs that deliberately omit the condition and the verification
that proves the behaviour in both directions, is in
[`docs/research/tooling/2026-09-19-m0-toolchain-verification.md`](../research/tooling/2026-09-19-m0-toolchain-verification.md)
section 5.
