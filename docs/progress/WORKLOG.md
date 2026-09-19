# WORKLOG

Append-only implementation log. Every material task gets a `started` entry
before implementation and a result entry when it stops for any reason.
Entry format is defined in `docs/progress/README.md` (source: build plan AD-014).

Never rewrite or delete earlier entries. Append corrections as new entries.

---

## 2026-09-19 15:55 — M0 — Milestone 0: Repository Foundation (session start)

**Status:** started
**Actor/session:** Claude Fable 5.1 orchestrator + implementer subagents
**Commit:** not committed

### Goal
Bootstrap the empty repository and complete every Milestone 0 task
(M0-T1 … M0-T11) from `docs/milestones/build-plan.md`, leaving a verified,
documented workspace from which Milestone 1 can begin. No Milestone 1
functionality (agent runtime, eve, Jev, workflow, compiler, storage) is built.

### Implementation references
- Toolchain verified against the npm registry on 2026-09-19:
  Node 24.21.0 (LTS "Krypton"), pnpm 12.4.2, turbo 2.11.2,
  @biomejs/biome 2.5.14, vitest 5.0.1 (4.1.11 prior line), typescript 7.0.2
  (6.0.3 prior line), husky 9.1.7, secretlint 13.0.5.
- Per-tool documentation references are recorded in the task entries below and
  in `docs/research/`.

### Environment notes
- Host machine had Node 23.11.0 and a Corepack shim for pnpm that failed to
  download pnpm 12. Node 24.21.0 and pnpm 12.4.2 were installed into the
  user-local prefix `~/.n` (via the pre-existing `n` tool) and used through
  `PATH="$HOME/.n/bin:$PATH"`. Nothing system-wide was changed.
- The build plan was copied verbatim into `docs/milestones/build-plan.md` so the
  repository is self-describing.

### Next exact step
Task M0-T1 … M0-T6 + M0-T10 (workspace/tooling) and M0-T8 (ADRs) start in
parallel; M0-T7, M0-T9, M0-T11 (AGENTS.md, docs system) follow once the
tooling exists so they describe the real repository.

---

## 2026-09-19 16:20 — M0-T1 — Bootstrap workspace

**Status:** completed
**Actor/session:** implementer subagent (opus) — tooling
**Commit:** not committed

### Goal
Create the pnpm workspace, Node 24 pin, Turborepo task graph, the three
Milestone 0 packages, repository hygiene files and the root script surface
required by M0-T1, so that `pnpm check` is the single local quality gate.

### Implementation references
- package/version: pnpm 12.4.2, turbo 2.11.2, Node 24.21.0.
- installed docs read: `node --help`; `node_modules/turbo/schema.json`
  (`tasks` → `Pipeline`: `dependsOn`, `inputs`, `outputs`, `cache`,
  `persistent`); `pnpm config get`.
- official docs/repos/examples read: <https://pnpm.io/settings>,
  <https://pnpm.io/settings/cli>.
- public types/exports inspected: turbo JSON schema definitions; pnpm settings
  resolved via `pnpm config get`.
- selected documented pattern: settings in `pnpm-workspace.yaml` (not
  `.npmrc`); `packageManager` pin; turbo `build` with `dependsOn: ["^build"]`
  and `outputs: ["dist/**"]`, `dev` persistent and uncached.

### Work completed
- `pnpm-workspace.yaml` with `packages/*`, `engineStrict: true` and the
  pnpm-managed `minimumReleaseAgeExclude` list.
- Root `package.json`: `type: module`, `packageManager: pnpm@12.4.2`,
  `engines.node: ">=24 <25"`, exact (unprefixed) dependency versions, and the
  full script surface: `dev`, `build`, `typecheck`, `test`, `test:unit`,
  `test:integration`, `test:contract`, `test:replay`, `lint`, `format`,
  `format:check`, `check:handoff`, `check`, `prepare`.
- `.node-version` and `.nvmrc` both `24.21.0`.
- `turbo.json` with `build`, `typecheck`, `dev`.
- Three packages, all `private`, named `@internal/<dir>`: `config` (TypeScript
  config bases only), `testing` (one real helper, `createFakeClock`), `core`
  (an honest empty boundary: a comment plus `export {}`).
- `.gitignore`, `.editorconfig`, `.env.example` (no values; commented
  placeholders marked not-used-until-M1/M2), `.vscode/settings.json`,
  `.vscode/extensions.json`.

### Files changed
- `pnpm-workspace.yaml`, `package.json`, `pnpm-lock.yaml`, `turbo.json`
- `.node-version`, `.nvmrc`, `.gitignore`, `.editorconfig`, `.env.example`
- `.vscode/settings.json`, `.vscode/extensions.json`
- `packages/config/{package.json,tsconfig.base.json,tsconfig.package.json}`
- `packages/core/{package.json,tsconfig.json,tsconfig.build.json,src/index.ts}`
- `packages/testing/{package.json,tsconfig.json,tsconfig.build.json,src/index.ts,src/clock.ts,src/clock.test.ts}`

### Verification
- `pnpm install` — PASS
- `pnpm check` — PASS (all six stages, from a clean `dist`)
- `pnpm build` — PASS (emits `dist/` for `@internal/core` and `@internal/testing`)
- `pnpm --filter @internal/testing build` — PASS (builds independently)
- `pnpm --filter @internal/core build` — PASS (builds independently)
- `pnpm dev` — PASS (both packages enter `tsc --watch`, "Found 0 errors",
  killed after 20s; persistent by design)

### Decisions / deviations
- `.npmrc` was created with `engine-strict=true` and then **deleted**: pnpm 12
  does not read it (`pnpm config get engine-strict` → `undefined`). The
  documented pnpm 12 equivalent, `engineStrict: true` in `pnpm-workspace.yaml`,
  is used instead.
- Documentation discrepancy, installed version wins: pnpm's docs claim an
  install always fails when the **project's own** `engines` field is
  incompatible. pnpm 12.4.2 does not. Verified with `engines.node` set to
  `">=99 <100"`: `pnpm install` and `pnpm install --force` both exit 0, in this
  repository and in a clean scratch project, with and without `engineStrict`.
  The Node pin is therefore enforced by `.node-version` / `.nvmrc` and CI.
- `pnpm typecheck` is `turbo run typecheck && tsc --noEmit -p tsconfig.json`.
  Turbo never runs the repository root, so the second half is what covers
  `scripts/`, `tests/` and `vitest.config.ts`.
