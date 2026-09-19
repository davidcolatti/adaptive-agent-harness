---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/milestones/build-plan.md
  - docs/progress/WORKLOG.md
implementation:
  - package.json
  - pnpm-workspace.yaml
  - turbo.json
  - biome.json
  - vitest.config.ts
  - tsconfig.json
  - packages/config
---

# Milestone 0 toolchain verification

Implementation-reference record for Milestone 0, required by AD-011 (no guessed
framework behaviour) and AD-016 (internal choices are recorded, not implied).

Everything below was verified on **2026-09-19** against the packages actually
installed in `pnpm-lock.yaml`, on macOS (darwin 25.3.0, arm64) with
**Node v24.21.0** and **pnpm 12.4.2**. Where a web document disagreed with the
installed package, the installed package won and the discrepancy is recorded.

## 1. Installed versions

| Package | Exact version | Role |
| --- | --- | --- |
| node | 24.21.0 | runtime, pinned by `.node-version` / `.nvmrc` |
| pnpm | 12.4.2 | package manager, pinned by `packageManager` |
| typescript | 6.0.3 | compiler (`build`, `typecheck`) |
| turbo | 2.11.2 | task orchestration |
| @biomejs/biome | 2.5.14 | formatter, linter, import assist |
| vitest | 5.0.1 | test runner |
| vite | 8.3.0 | required non-optional peer of vitest 5 |
| @types/node | 24.13.6 | Node type definitions, held on the 24.x line |
| yaml | 2.9.1 | reads `pnpm-workspace.yaml` in the architecture test |
| husky | 9.1.7 | git hooks |
| secretlint | 13.0.5 | staged-file secret scan |
| @secretlint/secretlint-rule-preset-recommend | 13.0.5 | secret rule preset |

All versions are pinned exactly (no `^`, no `~`) in `package.json`.

`@types/node` is deliberately held on the **24.x** line to match the pinned
runtime. A newer major (26.x was installed first and then corrected) declares
APIs that do not exist on Node 24, which would let code typecheck and then fail
at runtime, defeating the point of the `.node-version` pin. The rule for this
repository is that the `@types/node` major always tracks the Node major in
`.node-version`.

## 2. Node 24

- Read: `node --help` (flags `--experimental-strip-types` / `--no-strip-types`,
  `--experimental-transform-types`).
- Verified by execution: a `.ts` file with type annotations, an interface and a
  `node:fs` import runs with a bare `node file.ts`, exit 0, no flags and no
  warning. This is why `scripts/verify-handoff.ts` is TypeScript and why no
  `tsx` or `ts-node` dependency exists.
- Constraint this imposes: type **stripping** only. Constructs that need code
  generation (`enum`, `namespace`, parameter properties) would require
  `--experimental-transform-types` and are therefore avoided in `scripts/`.
- Verified `import.meta.main` exists in Node 24.21.0 and is typed by
  `@types/node` 24.13.6 (`node_modules/@types/node/module.d.ts`, `main: boolean`
  on the global `ImportMeta` interface, tagged `@since v24.2.0` and
  `@experimental`). The CLI entry guard in `scripts/verify-handoff.ts` uses it.
  Because it is marked experimental upstream, the documented fallback if a
  future `@types/node` or Node release withdraws it is to compare
  `process.argv[1]` with `fileURLToPath(import.meta.url)`.

## 3. pnpm 12

- Read: <https://pnpm.io/settings> and <https://pnpm.io/settings/cli>.
- **pnpm 12 reads its settings from `pnpm-workspace.yaml`, not `.npmrc`.**
  Verified: with `engine-strict=true` in `.npmrc`,
  `pnpm config get engine-strict` returned `undefined`; after moving
  `engineStrict: true` into `pnpm-workspace.yaml`,
  `pnpm config get engineStrict` returned `true`. `.npmrc` was therefore
  deleted rather than left in place looking effective.
- **Documentation discrepancy (installed version wins).** The docs state:
  "Regardless of this configuration, installation will always fail if a project
  (not a dependency) specifies an incompatible version in its `engines` field."
  That is **not** the behaviour of pnpm 12.4.2. Verified twice: with
  `engines.node` set to `">=99 <100"`, both `pnpm install` and
  `pnpm install --force` exited 0, in this repository and in a clean scratch
  project with and without `engineStrict`. `engineStrict` gates *dependencies*
  only.
  Consequence: the Node pin is enforced by `.node-version` / `.nvmrc` locally
  and by `actions/setup-node` with `node-version-file` in CI. `engines.node`
  remains declared as documentation and for consumers.
- `nodeVersion` was deliberately **not** set. Leaving it unset makes
  `engineStrict` check dependencies against the Node version actually running,
  which catches a contributor on an old Node; pinning it would only make the
  check deterministic at the cost of that signal.
