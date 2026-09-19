# Local setup

How to get this repository running on a new machine. Milestone 0 has no services, no containers
and no secrets, so the whole setup is three commands after the clone.

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

## What you do not need

Milestone 0 needs **no Docker, no Supabase and no environment variables**. There is nothing to
start and nothing to copy before `pnpm install` works.

`.env.example` exists so the variable names are discoverable early, and every line in it is
commented out for exactly that reason. It records:

- Milestone 1: `AI_GATEWAY_API_KEY`.
- Milestone 2: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server side only,
  never exposed to a client or an agent tool).

Copy `.env.example` to `.env` and fill values in when the milestone that introduces them starts.
`.env` is never committed.

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