- No `apps/*` and no packages beyond the three named ones were created;
  Milestone 1 owns those.

### Known issues / blockers
- `engines.node` is declarative only (see above).
- `pnpm dev` is only defined by `@internal/core` and `@internal/testing`; there
  is nothing else to watch yet.

### Next exact step
Milestone 1 adds `apps/example-agent` and the runtime packages; extend
`turbo.json` only if a task genuinely differs from `build`/`typecheck`/`dev`.

---

## 2026-09-19 16:20 — M0-T2 — TypeScript strict baseline

**Status:** completed
**Actor/session:** implementer subagent (opus) — tooling
**Commit:** not committed

### Goal
Turn on the eight strictness flags M0-T2 names, plus the module/ESM settings
the project needs, in one shared base that covers every TypeScript file in the
repository including root scripts, root tests and config files.

### Implementation references
- package/version: typescript 6.0.3 (latest 6.0.x; 7.0.2 is the latest overall).
- installed docs read: `node_modules/typescript/lib/typescript.d.ts`
  (`customConditions?: string[]`), `pnpm exec tsc --help --all`, installed
  `ts.ScriptTarget` and `ts.ModuleKind` enums.
- official docs/repos/examples read: `@tsconfig/node24` v24.0.5 (fetched from
  npm and read directly) for `target`/`lib`.
- public types/exports inspected: as above.
- selected documented pattern: `target`/`lib` copied from `@tsconfig/node24`;
  `module`/`moduleResolution` `nodenext`; a base with no path-valued options,
  because TypeScript resolves a relative path in an extended config against the
  file that declares it.

### Work completed
- `packages/config/tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`,
  `noFallthroughCasesInSwitch`, `noImplicitReturns`,
  `useUnknownInCatchVariables`, `forceConsistentCasingInFileNames`, plus
  `isolatedModules`, `verbatimModuleSyntax`, `module`/`moduleResolution`
  `nodenext`, `target` es2024 with the `@tsconfig/node24` lib set,
  `types: ["node"]`, `skipLibCheck`. No `baseUrl`.
- `packages/config/tsconfig.package.json`: adds `declaration`,
  `declarationMap`, `sourceMap`.
- Per package: `tsconfig.json` (typecheck, `noEmit`, `customConditions`) and
  `tsconfig.build.json` (`rootDir: src`, `outDir: dist`, no custom condition).
- Root `tsconfig.json` covering `scripts/**/*.ts`, `tests/**/*.ts` and
  `vitest.config.ts`.
- ESM throughout: every `package.json` is `"type": "module"`.

### Files changed
- `packages/config/tsconfig.base.json`, `packages/config/tsconfig.package.json`
- `packages/core/tsconfig.json`, `packages/core/tsconfig.build.json`
- `packages/testing/tsconfig.json`, `packages/testing/tsconfig.build.json`
- `tsconfig.json`

### Verification
- `pnpm typecheck` — PASS
- deliberate type error in `packages/core/src/__gate-proof.ts` →
  `pnpm typecheck` — FAIL as intended, exit 2,
  `src/__gate-proof.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.`
  Reverted; `pnpm typecheck` — PASS
- deliberate type error in `scripts/__gate-proof.ts` → `pnpm typecheck` —
  FAIL as intended, exit 2, same TS2322. This proves root scripts are covered,
  not only packages. Reverted; `pnpm typecheck` — PASS
- `tsc --noEmit -p tsconfig.json` with `packages/*/dist` deleted — PASS,
  proving typecheck never needs a prior build
- same command with `customConditions` removed — FAIL as intended,
  `TS2307: Cannot find module '@internal/testing'`. Restored; PASS
- `pnpm build` — PASS, emits `.js`, `.d.ts`, `.js.map` and `.d.ts.map`

### Decisions / deviations
- Project-owned: the `"@internal/source"` export condition. Packages expose
  `"@internal/source": "./src/index.ts"` next to `types`/`default` pointing at
  `dist`. Typecheck configs enable it via `customConditions`; build configs do
  not, so a package compiles against its dependencies' emitted declarations,
  which is what makes turbo's `build` → `^build` dependency real.
- `tsBuildInfoFile` was written and then removed: without `incremental` or
  `composite` it emits nothing, and a no-op setting in a config is misleading.
  Turbo already caches build outputs.
- The 6.0-over-7.0 choice was made by the orchestrator. What is verified here is
  narrower: 6.0.3 installs, typechecks, builds and emits correctly under Node
  24, and `tsc --help --all` reports no deprecated option in use. The claim that
  6.0 is the last JavaScript-based line and therefore safer for ts-morph was not
  independently confirmed and is flagged in the research note.

### Known issues / blockers
- None.

### Next exact step
Milestone 1 packages copy `packages/core/tsconfig*.json` verbatim; only
`include`/`exclude` should ever differ.

---

## 2026-09-19 16:20 — M0-T3 — Biome and the architecture boundary test

**Status:** completed
**Actor/session:** implementer subagent (opus) — tooling
**Commit:** not committed

### Goal
Make Biome the only formatter and baseline linter, with unused-code,
suspicious, correctness and import-organisation rules on, and put the
dependency rule from the build plan into an architecture test rather than into
the linter.

### Implementation references
- package/version: @biomejs/biome 2.5.14, yaml 2.9.1.
- installed docs read:
  `node_modules/@biomejs/biome/configuration_schema.json` (`Rules`, `Actions`,
  `Source`, `Correctness`, `FilesConfiguration`, `PresetConfig`,
  `RuleAssistPlainConfiguration`), `biome check --help`, `biome lint --help`.
- official docs/repos/examples read: <https://biomejs.dev/reference/vscode/>.
- public types/exports inspected: the JSON schema definitions above.
- selected documented pattern: `preset: "recommended"` per rule group;
  `assist.actions.source.organizeImports: "on"`; folder ignores without a
  trailing `/**`; `biome check --formatter-enabled=false .` for lint + assist.

### Work completed
- `biome.json`: 2-space indent, double quotes, LF, line width 100; recommended
  presets on for every rule group with no rule disabled; unused
  imports/variables/parameters/private-members/labels raised to `error`;
  `useImportType`, `useExportType`, `useNodejsImportProtocol` raised to `error`;
  `organizeImports` assist on; `vcs.useIgnoreFile: true`; `dist`,
  `node_modules`, `.turbo`, `coverage` and `pnpm-lock.yaml` ignored.