- `minimumReleaseAgeExclude` in `pnpm-workspace.yaml` is written by pnpm itself.
  pnpm 12 applies a supply-chain release-age gate (`minimumReleaseAge`, default
  1440 minutes) and records deliberately installed newer packages there.
  **pnpm appends but does not prune.** Read
  <https://pnpm.io/settings/dependency-resolution>:
  `minimumReleaseAgeExcludePrune` defaults to `false`, so a superseded version
  stays in the list forever unless it is removed by hand. Observed directly:
  changing `@types/node` from 26.6.2 to 24.13.6 turned the entry into
  `'@types/node@24.13.6 || 26.6.2'` rather than replacing it. The stale `26.6.2`
  was removed manually and a following `pnpm install` did not re-add it.

## 4. TypeScript 6.0.3

- Read: `node_modules/typescript/lib/typescript.d.ts` (confirmed
  `customConditions?: string[]`), `pnpm exec tsc --help --all`, and the
  installed `ts.ScriptTarget` / `ts.ModuleKind` enums (ES2024 and ES2025 targets
  and `NodeNext` module all present).
- Read: the official `@tsconfig/node24` base (v24.0.5, fetched from npm) to fix
  `target` and `lib`. It uses `target: es2024` with
  `lib: ["es2024", "ESNext.Array", "ESNext.Collection", "ESNext.Error",
  "ESNext.Iterator", "ESNext.Promise"]`, which `packages/config/tsconfig.base.json`
  follows exactly.
- Only one deprecation is reported by `tsc --help --all` (`out`, superseded by
  `outFile`); none of the options used here is deprecated, so the config is
  forward-compatible with TypeScript 7.
- **Version-line choice, verified against the official announcements.**
  TypeScript 7.0.2 is the current latest release and 6.0.3 is the newest of the
  6.0 line. This project pins 6.0.3. The rationale is confirmed, not assumed:

  - [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/):
    7.0 is the native Go port, and "TypeScript 7.0 is made available without an
    API. We expect TypeScript 7.1 to ship with a new (and different) API, but
    until then we have made it a priority to ensure TypeScript can be run
    side-by-side with TypeScript 6.0 for utilities that still need some
    programmatic access to the compiler (such as typescript-eslint)." Tooling
    authors who need the API are directed to stay on 6.0 or install the
    side-by-side package `@typescript/typescript6`
    (`npm install -D typescript@npm:@typescript/typescript6`).
  - [Announcing TypeScript 6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/):
    "TypeScript 6.0 is a unique release in that we intend for it to be the last
    release based on the current JavaScript codebase," and "TypeScript 6.0 acts
    as the bridge between TypeScript 5.9 and 7.0."

  So 6.0 is the last release that exposes the compiler API this project will
  need for AD-016 source generation.

- **ts-morph does not actually gate the TypeScript major.** Checked with
  `npm view ts-morph version` (28.0.0, published 2026-04-12) and
  `npm view ts-morph dependencies`, which returns
  `{ '@ts-morph/common': '~0.29.0', 'code-block-writer': '^13.0.3' }` — no
  `typescript` dependency. `npm view @ts-morph/common@0.29 dependencies` is
  `{ minimatch, path-browserify, tinyglobby }`, also with no `typescript`.
  ts-morph vendors its own compiler, so it will not break when this repository's
  `typescript` pin moves. The real constraint is the missing 7.0 API, not
  ts-morph.

- **Upgrade trigger.** Re-evaluate the 7.x line once 7.1 ships its new API, and
  at the latest before Milestone 8.

- **The configuration is already 7.0-ready.** None of the options 7.0 drops is
  used anywhere in the repository. Verified over all seven tsconfig files
  (`packages/config/tsconfig.base.json`,
  `packages/config/tsconfig.package.json`, both `packages/core/tsconfig*.json`,
  both `packages/testing/tsconfig*.json`, and the root `tsconfig.json`):

  ```sh
  grep -rniE '"target"[[:space:]]*:[[:space:]]*"es5"|"downlevelIteration"|"moduleResolution"[[:space:]]*:[[:space:]]*"(node|node10|classic)"|"module"[[:space:]]*:[[:space:]]*"(amd|umd|system|systemjs|none)"|"baseUrl"|"(esModuleInterop|allowSyntheticDefaultImports|alwaysStrict)"[[:space:]]*:[[:space:]]*false' \
    packages/config/tsconfig.base.json packages/config/tsconfig.package.json \
    packages/core/tsconfig.json packages/core/tsconfig.build.json \
    packages/testing/tsconfig.json packages/testing/tsconfig.build.json \
    tsconfig.json
  ```

  Exit code 1, no matches. The grep was control-tested by planting
  `"baseUrl": "."` in the root `tsconfig.json`, which it caught (exit 0); the
  file was then restored and confirmed byte-identical.