- `tests/architecture/boundaries.ts`: one commented `BOUNDARY_RULES` constant
  encoding the build plan's Dependency rule, plus the pure functions
  `matchesPattern`, `findBoundaryViolations` and `formatViolations`.
- `tests/architecture/package-boundaries.test.ts`: reads `pnpm-workspace.yaml`
  with the `yaml` parser, loads every workspace `package.json`, asserts the real
  workspace is clean, and exercises the rule engine against fabricated
  violating packages.

### Files changed
- `biome.json`
- `tests/architecture/boundaries.ts`
- `tests/architecture/package-boundaries.test.ts`
- `package.json` (added `yaml` devDependency; `lint`, `format`, `format:check`
  scripts)

### Verification
- `pnpm lint` — PASS
- `pnpm format:check` — PASS
- badly formatted file added → `pnpm format:check` — FAIL as intended, exit 1,
  Biome printed the expected diff. Reverted; PASS
- fabricated `packages/core` dependency on `eve` → architecture test — FAIL as
  intended, exit 1, message:
  `eve matches the adapter-only pattern "eve"; only an adapter package (@internal/runtime-eve, @internal/decision-jev, @internal/storage-supabase, @internal/runtime-ai-sdk, @internal/workflow-vercel, @internal/sandbox-vercel) may depend on it`.
  Reverted; PASS
- `pnpm test:unit` (includes 13 rule-engine cases) — PASS

### Decisions / deviations
- Biome's own linter rejected the first `biome.json`, which corrected two keys:
  `rules.recommended` / `actions.recommended` are deprecated in favour of
  `preset: "recommended"`, and folder ignores must not carry a trailing `/**`
  since Biome 2.2.0 (`lint/suspicious/useBiomeIgnoreFolder`). Both were fixed at
  the source rather than suppressed.
- `pnpm lint` is `biome check --formatter-enabled=false .`, because `biome lint`
  does not run assist actions and import organisation is required by M0-T3.
  Formatting stays with `format:check`, so the two scripts fail for distinct
  reasons.
- Turbo 2.x ships a `boundaries` feature; it was not used. The plan's rule is
  about declared dependencies between packages, and the test form is additionally
  unit-testable with fabricated packages, which a linter rule is not.
- `yaml` was added rather than hand-parsing `pnpm-workspace.yaml`. Node 24 has
  no built-in YAML parser and the file now carries pnpm-managed keys beyond
  `packages:`.

### Known issues / blockers
- The adapter list in `BOUNDARY_RULES` names packages that do not exist yet
  (`@internal/runtime-eve` and the rest). That is intentional: the table is the
  extension point, and the test asserts the real workspace separately.

### Next exact step
When Milestone 1 adds a package, add it to `BOUNDARY_RULES.adapterPackages`
only if it is genuinely an adapter, and update the expected package list in
`package-boundaries.test.ts`.

---

## 2026-09-19 16:20 — M0-T4 — Vitest and the test-helpers package

**Status:** completed
**Actor/session:** implementer subagent (opus) — tooling
**Commit:** not committed

### Goal
Stand up the four test layers from the build plan's testing strategy as named
Vitest projects with individual run scripts, and create the shared test-helpers
package M0-T4 requires immediately.

### Implementation references
- package/version: vitest 5.0.1, vite 8.3.0.
- installed docs read: `node_modules/vitest/dist/chunks/plugin.d.*.d.ts`
  (`TestProjectConfiguration`, `ProjectConfig`, `NonProjectOptions`),
  `pnpm exec vitest --help` (`--project`), `configDefaults` read at runtime,
  `node_modules/vitest/package.json` peerDependencies.
- official docs/repos/examples read: <https://vitest.dev/guide/migration>,
  <https://vitest.dev/config/>, <https://vite.dev/config/ssr-options.html>.
- public types/exports inspected: `vitest/config` exports; Vite's
  `defaultServerConditions` and `defaultExternalConditions`.
- selected documented pattern: one root `vitest.config.ts` with `test.projects`;
  `--project <name>` to select; `ssr.resolve.conditions` and
  `ssr.resolve.externalConditions` for the custom export condition.

### Work completed
- `vitest.config.ts` with four named projects: `unit` (`**/*.test.ts` minus the
  three suffixed layers), `integration`, `contract`, `replay`.
- `passWithNoTests` set once at the root.
- `@internal/testing` exporting exactly one helper, `createFakeClock({ start })`
  returning `{ now, advance, isoNow }`, with six unit tests.
- `tests/toolchain/source-condition.test.ts` asserting the `@internal/source`
  contract at runtime.
- Scripts `test`, `test:unit`, `test:integration`, `test:contract`,
  `test:replay`.

### Files changed
- `vitest.config.ts`
- `packages/testing/src/clock.ts`, `packages/testing/src/index.ts`,
  `packages/testing/src/clock.test.ts`, `packages/testing/package.json`
- `tests/toolchain/source-condition.test.ts`
- `package.json` (test scripts; `vite` devDependency)

### Verification
- `pnpm test` — PASS (4 files, 42 tests)
- `pnpm test:unit` — PASS (4 files, 42 tests)
- `pnpm test:integration` — PASS ("No test files found, exiting with code 0")
- `pnpm test:contract` — PASS (no files)
- `pnpm test:replay` — PASS (no files)
- deliberately failing unit test added → `pnpm test:unit` — FAIL as intended,
  exit 1, `AssertionError: expected 1 to be 2`. Reverted; PASS
- `import.meta.resolve("@internal/testing")` resolves to
  `.../packages/testing/src/index.ts` — PASS

### Decisions / deviations
- **`vitest.workspace.ts` is not used.** The installed Vitest 5 dist contains no
  reference to it and expects `test.projects` in `vitest.config.ts`. The build
  plan's repository layout lists `vitest.workspace.ts`; that entry is stale for
  this version.
- `passWithNoTests` is listed in `NonProjectOptions` in the installed types, so
  it cannot be set per project and is set once at the root.
- Top-level `resolve.conditions` did **not** work: it failed with
  `Failed to resolve entry for package "@internal/testing"`. Vitest resolves
  through Vite's server environment, so the condition belongs under
  `ssr.resolve`. Both `conditions` and `externalConditions` are set, and both
  spread Vite's exported defaults, because assigning them replaces rather than
  extends the defaults.
- `vite` is a direct devDependency because vitest 5 declares it as a
  non-optional `peerDependency`.
- `configDefaults.exclude` is only `node_modules` and `.git` in Vitest 5, so
  `**/dist/**` and `**/.turbo/**` are excluded explicitly.

### Known issues / blockers
- Three of the four layers have no test files yet. They are wired and pass by
  design until Milestones 1-6 fill them.

### Next exact step
Milestone 1 adds the first `*.contract.test.ts` for the `AgentRuntime`
boundary; no config change should be needed.

---

## 2026-09-19 16:20 — M0-T5 — Git hooks

**Status:** completed
**Actor/session:** implementer subagent (opus) — tooling
**Commit:** not committed

### Goal
Install Husky and add a pre-commit hook that runs Biome and a secret scan on
staged files, and a pre-push hook that runs typecheck and unit tests, with
nothing expensive in either.

### Implementation references
- package/version: husky 9.1.7, secretlint 13.0.5,
  @secretlint/secretlint-rule-preset-recommend 13.0.5.
- installed docs read: `node_modules/husky/README.md`,
  `node_modules/secretlint/README.md` (full CLI usage and exit-status table),
  `node_modules/@secretlint/secretlint-rule-preset-recommend/README.md`,
  `biome check --help` (`--staged`, `--no-errors-on-unmatched`).
- official docs/repos/examples read:
  <https://typicode.github.io/husky/get-started.html>.
- public types/exports inspected: the generated `.husky/_` directory and
  `git config core.hooksPath`.
- selected documented pattern: `prepare: "husky"`; plain shell hook files with
  no shebang and no `husky.sh` source line; `biome check --staged`; secretlint
  invoked with explicit literal paths via `--no-glob`.

### Work completed
- `prepare: "husky"` in the root `package.json`; verified it sets
  `core.hooksPath` to `.husky/_`.
- `.husky/pre-commit`: `set -e`, early exit when nothing is staged, secret scan
  over the staged paths, then `biome check --staged --no-errors-on-unmatched`.
- `.husky/pre-push`: `set -e`, `pnpm run typecheck`, `pnpm run test:unit`.
- `.secretlintrc.json` with the recommended preset; `.secretlintignore`.

### Files changed
- `.husky/pre-commit`, `.husky/pre-push`
- `.secretlintrc.json`, `.secretlintignore`
- `package.json` (`prepare` script; secretlint devDependencies)

### Verification
All hook runs below were executed directly with `sh .husky/<hook>`, never by
committing.
- staged file containing a realistic AWS secret access key →
  `sh .husky/pre-commit` — FAIL as intended, exit 1,
  `error [AWSSecretAccessKey] found AWS Secret Access Key` from
  `@secretlint/secretlint-rule-preset-recommend > @secretlint/secretlint-rule-aws`.
  Unstaged and deleted; index back to 0 staged files
- staged file with only a lint error (unused import) →
  `sh .husky/pre-commit` — FAIL as intended, exit 1,
  `lint/correctness/noUnusedImports`. Unstaged and deleted
- clean staged file → `sh .husky/pre-commit` — PASS, exit 0
- `sh .husky/pre-push` — PASS (typecheck 2 tasks, 4 test files)
- deliberate type error → `sh .husky/pre-push` — FAIL as intended, exit 2.
  Reverted; PASS

### Decisions / deviations
- **`set -e` is required and was initially missing.** The first draft ran every
  check and returned only the last command's exit code, so a Biome failure
  followed by a clean secret scan would have exited 0. This was reproduced, then
  fixed, then re-proved with a lint-only failure.
- secretlint has no `--staged` mode. The documented approach is explicit file
  paths, so the hook pipes
  `git diff --cached --name-only --diff-filter=ACMR -z` into `xargs -0` and
  passes `--no-glob` so each argument is a literal path. Filenames containing
  spaces survive.
- Known limitation of that approach: secretlint reads the working-tree file, not
  the staged blob, so a partially staged file is scanned in full.
- The secret scan runs before Biome, so the most serious failure is reported
  first.
- **Verified allow-list worth knowing:** `AKIAIOSFODNN7EXAMPLE`, the canonical
  AWS documentation key, is allow-listed by the AWS rule and is not reported.
  Any future test of this gate must use a non-example credential.

### Known issues / blockers
- Hooks run `pnpm`, so a contributor without pnpm on PATH gets a hook failure
  rather than a clear message. Acceptable: `packageManager` and `.node-version`
  already pin the toolchain.

### Next exact step
Leave the hooks alone until a milestone adds a check that is both cheap and
worth blocking a commit on.

---

## 2026-09-19 16:20 — M0-T6 — GitHub Actions

**Status:** completed
**Actor/session:** implementer subagent (opus) — tooling
**Commit:** not committed

### Goal
Add the initial CI workflow: install with a frozen lockfile, then run the same
gates as `pnpm check`, in the same order, as separately named steps.

### Implementation references
- package/version: actions/checkout v7.0.1, pnpm/action-setup v6.1.0,
  actions/setup-node v7.0.0 (latest release tags read from the GitHub releases
  API on 2026-09-19).
- installed docs read: n/a (GitHub-hosted actions).
- official docs/repos/examples read:
  <https://github.com/pnpm/action-setup> README,
  <https://github.com/actions/setup-node> README.
- public types/exports inspected: the documented action inputs.
- selected documented pattern: `pnpm/action-setup@v6` with no `version` input,
  which reads the pnpm version from the `packageManager` field; then
  `actions/setup-node@v7` with `node-version-file: .node-version` and
  `cache: pnpm`; then `pnpm install --frozen-lockfile`.

### Work completed
- `.github/workflows/ci.yml`: one `check` job on `ubuntu-latest`, triggered by
  push to `main` and by `pull_request`, with `concurrency` cancel-in-progress
  and `permissions: contents: read`.
- Steps: Checkout, Set up pnpm, Set up Node, Install, then Format, Lint,
  Typecheck, Test, Build, Handoff documentation.

### Files changed
- `.github/workflows/ci.yml`

### Verification
- `pnpm check` locally, which runs the identical six commands in the identical
  order — PASS
- each CI command individually: `pnpm run format:check` — PASS;
  `pnpm run lint` — PASS; `pnpm run typecheck` — PASS; `pnpm run test` — PASS;
  `pnpm run build` — PASS; `pnpm run check:handoff` — PASS