- Strict baseline required by M0-T2 is set in
  `packages/config/tsconfig.base.json`; no path-valued option appears there,
  because TypeScript resolves a relative path in an extended config against the
  file that declares it, which would point `rootDir`/`outDir` into
  `packages/config/`.

## 5. Cross-package resolution: the `@internal/source` condition

**This is a project-owned decision, not a documented framework requirement.**

Every workspace package declares:

```json
"exports": {
  ".": {
    "@internal/source": "./src/index.ts",
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js"
  }
}
```

- Typecheck configs set `"customConditions": ["@internal/source"]`, so
  `tsc --noEmit` reads a dependency's TypeScript source and never needs a prior
  build.
- Build configs (`tsconfig.build.json`) deliberately **omit** the condition, so
  `tsc -p tsconfig.build.json` compiles against a dependency's emitted `.d.ts`.
  That is why the turbo `build` task declares `dependsOn: ["^build"]`.
- Verified both directions with `packages/*/dist` deleted:
  `tsc --noEmit -p tsconfig.json` exits 0 with `customConditions` present, and
  fails with `TS2307: Cannot find module '@internal/testing'` when it is removed.
- `tests/toolchain/source-condition.test.ts` asserts the contract at runtime so
  it cannot rot silently.

## 6. Vitest 5.0.1 and Vite 8.3.0

- Read: `node_modules/vitest/dist/chunks/plugin.d.*.d.ts`,
  `pnpm exec vitest --help`, <https://vitest.dev/guide/migration>,
  <https://vitest.dev/config/>, <https://vite.dev/config/ssr-options.html>.
- **`vitest.workspace.ts` is not used.** The installed dist contains no
  reference to it; Vitest 5 expects `test.projects` inside `vitest.config.ts`.
  The build plan's repository layout lists `vitest.workspace.ts`; that part of
  the layout is stale for this version and the single root `vitest.config.ts`
  is used instead.
- Projects are selected with `--project <name>`, confirmed in `vitest --help`.
- **`passWithNoTests` is root-only.** The installed types list it in
  `NonProjectOptions`, so it cannot be set per project. It is set once at the
  root, which is what lets the `integration`, `contract` and `replay` layers
  pass before they have any files.
- `configDefaults.exclude` is only `["**/node_modules/**", "**/.git/**"]` in
  Vitest 5 (read at runtime, not assumed), so `**/dist/**` and `**/.turbo/**`
  are added explicitly.
- **Custom conditions must be set under `ssr.resolve`, not `resolve`.** Setting
  top-level `resolve.conditions` failed with
  `Failed to resolve entry for package "@internal/testing"`. Vitest resolves
  test modules through Vite's server environment; `ssr.resolve.conditions`
  covers dependencies Vite processes and `ssr.resolve.externalConditions`
  covers ones it externalises to Node. Assigning either replaces the defaults,
  so `defaultServerConditions` and `defaultExternalConditions` are imported from
  `vite` and spread rather than retyped by hand.
- `vite` is declared as a direct devDependency because vitest 5 lists it as a
  **non-optional** `peerDependency` (`^6.4.0 || ^7.0.0 || ^8.0.0`).

## 7. Biome 2.5.14

- Read: `node_modules/@biomejs/biome/configuration_schema.json`,
  `biome check --help`, `biome lint --help`,
  <https://biomejs.dev/reference/vscode/>.
- Biome's own linter rejected the first draft of `biome.json`, which is how two
  keys were corrected:
  - `rules.recommended` / `actions.recommended` are **deprecated**; the current
    key is `preset: "recommended"`.
  - Folder ignores must not carry a trailing `/**` since Biome 2.2.0:
    `"!**/dist"`, not `"!**/dist/**"` (rule
    `lint/suspicious/useBiomeIgnoreFolder`).
- `biome lint` does not run assist actions, so `lint` is
  `biome check --formatter-enabled=false .`, which runs the linter plus the
  `organizeImports` assist while leaving formatting to `format:check`.
  `--enforce-assist` defaults to `true`, so an unsorted import is an error.
- `format:check` is `biome format .` (no `--write`); verified to exit 1 on an
  unformatted file and 0 once formatted.
- `biome check --staged` exists and is the documented staged-file mode;
  `--no-errors-on-unmatched` keeps it quiet when no staged file is a type Biome
  handles.
- Biome parses comments in `tsconfig*.json`, verified by formatting a tsconfig
  containing `//` and `/* */` comments. The tsconfig files therefore carry real
  explanatory comments.
- `vcs.useIgnoreFile: true` makes Biome honour `.gitignore`.