- `pnpm install --frozen-lockfile` — PASS (lockfile is committed-ready)
- Action versions confirmed current against the GitHub releases API on
  2026-09-19 — PASS

### Decisions / deviations
- Actions are pinned by major tag, not by commit SHA. Pinning to a SHA is the
  stricter supply-chain posture and should be revisited when the repository
  becomes public.
- `pnpm/action-setup` runs before `actions/setup-node` because setup-node's
  pnpm cache invokes `pnpm store path`.
- `pnpm/action-setup` v6 also offers its own `cache` input. setup-node's
  `cache: pnpm` is used instead, as specified, to keep Node and store caching
  in one place.
- The workflow has **not** been executed; there is no remote and nothing is
  committed. What is verified is that every command it runs passes locally on
  the pinned Node and pnpm versions.
- `.github/pull_request_template.md` was deliberately not created; another task
  owns it.

### Known issues / blockers
- The workflow is unexecuted until the first push. The first CI run should be
  watched.

### Next exact step
On the first push to a remote, watch the `check` job and reconcile any
ubuntu-vs-macOS difference (most likely candidates: line endings and
case-sensitive filenames, both already guarded by `lineEnding: "lf"` and
`forceConsistentCasingInFileNames`).

---

## 2026-09-19 16:20 — M0-T10 — Enforce work logging

**Status:** completed
**Actor/session:** implementer subagent (opus) — tooling
**Commit:** not committed

### Goal
Add the lightweight verification script M0-T10 requires, wired into `pnpm check`
as `check:handoff`, failing when the mandatory handoff files are missing or
internally inconsistent, without trying to infer whether every code edit was
logged.

### Implementation references
- package/version: Node 24.21.0 only; the script has no dependency outside
  `node:*`.
- installed docs read: `node --help` (type stripping); verified
  `import.meta.main` exists at runtime and is typed by @types/node 26.6.2.
- official docs/repos/examples read: the build plan's AD-014 entry template and
  the M0-T10 task definition.
- public types/exports inspected: `node:fs` `readFileSync`/`readdirSync`,
  `NodeJS.ErrnoException`.
- selected documented pattern: pure exported functions for the parsing and
  validation, a thin CLI wrapper that reads the files, guarded by
  `import.meta.main`.

### Work completed
- `scripts/verify-handoff.ts` exporting `parseWorkLogEntries`, `isCompleted`,
  `hasVerificationResult`, `referencedDecisionPrefixes`, `verifyHandoff` and
  `main`. It fails when: `docs/context/current-state.md` is missing;
  `docs/progress/WORKLOG.md` is missing; an entry whose `**Status:**` line says
  `completed` has no `### Verification` section containing a `PASS` or `FAIL`
  line; or a decision-record reference in either supported form (an `ADR-`
  prefix followed by four digits, or a `docs/decisions/` path beginning with
  four digits) has no matching file under `docs/decisions/`. This entry
  deliberately avoids writing a concrete 4-digit example: the first draft used
  one, and `pnpm check:handoff` correctly failed the WORKLOG for citing a
  record that does not exist, which is the rule working as designed.
- Entries are delimited by `## ` headings; text before the first heading is
  preamble and is not an entry.
- `scripts/verify-handoff.test.ts`: 22 cases against fixture strings, including
  a completed entry without verification, a started entry (which must not
  require one), a `PASS` that appears outside the verification section, a
  missing decision record, and a present one.
- Root script `check:handoff`, and `check:handoff` as the last stage of
  `pnpm check` and the last step of CI.

### Files changed
- `scripts/verify-handoff.ts`
- `scripts/verify-handoff.test.ts`
- `package.json` (`check:handoff`; `check`)
- `.github/workflows/ci.yml` (Handoff documentation step)

### Verification
- `pnpm check:handoff` against the current repository — PASS
  (`check:handoff — OK`)
- `pnpm test:unit` — PASS, including the 22 handoff cases
- `node scripts/verify-handoff.ts` run directly under Node 24 with no flags and
  no transpiler — PASS

### Decisions / deviations
- Per the task definition the script does not attempt to infer whether every
  code edit was logged.
- The decision-record rule matches only a 4-digit prefix, so the literal
  placeholder `ADR-NNNN` in documentation is not treated as a reference.
  `docs/decisions/` does not exist yet (another task owns it); an absent
  directory yields an empty prefix list rather than an error, which is why this
  passes today and will start biting the moment an entry cites a record.
- Rule severity is deliberately blunt: a `### Verification` section needs at
  least one `PASS` or `FAIL` line. It does not judge whether the verification is
  good, which is review's job.

### Known issues / blockers
- None.

### Next exact step
When `docs/decisions/` is created with `0000-template.md`, re-run
`pnpm check:handoff` and confirm a WORKLOG entry citing a real record passes.

---

## 2026-09-19 16:20 — M0 — Tooling task group result (M0-T1 … T6, T10)

**Status:** completed
**Actor/session:** implementer subagent (opus) — tooling
**Commit:** not committed

### Goal
Record the end-to-end result of the Milestone 0 tooling task group and the
single implementation-reference document required by AD-011 and AD-014.

### Implementation references
- Every dependency, the exact installed version, the files and URLs read for
  each, the configuration pattern selected, and every project-owned decision are
  recorded in
  `docs/research/tooling/2026-09-19-m0-toolchain-verification.md`.

### Work completed
- M0-T1, M0-T2, M0-T3, M0-T4, M0-T5, M0-T6 and M0-T10, each logged above.
- Three workspace packages, one root quality gate, four test layers, two git
  hooks, one CI workflow, one handoff verification script.

### Files changed
- `docs/research/tooling/2026-09-19-m0-toolchain-verification.md`
- All files listed in the entries above.

### Verification
- `pnpm install` — PASS
- `pnpm format:check` — PASS
- `pnpm lint` — PASS
- `pnpm typecheck` — PASS
- `pnpm test` — PASS (4 files, 42 tests)
- `pnpm test:unit` — PASS
- `pnpm test:integration` — PASS (no files)
- `pnpm test:contract` — PASS (no files)
- `pnpm test:replay` — PASS (no files)
- `pnpm build` — PASS
- `pnpm check:handoff` — PASS
- `pnpm check` — PASS end to end from a clean `dist`
- `pnpm --filter @internal/testing build` — PASS
- `pnpm --filter @internal/core build` — PASS
- `pnpm dev` — PASS (persistent watch tasks start cleanly)
- Gate-break proofs, each reverted and re-verified green: formatting — FAIL as
  intended; type error in a package — FAIL as intended; type error in a root
  script — FAIL as intended; failing unit test — FAIL as intended; staged AWS
  secret — FAIL as intended; staged lint error — FAIL as intended; fabricated
  `@internal/core` dependency on `eve` — FAIL as intended.

### Decisions / deviations
- Consolidated in the research note. The three that most affect later work:
  the `@internal/source` export condition; `vitest.workspace.ts` being obsolete
  in Vitest 5 in favour of `test.projects`; and pnpm 12 not enforcing the
  project's own `engines.node` despite its documentation.

### Known issues / blockers
- Nothing is committed; `pnpm-lock.yaml` is committed-ready but uncommitted.
- CI has never executed.
- M0-T7 (`AGENTS.md`), M0-T8 (ADRs), M0-T9 (`docs/` structure) and M0-T11
  (source-of-truth protocol) are owned by other tasks and are not done here.

### Next exact step
Commit the workspace on a branch, then let M0-T7 / T8 / T9 / T11 describe the
repository that now exists.

---

## 2026-09-19 16:30 — M0-T2 — Follow-up: hold @types/node on the Node 24 line

**Status:** completed
**Actor/session:** implementer subagent (opus) — tooling
**Commit:** not committed

### Goal
Correct a review finding: `@types/node` was pinned to 26.6.2 while the runtime
is pinned to Node 24. Types from a newer Node major declare APIs that do not
exist at runtime on Node 24, so code could typecheck and then fail, which
defeats the `.node-version` pin.

### Implementation references
- package/version: @types/node 24.13.6 (latest of the 24.x line, confirmed with
  `npm view @types/node@24 version`), replacing 26.6.2.
- installed docs read: `node_modules/@types/node/module.d.ts` lines 574-662, the
  global `ImportMeta` interface.
- official docs/repos/examples read:
  <https://pnpm.io/settings/dependency-resolution> for
  `minimumReleaseAge`, `minimumReleaseAgeExclude` and
  `minimumReleaseAgeExcludePrune`.
- public types/exports inspected: `ImportMeta.main`, declared as
  `main: boolean`, tagged `@since v24.2.0` and `@experimental`.
- selected documented pattern: the `@types/node` major always tracks the Node
  major in `.node-version`.

### Work completed
- `package.json`: `@types/node` pinned to `24.13.6`.
- `pnpm install` regenerated `pnpm-lock.yaml`; every transitive reference
  (vite 8.3.0, vitest 5.0.1) now resolves against `@types/node@24.13.6`.
- `pnpm-workspace.yaml`: removed the stale `26.6.2` from
  `minimumReleaseAgeExclude`, and corrected the comment above it.
- Research note sections 1 and 2 updated.

### Files changed
- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `docs/research/tooling/2026-09-19-m0-toolchain-verification.md`

### Verification
- `npm view @types/node@24 version` — PASS (latest 24.x is 24.13.6)
- `pnpm install` — PASS (`- @types/node 26.6.2`, `+ @types/node 24.13.6`)
- `import.meta.main` is still typed under 24.13.6 — PASS. Confirmed two ways:
  it is declared at `node_modules/@types/node/module.d.ts:661`, and a probe file
  `const m: boolean = import.meta.main;` typechecks clean. No change to
  `scripts/verify-handoff.ts` was needed.
- `pnpm install --frozen-lockfile` — PASS (lockfile committed-ready)
- `rm -rf packages/*/dist && pnpm check` — PASS end to end: format clean, lint
  clean, typecheck 2 turbo tasks plus the root project, 4 test files / 42 tests,
  build 2 tasks, `check:handoff — OK`

### Decisions / deviations
- **pnpm did not prune the stale exclude entry, and cannot be made to by
  default.** `minimumReleaseAgeExcludePrune` defaults to `false`. The install
  merged rather than replaced, producing
  `'@types/node@24.13.6 || 26.6.2'`. The `26.6.2` half was removed by hand and a
  following `pnpm install` did not re-add it. Enabling
  `minimumReleaseAgeExcludePrune` was considered and not done here, because it
  changes install behaviour repository-wide and is outside this correction's
  scope.
- `import.meta.main` is marked `@experimental` upstream. The documented fallback
  if it is ever withdrawn is comparing `process.argv[1]` with
  `fileURLToPath(import.meta.url)`; this is recorded in the research note rather
  than implemented, because the guard works today.

### Known issues / blockers
- None.

### Next exact step
When the repository moves to a newer Node major, bump `.node-version`,
`.nvmrc`, `engines.node` and the `@types/node` major together, and re-check the
`@tsconfig/node<major>` base for `target`/`lib`.

---

## 2026-09-19 16:36 — M0-T2 — TypeScript version rationale verified

**Status:** completed
**Actor/session:** orchestrator verification recorded by implementer subagent (opus) — tooling
**Commit:** not committed

### Goal
Close the open item left by the M0-T2 entry above. The reason for pinning
TypeScript 6.0.3 rather than the newer 7.0.2 was recorded as the orchestrator's
stated rationale and explicitly flagged as not independently confirmed. It has
now been checked against the official release announcements, so section 4 of the
toolchain research note states verified facts instead of a caveat.

### Implementation references
- package/version: typescript 6.0.3 (pinned), typescript 7.0.2 (latest),
  ts-morph 28.0.0, @ts-morph/common 0.29.x.
- official docs/repos/examples read:
  - <https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/> —
    7.0 is the native Go port; "TypeScript 7.0 is made available without an API.
    We expect TypeScript 7.1 to ship with a new (and different) API"; tooling
    needing programmatic access should stay on 6.0 or use the side-by-side
    package `@typescript/typescript6`; options no longer supported are
    `target: es5`, `downlevelIteration`,
    `moduleResolution: node`/`node10`/`classic`,
    `module: amd`/`umd`/`systemjs`/`none`, `baseUrl`, `esModuleInterop` or
    `allowSyntheticDefaultImports` set to `false`, and `alwaysStrict` set to
    `false`.
  - <https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/> —
    "TypeScript 6.0 is a unique release in that we intend for it to be the last
    release based on the current JavaScript codebase," and "TypeScript 6.0 acts
    as the bridge between TypeScript 5.9 and 7.0."