## 8. Turborepo 2.11.2

- Read: `node_modules/turbo/schema.json` (`tasks` → `Pipeline` definition with
  `dependsOn`, `inputs`, `outputs`, `cache`, `persistent`).
- `turbo.json` declares three tasks: `build` (`dependsOn: ["^build"]`,
  `outputs: ["dist/**"]`), `typecheck` (no dependencies, no outputs, because the
  `@internal/source` condition removes the need for built dependencies), and
  `dev` (`cache: false`, `persistent: true`).
- `$schema` points at the installed `./node_modules/turbo/schema.json` so the
  schema can never drift from the installed binary.
- Turbo only runs workspace packages, never the repository root, which is why
  `pnpm typecheck` is `turbo run typecheck && tsc --noEmit -p tsconfig.json`:
  the second half covers `scripts/`, `tests/` and `vitest.config.ts`.

## 9. Husky 9.1.7 and secretlint 13.0.5

- Read: `node_modules/husky/README.md` (points at
  <https://typicode.github.io/husky>), the get-started page, and the generated
  `.husky/_` directory.
- `prepare: "husky"` is the documented v9 install; after `pnpm install`,
  `git config core.hooksPath` is `.husky/_`. Hook files in `.husky/` are plain
  shell with no shebang and no `husky.sh` source line.
- **`set -e` is mandatory in a hook.** The first draft without it ran every
  check and returned only the last exit code, so a Biome failure followed by a
  clean secret scan would have exited 0. Verified by reproducing the mask, then
  verified fixed: a staged lint error alone now fails the hook.
- Read: `node_modules/secretlint/README.md`. secretlint has **no `--staged`
  mode**; the documented approach is to pass file paths, with `--no-glob` to
  treat them as literal paths. The hook pipes
  `git diff --cached --name-only --diff-filter=ACMR -z` into `xargs -0`, which
  keeps filenames containing spaces intact.
- Caveat inherent to this approach: secretlint reads the working-tree file, not
  the staged blob, so a partially staged file is scanned in full.
- Rule preset configured in `.secretlintrc.json` exactly as the preset's README
  documents.
- **Verified false negative worth knowing:** `AKIAIOSFODNN7EXAMPLE`, the
  canonical AWS documentation key, is allow-listed by
  `@secretlint/secretlint-rule-aws` and is **not** reported. Gate proofs must
  use a non-example credential; a realistic AWS secret access key and a Slack
  bot token were both detected (exit 1).

## 10. GitHub Actions

Release tags checked against the GitHub releases API on 2026-09-19:

| Action | Latest release | Pinned as |
| --- | --- | --- |
| actions/checkout | v7.0.1 | `@v7` |
| pnpm/action-setup | v6.1.0 | `@v6` |
| actions/setup-node | v7.0.0 | `@v7` |

- Read: pnpm/action-setup README (v6 takes the pnpm version from the
  `packageManager` field when `version` is omitted) and actions/setup-node
  README (`node-version-file` accepts `.node-version`; `cache: pnpm` is
  supported; the one v7 breaking change is the removal of the dummy
  `NODE_AUTH_TOKEN` fallback, which this workflow does not rely on).
- `pnpm/action-setup` runs before `actions/setup-node` because setup-node's
  pnpm cache invokes `pnpm store path`.
- The workflow runs the six `pnpm check` stages as separate named steps, in the
  same order, so a red build names the gate that failed.

## 11. Project-owned decisions recorded here (AD-016)

1. The `@internal/source` export condition and the split between
   `tsconfig.json` (typecheck, source resolution) and `tsconfig.build.json`
   (emit, dist resolution). Not prescribed by any tool.
2. Workspace package naming `@internal/<dir>`, all `private: true`.
3. secretlint + `@secretlint/secretlint-rule-preset-recommend` as the secret
   scanner. Chosen for a documented staged-file-compatible CLI and a rule
   preset, with no service dependency.
4. `yaml` (eemeli/yaml 2.9.1) as the parser for `pnpm-workspace.yaml` in the
   architecture test, instead of a hand-rolled parser. Node 24 has no built-in
   YAML parser and the workspace file now carries pnpm-managed keys beyond
   `packages:`.
5. Dependency-boundary rules live in `tests/architecture/boundaries.ts` as a
   single data table plus a pure `findBoundaryViolations()` function, per M0-T3
   ("use TypeScript/architecture tests for rules Biome should not own"). Turbo
   2.x has a `boundaries` feature; it was not used, because the plan's rule is
   about declared dependencies across packages and the test form is also
   unit-testable with fabricated packages.
6. `lint` excludes formatting (`--formatter-enabled=false`) so that
   `format:check` and `lint` fail for distinct, non-overlapping reasons.