- npm commands run: `npm view ts-morph version` (28.0.0),
  `npm view ts-morph time` (28.0.0 published 2026-04-12),
  `npm view ts-morph dependencies`
  (`{ '@ts-morph/common': '~0.29.0', 'code-block-writer': '^13.0.3' }`),
  `npm view @ts-morph/common@0.29 dependencies`
  (`{ minimatch, path-browserify, tinyglobby }`).
- selected documented pattern: hold the 6.0 line while 7.0 ships without a
  compiler API; re-evaluate once 7.1 ships its new API, at the latest before
  Milestone 8.

### Work completed
- Replaced the "Version-line choice" paragraph in section 4 of
  `docs/research/tooling/2026-09-19-m0-toolchain-verification.md` with the
  verified rationale and its two sources.
- Recorded that ts-morph does **not** gate the TypeScript major: neither
  `ts-morph` nor `@ts-morph/common` declares a `typescript` dependency, so it
  vendors its own compiler. The real constraint is the missing 7.0 API.
- Recorded the upgrade trigger and the grep that shows the configuration is
  already 7.0-ready.

### Files changed
- `docs/research/tooling/2026-09-19-m0-toolchain-verification.md` (section 4)
- `docs/progress/WORKLOG.md` (this entry)

### Verification
- tsconfig grep for every option TypeScript 7.0 no longer supports, over all
  seven tsconfig files — PASS (exit 1, no matches). The grep was control-tested
  by planting `"baseUrl": "."` in the root `tsconfig.json`, which it caught
  (exit 0); the file was restored and confirmed byte-identical with `diff`.
- `npm view ts-morph dependencies` shows no `typescript` dependency — PASS
- `npm view @ts-morph/common@0.29 dependencies` shows no `typescript`
  dependency — PASS
- `pnpm check:handoff` — PASS (`check:handoff — OK`)

### Decisions / deviations
- The exact wording of the 7.0 announcement is "TypeScript 7.0 is made available
  without an API", which is what is quoted, rather than the paraphrase "does not
  ship with an API".
- No code or configuration changed. This entry records verification only.

### Known issues / blockers
- None. The open item flagged in the earlier M0-T2 entry is closed.

### Next exact step
Re-evaluate TypeScript 7.x when 7.1 ships its new compiler API, at the latest
before Milestone 8 introduces ts-morph codegen. If the move happens, the only
expected configuration work is confirming the grep above still returns no
matches.

---

## 2026-09-19 16:43 — M0-T8 — ADR system

**Status:** completed
**Actor/session:** implementer subagent (sonnet) — adrs; reviewed by orchestrator
**Commit:** not committed

### Goal
Create the ADR system (`docs/decisions/`) and record, as ADRs, the
architectural decisions and owner-decided product constraints from the build
plan, plus the Milestone 0 toolchain decisions.

### Implementation references
- package/version: n/a (documentation task).
- installed docs read: n/a.
- official docs/repos/examples read: `docs/milestones/build-plan.md` §1, §4,
  §5, §12, §13, §16, §17, Appendix A;
  <https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/>;
  <https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/>.
- public types/exports inspected: n/a.
- selected documented pattern: n/a.

### Work completed
- `docs/decisions/README.md` and `0000-template.md`.
- ADRs 0001-0016 (AD-001 through AD-016), 0017 (owner-decided product
  constraints).
- ADRs 0018-0023 (Milestone 0 toolchain decisions), grounded in
  `docs/research/tooling/2026-09-19-m0-toolchain-verification.md`.
- ADR-0019 updated after the orchestrator verified the TypeScript 6/7
  rationale against the official 6.0 and 7.0 announcements and
  `npm view ts-morph`.

### Files changed
- `docs/decisions/README.md`
- `docs/decisions/0000-template.md`
- `docs/decisions/0001-*.md` through `docs/decisions/0023-*.md`

### Verification
- `ls docs/decisions | wc -l` — PASS (25 files: template, 0001-0023, README;
  index matches)
- `pnpm check:handoff` — PASS

### Decisions / deviations
- ADRs 0018-0023 exceed the plan's literal ask ("ADRs for the decisions in
  this document"), per AD-016.

### Known issues / blockers
- None.

### Next exact step
None for M0.

---

## 2026-09-19 16:43 — M0-T7 — Engineering instructions

**Status:** completed
**Actor/session:** implementer subagent (sonnet) — agentsmd; reviewed by orchestrator
**Commit:** not committed

### Goal
Write the canonical engineering contract, `AGENTS.md`, covering the read
order, the non-negotiable rules, boundaries, prohibitions, commands,
definition of done, testing requirements, the source-of-truth summary, the
progress protocol, the task lifecycle, the ADR requirement, scope discipline,
git discipline, and the north-star invariants; point a thin `CLAUDE.md` at it.

### Implementation references
- package/version: n/a (documentation task).
- installed docs read: `package.json`, `biome.json`, `vitest.config.ts`,
  `.husky/pre-commit`, `.husky/pre-push`, `.github/workflows/ci.yml`,
  `tests/architecture/boundaries.ts`, `scripts/verify-handoff.ts`.
- official docs/repos/examples read: `docs/milestones/build-plan.md`.
- public types/exports inspected: n/a.
- selected documented pattern: n/a.

### Work completed
- `AGENTS.md`: the canonical contract (read order, thirteen rules,
  boundaries, prohibitions, commands, definition of done, testing, the
  source-of-truth summary, the progress/handoff protocol, the task lifecycle,
  the ADR requirement, scope discipline, git discipline, north-star
  invariants).
- Thin `CLAUDE.md` pointing at `AGENTS.md`.
- `README.md`, `.github/pull_request_template.md`.
- Staleness fixups applied after ADRs 0018-0023 and the `docs/` tree landed
  (this task).

### Files changed
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `.github/pull_request_template.md`

### Verification
- `pnpm format:check` — PASS
- Orchestrator claim-by-claim review of `AGENTS.md` against the config, hook,
  and CI files — PASS

### Decisions / deviations
- `AGENTS.md` is roughly 535 lines because the build plan mandates several
  verbatim blocks; kept rather than trimming mandated content.

### Known issues / blockers
- None.

### Next exact step
None for M0.

---

## 2026-09-19 16:43 — M0-T9 — Project documentation memory

**Status:** completed
**Actor/session:** implementer subagent (sonnet) — docs, with sub-agents; reviewed by orchestrator
**Commit:** not committed

### Goal
Create the project documentation memory: the full `docs/` structure and its
required initial files, so a fresh agent can follow the mandatory read order
without prior chat context.

### Implementation references
- package/version: n/a (documentation task).
- installed docs read: n/a.
- official docs/repos/examples read: `docs/milestones/build-plan.md`.
- public types/exports inspected: n/a.
- selected documented pattern: n/a.

### Work completed
- `docs/README.md`, `docs/progress/README.md`,
  `docs/progress/milestones/README.md`, `docs/architecture/system-map.md`,
  `docs/development/local-setup.md`, `docs/development/commands.md`,
  `docs/research/README.md`, `docs/research/vercel/README.md`,
  `docs/milestones/README.md`, `docs/milestones/m0-repository-foundation.md`,
  `docs/milestones/m1-local-agent-and-public-harness-boundary.md`,
  `docs/runbooks/README.md`, `docs/contracts/README.md`,
  `docs/concepts/README.md`, `docs/examples/README.md`.
- `docs/milestones/build-plan.md` is a verbatim copy of the owner's plan.

### Files changed
- All files listed above.

### Verification
- Orchestrator link check (47 Markdown files, 0 broken relative links) — PASS
- `pnpm check:handoff` — PASS

### Decisions / deviations
- Per-topic architecture docs and contract files were deliberately not
  created (an honest empty boundary rather than speculative content).
- The runbook's machine-specific PATH line was removed in review.

### Known issues / blockers
- None.

### Next exact step
None for M0.

---

## 2026-09-19 16:43 — M0-T11 — Framework reference procedure

**Status:** completed
**Actor/session:** implementer subagent (sonnet) — docs; reviewed by orchestrator
**Commit:** not committed

### Goal
Create the framework reference procedure,
`docs/development/source-of-truth-protocol.md`, so framework-facing work
cannot proceed on a guessed Vercel/eve/AI SDK API.

### Implementation references
- package/version: n/a (documentation task).
- installed docs read: n/a.
- official docs/repos/examples read: `docs/milestones/build-plan.md`, AD-011
  and §16.
- public types/exports inspected: n/a.
- selected documented pattern: n/a.

### Work completed
- `docs/development/source-of-truth-protocol.md`: AD-011 precedence, the MUST
  NOT list, the Implementation references checkpoint, the
  web-examples-are-not-authority rule, an explicit prohibition of guessed
  Vercel APIs, eve / Workflow SDK / AI SDK-Jev / Sandbox protocols, inspection
  checklists with commands, the stop condition, record locations, and a
  worked example.

### Files changed
- `docs/development/source-of-truth-protocol.md`

### Verification
- Manual review against build plan AD-011 and §16 — PASS
- `pnpm check:handoff` — PASS

### Decisions / deviations
- None beyond what is recorded in the file itself.

### Known issues / blockers
- None.

### Next exact step
None for M0.

## 2026-09-19 16:47 — M0 — Milestone 0 complete: final verification, commits, handoff

**Status:** completed
**Actor/session:** Claude Fable 5.1 orchestrator
**Commit:** cdeaeed (tooling), b8cc0ac (ADRs), 4f5da91 (docs), 7c09f10 (AGENTS.md set); handoff commit follows this entry

### Goal
Close Milestone 0: review all subagent work, run the final gate from a fresh
clone, prove every gate bites, commit in logical task groups, write the
milestone snapshot and rewrite the handoff.

### Implementation references
- Verified during review: TypeScript 6.0/7.0 announcements
  (https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ ,
  https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/),
  `npm view ts-morph` (28.0.0, vendors its own compiler). Recorded in
  ADR-0019 and the toolchain research note section 4.
- All other references: per-task entries above and
  `docs/research/tooling/2026-09-19-m0-toolchain-verification.md`.

### Work completed
- Reviewed every subagent deliverable against the files on disk (not the
  summaries); pushed back on `@types/node` 26.x (corrected to 24.13.6), the
  unverified TypeScript rationale (verified, ADR-0019 updated), a paraphrased
  quotation (fixed to exact wording), AGENTS.md staleness after ADRs 0018-0023
  landed, a wrong `check:handoff` description in `commands.md`, a
  machine-specific PATH line in the runbook, and a stale comment in
  `tests/architecture/boundaries.ts`.
- Link check over 47 Markdown files: 0 broken relative links.
- Four logical commits; pre-commit hook ran on each.
- Wrote `docs/progress/milestones/m0.md` and rewrote
  `docs/context/current-state.md`.

### Files changed
- `docs/progress/milestones/m0.md` (new)
- `docs/context/current-state.md` (rewritten)
- `docs/progress/WORKLOG.md` (this entry)

### Verification
Fresh `git clone` of 7c09f10 with the handoff files copied in:
- `pnpm install --frozen-lockfile` — PASS
- `pnpm check` (format:check, lint, typecheck, test 42/42, build, check:handoff) — PASS
- badly formatted file → `pnpm format:check` exit 1 — PASS (gate bites)
- type error → `pnpm typecheck` exit 2 — PASS (gate bites)
- failing test → `pnpm test:unit` exit 1 — PASS (gate bites)
- `@internal/core` depends on `eve` → architecture test fails naming the adapter-only rule — PASS (gate bites)
- staged Slack token → `.husky/pre-commit` exit 1 (secretlint SLACK_TOKEN) — PASS (gate bites)
- completed WORKLOG entry without verification → `pnpm check:handoff` exit 1 — PASS (gate bites)
- No intentional failure left behind: `git status` clean in the clone — PASS

### Decisions / deviations
- pnpm 12 verifies dependencies before running scripts, so a manifest edit
  that adds an uninstalled dependency fails at `pnpm test` before vitest
  starts; the architecture test was therefore proven by invoking vitest
  directly. Both layers reject the violation.
- Left pnpm's `minimumReleaseAgeExcludePrune` at its default (false).
- CI has not executed: no remote configured. Criteria "deliberate failure
  fails CI" are proven locally with the identical commands.

### Known issues / blockers
- None.

### Next exact step
M1-T1, Install AI SDK and `eve`: append a `started` entry with
Implementation references, then follow
`docs/development/source-of-truth-protocol.md`.
