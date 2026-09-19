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

---

## 2026-09-19 16:53 — M1-T1 — Install AI SDK and `eve`

**Status:** started
**Actor/session:** implementer subagent (opus) — orchestrated by Claude Fable 5.1
**Commit:** not committed

### Goal
Install current, mutually compatible versions of the AI SDK (`ai`) and `eve`
into two new adapter packages (`@internal/runtime-eve`,
`@internal/runtime-ai-sdk`), record what the installed packages actually
document, and write the dependency-versioning ADR (ADR-0024). This task is
install + research + policy only: it does not implement `AgentRuntime`
(M1-T5) or `EveAgentRuntime` (M1-T6), and does not scaffold the example agent
(M1-T2).

### Implementation references
- package/version (to be installed, from the registry on 2026-09-19 via
  `pnpm view`):
  - `eve@0.63.0` — `engines.node: ">=24"`, `type: module`,
    `bin: { eve: "./bin/eve.js" }`; runtime dependencies `nitro@3.0.260903-beta`
    and `undici@8.9.0`.
  - `eve` peer dependencies: `ai: "^7.0.105"` (**required**, no
    `peerDependenciesMeta` entry) plus five optional peers
    (`dd-trace`, `just-bash`, `braintrust`, `microsandbox`,
    `@opentelemetry/api`), each marked `"optional": true` in
    `peerDependenciesMeta`.
  - `ai@7.0.107` — peer dependency `zod: "^3.25.76 || ^4.1.8"` (**required**,
    the package declares no `peerDependenciesMeta`); runtime dependencies
    `@ai-sdk/gateway@4.0.87`, `@ai-sdk/provider@4.0.17`,
    `@ai-sdk/provider-utils@5.0.45`, which arrive transitively and are
    therefore not declared by any workspace package.
  - Compatibility finding: `ai@7.0.107` satisfies `eve@0.63.0`'s
    `ai: "^7.0.105"` peer range, so there is **no** eve-vs-ai version
    discrepancy to resolve; the latest `ai` is also the eve-compatible `ai`.
  - `zod@4.6.5` is the current release and satisfies `^4.1.8`.
- installed docs read: none yet. `node_modules/eve/docs/` and the shipped `ai`
  types do not exist until the install runs. This section is updated with the
  actual files read after `pnpm install`, per
  `docs/development/source-of-truth-protocol.md` §3 and §6.
- official docs/repos/examples read: none yet; the installed packages are the
  primary source under the protocol's precedence order and are inspected
  first.
- public types/exports inspected: `eve`'s published `exports` map was printed
  from the registry (`pnpm view eve exports`) and lists `.`, `./ai`,
  `./hooks`, `./client`, `./evals`, `./tools`, `./skills`, `./sandbox`,
  `./channels`, `./models`, `./memory`, `./context`, `./connections`,
  `./instructions`, `./setup`, `./vercel` and others, plus two
  `./internal/*` subpaths that are off limits under AGENTS.md rule 6. The
  installed copy is re-inspected after install and recorded in the research
  note.
- selected documented pattern: none — this task installs and documents; no
  framework API is called yet. `src/index.ts` in each adapter stays a minimal
  typed smoke surface proving the public entrypoint resolves under typecheck.
- anything not documented that must be harness-owned: to be recorded in
  `docs/research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md` after the
  installed-docs inspection.

### Next exact step
Create `packages/runtime-eve` and `packages/runtime-ai-sdk` mirroring
`packages/core`, declare the pinned dependencies, run `pnpm install`, then
inspect `node_modules/eve/docs/` and the installed `ai` types.

---

## 2026-09-19 17:04 — M1-T1 — Install AI SDK and `eve` (result)

**Status:** completed
**Actor/session:** implementer subagent (opus) — orchestrated by Claude Fable 5.1
**Commit:** bdb4a23

Result entry for the `started` entry above. Appended rather than rewritten, per
`docs/progress/README.md`. The `Implementation references` section below is the
post-install version the started entry promised; where the two differ, this one
is authoritative.

### Goal
Install current, mutually compatible versions of `eve` and the AI SDK (`ai`)
into two new adapter packages, record what the installed packages document, and
write the dependency-versioning ADR. Explicitly out of scope: `AgentRuntime`
(M1-T5), `EveAgentRuntime` (M1-T6) and the example agent (M1-T2).

### Implementation references
- package/version (installed, verified against the resolved
  `node_modules` path and the lockfile):
  - `eve@0.63.0` — `engines.node: ">=24"`, `bin: { eve: "./bin/eve.js" }`,
    runtime deps `nitro@3.0.260903-beta` and `undici@8.9.0`.
  - `ai@7.0.107` — `engines.node: ">=22"`, runtime deps
    `@ai-sdk/gateway@4.0.87`, `@ai-sdk/provider@4.0.17`,
    `@ai-sdk/provider-utils@5.0.45` (all transitive, declared by no workspace
    package).
  - `zod@4.6.5` — required peer of `ai` (`^3.25.76 || ^4.1.8`, no
    `peerDependenciesMeta`, therefore not optional).
  - Compatibility: `ai@7.0.107` satisfies eve's required peer `ai: "^7.0.105"`.
    No discrepancy to resolve; the newest `ai` is also the eve-compatible `ai`.
    Eve's five other peers (`dd-trace`, `just-bash`, `braintrust`,
    `microsandbox`, `@opentelemetry/api`) all carry `"optional": true` and were
    deliberately not installed.
- installed docs read:
  - `eve/docs/README.md` (the framework's own entrypoint; declares eve preview
    status and the authored filesystem model).
  - `eve/docs/reference/typescript-api.md` (the `define*` surface and the import
    path for each; the rule that the export map is the full public contract).
  - `eve/docs/reference/cli.md` (every CLI command).
  - Full file inventory of `eve/docs` (110 files) and `ai/docs` (291 files),
    both recorded in the research note.
  - `ai/README.md`, `ai/docs/02-getting-started/00-choosing-a-provider.mdx`,
    `ai/docs/03-agents/02-building-agents.mdx`.
- official docs/repos/examples read: none. The installed packages settled every
  question asked, so precedence levels 3-5 were not needed.
- public types/exports inspected:
  - `eve/package.json` `exports` (79 entries) and `imports`;
    `eve/dist/src/index.d.ts`; `eve/dist/src/public/index.d.ts`;
    `eve/dist/src/public/definitions/agent.d.ts`;
    `eve/dist/src/public/models/openai/index.d.ts`;
    `eve/dist/src/shared/agent-definition.d.ts`.
  - `ai/package.json` `exports` (4 entries); `ai/dist/index.d.ts` (the final
    `export { ... }` statement and the three re-export statements).
- selected documented pattern: none called yet. The two `src/index.ts` files
  each re-export one documented public type (`AgentDefinition` from `eve`,
  `LanguageModel` from `ai`) purely so that `pnpm typecheck` fails if the public
  entrypoint stops resolving. Neither imports a package-internal path.
- anything not documented that must be harness-owned: recorded in
  `docs/research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md` §8. In
  short: `Job`, `defineDomain()`, `createHarness()`, `ExecutionContext`,
  `CapabilityRegistry`, the trace schema and the `AgentRuntime` boundary itself
  are harness-owned; neither package offers an equivalent.

### Work completed
- Created `packages/runtime-eve` (`@internal/runtime-eve`) and
  `packages/runtime-ai-sdk` (`@internal/runtime-ai-sdk`), mirroring
  `packages/core`: same `exports` map with the `@internal/source` condition
  (ADR-0020), same `build`/`dev`/`typecheck` scripts, `private: true`,
  `type: module`, both tsconfigs.
- Pinned exactly: `runtime-eve` declares `eve@0.63.0`, `ai@7.0.107`,
  `zod@4.6.5`; `runtime-ai-sdk` declares `ai@7.0.107`, `zod@4.6.5`. Both add
  `vitest@5.0.1` as a devDependency, matching `@internal/testing`.
- Added a co-located unit test to each package asserting (a) that each declared
  dependency's installed `version` equals this package's own pin, with both
  values read from disk and neither hard-coded, and (b) that the package
  declares no `^`/`~` range.
- Wrote `docs/research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md` and
  `docs/decisions/0024-framework-dependency-versioning-policy.md`.
- Updated the docs the install made stale: AGENTS.md, the system map, the
  source-of-truth protocol, the ADR index, the research indexes, the commands
  reference, and both milestone files.
- Corrected the source-of-truth protocol's `eve`/`ai` inspection checklists.
  They used literal `node_modules/<pkg>/...` paths, which do not exist under
  pnpm's isolated store, and pointed at `eve/dist/*.d.ts`, where eve's
  declarations are not. The replacements resolve the real directory first and
  were each executed before being written down.

### Files changed
New:
- `packages/runtime-eve/{package.json,tsconfig.json,tsconfig.build.json}`
- `packages/runtime-eve/src/{index.ts,index.test.ts}`
- `packages/runtime-ai-sdk/{package.json,tsconfig.json,tsconfig.build.json}`
- `packages/runtime-ai-sdk/src/{index.ts,index.test.ts}`
- `docs/decisions/0024-framework-dependency-versioning-policy.md`
- `docs/research/vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md`

Modified:
- `pnpm-lock.yaml`, `pnpm-workspace.yaml` (pnpm appended four entries to
  `minimumReleaseAgeExclude`; not hand-edited)
- `tests/architecture/boundaries.ts` (the `adapterPackages` comment; the data is
  unchanged)
- `tests/architecture/package-boundaries.test.ts` (the expected workspace
  package inventory grew from three names to five)
- `AGENTS.md`, `docs/architecture/system-map.md`,
  `docs/development/source-of-truth-protocol.md`,
  `docs/development/commands.md`, `docs/decisions/README.md`,
  `docs/research/README.md`, `docs/research/vercel/README.md`,
  `docs/milestones/m1-local-agent-and-public-harness-boundary.md`,
  `docs/milestones/README.md`, `docs/context/current-state.md`,
  `docs/progress/WORKLOG.md`

### Verification
- `pnpm install` — PASS (33 packages added; pnpm appended
  `@ai-sdk/gateway@4.0.87`, `@ai-sdk/provider-utils@5.0.45`, `ai@7.0.107`,
  `eve@0.63.0` to `minimumReleaseAgeExclude`)
- `pnpm install --frozen-lockfile` — PASS ("Lockfile is up to date")
- `pnpm test:unit` — PASS (6 files, 51 tests; was 4 files, 42 tests)
- `pnpm format` — PASS (36 files, no fixes applied)
- `pnpm check` — PASS, all six stages:
  - `format:check` — PASS
  - `lint` — PASS
  - `typecheck` — PASS (5 packages plus the root project)
  - `test` — PASS (6 files, 51 tests across the four projects)
  - `build` — PASS (5 packages; both new packages emit `dist/`)
  - `check:handoff` — PASS
- Gate bites, architecture boundary: added `"eve": "0.63.0"` to
  `packages/core/package.json` devDependencies, ran
  `pnpm exec vitest run --project unit tests/architecture` — FAIL as intended,
  `eve matches the adapter-only pattern "eve"; only an adapter package
  (@internal/runtime-eve, ...) may depend on it`. Reverted with
  `git checkout -- packages/core/package.json`; `git diff packages/core` and
  `git status --porcelain packages/core` both empty, test back to 11 passed.
- Gate bites, version pin: loosened `runtime-eve`'s `eve` pin to `^0.63.0`, ran
  `pnpm exec vitest run --project unit packages/runtime-eve` — FAIL as intended,
  on both assertions (`expected '0.63.0' to be '^0.63.0'` and
  `Ranged dependencies must be exact pins: [["eve","^0.63.0"]]`). Restored the
  pin; 9 tests pass across both new packages.
- `pnpm --filter @internal/runtime-eve exec eve info` — did not run, as
  expected: `Invalid eve project ...: found no agent files`. It needs the
  authored `agent/` directory that M1-T2 creates. It did confirm the installed
  binary runs and self-reports v0.63.0. Not forced.
- Every inspection command written into
  `docs/development/source-of-truth-protocol.md` §10 was executed against this
  tree before being recorded — PASS.

### Decisions / deviations
- **ADR-0024** records the versioning policy: exact pins for every framework
  dependency and its required peers, optional peers not installed, upgrades as
  their own task with a fresh source-of-truth inspection, the eve-compatible
  `ai` winning for the eve adapter when the two disagree, and the per-package
  assertion tests as the enforcement mechanism.
- **`ai` is a direct dependency of `@internal/runtime-eve`, not transitive.**
  The installed `eve` makes it a required peer *and* exposes AI SDK types on its
  public surface: 109 of eve's shipped `.d.ts` files import from `"ai"`, and
  `eve/models/openai`'s `chatgpt()`/`openai()` are declared to return `ai`'s
  `LanguageModel`. This was an open question in the task brief; the installed
  types answered it.
- **No `@ai-sdk/*` provider package installed.** `@ai-sdk/gateway` is already a
  dependency of `ai`, and `ai/README.md` documents the Gateway as the default
  path needing no extra install. Choosing a direct provider is M1-T5's call.
- **`zod` is declared explicitly** in both adapters rather than left to pnpm's
  automatic peer installation, so the version is visible in a manifest and
  covered by the assertion tests. `zod` is not an adapter-only dependency under
  `BOUNDARY_RULES`, so this does not widen any boundary.
- **`vitest` added as a devDependency to both new packages**, matching
  `@internal/testing`, because they now contain co-located tests.
- **`tests/architecture/package-boundaries.test.ts` was modified**, which the
  task brief did not anticipate. Its first assertion hard-codes the expected
  workspace package inventory; adding two packages necessarily fails it. Only
  the inventory list changed. No rule was weakened and `adapterPackages` was not
  touched.
- **The source-of-truth protocol's inspection commands were wrong and were
  fixed**, not merely re-labelled. This is slightly beyond the literal brief,
  but the brief required §10 to stop saying eve/ai are uninstalled, and leaving
  commands that cannot run under pnpm would have made the section actively
  misleading for M1-T2.
- **The two assertion tests share their shape by duplication.** Extracting a
  helper into `@internal/testing` was considered and deferred until a third
  package needs it; ADR-0024 records that.

### Known issues / blockers
- None blocking M1-T2.
- **Discrepancy recorded, resolved in favour of the installed package:**
  `eve@0.63.0` ships **no `eve check` command**
  (`eve/docs/reference/cli.md`; a grep for it across all 110 shipped doc files
  returns only prose). AGENTS.md and `current-state.md` referenced it. `eve info`
  is the 0.63.0 equivalent, and both files now say so.
- **The AI SDK's shipped `.mdx` docs contain unresolved `__PROVIDER_IMPORT__`
  and `__MODEL__` placeholders** in 82 of 291 files, where the published site
  injects a provider. Their prose and API names are authoritative; their model
  arguments are not literals. Read shapes from `ai/dist/index.d.ts`.
- **`ai`'s agent class is `ToolLoopAgent`, not `Agent`.** In 7.0.107, `Agent` is
  a *type*; `Experimental_Agent` is an alias for `ToolLoopAgent`. M1-T5 must use
  the non-experimental name, per the source-of-truth protocol §8.
- **Open for M1-T6:** how to drive `eve` programmatically rather than through
  the CLI is not yet established. `eve/client` (`Client`, `ClientSession`) is
  the documented programmatic surface and
  `eve/docs/guides/client/overview.mdx` is the page to read. M1-T1 did not
  guess, per the no-assumption stop condition.
- CI still has not executed; no remote is configured. Unchanged from M0.

### Next exact step
M1-T2, Scaffold example agent. Read
`eve/docs/concepts/project-structure.mdx`, `eve/docs/reference/agent-files.md`
and `eve/docs/tools/overview.mdx` (resolve the real path first, per
`docs/development/source-of-truth-protocol.md` §10), then append a `started`
WORKLOG entry with Implementation references before creating any file.

---

## 2026-09-19 17:20 — M1-T2 — Scaffold example agent (+ ADR-0025)

**Status:** started
**Actor/session:** Claude Opus 5 implementer subagent (m1-t2), delegated by the
Claude Fable 5.1 orchestrator
**Commit:** 4748a36

### Goal
Scaffold the neutral vendor-triage example agent as a real `eve` project under
`apps/example-agent`, using eve's documented authored filesystem structure, with
one read-only fixture tool backed by deterministic local fixture data, so that
`eve info` discovers it and it typechecks and builds inside the workspace.

This task does **not** implement `defineDomain()`, `createHarness()` or any
runtime adapter (M1-T3…T6), and makes no live model call.

It carries one architecture change with it, recorded as **ADR-0025**:
`tests/architecture/boundaries.ts` Rule 2 currently applies the adapter-only
dependency rule to every workspace package including `apps/*`, so an eve project
under `apps/` cannot exist without changing the rule. Per AGENTS.md rule 13 that
is a deliberate architecture change with an ADR, not a quiet edit.

### Implementation references
- **package/version:** `eve@0.63.0`, `ai@7.0.107`, `zod@4.6.5`, all resolved from
  `packages/runtime-eve` and confirmed against `pnpm-lock.yaml`. Real store path
  resolved per `docs/development/source-of-truth-protocol.md` §10:
  `node_modules/.pnpm/eve@0.63.0_ai@7.0.107_zod@4.6.5_/node_modules/eve`.
- **installed docs read** (all under that resolved `eve` directory, `docs/`):
  - `docs/README.md` — the public mental model and the authored filesystem slots.
  - `docs/getting-started.mdx` — project creation, the manual-install path
    (`npm install eve@latest ai zod`), and `eve init .` into an existing package.
  - `docs/concepts/project-structure.mdx` — one root agent in `agent/` beside
    `package.json`; `agent/lib/` for agent-only helpers; evals beside `agent/`.
  - `docs/reference/agent-files.md` — the agent directory slot table, path-derived
    naming (`agent/tools/get_weather.ts` → tool `get_weather`), `lib/` as
    import-only, and `eve info` as the discovery debugger.
  - `docs/reference/cli.md` — every command; `eve info [--json]`, `eve build`,
    `eve set`. Confirms again that no `eve check` exists.
  - `docs/reference/typescript-api.md` — the `define*` surface and its import
    paths; `defineAgent` from `eve`, `defineTool` from `eve/tools`, `defineSkill`
    from `eve/skills`; the authored module lifecycle (compile-only vs runtime).
  - `docs/agent-config.md` — `model` is required when `agent.ts` is present;
    `model` accepts an AI Gateway model id string or a provider `LanguageModel`.
  - `docs/instructions.mdx` — `agent/instructions.md` is the system prompt; keep
    it to stable identity and standing rules; situational procedures go in skills.
  - `docs/skills.mdx` — a flat Markdown file under `agent/skills/` is a complete
    skill; `description` frontmatter is the routing hint.
  - `docs/tools/overview.mdx` — `defineTool`, required `description` and
    `inputSchema`, optional `outputSchema`, `execute(input, ctx)`, the approval
    helpers from `eve/tools/approval`, and the rule that tool output must be
    JSON-serializable.
  - `docs/tutorial/first-agent.mdx` — the end-to-end authoring order.
- **official docs/repos/examples read:** none. The installed package settled every
  question, which is the source order the protocol requires (§1).
- **public types/exports inspected:**
  - `dist/src/public/index.d.ts` — `defineAgent`, `AgentDefinition`, `DefinedAgent`.
  - `dist/src/public/tools/index.d.ts` — `defineTool`, `ToolContext`,
    `ToolDefinition`, `toolOutput`.
  - `dist/src/tools/definition.d.ts` — the two `defineTool` overloads, the
    `ToolDefinition` fields (`description`, `inputSchema`, `outputSchema?`,
    `approval?`, `toModelOutput?`, `availableInSubagents?`) and `ToolContext`.
  - `dist/src/public/tools/approval/index.d.ts` — `always`, `auto`, `never`, `once`.
  - `dist/src/shared/agent-definition.d.ts` — `PublicAgentStaticModelDefinition`
    is `string | LanguageModel`, so a Gateway model id string is the documented
    minimal configuration.
- **selected documented pattern:** a single root agent at `apps/example-agent/agent/`
  with `agent.ts` (`defineAgent` + a Gateway model id string), `instructions.md`,
  one flat Markdown skill under `agent/skills/`, one `defineTool` module under
  `agent/tools/` whose implementation lives in a pure module under `agent/lib/`,
  and the fixture data as a typed module in `agent/lib/`.
- **anything not documented that must be harness-owned:** eve has no "read-only"
  or side-effect permission flag on a tool definition; the closest documented
  mechanism is the per-tool `approval` policy. The fixture tool therefore states
  its read-only nature through `approval: never()` plus a doc comment, and the
  no-side-effects guarantee is enforced by testing the pure `lib/` function.

### Next exact step
Write ADR-0025, extend `BOUNDARY_RULES` with an app-package allowlist, then
scaffold `apps/example-agent`.

## 2026-09-19 17:20 — M1-T7, M1-T8 — Runtime context and error taxonomy

**Status:** started
**Actor/session:** coding agent (Claude Opus 5, implementer subagent)
**Commit:** 4748a36

### Goal
Define, in `@internal/core`, the typed `ExecutionContext` (M1-T7) and the
harness error taxonomy with a trace-safe serialization (M1-T8), with unit tests
and contract documentation. These are contracts, not behaviour: no runtime, no
model call, no I/O. The target is the smallest honest set that M1-T3 through
M1-T6 can build on, leaving the full trace schema to M2-T3 and the decision
contracts to M3.

### Implementation references
- package/version: none. **This task is not Vercel-framework-facing**, so the
  source-of-truth protocol's eve/AI-SDK research checkpoint does not apply: no
  code here imports `eve`, `ai` or any third-party package, and `@internal/core`
  stays at zero dependencies by the dependency rule (AGENTS.md, build plan §4).
  The authoritative sources are the build plan and the repository's own configs.
- installed docs read: not applicable (see above). The toolchain versions the
  types are written against are `typescript@6.0.3` and `vitest@5.0.1`, both
  read from the root `package.json`.
- official docs/repos/examples read: none required.
- public types/exports inspected:
  - `packages/config/tsconfig.base.json` and `tsconfig.package.json`, for the
    strictness the contracts must survive: `strict`, `noUncheckedIndexedAccess`,
    `exactOptionalPropertyTypes`, `noImplicitOverride`, `useUnknownInCatchVariables`,
    `isolatedModules`, `verbatimModuleSyntax`, `target: es2024`.
  - `vitest@5.0.1` public exports `expectTypeOf` and `assertType`, confirmed by
    importing the installed package. Type-level assertions are checked by
    `tsc --noEmit` because `packages/core/tsconfig.json` includes
    `src/**/*.ts`, which covers co-located tests.
  - `packages/testing/src/clock.ts` and `packages/runtime-ai-sdk/src/index.test.ts`,
    for the existing documentation and test style.
- selected documented pattern: build plan §5 (Core Contracts) for `Job.budget`,
  `Job.permissions`, `Job.metadata` and the `{ id, version }` reference shape;
  build plan Milestone 1 M1-T7 for the `ExecutionContext` field list and M1-T8
  for the nine error classes; build plan Milestone 2 M2-T4 for the exact
  `TraceWriter` interface and M2-T3 for the trace-event fields this task
  deliberately does **not** define yet.

### Work completed
- (in progress)

### Files changed
- (in progress)

### Verification
- (pending)

### Decisions / deviations
- (pending)

### Known issues / blockers
- Another implementer is working in the same tree on M1-T2. File ownership was
  split in advance; shared documents are edited surgically after a re-read.

### Next exact step
Implement `packages/core/src/{json,context,trace,errors}.ts` with co-located
unit tests, then the contract documents.

## 2026-09-19 17:26 — M1-T7, M1-T8 — Runtime context and error taxonomy

**Status:** completed
**Actor/session:** coding agent (Claude Opus 5, implementer subagent)
**Commit:** 4748a36

This is the result entry for the `started` entry above. Where the two differ,
this one is authoritative. M1-T7 and M1-T8 were done together because M1-T7's
`createExecutionContext()` validates its input by throwing M1-T8's
`ValidationError`, and M1-T8's `BudgetDimension` is `keyof Budget` from M1-T7;
splitting them would have meant one task importing the other's unwritten types.

### Goal
Define the typed `ExecutionContext` (M1-T7) and the harness error taxonomy with
a trace-safe serialization (M1-T8) in `@internal/core`, with unit tests and
contract documentation. Contracts only: no runtime, no model call, no I/O, and
no pre-building of M2's trace schema or M3's decision types.

### Implementation references
- package/version: none. **Not a Vercel-framework-facing task.** Nothing here
  imports `eve`, `ai` or any third-party package; `@internal/core` still
  declares no runtime dependency, which the dependency rule requires. The
  source-of-truth protocol's eve/AI-SDK research checkpoint therefore does not
  apply, and no installed framework docs were needed.
- toolchain the types are written against: `typescript@6.0.3`, `vitest@5.0.1`.
- installed docs read: not applicable (see above).
- official docs/repos/examples read: none required.
- public types/exports inspected:
  - `packages/config/tsconfig.base.json` and `tsconfig.package.json`, for the
    strictness the contracts have to survive: `strict`,
    `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
    `noImplicitOverride`, `useUnknownInCatchVariables`, `isolatedModules`,
    `verbatimModuleSyntax`, `target: es2024`. Three of these shaped the code
    directly and are called out under "Decisions" below.
  - `vitest@5.0.1`'s `expectTypeOf`, confirmed present by importing the
    installed package. Type-level assertions are enforced by `tsc --noEmit`,
    because `packages/core/tsconfig.json` includes `src/**/*.ts` and so covers
    co-located tests; Vitest itself runs them as no-ops.
  - `packages/testing/src/clock.ts` and
    `packages/runtime-ai-sdk/src/index.test.ts`, for the existing
    documentation and test style.
- selected documented pattern: build plan §5 for `Job.budget`,
  `Job.permissions`, `Job.metadata` and the `{ id, version }` reference shape;
  M1-T7 for the `ExecutionContext` field list; M1-T8 for the nine error
  classes; M2-T4 for the verbatim `TraceWriter` interface; M2-T3 for the trace
  event fields this task deliberately does **not** define.

### Work completed
- `packages/core/src/json.ts`: recursive `JsonValue`/`JsonObject`/`JsonArray`/
  `JsonPrimitive` with no `any`, the type `Job.metadata` and every serializable
  field is written against.
- `packages/core/src/context.ts`: `ExecutionContext` (nine readonly fields),
  `DomainRef`, `Budget`, `ToolGrant`/`ToolGrantMode`, `RuntimeInfo`, and
  `createExecutionContext()` applying the documented defaults and validating
  that `attempt` is an integer of at least 1.
- `packages/core/src/trace.ts`: the verbatim M2-T4 `TraceWriter`, a minimal
  five-field `TraceEvent` carrying a doc comment that names M2-T3 as the owner
  of the real schema, and `createNoopTraceWriter()`.
- `packages/core/src/errors.ts`: abstract `HarnessError` plus the nine classes,
  the `HarnessErrorCode` union, `SerializedHarnessError`, `serializeError()`,
  `isHarnessError()`, `MAX_SERIALIZED_CAUSE_DEPTH` and
  `HarnessError.prototype.toJSON()`.
- `packages/core/src/index.ts`: replaced the `export {}` placeholder with a
  named re-export barrel (40 symbols).
- Four co-located test files, 86 tests.
- `docs/contracts/execution-context.md` and `docs/contracts/errors.md`, both
  with the required frontmatter, and both stating explicitly which shapes are
  M1 shapes that a later milestone replaces.
- `docs/decisions/0026-harness-errors-serialize-to-a-whitelisted-trace-safe-shape.md`.
- Updated `docs/contracts/README.md` (two rows, and the "none of them exist
  yet" framing), `docs/architecture/system-map.md` (the `packages/core` bullet,
  its status row, and the source-file inventory),
  `docs/decisions/README.md` (the 0026 row and its paragraph), `AGENTS.md`
  (two layout-tree comments, the ADR paragraph, and the scope-discipline
  paragraph that still claimed core was empty), and the M1 milestone file.

### Files changed
New:
- `packages/core/src/{json,context,trace,errors}.ts`
- `packages/core/src/{json,context,trace,errors}.test.ts`
- `docs/contracts/execution-context.md`
- `docs/contracts/errors.md`
- `docs/decisions/0026-harness-errors-serialize-to-a-whitelisted-trace-safe-shape.md`

Modified:
- `packages/core/src/index.ts` (the barrel; was `export {}`)
- `packages/core/package.json` (added `vitest@5.0.1` as a devDependency for the
  co-located tests, matching `@internal/testing`; updated the now-false
  "Intentionally empty until Milestone 1" description). Still **no**
  `dependencies` block.
- `pnpm-lock.yaml` (one importer entry for that devDependency; see "Decisions")
- `AGENTS.md`, `docs/architecture/system-map.md`, `docs/contracts/README.md`,
  `docs/decisions/README.md`,
  `docs/milestones/m1-local-agent-and-public-harness-boundary.md`,
  `docs/progress/WORKLOG.md`

Deliberately not touched: `apps/**`, `pnpm-workspace.yaml`,
`tests/architecture/**`, `docs/decisions/0025-*` and
`docs/context/current-state.md`, all of which belong to the concurrent M1-T2
work or to the orchestrator.

### Verification
- `pnpm --filter @internal/core typecheck` — PASS
- `pnpm --filter @internal/core build` — PASS (emits `dist/`)
- `pnpm exec vitest run --project unit packages/core` — PASS (4 files, 86 tests)
- `pnpm test:unit` — PASS (12 files, 156 tests; was 6 files, 51 tests before
  M1-T2 and this task)
- `pnpm install --frozen-lockfile` — PASS ("Lockfile is up to date"), confirming
  the one importer entry this task added is committed state, not drift.
- `pnpm check` — PASS, all six stages:
  - `format:check` — PASS (55 files)
  - `lint` — PASS (55 files)
  - `typecheck` — PASS (5 turbo tasks plus the root project)
  - `test` — PASS (12 files, 156 tests across the four projects)
  - `build` — PASS (5 tasks)
  - `check:handoff` — PASS
- Zero-dependency boundary, checked by hand: `packages/core/package.json` has
  no `dependencies` key at all, and its `devDependencies` are exactly
  `@internal/config` and `vitest`. The architecture boundary test passes.
- `grep -rn "any" packages/core/src` — 11 hits, **all in prose comments**
  (phrases like "any throwable", "no `any`"). No `any` type is declared.
- Gate bites, trace safety: widened `serializeError` to spread the error's own
  enumerable properties (`...Object.fromEntries(Object.entries(error))`) and
  ran `pnpm exec vitest run --project unit packages/core/src/errors.test.ts` —
  FAIL as intended, 4 of 62 tests, including
  `expected '{"token":"secret-token","name":"Error…' not to contain
  'secret-token'` and `expected { details: undefined, …(5) } to not have
  property "apiKey"`. Reverted; 62 tests pass again.

### Decisions / deviations
Project decisions, recorded here per ADR-0016 because each is small and easily
reversed. The one material decision got its own ADR.

- **ADR-0026, the only ADR written.** "Trace-safe" is undefined by the build
  plan, binds every future package that writes a trace, and a future engineer
  would need the *why* before relaxing it, which is ADR-0016's own test. It
  records: serialization is a whitelist of `name`, `code`, `message`,
  `details` and a depth-bounded `cause`; stacks are excluded by default;
  `code` rather than `name` or `instanceof` is the discriminant consumers
  branch on; `serializeError` is total; and `SerializedHarnessError` is
  assignable to `JsonObject`.
- **`ToolGrant` is `{ toolId, mode: "read" | "write", scope? }`.** The plan
  names the type in `Job.permissions` and never defines it. This is the
  smallest shape that answers M1's only question of it ("may this job call this
  tool this way?"). Documented as an M1 shape that M2 (approvals) and M5
  (enforcement) extend. Not ADR-worthy: it is additive to change.
- **Error code scheme: `SCREAMING_SNAKE_CASE` of the class name with the
  trailing `Error` dropped**, so `BudgetExceededError` is `BUDGET_EXCEEDED`.
  Mechanical, so a tenth class does not need a naming discussion.
- **Each concrete error class merges its own typed fields into `details`.** The
  whitelist alone would drop `dimension`, `toolId` and the replay fingerprints
  on serialization, which would make the trace materially less useful. Class
  fields are merged last and win over a caller's key of the same name.
- **No `retryable` flag on the base class.** Whether a failure is worth
  retrying is a policy decision about a situation, not a property of an error
  instance, and nothing in M1-M6 needs one. Recorded as a rejected alternative
  in ADR-0026 so it is not silently re-litigated.
- **`createExecutionContext()` was kept**, not dropped as ceremony. It puts the
  six defaults in one place and gives the `attempt >= 1` check somewhere to
  live. It validates nothing else: `runId`/`jobId` format is M2-T1's decision.
- **No recording trace writer was added to `@internal/testing`.** Nothing in
  M1-T7 or M1-T8 needs to assert on emitted events, so adding one would have
  been speculative and would have created a new `@internal/testing` ->
  `@internal/core` dependency edge for no current benefit. Left open for
  whichever of M1-T3..T6 first needs it.
- **Three tsconfig settings shaped the code and are worth knowing before
  editing it:**
  - `exactOptionalPropertyTypes` is why `serializeError` builds its result with
    conditional spreads (`...(x === undefined ? {} : { x })`) instead of
    assigning `undefined`.
  - `JsonObject`'s index signature admits `undefined` so a type with optional
    properties is assignable to it. That is faithful to `JSON.stringify`, and
    it is what makes `SerializedHarnessError` embeddable in a trace payload.
    `noUncheckedIndexedAccess` means reads were already `| undefined` anyway.
  - `ValidationIssue` is declared as a `type` alias, not an `interface`, on
    purpose: TypeScript gives an implicit index signature to object type
    aliases but not to interfaces, so only the alias is assignable to
    `JsonObject` and therefore storable in `details`.
- **Deviation from the task brief: the barrel uses named re-exports, not
  `export *`.** It matches `packages/testing/src/index.ts`, and it makes the
  package's public surface a reviewable list rather than an implicit one.
- **Deviation, small: two extra AGENTS.md edits.** The brief scoped me to the
  `core/` layout comment and the ADR number. I also corrected the tree's
  "ADRs 0001-0024" count and the scope-discipline paragraph, which still said
  `packages/core` "is intentionally empty (`export {}`)". Leaving a
  now-false statement would have violated rule 8 (docs stale = not done).
- **One `pnpm install` was run**, as the brief permitted, after adding
  `vitest@5.0.1` to `packages/core`. It added one importer entry to
  `pnpm-lock.yaml`. No package version changed and `pnpm-workspace.yaml` was
  not touched by it.

### Known issues / blockers
- None blocking. `pnpm check` passes on the combined tree.
- **Open for M1-T3:** `ValidationError.issues` is a schema-agnostic shape.
  M1-T3 chooses the schema library (`zod@4.6.5` is already installed in both
  adapter packages, but `@internal/core` must not depend on it) and writes the
  adapter that normalizes its errors into `ValidationIssue[]`. Core must keep
  zero dependencies, so that adapter cannot live in core.
- **Open for M1-T4:** `createHarness()` is what will actually construct an
  `ExecutionContext` per attempt and decide where `runId` comes from. M2-T1
  chooses the sortable identifier scheme; M1 treats both IDs as opaque strings.
- **Open for M1-T5/T6:** the runtime adapters must propagate
  `ExecutionContext.signal` into the work they start, which is a Milestone 1
  acceptance criterion ("cancellation/abort signal reaches the runtime"). The
  context provides the signal; nothing enforces propagation yet.
- **Open for M2-T3:** `TraceEvent` is a five-field placeholder and will be
  replaced wholesale. Both the type's doc comment and
  `docs/contracts/execution-context.md` say so.
- **Open for M2-T9:** `details` is not a redaction boundary. The whitelist
  stops the harness from leaking values nobody chose to publish; it cannot stop
  a caller from publishing one deliberately.

### Next exact step
The orchestrator reviews and commits, then rewrites
`docs/context/current-state.md` for both this task and M1-T2. The next
implementation task is **M1-T3, `defineDomain()`**, which now has
`ExecutionContext`, `Budget`, `ToolGrant`, `JsonValue` and `ValidationError`
to build `Job` and `DomainDefinition` against.

---

## 2026-09-19 17:28 — M1-T2 — Scaffold example agent (+ ADR-0025)

**Status:** completed
**Actor/session:** Claude Opus 5 implementer subagent (m1-t2), delegated by the
Claude Fable 5.1 orchestrator
**Commit:** 4748a36

### Goal
As the 17:20 `started` entry. Scaffold the neutral vendor-triage example agent
as a real `eve` project under `apps/example-agent`, with one read-only fixture
tool over deterministic local data, discoverable by `eve info` and buildable and
typecheckable inside the workspace. No `defineDomain()`, no `createHarness()`,
no runtime adapter, no live model call.

### Implementation references
Recorded in full in the 17:20 `started` entry above and expanded into
`docs/research/vercel/2026-09-19-m1-eve-project-scaffold.md`. Summary:
`eve@0.63.0` / `ai@7.0.107` / `zod@4.6.5`, resolved from `packages/runtime-eve`;
eleven shipped `eve` doc pages read, five shipped `.d.ts` files inspected;
selected pattern is `defineAgent` + `defineTool` + a flat Markdown skill, with
the tool's implementation in a pure `agent/lib/` module.

### Work completed

**Part A — ADR-0025 and the boundary engine.**
- `tests/architecture/boundaries.ts` gained a required `BoundaryRules` field,
  `appPackagesMayDependOn: readonly DependencyPattern[]`, set to
  `["eve", "ai", "@ai-sdk/*"]`. Rule 2 now skips an adapter-only dependency for a
  package under `apps/**` when it matches that allowlist. The engine stays pure
  and knows no package name; the field is required, not optional, so a future
  rules table has to take a position. `@supabase/*`, `@vercel/*` and `workflow`
  are deliberately absent, and Rule 3 (`forbiddenByPackage`) still applies to
  application packages.
- Four engine unit tests added covering both directions: app + `eve` allowed,
  app + `@supabase/*` still rejected, library + `eve` still rejected, core +
  `eve` still rejected.
- `docs/decisions/0025-application-packages-may-author-eve-agents-directly.md`
  records the decision with context, consequences and six rejected alternatives.

**Part B — `apps/example-agent`.**
- `pnpm-workspace.yaml` `packages:` now includes `apps/*`.
- `@internal/example-agent`, `private`, `type: module`, pinning `eve@0.63.0`,
  `ai@7.0.107` and `zod@4.6.5` exactly, with `@internal/config` and
  `vitest@5.0.1` as devDependencies. It declares no `@internal/*` runtime
  dependency; M1-T3/T4 wire that.
- Authored `eve` project at `agent/`: `agent.ts` (`defineAgent`, AI Gateway model
  id from `EXAMPLE_AGENT_MODEL` with eve's own default as fallback),
  `instructions.md`, `skills/triage-vendor.md`, `tools/lookup_vendor_evidence.ts`,
  `tools/web_search.ts` and `tools/web_fetch.ts` (both `disableTool()`), and
  `lib/vendor-fixtures.ts` + `lib/vendor-evidence.ts`.
- Three fictional vendors of deliberately different evidence quality, every
  website on a reserved `.example` domain. Unknown vendors return a documented
  `status: "unknown"` result naming the vendors that are on file, so the agent
  reports missing information instead of inventing a vendor.
- Tests: `agent/lib/vendor-evidence.test.ts` (9 cases: known vendor,
  determinism, case/whitespace normalization, unknown vendor, no fuzzy
  matching, JSON-serializability, fixture invariants) and
  `src/dependency-pins.test.ts` (ADR-0024's assertion, plus an assertion that
  the app declares none of the surfaces ADR-0025 keeps adapter-only). No model
  is called by either.
- `apps/example-agent/turbo.json` extends the root config so Turborepo watches
  `agent/**` and caches `.output/**`; the root task definitions assume `src/**`
  and `dist/**`, which would have served stale cache hits here.
- `.gitignore` now excludes `.eve/` and `.output/`, the artifacts `eve info` and
  `eve build` write into the app.

**Documentation.** ADR-0025 and its index entry; the new research note and its
index entry; `AGENTS.md` (layout tree, enforcement prose, the model-call
prohibition, next free ADR number); `docs/architecture/system-map.md`
(frontmatter, current state, package status, the four-part rules table, the
enforcement proof); `docs/examples/README.md` rewritten; `docs/development/commands.md`
(per-package scripts and a new `eve` commands section); the M1 milestone file
(T2 result, status lines, the app-allowlist prerequisite); `.env.example`.

### Files changed
New:
- `apps/example-agent/{package.json,tsconfig.json,turbo.json}`
- `apps/example-agent/agent/{agent.ts,instructions.md}`
- `apps/example-agent/agent/skills/triage-vendor.md`
- `apps/example-agent/agent/tools/{lookup_vendor_evidence.ts,web_search.ts,web_fetch.ts}`
- `apps/example-agent/agent/lib/{vendor-fixtures.ts,vendor-evidence.ts,vendor-evidence.test.ts}`
- `apps/example-agent/src/dependency-pins.test.ts`
- `docs/decisions/0025-application-packages-may-author-eve-agents-directly.md`
- `docs/research/vercel/2026-09-19-m1-eve-project-scaffold.md`

Modified:
- `tests/architecture/boundaries.ts`, `tests/architecture/package-boundaries.test.ts`
- `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.gitignore`, `.env.example`
- `AGENTS.md`, `docs/architecture/system-map.md`, `docs/decisions/README.md`,
  `docs/development/commands.md`, `docs/examples/README.md`,
  `docs/milestones/m1-local-agent-and-public-harness-boundary.md`,
  `docs/research/vercel/README.md`

Not touched: `packages/core/**`, `docs/decisions/0026-*`,
`docs/context/current-state.md`, root `package.json`.

### Verification
- `pnpm install` then `pnpm install --frozen-lockfile` — PASS (7 workspace
  projects; the lockfile gained 19 lines for the new package).
- `pnpm run format:check` — PASS
- `pnpm run lint` — PASS
- `pnpm run typecheck` — PASS
- `pnpm run test` — PASS (12 files, 156 tests; 4 of those files and their tests
  belong to the concurrent M1-T7/M1-T8 core work)
- `pnpm run build` — PASS (5 packages, including `eve build`)
- `pnpm run check:handoff` — PASS
- `pnpm check` — PASS end to end.
- `pnpm --filter @internal/example-agent exec eve info` — PASS. `Compile ready`,
  `Diagnostics 0 errors, 0 warnings`, `Layout nested`, `Instructions
  instructions.md (system)`, `Skills 1 skill`, `Tools 9 tools`. The full output
  is quoted verbatim in
  `docs/research/vercel/2026-09-19-m1-eve-project-scaffold.md` §7.
- `eve info --json` — PASS. `status: "ready"`, `model:
  "openai/gpt-5.6-luna-fast"`, `skills: ["triage-vendor"]`, tools
  `["bash","read_file","write_file","todo","load_skill","ask_question","task_cancel","agent","lookup_vendor_evidence"]`.
- `pnpm --filter @internal/example-agent exec eve build` — PASS, exit 0, offline,
  no model credential configured. Nitro server bundle at `.output`, 10.1 MB
  (2.31 MB gzip).
- **Gate-bites proof, three ways, each reverted:**
  1. `@supabase/supabase-js: "2.0.0"` added to `apps/example-agent` →
     architecture test FAILS: `@supabase/supabase-js matches the adapter-only
     pattern "@supabase/*"; only an adapter package (...) may depend on it`.
     So the app allowance really is an allowlist, not an exemption.
  2. `eve` added to `@internal/testing` (a library package) → FAILS on the
     adapter-only rule. The allowance does not leak to `packages/*`.
  3. `eve` added to `@internal/core` → FAILS: `eve matches the adapter-only
     pattern "eve"`.
  All three manifests restored; `packages/core/package.json` was checksummed
  before and after and is byte-identical to the concurrent agent's version.
  `git diff` shows no trace of any of the three edits, and the architecture
  suite is back to 15 passed.

### Decisions / deviations
- **No layout deviation.** The build plan's assumed structure
  (`agent/{agent.ts,instructions.md,skills/,tools/,lib/}`) is exactly what
  `eve/docs/reference/agent-files.md` and
  `eve/docs/concepts/project-structure.mdx` document for a single-agent project.
  eve also supports a flat layout with the agent files at the package root; the
  nested one was chosen because eve's own docs recommend it and the build plan
  specifies it. `eve info` confirms `Layout nested`.
- **`eve` has no read-only / side-effect flag on a tool.** The authored tool
  shape in `eve/dist/src/tools/definition.d.ts` is `description`, `inputSchema`,
  `outputSchema?`, `execute`, `label?`, `approval?`, `approvalKey?`,
  `toModelOutput?`, `availableInSubagents?`, `execution?`. The task brief
  assumed permission metadata might exist; it does not. Read-only is expressed
  as `approval: never()` plus a doc comment, and *enforced* by keeping the
  implementation in a pure `lib/` module with a direct unit test. A
  machine-readable form of this property is M1-T9's problem, not eve's.
- **Two of eve's optional default tools were disabled.** A first `eve info`
  reported 11 tools, including `web_search` and `web_fetch`, which would give
  this fixture domain live web research by default. That contradicts the
  milestone's own instruction ("Use deterministic local fixture tools before
  adding live web research"), so both are disabled with `disableTool()` at their
  own slots, the documented per-tool mechanism. `defaultTools: false` was
  rejected: it also removes `load_skill`, which this agent's skill needs. This
  is slightly beyond the literal brief, which asked only for one fixture tool;
  it is recorded here rather than done quietly. Reversing it is two file
  deletions.
- **`ai` is declared directly by the app.** eve's own manual-install instruction
  is `npm install eve@latest ai zod`, `ai` is eve's only required peer, and
  ADR-0024 requires a required peer to be declared and pinned rather than
  auto-installed. `zod` is needed by the tool's input schema. All three at the
  same pins the adapters use.
- **The tool is a wrapper over a pure function**, rather than self-contained.
  `defineTool` stamps a brand only eve's lifecycle code executes, and identity
  is path-derived, so a tool module exports nothing a test can call. Splitting
  the logic into `agent/lib/` is what makes the behaviour testable at all.
- **Relative imports use the `.js` extension.** eve's examples show extensionless
  ones, but this repository typechecks with `module: nodenext`, which requires
  the extension. Verified that eve's compiler resolves `./vendor-evidence.js` to
  the TypeScript source: `eve info` reports zero diagnostics. No
  `moduleResolution` override was needed, so the app shares the repository's
  language baseline.
- **The app has no `tsconfig.build.json` and emits no `dist/`.** It is an
  application: nothing imports it. Its `build` is `eve build`. Because the root
  turbo task definitions describe `src/**` and `dist/**`, the app carries its own
  `turbo.json` (`extends: ["//"]`, the only permitted value in the turbo 2.11
  schema) declaring `agent/**` as an input and `.output/**` as an output.
  Without it, turbo would have served a stale cache hit after any agent edit.
- **No root `example:info` script was added.** `eve info` needs no wrapper;
  `pnpm --filter @internal/example-agent run info` works, and it is documented in
  `docs/development/commands.md`. Root `package.json` is untouched.
- **AGENTS.md's "next free number" is now 0027.** ADR-0025 is this task's;
  ADR-0026 was created by the concurrent M1-T7/M1-T8 core work while this task
  ran.
- **Shared docs were edited surgically**, re-read immediately before each change,
  per the concurrency rules. `docs/context/current-state.md` was deliberately not
  touched; the orchestrator rewrites it after both tasks land.

### Known issues / blockers
- None blocking M1-T3.
- **`pnpm build` now runs a full `eve build`** as part of `pnpm check`. It is
  cached by turbo and took about 2.5 s warm, but it is a heavier build stage than
  the repository had before, and it produces a 10.1 MB bundle on a cold run.
- **eve's remaining default tools are not deterministic either.** After the two
  web tools are disabled, the agent still has `bash`, `read_file`, `write_file`,
  `todo`, `load_skill`, `ask_question`, `task_cancel` and `agent`. None reaches
  the network, but whether a harness-run domain should carry eve's default tool
  set at all is an open question for M1-T6 and M1-T9. Nothing was assumed.
- **Open for M1-T4/M1-T6: how to run the agent programmatically.** Unchanged
  from M1-T1. `eve/client` (`Client`, `ClientSession`) is the documented
  programmatic surface and `eve/docs/guides/client/overview.mdx` is the page to
  read; this task did not read it, because nothing here executes the agent.
- **Open: there is no documented non-interactive local run command that works
  without a model credential.** `eve dev` is an interactive TUI, `eve start`
  serves a built `.output/`, and `eve invoke` sends a message; all reach a model.
  That is why no `example:run` script exists yet. The acceptance criterion
  belongs to M1-T4.
- **Open: whether a tool's `execute` can run outside eve's runtime context.**
  `ctx` is documented as live only while authored code runs. The example's tool
  ignores `ctx` entirely, so the question did not arise here, but a harness that
  wants to invoke an eve tool directly must answer it.
- **Open: who chooses the model.** The example reads `EXAMPLE_AGENT_MODEL` and
  falls back to eve's default. Whether the harness should select the model
  instead of the domain is an M1-T4/M1-T6 decision.
- **The Milestone 1 acceptance criterion "the example calls the harness API
  rather than the `eve` runtime directly" is not yet enforced by anything.**
  ADR-0025 names it as the complementary rule and puts its enforcement in M1-T4.
  Between now and then the rule is a convention.

### Next exact step
**M1-T3, `defineDomain()`**. The example agent exists and is discoverable, so
M1-T3 can register the vendor-triage domain against it:
`apps/example-agent/agent/lib/vendor-evidence.ts` already defines the evidence
shape a `defineDomain` input/output schema will have to describe.

## 2026-09-19 17:35 — M1-T6 (research) — EveAgentRuntime: programmatic eve execution research checkpoint

**Status:** started
**Actor/session:** coding agent (research subagent)
**Commit:** not committed

### Goal

Establish, from the installed `eve@0.63.0` and `ai@7.0.107` packages, how an
`EveAgentRuntime` can run the `apps/example-agent` agent from TypeScript:
in-process execution, structured output, model injection (including a test
double), cancellation, run observation for tracing/usage, per-run tool policy,
session/state isolation, execution-model constraints, the `agent` default tool,
and what is not documented and must therefore be a harness-owned decision.
Research only: no source code changes. Deliverable is
`docs/research/vercel/2026-09-19-m1-eve-programmatic-execution.md`.

### Implementation references

- package/version: to be recorded in the `completed` entry.
- installed docs read: in progress.
- official docs/repos/examples read: in progress.
- public types/exports inspected: in progress.
- selected documented pattern: in progress.

### Work completed

- (in progress)

### Files changed

- (in progress)

### Verification

- (pending)

### Decisions / deviations

- (pending)

### Known issues / blockers

- None yet.

### Next exact step

Read the installed `eve` docs and `.d.ts` surface, then write the research note.

## 2026-09-19 17:38 — M1-T3, M1-T5 — `defineDomain()` and the `AgentRuntime` contract

**Status:** started
**Actor/session:** coding agent (implementation subagent)
**Commit:** not committed

### Goal

Add the remaining M1 pieces of build plan section 5 that these two tasks own:
`Job`, `DomainDefinition`, a schema abstraction that keeps `@internal/core`
zero-dependency, `defineDomain()`, `AgentRuntime` and `AgentExecution` in
`@internal/core`; a `FakeAgentRuntime` in `@internal/testing`; and the
vendor-triage domain definition with real `zod` schemas in
`apps/example-agent`. Out of scope: `createHarness()` (M1-T4), `EveAgentRuntime`
(M1-T6), `CapabilityRegistry` (M1-T9).

### Implementation references

- package/version: `zod@4.6.5` (installed, resolved from `apps/example-agent`
  via `require.resolve("zod/package.json")` to
  `node_modules/.pnpm/zod@4.6.5/node_modules/zod/package.json`). `typescript@6.0.3`,
  `vitest@5.0.1`, Node 24.21.0, pnpm 12.4.2.
- installed docs read: `node_modules/.pnpm/zod@4.6.5/node_modules/zod/v4/core/standard-schema.d.ts`
  (the full `StandardSchemaV1` interface: `~standard` with `version: 1`,
  `vendor: string`, optional `types`, and
  `validate: (value: unknown, options?) => Result<Output> | Promise<Result<Output>>`;
  `Result` is `{ value }` or `{ issues: ReadonlyArray<Issue> }`; `Issue.path` is
  `ReadonlyArray<PropertyKey | PathSegment>` where `PathSegment` is `{ key: PropertyKey }`),
  and `.../zod/v4/core/schemas.d.ts` lines 106-112, where `$ZodType` declares
  `"~standard": $ZodStandardSchema<this>`, i.e. every zod schema *is* a
  Standard Schema.
- official docs/repos/examples read: <https://standardschema.dev>, fetched
  2026-09-19. Its published interface is character-for-character the same as the
  copy zod ships, including the optional `types` and the
  `PropertyKey | PathSegment` path element. Spec version is `1`.
- public types/exports inspected: `zod`'s `~standard` at runtime, probed with
  Node against the installed package: `version: 1`, `vendor: "zod"`, `validate`
  returns **synchronously** for object schemas, and failure `path` arrays
  contain bare `string`/`number` segments (not `{ key }` objects) — e.g.
  `["b", 0, "c"]`. The harness still handles both forms, because the spec
  permits both and another vendor may use the object form.
- selected documented pattern: **Standard Schema v1, declared structurally in
  core.** `@internal/core` owns a copy of the spec's interface as
  `Schema<TOutput, TInput>` and never imports a schema library, so the
  zero-dependency rule holds while domains author schemas in `zod`. Recorded as
  ADR-0027.
- anything not documented that must be harness-owned: the spec defines no error
  type and no path normalization. `validateWith()` is harness-owned: it
  normalizes both path forms to `ValidationIssue.path` (`(string | number)[]`)
  and throws the existing `ValidationError`. `DomainEval` is a harness-owned M1
  shape; M6-T5 owns evals. Job IDs use `crypto.randomUUID()` in M1; M2-T1 owns
  the sortable ID scheme.

### Work completed

- (in progress)

### Files changed

- (in progress)

### Verification

- (pending)

### Decisions / deviations

- (pending)

### Known issues / blockers

- None yet.

### Next exact step

Implement `packages/core/src/schema.ts`, `job.ts`, `domain.ts` and
`agent-runtime.ts`, then the fake runtime and the example domain.

## 2026-09-19 17:49 — M1-T6 (research) — EveAgentRuntime: programmatic eve execution research checkpoint (result)

**Status:** completed
**Actor/session:** coding agent (research subagent)
**Commit:** not committed

### Goal

Answer, from the installed `eve@0.63.0` and `ai@7.0.107` only, how `EveAgentRuntime`
can execute the example agent: in-process execution, structured output, model
injection and test doubles, cancellation, run observation for tracing and usage,
per-run tool policy, session/state isolation, execution-model constraints, the
built-in `agent` tool, and what is undocumented and must be harness-owned.
Research only; no source code written, nothing committed.

### Implementation references

- package/version: `eve` 0.63.0, `ai` 7.0.107, `zod` 4.6.5, pinned by
  `packages/runtime-eve/package.json` and `apps/example-agent/package.json`.
  Resolved with
  `require.resolve('eve/package.json', { paths: ['apps/example-agent'] })` to
  `node_modules/.pnpm/eve@0.63.0_ai@7.0.107_zod@4.6.5_/node_modules/eve`, and the
  matching `ai` resolution to
  `node_modules/.pnpm/ai@7.0.107_zod@4.6.5/node_modules/ai`.
- installed docs read: `$EVE/docs/README.md`;
  `concepts/{sessions-runs-and-streaming.md, execution-model-and-durability.mdx,
  default-harness.md, built-in-tools.md, context-control.md, state.md,
  security-model.md}`; `reference/{typescript-api.md, cli.md}`; `agent-config.md`;
  `guides/client/{overview, messages, output-schema, streaming, continuations}.mdx`;
  `guides/{session-context.md, hooks.md, dynamic-capabilities.md,
  auth-and-route-protection.md, dev-tui.md}`;
  `guides/instrumentation/{instrumentation, otel}.mdx`;
  `guides/deployment/self-hosting.md`; `evals/{overview, targets, running}.mdx`;
  `tools/human-in-the-loop.md`; `subagents/index.mdx`.
- official docs/repos/examples read: none beyond the installed package. Under the
  source-of-truth protocol §1 the lockfile-matched package wins, and its shipped
  docs and declaration files settled every question asked.
- public types/exports inspected: `$EVE/dist/src/index.d.ts`;
  `public/index.d.ts`; `public/local-dev.d.ts`; `public/definitions/agent.d.ts`;
  `shared/agent-definition.d.ts`; `client/{index, types, session, sessions,
  message-response}.d.ts`; `protocol/message.d.ts`; `evals/{index, mock-model,
  types}.d.ts`; `public/{hooks, instrumentation, context, ai, models}/index.d.ts`;
  `public/{next, vercel, nuxt, sveltekit}/index.d.ts`;
  `public/next/server.js`, `public/nuxt/dev-server.js`,
  `public/sveltekit/dev-server.js`; `runtime/local-dev-capability.d.ts`;
  `$AI/dist/index.d.ts`; `$AI/dist/test/index.d.ts`; both `package.json` export maps.
- selected documented pattern: **`eve/client` over HTTP against a running eve
  server.** `eve` 0.63.0 exposes no in-process run API; its own Next, Nuxt and
  SvelteKit adapters spawn `eve dev --no-ui --port 0` or
  `.output/server/index.mjs` as a child process
  (`$EVE/dist/src/public/next/server.js`), and evals always target an HTTP URL
  (`$EVE/docs/evals/targets.mdx`). One fresh session per job via
  `client.sessions.create({ message, clientContext, outputSchema, signal })`;
  structured result from `MessageResult.data` / the `result.completed` event;
  cancellation via `MessageResponse.cancel()`; usage aggregated from
  `step.completed.data.usage` (`costUsd`, `inputTokens`, `outputTokens`, cache
  counters) across the turn's events. Full design, with each step marked
  "documented (path)" or "harness-owned", in §12 of the research note.
- anything not documented that must be harness-owned: obtaining and owning the
  server URL; presenting `job.objective` and `job.input` as a turn (eve documents
  no context slot for either; `clientContext` is the nearest fit);
  per-run tool permission enforcement (`SendTurnOptions` has no tool field);
  `Job.budget` enforcement (eve's `limits.*` are authored, per session, token and
  cost only, and prompt a human on breach); the
  `{ modelCalls, toolCalls, durationMs, costUsd? }` roll-up; the counting rule for
  retried steps, which eve explicitly does not disambiguate; and the mapping from
  eve failure codes to `AgentExecutionError`.

### Work completed

- Wrote `docs/research/vercel/2026-09-19-m1-eve-programmatic-execution.md`: 14
  numbered sections answering the ten questions, plus a recommended
  `EveAgentRuntime` design, a paste-ready `Implementation references` block for
  the M1-T6 implementer, and eight open questions for the orchestrator.
- Added the note's index entry to `docs/research/vercel/README.md`.
- Key findings: no in-process execution (§1); per-turn `outputSchema` is
  documented, server-validated and should replace text parsing (§2);
  `defineAgent({ model })` accepts a `LanguageModel` and `mockModel()` from
  `eve/evals` is the documented credential-free double, but it is authored into
  the agent file rather than injected per run (§3); `MessageResponse.cancel()` is
  run cancellation while `SendTurnOptions.signal` only aborts the HTTP request, so
  `ExecutionContext.signal` needs two propagations (§4); `step.completed.data.usage`
  carries `costUsd` only when AI Gateway served the call, and retried steps
  re-emit events that no field disambiguates (§5); no caller-supplied tool policy
  exists, with route-auth attributes plus a tool `approval` policy as the
  documented composition and observation-plus-cancel as the M1 fallback (§6);
  runs write to `.eve/.workflow-data` and there is no ephemeral test mode (§7);
  the built-in `agent` tool spawns a full root-agent copy even with zero
  subagents, so `defaultTools: false` is recommended for the example (§9).

### Files changed

- `docs/research/vercel/2026-09-19-m1-eve-programmatic-execution.md` (new).
- `docs/research/vercel/README.md` (one index entry appended).
- `docs/progress/WORKLOG.md` (this entry and the `started` entry above).

No source code, no `packages/*`, no `apps/*`, no contracts, no ADRs, no
`current-state.md`. Not committed.

### Verification

- note reviewed against installed files, every cited path exists — PASS.
  Checked by script: every `$EVE/...` and `$AI/...` path in the note resolved
  against the pnpm-resolved package directories, and every repository-relative
  path resolved against the working tree. 0 missing.
- `pnpm --filter @internal/example-agent exec eve info --json` — PASS
  (exit 0; tools `["bash","read_file","write_file","todo","load_skill",
  "ask_question","task_cancel","agent","lookup_vendor_evidence"]`, unchanged
  from M1-T2).
- `pnpm check:handoff` — PASS (`check:handoff — OK`), run 17:48 after appending
  this entry. Recording the first attempt too, because it teaches something about
  running concurrently: at 17:47 the same command **FAILED** with
  `[missing-decision-record] docs/progress/WORKLOG.md references decision record
  0027, but no file starting with "0027-" exists in docs/decisions/`. The
  reference belonged to the concurrent M1-T3/M1-T5 entry, which planned ADR-0027
  before writing the file; `docs/decisions/0027-standard-schema-is-the-harness-schema-contract.md`
  landed between the two runs and the check went green. Nothing in this task
  caused or fixed it. This entry references no decision record.
- `pnpm exec biome format` on the three changed files — not applicable; Biome's
  configuration ignores Markdown ("No files were processed in the specified
  paths"). No formatting gate applies to this task's output.

### Decisions / deviations

- **No eve server was started and no turn was run.** The task scope allowed
  read-only commands plus `eve info` and `eve build`, and a model-calling run
  needs `AI_GATEWAY_API_KEY`, which is deliberately unset. §10 of the note records
  this explicitly and gives the exact commands the M1-T6 implementer must run to
  confirm that a `mockModel` fixture agent serves a turn offline. If it does not,
  every end-to-end adapter test needs a credential.
- **The note recommends consuming the `eve/client` event stream rather than
  `eve/hooks` for M1 tracing**, which reads against the letter of ADR-0012's
  "agent-runtime observation MUST go through `eve/hooks`". The argument (note §5)
  is that it is the same documented event stream with the same envelope — eve's
  own docs say so — and that a hook runs in the server process and cannot reach
  the caller's `TraceWriter`. Raised as open question 8 rather than decided here;
  the recommendation is a short ADR-0012 clarification.

### Known issues / blockers

- None from this task. (`pnpm check:handoff` passes; see Verification for the
  transient ADR-0027 failure that resolved itself.)
- Open questions for the orchestrator, in note §14: who owns the eve server
  process; structured output vs text (couples to M1-T3's `Schema<T>`); whether a
  `mockModel` agent serves a turn offline; whether to set `defaultTools: false`
  on the example agent; one example app root or a second fixture root; whether
  permission enforcement by observation satisfies M1; whether a run should
  `reset()` its session; and the ADR-0012 reading above.

### Next exact step

Orchestrator reads
`docs/research/vercel/2026-09-19-m1-eve-programmatic-execution.md` §12 and §14 and
settles the eight open questions, in particular who owns the eve server process
(question 1) and whether the example agent sets `defaultTools: false`
(question 4), since both change M1-T6's scope. M1-T6 then pastes the §13
`Implementation references` block into its own `started` entry.

## 2026-09-19 17:55 — M1-T3, M1-T5 — `defineDomain()` and the `AgentRuntime` contract

**Status:** completed
**Actor/session:** coding agent (implementation subagent)
**Commit:** not committed

### Goal

As the `started` entry above (2026-09-19 17:38): `Job`, `DomainDefinition`, the
schema abstraction, `defineDomain()`, `AgentRuntime` and `AgentExecution` in
`@internal/core`; a `FakeAgentRuntime` in `@internal/testing`; and the
vendor-triage domain definition with real `zod` schemas in
`apps/example-agent`. Not in scope and not done: `createHarness()` (M1-T4),
`EveAgentRuntime` (M1-T6), `CapabilityRegistry` (M1-T9).

### Implementation references

Recorded in full in the `started` entry. Summary of what was verified against
the installed packages rather than assumed:

- `zod@4.6.5`, resolved from `apps/example-agent` to
  `node_modules/.pnpm/zod@4.6.5/node_modules/zod/`. Its
  `v4/core/standard-schema.d.ts` declares `StandardSchemaV1` with `~standard`
  carrying `version: 1`, `vendor: string`, optional `types`, and
  `validate: (value, options?) => Result<Output> | Promise<Result<Output>>`;
  `Issue.path` is `ReadonlyArray<PropertyKey | PathSegment>` with
  `PathSegment = { key: PropertyKey }`. `v4/core/schemas.d.ts` lines 106-112
  declare `"~standard": $ZodStandardSchema<this>` on `$ZodType`, so every zod
  schema is one.
- <https://standardschema.dev>, fetched 2026-09-19: identical interface, spec
  version 1.
- Probed at runtime against the installed package: `vendor: "zod"`, `validate`
  answers synchronously for object schemas, and failure paths are bare
  `string`/`number` segments (e.g. `["b", 0, "c"]`), never the `{ key }` form.
  The harness handles both anyway, because the spec permits both.
- `typescript@6.0.3`, `vitest@5.0.1`, Node 24.21.0, pnpm 12.4.2.

### Work completed

- **`@internal/core`, schema boundary (`src/schema.ts`).** `Schema<TOutput,
  TInput = unknown>` plus `SchemaProps`, `SchemaTypes`, `SchemaIssue`,
  `SchemaPathSegment`, `SchemaResult`/`SchemaSuccessResult`/
  `SchemaFailureResult`, `InferSchemaInput`/`InferSchemaOutput`, `isSchema`,
  `assertIsSchema` and `validateWith`. A harness-owned copy of Standard Schema
  v1 with an attribution comment; core imports nothing. `validateWith` is the
  single point where a schema failure becomes a `ValidationError`, normalizing
  both path forms.
- **`@internal/core`, `Job` (`src/job.ts`).** `Job<TInput, TOutput>` and
  `JobContracts`, exactly build plan section 5, readonly throughout. `TOutput`
  is phantom, carried by an optional `unique symbol`-keyed marker so
  `AgentRuntime.run` can infer it; `JOB_OUTPUT_TYPE` is `declare`d (nothing is
  emitted) and deliberately not re-exported from the barrel.
- **`@internal/core`, `defineDomain()` (`src/domain.ts`).** `DomainDefinition`,
  `DefineDomainConfig`, `CreateJobInput`, `DomainEval`, `defineDomain`.
  Validates `id`, `version`, both schemas and `createJob`; returns a frozen
  definition whose `createJob` stamps `domain`, generates `id`, checks the
  domain's returned body, applies defaults and freezes the job.
- **`@internal/core`, `AgentRuntime` (`src/agent-runtime.ts`).** `AgentRuntime`,
  `AgentExecution` (discriminated union on `status`),
  `CompletedAgentExecution`, `FailedAgentExecution`, `AbortedAgentExecution`,
  `AgentExecutionUsage`. No `eve`/AI SDK concept in any of it.
- **`@internal/testing`, `createFakeAgentRuntime()`
  (`src/fake-agent-runtime.ts`).** Scripted `result` or `handler`, `calls`
  recording, configurable `delayMs`, and abort handling on both an
  already-aborted signal and one that fires mid-run. `@internal/core` added as
  a `dependency` (`workspace:*`); lockfile updated.
- **`apps/example-agent/src/domain/`.** `schemas.ts` (zod input/output, field
  names matching `agent/instructions.md`), `procurement-sop.ts` (invented SOP),
  `index.ts` (`vendorTriage = defineDomain({...})` with the job factory and two
  fixture evals built from the `Northwind Ledger` and `Cobalt Harbor Logistics`
  fixtures). `@internal/core` added as a dependency.
- **Documentation.** ADR-0027, three contract docs, and updates to the
  contracts README, decisions README, AGENTS.md, the examples README, the
  system map and the milestone file.

### Files changed

- `packages/core/src/schema.ts`, `job.ts`, `domain.ts`, `agent-runtime.ts` (new)
- `packages/core/src/schema.test.ts`, `domain.test.ts`, `agent-runtime.test.ts` (new)
- `packages/core/src/index.ts` (barrel: new exports, header updated)
- `packages/testing/src/fake-agent-runtime.ts`, `fake-agent-runtime.test.ts` (new)
- `packages/testing/src/index.ts`, `packages/testing/package.json`
- `apps/example-agent/src/domain/schemas.ts`, `procurement-sop.ts`, `index.ts`,
  `domain.test.ts` (new)
- `apps/example-agent/package.json`, `apps/example-agent/src/dependency-pins.test.ts`
- `pnpm-lock.yaml`
- `docs/decisions/0027-standard-schema-is-the-harness-schema-contract.md` (new)
- `docs/contracts/job.md`, `domain-definition.md`, `agent-runtime.md` (new)
- `docs/contracts/README.md`, `docs/decisions/README.md`, `AGENTS.md`,
  `docs/examples/README.md`, `docs/architecture/system-map.md`,
  `docs/milestones/m1-local-agent-and-public-harness-boundary.md`
- `docs/progress/WORKLOG.md`

### Verification

- `pnpm install --frozen-lockfile` — PASS (lockfile up to date after the two
  new workspace dependencies).
- `pnpm test:unit` — PASS. 17 files, 235 tests (was 12 files, 156 tests).
- `pnpm check` — PASS, every stage: `format:check` (70 files), `lint`
  (70 files), `typecheck` (5 packages), `test` (17 files, 235 tests), `build`
  (5 tasks including `eve build`), `check:handoff` OK.
- `pnpm --filter @internal/example-agent run info` — `Compile ready`,
  `Diagnostics 0 errors, 0 warnings`, 1 skill, 9 tools. Unchanged by
  `src/domain/`: eve compiles only `agent/`. (Note: `pnpm --filter ... info`
  without `run` is pnpm's own `info` command and fails with a registry 404; the
  script form is the one to use, as `docs/examples/README.md` already says.)
- `packages/core/package.json` has no `dependencies` key at all — PASS.
- `grep -rn ": any\|<any>\|as any" packages/core/src` — no matches — PASS.

### Decisions / deviations

- **ADR-0027, Standard Schema v1 declared structurally in core.** The material
  decision; alternatives (depend on zod, per-library adapters, JSON Schema
  strings) are recorded there.
- **A `symbol` path segment is rendered with `String()`, not dropped.** The
  task brief suggested dropping it. Dropping a middle segment silently produces
  a path pointing at a different field, which is the kind of quiet corruption
  this repository's own fixture module argues against; `"Symbol(k)"` keeps the
  position honest and is still a `string`. Covered by a unit test.
- **A malformed schema throws `ValidationError`, not `TypeError`**, with a
  root-path issue, so every failure crossing a harness boundary has one type to
  catch. Same for a schema whose `validate` throws (original kept in `cause`).
- **A domain cannot state its own `domain` reference.** `CreateJobInput` is
  `Job` minus `id` and `domain`; the mismatch the brief asked to assert against
  is instead unstatable. Project decision.
- **`createJob` does not validate input.** M1-T4 owns the single choke point.
  Asserted by a test.
- **`DomainEval` is `{ id, description, input, expect? }`**, where `expect`
  throws to fail. M1 shape; M6 owns evals. Project decision.
- **No `isAgentExecutionCompleted` guard.** `status === "completed"` narrows
  natively, so the guard did not earn its place.
- **Job ids are `crypto.randomUUID()`** in M1. M2-T1 replaces the scheme;
  nothing may parse the current format.
- **`defineDomain`'s id rule is deliberately lenient** (letters, digits, `.`,
  `-`, `_`, starting alphanumeric). It bans whitespace, `/` and `@` so a
  contract reference such as `vendor-triage.input@1.0.0` stays unambiguous.
  `version` is strict: exactly `major.minor.patch`.
- **One type assertion exists**, in `createFakeAgentRuntime`, converting a
  scripted `AgentExecution` to `AgentExecution<TOutput>`. It is in
  `@internal/testing`, not core, is confined to one named function, and is
  itself an argument for the harness re-validating a claimed output.
- **`apps/example-agent/src/dependency-pins.test.ts` was adjusted** to exclude
  `@internal/*` from the pin assertions (a `workspace:*` range is not a version
  to pin) and to assert the new `@internal/core` dependency instead.
- `agent/instructions.md` and `agent/skills/triage-vendor.md` were **not**
  edited: the schema field names were chosen to match what they already say.

### Known issues / blockers

- None. Two milestone acceptance criteria are met only at the schema level
  ("input is validated", "one intentionally invalid output fails closed"); the
  end-to-end versions need `createHarness()` (M1-T4), which is where the
  criteria are actually claimed.
- "Cancellation reaches the runtime" is proven for the contract and the fake.
  That it reaches `eve` remains M1-T6's to prove.

### Next exact step

**M1-T4, `createHarness()`**. It now has everything it needs:
`vendorTriage.inputSchema`/`outputSchema` and `validateWith()` for the two
validation points, `vendorTriage.createJob()` for the job,
`createExecutionContext()` for the context, and `createFakeAgentRuntime()` from
`@internal/testing` to run against in tests without `eve`. M1-T6 and M1-T9 are
independent of it and of each other.

## 2026-09-19 17:58 — M1-T6 (research, addendum) — Verified by execution: a `mockModel` eve turn runs offline

**Status:** completed
**Actor/session:** coding agent (research subagent)
**Commit:** not committed by this task (see Decisions / deviations)

### Goal

Close open question 3 of
`docs/research/vercel/2026-09-19-m1-eve-programmatic-execution.md` by execution
rather than by reading: prove or disprove that an eve agent whose `agent.ts` is
`defineAgent({ model: mockModel(...), defaultTools: false })` serves a full turn
offline, driven by `eve/client`, with a per-turn `outputSchema` in both the zod
and plain-JSON-Schema forms, returning `MessageResult.data`. The answer decides
whether the M1-T6 adapter's end-to-end tests need a model credential.

### Implementation references

- package/version: `eve` 0.63.0, `ai` 7.0.107, `zod` 4.6.5, resolved through
  `packages/runtime-eve/node_modules` (unchanged from the parent entry).
- installed docs read: `$EVE/docs/evals/overview.mdx` ("Deterministic fixture
  models"), `$EVE/docs/concepts/project-structure.mdx`,
  `$EVE/docs/reference/agent-files.md`, `$EVE/docs/agent-config.md`
  ("Other defineAgent fields"), `$EVE/docs/concepts/built-in-tools.md`
  ("Disable optional default tools"), `$EVE/docs/reference/cli.md`
  (`eve info`, `eve dev`).
- official docs/repos/examples read: none; the installed package settled
  everything, and two answers came only from running it.
- public types/exports inspected: `$EVE/dist/src/evals/mock-model.d.ts`
  (`MockModelOptions { modelId?, provider?, respond? }`, `MockModelRequest`,
  `MockModelResponse { text?, toolCalls?, usage? }`);
  `$EVE/dist/src/shared/agent-definition.d.ts` line 355
  (agent-level `modelContextWindowTokens`, absent from the agent-config.md
  field table); `$EVE/dist/src/protocol/message.d.ts`
  (`isTurnFailureEvent`, `TurnFailureStreamEvent`);
  `$EVE/dist/src/client/types.d.ts` (`MessageResult`).
- selected documented pattern: unchanged. `eve/client` against an
  `eve dev --no-ui --port 0` server; `mockModel` options form with a scripted
  `respond`; per-turn `outputSchema`; `MessageResponse.cancel()`.

### Work completed

- Built a throwaway fixture at `packages/runtime-eve/.tmp-mock-agent/`, ran six
  turns against it, and deleted it in full.
- Appended section 15, "Verified by execution: a `mockModel` turn offline", to
  the research note: the three-attempt app-root table, the
  `modelContextWindowTokens` discrepancy, the fixture source, the exact
  commands and server output, four event sequences with timings, the
  `final_output` mechanism, and a teardown record.
- Rewrote §12 step 7's terminal-state table and updated §14 questions 3 and 5.

Findings, in order of how much they change M1-T6:

1. **A `mockModel` turn runs offline.** Six turns, 58-141 ms each, every model
   credential unset. Adapter contract tests need no credential and no
   `live:eve` tag.
2. **`MessageResult.status` is not a discriminator.** It was `"waiting"` for a
   successful turn, a turn that failed with `OUTPUT_SCHEMA_NOT_FULFILLED`, and a
   cancelled turn. The adapter must branch on turn boundary events and should
   use the exported `isTurnFailureEvent`. §12's table said otherwise and has
   been corrected.
3. **An app-root `package.json` declaring `eve` is required.** With no
   `package.json`, eve walked up to `packages/runtime-eve` and reported "found
   no agent files"; with a bare one it reported "No eve project contains …".
   A permanent fixture must therefore be its own workspace package.
4. **`mockModel` alone does not compile.** The evals doc's one-liner fails with
   "Cannot compile agent compaction because the primary compaction trigger model
   \"eve-mock/model\" does not have known AI Gateway context window metadata."
   The fix is an agent-level `modelContextWindowTokens`, which exists on
   `PublicAgentDefinition` but is missing from the agent-config.md field table.
   Recorded as a docs-vs-installed-package discrepancy.
5. **A per-turn `outputSchema` reaches the model as a synthetic `final_output`
   tool** carrying the lowered JSON Schema. Undocumented. A fixture may script
   it; the adapter must not name it and does not need to.
6. **`MessageResult.message` is `undefined` on a structured turn.**
7. **`defaultTools: false` really does remove all eight defaults**, `agent`
   included: `eve info` reported 1 tool, the authored one. §9 confirmed.
8. **Cancellation is real and fast.** Against a tool sleeping 8000 ms, `cancel()`
   returned `"accepted"` and `turn.cancelled -> session.waiting` arrived 44 ms
   later with no `action.result`. But cancelling an instant turn completes
   normally, so a cancellation test must make the turn slow.
9. **A mocked tool call round-trips** as `actions.requested -> action.result`,
   which is what the permission check and tool count depend on.
10. **No `costUsd` on a mock model's `step.completed.usage`**, only token and
    cache counters. §5's optional-cost claim confirmed.

### Files changed

- `docs/research/vercel/2026-09-19-m1-eve-programmatic-execution.md` (section 15
  appended; §12 step 7 table rewritten; §14 questions 3 and 5 updated).
- `docs/progress/WORKLOG.md` (this entry).

Created and deleted within the task: `packages/runtime-eve/.tmp-mock-agent/**`,
including its 20 MB `.eve/`. No other file in the repository was touched; nothing
under `packages/core`, `packages/testing`, `apps/example-agent` or
`docs/contracts` was read for writing or modified.

### Verification

- **Spike itself — PASS.** `client.health()` returned
  `{"ok":true,"status":"ready","workflowId":"workflow//eve//workflowEntry"}`;
  plain turn PASS (141 ms, `message: "Hello from the fixture agent."`); tool
  round-trip PASS (80 ms, `actions.requested -> action.result`); zod
  `outputSchema` PASS (125 ms, `data: {"category":"software","risk":2}`); plain
  JSON Schema PASS (58 ms, identical `data`); in-flight cancel PASS
  (`turn.cancelled` 44 ms after accept). One deliberate negative case also
  behaved as expected: a text-only reply on a schema turn FAILED with
  `OUTPUT_SCHEMA_NOT_FULFILLED`, which is the finding, not a defect.
- `AI_GATEWAY_API_KEY`, `VERCEL_OIDC_TOKEN`, `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY` all confirmed unset before the run; the server was
  additionally started under `env -u AI_GATEWAY_API_KEY -u VERCEL_OIDC_TOKEN` —
  PASS (no credential was read and none reached a provider).
- Teardown — PASS. `packages/runtime-eve/.tmp-mock-agent/` removed;
  `pgrep -fl "eve.js dev"` reported no remaining process; `git status --short`
  shows only this task's documentation changes.
- `pnpm check:handoff` — PASS (`check:handoff — OK`).

### Decisions / deviations

- **This task did not commit, but its earlier output was committed by another
  agent.** The concurrent M1-T3/M1-T5 task committed the whole working tree as
  `16e10e8`, which swept in the research note, the research README entry and both
  earlier M1-T6 WORKLOG entries. Nothing was lost and the content is intact, but
  M1-T6 research is now recorded under an M1-T3/M1-T5 commit message. Left alone
  deliberately: AGENTS.md forbids rewriting another agent's committed work.
  Flagged for the orchestrator. The section 15 changes in this entry are
  uncommitted.
- The fixture declared `eve`, `ai` and `zod` in its `package.json` but was never
  `pnpm install`ed; it resolved them upward through
  `packages/runtime-eve/node_modules`. Deliberate, to avoid touching
  `pnpm-lock.yaml` or the workspace while another agent was working.
- The fixture's mock responder scripts the undocumented `final_output` tool.
  That is acceptable in a fixture and forbidden in the adapter; §15.6 states the
  split explicitly so nobody copies it into `packages/runtime-eve`.

### Known issues / blockers

- None from this task.
- Open questions 1, 2, 4, 6, 7 and 8 in note §14 remain for the orchestrator.
  Questions 3 and 5 are now answered or costed.

### Next exact step

Orchestrator settles note §14 questions 1 (who owns the eve server process),
4 (`defaultTools: false` on the example agent) and 5 (one app root or a second
fixture package, now costed at one `BOUNDARY_RULES` entry), then starts M1-T6
with the §13 `Implementation references` block plus the §15.7 corrections.

## 2026-09-19 18:01 — M1-T4, M1-T9 — `createHarness()` and the domain capability registry

**Status:** started
**Actor/session:** coding agent (implementation subagent)
**Commit:** not committed

### Goal

Add the two remaining `@internal/core` pieces Milestone 1 owns.

**M1-T4, `createHarness()`**: the public entry point the build plan states as
`createHarness({ agentRuntime, storage })` plus
`harness.run({ domain, input })`. It is the single choke point where input is
validated before execution and a runtime's claimed output is re-validated
before success, and the place trace events for a run are emitted.

**M1-T9, capability registry**: `CapabilityRegistry` and `CapabilityManifest`
per build plan section 5 and AD-015, with the canonical-JSON/fingerprint
primitives the manifest needs, and the example domain registering its five
capability kinds.

Out of scope: `EveAgentRuntime` (M1-T6), the `Storage` contract (M2), the real
trace taxonomy (M2-T3), the sortable ID scheme (M2-T1), and behavior
fingerprints over instructions/SOP/skills/model config (M2-T8).

### Implementation references

Not Vercel-framework-facing: neither task touches `eve`, the AI SDK, AI
Gateway, Jev, Workflow or Sandbox. The source material is this repository's own
plan plus one Node built-in.

- package/version: Node 24.21.0, pnpm 12.4.2, `typescript@6.0.3`,
  `vitest@5.0.1`, `@types/node@24.13.6`. `@internal/core` stays at zero
  third-party dependencies; the only new import is the Node built-in
  `node:crypto`.
- installed docs read: `node_modules/@types/node/crypto.d.ts`
  (`createHash(algorithm: string, options?: HashOptions): Hash`, and `Hash`'s
  `update(data, inputEncoding)` / `digest(encoding)`), matching the Node 24 API
  documentation for `crypto.createHash`.
- plan sections read: build plan §5 (Core Contracts — Job, Domain definition,
  Agent runtime, **Capability registry**, Fallback envelope), **AD-015**
  (workflow IR references a typed capability registry; the seven capability
  kinds and the eight metadata fields a registry record carries), **AD-016**
  (internal implementation choices are recorded, not implied, and it names
  "canonical JSON encoding used for fingerprints" as an explicit example),
  Milestone 1 tasks M1-T4 and M1-T9 with the milestone's acceptance criteria,
  and M2-T1 (stable identifiers), M2-T3 (trace event taxonomy) and M2-T8
  (behavior fingerprint) so that nothing here forecloses what M2 extends.
- repository contracts read in full: `docs/contracts/execution-context.md`,
  `errors.md`, `job.md`, `domain-definition.md`, `agent-runtime.md`, and every
  file under `packages/core/src/` and `packages/testing/src/` with its test.
- external specification consulted: RFC 8785 (JSON Canonicalization Scheme) for
  the canonical-JSON rules the fingerprint needs — sorted object keys, no
  insignificant whitespace, arrays in order. The harness implements the subset
  it needs over its own `JsonValue` model rather than depending on a library,
  and rejects the values JSON cannot represent (`NaN`, `Infinity`).
- selected documented pattern: none is prescribed for either task, so both are
  harness-owned by the no-assumption stop condition. The canonical-JSON and
  fingerprint scheme is material enough for an ADR under AD-016 and is recorded
  as **ADR-0029**; the smaller choices (harness-owned `Clock`, `runtime`
  optionality on `createExecutionContext`, `HarnessRunResult` shape, the
  registry's error type for an unknown reference) are recorded in this entry.
- anything not documented that must be harness-owned: the build plan's
  `createHarness({ agentRuntime, storage })` names a `storage` option whose
  contract M2 defines; M1 omits the option rather than inventing a placeholder
  type. The build plan's `CapabilityManifest` is named but never defined; its
  shape (`{ version: 1, entries }`, deterministically sorted) is harness-owned.

### Work completed

- (in progress)

### Files changed

- (in progress)

### Verification

- (pending)

### Decisions / deviations

- (pending)

### Known issues / blockers

- Another agent's research spike may leave `packages/runtime-eve/.tmp-mock-agent/`
  in the tree; it is not this task's and is ignored.

### Next exact step

Implement `packages/core/src/identifiers.ts`, `fingerprint.ts`,
`capabilities.ts` and `harness.ts` with their tests, then the example domain's
capabilities, handler and policy.

---

## 2026-09-19 18:22 — M1-T6 — Eve adapter (`EveAgentRuntime`)

**Status:** started
**Actor/session:** Claude Opus 5 implementer subagent (orchestrated)
**Commit:** not committed

### Goal
Implement `EveAgentRuntime` in `packages/runtime-eve`, the first real
`AgentRuntime`, without leaking any `eve` session type past the package
boundary. Add the credential-free fixture app `apps/eve-fixture-agent`, the
`startEveDevServer()` test helper, unit and contract tests, `pnpm example:run`
and `pnpm example:run:mock`, ADR-0028 and `docs/architecture/runtime.md`.

### Implementation references
- package/version: `eve@0.63.0`, `ai@7.0.107`, `zod@4.6.5`, pinned by
  `packages/runtime-eve/package.json` and `apps/example-agent/package.json`
  (ADR-0024). Resolved with
  `require.resolve('eve/package.json', { paths: ['packages/runtime-eve'] })` to
  `node_modules/.pnpm/eve@0.63.0_ai@7.0.107_zod@4.6.5_/node_modules/eve`;
  `node -e "require('$EVE/package.json').version"` printed `0.63.0`.
- installed docs read: `$EVE/docs/guides/client/{overview,messages,streaming,output-schema}.mdx`;
  `$EVE/docs/concepts/built-in-tools.md`; `$EVE/docs/evals/overview.mdx`
  (`mockModel`, "Deterministic fixture models"); `$EVE/docs/reference/cli.md`
  (command table and the `eve dev` flag table, `--no-ui`, `--port`).
- official docs/repos/examples read: none beyond the installed package. The
  installed docs and declaration files settled every question, and the
  source-of-truth protocol §1 puts them first.
- public types/exports inspected: `$EVE/dist/src/client/index.d.ts` (the full
  `eve/client` export list, including `isTurnFailureEvent` and
  `isCurrentTurnBoundaryEvent`); `client/types.d.ts` (`ClientOptions`,
  `ClientAuth`, `HeadersValue`, `ClientRedirectPolicy`, `SendTurnInput`,
  `SendTurnOptions`, `MessageResult`, `CancelSessionResult`); `client/client.d.ts`
  (`Client.health()`, `Client.info()`, `Client.sessions`);
  `client/sessions.d.ts` (`ClientSessions.create`, `CreatedClientSession`);
  `client/session.d.ts`; `client/message-response.d.ts` (`sessionId`, `cancel()`,
  `result()`, `[Symbol.asyncIterator]`, single-use);
  `client/health-schema.d.ts`; `protocol/cancel-turn.d.ts` (`CancelTurnResult`);
  `protocol/message.d.ts` (`MessageStreamEventMeta`, `StepStartedStreamEvent`,
  `StepCompletedStreamEvent.usage`, `StepFailedStreamEvent`,
  `ActionsRequestedStreamEvent`, `ActionResultStreamEvent`,
  `ResultCompletedStreamEvent`, `TurnCompleted/Cancelled/FailedStreamEvent`,
  `SessionWaiting/Failed/CompletedStreamEvent`, `TurnFailureStreamEvent`,
  `isTurnFailureEvent`); `shared/action-types.d.ts` (`RuntimeActionRequest`'s
  five kinds and `RuntimeActionResult`'s three); `evals/mock-model.d.ts`
  (`MockModelOptions`, `MockModelRequest`, `MockModelResponse`);
  `evals/index.d.ts`; `shared/agent-definition.d.ts` (`defaultTools`, `tool`,
  `modelContextWindowTokens` on `PublicAgentDefinition`);
  `compiled/@standard-schema/spec/index.d.ts` (`StandardSchemaV1`,
  `StandardJSONSchemaV1`, `StandardJSONSchemaV1.Converter`);
  `tools/schema.d.ts` + `tools/schema.js` (`serializeOutputSchema`, which is how
  eve actually lowers a client `outputSchema`).
- selected documented pattern: `eve/client` over HTTP against a running eve
  server, exactly as
  `docs/research/vercel/2026-09-19-m1-eve-programmatic-execution.md` §12
  recommends. One fresh session per `run()` via
  `client.sessions.create({ message, clientContext, outputSchema, signal })`;
  the turn's events consumed live with `for await (const event of response)`;
  cancellation via `MessageResponse.cancel()`; terminal state branched on turn
  boundary events and `isTurnFailureEvent`, never on `MessageResult.status`
  (§15.7). The adapter never spawns a process; a separate
  `startEveDevServer()` helper under `@internal/runtime-eve/testing` does, using
  the `eve dev --no-ui --port 0` invocation eve's own Next/Nuxt/SvelteKit
  adapters use (`$EVE/dist/src/public/next/server.js`).
- not documented / harness-owned: obtaining and owning the server URL;
  presenting `job.objective` as the turn message and `job.input` as
  `clientContext`; per-run tool-permission enforcement by observation;
  `Job.budget` enforcement; the `{ modelCalls, toolCalls, durationMs, costUsd? }`
  roll-up and its retry counting rule; the eve-failure-code to
  `AgentExecutionError` mapping; the `eve.<type>` trace projection.
- **one correction to the research note.** §2 and §12 say the harness can pass
  its `Schema<T>` straight to eve because `SendTurnOptions.outputSchema` accepts
  "Standard Schema implementations". The installed types are narrower than that
  sentence: the field is `StandardJSONSchemaV1<unknown, TOutput> | JsonObject`,
  which requires `~standard.jsonSchema`, and `@internal/core`'s `Schema<T>`
  (ADR-0027) is Standard **Schema** v1, which declares only `~standard.validate`.
  `$EVE/dist/src/tools/schema.js` `serializeOutputSchema` confirms the runtime
  behaviour: without a `jsonSchema.output` function it throws
  `Zod 3 cannot emit an output JSON Schema`. Verified that `zod@4.6.5` does
  publish `~standard.jsonSchema` with `input`/`output` converters, and that
  `output({ target: "draft-07" })` on the vendor-triage output schema emits
  `minLength`, `minItems`, `enum` and `additionalProperties: false`. The adapter
  therefore lowers the domain schema itself through the documented
  `StandardJSONSchemaV1.Converter` and sends a plain JSON Schema object.

### Work completed

- (in progress)

### Files changed

- (in progress)

### Verification

- (pending)

### Decisions / deviations

- (pending)

### Known issues / blockers

- `AgentRuntime.run(job, context)` hands the adapter no schema: `Job.contracts`
  carries string references only, and M1-T9's capability registry does not exist
  yet. The adapter therefore takes the domains' output schemas at construction.

### Next exact step

Write `packages/runtime-eve/src/eve-agent-runtime.ts` and its unit test.

## 2026-09-19 18:24 — M1-T4, M1-T9 — `createHarness()` and the domain capability registry (result)

**Status:** completed
**Actor/session:** coding agent (implementation subagent)
**Commit:** not committed (the orchestrator reviews and commits)

### Goal

As stated in the `started` entry above (2026-09-19 18:01).

### Implementation references

As stated in the `started` entry. Nothing changed during implementation: neither
task is Vercel-framework-facing, `@internal/core` gained no third-party
dependency, and the only new import anywhere in core is the Node built-in
`node:crypto`.

### Work completed

**M1-T4, `createHarness()`.** `packages/core/src/harness.ts` is the single
choke point the milestone needs. `harness.run({ domain, input, signal?,
budget?, permissions?, metadata? })`:

1. validates `input` against `domain.inputSchema` and **throws**
   `ValidationError` on failure, because a rejected input is a caller bug found
   before a run exists and nothing has been spent;
2. builds the job with `domain.createJob(validInput)` and applies the
   overrides: budget merged shallowly, permissions replaced wholesale, metadata
   merged per key;
3. generates `runId` with `crypto.randomUUID()` and fixes `attempt` at `1`
   (M1 has no retries; **M2-T1** replaces the ID scheme and nothing may parse
   the current format);
4. builds the `ExecutionContext`, emits `run.started`, runs, emits exactly one
   terminal event and calls `flush()`;
5. contains a runtime that throws, reporting `AgentExecutionError` with the
   thrown value in `cause`;
6. re-validates a completed execution's output against `domain.outputSchema`
   before calling the run a success.

`HarnessRunResult<TOutput>` is a discriminated union on `status`:

```ts
type HarnessRunResult<TOutput = unknown> =
  | { status: "completed"; output: TOutput; /* base */ }
  | { status: "failed"; error: SerializedHarnessError; /* base */ }
  | { status: "aborted"; /* base */ };
```

with `runId`, `jobId`, `domain`, `attempt`, `usage` and `runtime` on every
variant, because a failed or cancelled attempt still cost something. The
`failed` variant has **no `output` field at all**, so an output that failed
validation is unreachable rather than merely undocumented.

**M1-T9, capability registry.** `packages/core/src/capabilities.ts` implements
the split build plan section 5 states: the runtime registry holds executable
values, the serializable manifest holds only metadata.
`createCapabilityRegistry()` returns `register` / `resolve` / `has` /
`entries` / `toManifest`, with `CapabilityManifestEntry` exactly as the plan
writes it. Every field of an entry is a string, a string array or an
`{ id, version }` pair, so "no executable source or secrets" is a property of
the type as well as of a test.

`packages/core/src/fingerprint.ts` holds `canonicalJson()` and `fingerprint()`
(**ADR-0029**). `packages/core/src/identifiers.ts` holds the identifier and
version rules, extracted from `domain.ts` so `defineDomain()` and the registry
cannot drift apart.

**Example domain.** `apps/example-agent/src/capabilities.ts` registers all six
entries across the five required kinds, with two new pure modules written for
the purpose (`src/handlers/detect-payment-detail-change.ts`,
`src/policies/no-proceed-with-open-risk-flags.ts`).
`apps/example-agent/src/domain/harness.test.ts` runs the real domain end to end
through `createHarness()` with `createFakeAgentRuntime()`.

**Testing package.** `createRecordingTraceWriter()` was added to
`@internal/testing`, which the M1-T7 handoff had predicted would be the first
thing a test needing to assert on emitted events would want.

### Files changed

New, `packages/core/src/`:

- `harness.ts` + `harness.test.ts` — `createHarness`, `Harness`,
  `CreateHarnessOptions`, `HarnessRunInput`, `HarnessRunResult` and its three
  variants, `Clock`.
- `capabilities.ts` + `capabilities.test.ts` — `CapabilityKind`,
  `CapabilityRef`, `CapabilityRegistration`, `CapabilityManifestEntry`,
  `CapabilityManifest`, `CapabilityRegistry`, `createCapabilityRegistry`,
  `capabilityFingerprint`, `formatCapabilityRef`, `parseCapabilityRefString`,
  `CAPABILITY_KINDS`.
- `fingerprint.ts` + `fingerprint.test.ts` — `canonicalJson`, `fingerprint`,
  `FINGERPRINT_ALGORITHM_PREFIX`.
- `identifiers.ts` — `isCapabilityIdentifier`, `isExactVersion`, plus the
  internal `collectRefIssues` / `throwIfIssues` shared with `domain.ts`.

Modified:

- `packages/core/src/context.ts` — `runtime` is now optional on
  `CreateExecutionContextInput`, defaulting to the new exported
  `HARNESS_RUNTIME_INFO`.
- `packages/core/src/domain.ts` — the two regexes and `throwIfIssues` moved to
  `identifiers.ts`; behaviour unchanged.
- `packages/core/src/trace.ts` — the "no recording writer exists" note is no
  longer true and now names the one that does.
- `packages/core/src/index.ts` — the new exports.
- `packages/core/package.json` — `@internal/testing` in **devDependencies**.
  Still no `dependencies` at all.
- `packages/core/turbo.json` — **new.** Drops `^build` for this one package;
  see "Decisions" below.
- `packages/testing/src/recording-trace-writer.ts` + its test + `index.ts`.
- `apps/example-agent/src/capabilities.ts` + its test — **new.**
- `apps/example-agent/src/handlers/detect-payment-detail-change.ts` + test —
  **new.**
- `apps/example-agent/src/policies/no-proceed-with-open-risk-flags.ts` + test —
  **new.**
- `apps/example-agent/src/domain/harness.test.ts` — **new.**
- `apps/example-agent/src/domain/schemas.ts` — exports the
  `VendorTriageRiskFlag` type so the handler can produce one without restating
  the shape.
- `apps/example-agent/package.json` — `@internal/testing` in devDependencies.
- `pnpm-lock.yaml`.

Documentation:

- `docs/contracts/harness.md` — **new.**
- `docs/contracts/capability-registry.md` — **new.**
- `docs/contracts/README.md` — both rows, and the summary prose.
- `docs/contracts/execution-context.md` — `HARNESS_RUNTIME_INFO`, `runtime`
  optionality, the defaults table, the recording-writer note.
- `docs/decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md` —
  **new.**
- `docs/decisions/README.md` — the table row and the entry prose.
- `AGENTS.md` — ADR paragraph and the `decisions/` layout comment; next free
  number is now **0030** (M1-T6 takes 0028).
- `docs/architecture/system-map.md` — core and testing descriptions, the
  source-file list, and the `packages/registry` row, corrected to say it is the
  **M5 workflow** registry while the capability registry is in core.
- `docs/examples/README.md` — the file table, a "Running it through the
  harness" section and a "The capability manifest" section.
- `docs/milestones/m1-local-agent-and-public-harness-boundary.md` — T4 and T9
  marked `completed` with result paragraphs, and the acceptance criteria
  rewritten.
- `docs/progress/WORKLOG.md` — this entry.

`docs/context/current-state.md` was deliberately **not** touched: another agent
owns it this session.

### Verification

Run with Node 24.21.0 and pnpm 12.4.2 from `~/.n/bin`. Two other agents were
working in this tree concurrently, so the per-stage results below separate what
this task owns from what it does not.

- `pnpm vitest run --project unit` over this task's eight new test files —
  **PASS**, 80/80.
- `pnpm test:unit` (whole repository) — **FAIL, 358/359**, and the single
  failure is not this task's: `tests/architecture/package-boundaries.test.ts >
  discovers every workspace package` lists the expected workspace inventory by
  hand and does not yet include `@internal/eve-fixture-agent`, the package
  M1-T6 created in this tree while this task was running. The other 14
  assertions in that file **PASS**, including the real
  `findBoundaryViolations` check, so no boundary is violated. That file belongs
  to M1-T6's task and was deliberately not edited here.
- `pnpm typecheck` — **PASS** (6/6 packages, plus the root `tsc --noEmit`).
- `pnpm build` — **PASS** (6/6, including `eve build`).
- `pnpm format:check` — **FAIL**, on three files, all M1-T6's:
  `apps/eve-fixture-agent/agent/lib/json-schema-value.ts`,
  `packages/runtime-eve/src/eve-agent-runtime.contract.test.ts`,
  `packages/runtime-eve/src/eve-agent-runtime.test.ts`. This task's files:
  `biome format packages/core packages/testing apps/example-agent` — **PASS**,
  59 files, no fixes applied.
- `pnpm lint` — **FAIL**, on three files, all M1-T6's
  (`packages/runtime-eve/src/eve-agent-runtime.ts`, its test, and
  `packages/runtime-eve/src/index.ts`). This task's files:
  `biome check --formatter-enabled=false packages/core packages/testing
  apps/example-agent` — **PASS**, no errors.
- `pnpm check:handoff` — **FAIL**, one problem, not this task's: the WORKLOG
  references decision record `0028` and no `0028-*` file exists yet. That
  reference is M1-T6's entry and M1-T6 writes the ADR. The `0029` reference
  this task introduced resolves, because
  `docs/decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md`
  exists.
- `pnpm check` — **not run to completion**, because three of its six stages
  fail on another agent's in-flight files. Every stage was run individually and
  is recorded above.
- `pnpm --filter @internal/example-agent run info` — **PASS**:
  `Compile ready`, `Diagnostics 0 errors, 0 warnings`, 1 skill. It now reports
  **2 tools** rather than 9, which is M1-T6's `defaultTools: false` change
  landing in this tree, not this task's; nothing here touches `agent/`.
- `packages/core/package.json` has no `dependencies` key at all;
  `@internal/testing` is in `devDependencies` only — **PASS**, asserted by
  reading the manifest.

### Decisions / deviations

Project decisions, recorded here rather than as ADRs (ADR-0029 covers the one
that needed one):

1. **`storage` is omitted from `CreateHarnessOptions`, not stubbed.** The build
   plan's target API names it; M2 defines the `Storage` contract. A placeholder
   type would publish a guess as a contract and force M2 to break it. Adding an
   optional option later is not a breaking change.
2. **`runtime` became optional on `CreateExecutionContextInput`**, defaulting to
   the exported `HARNESS_RUNTIME_INFO` (`{ name: "harness", version: "0.0.0",
   metadata: {} }`). The harness builds the context before it calls an adapter,
   so it genuinely does not know the adapter's identity. Of the two options the
   task considered, this was chosen over hard-coding `{ name: "harness" }` at
   the single call site because it states the situation in the contract rather
   than hiding it in one caller, and it is a small, documented change. The
   `AgentRuntime` contract was **not** changed. `version` is a module constant
   rather than a value read from `package.json` at runtime, because reading a
   manifest from a compiled `dist/` at an unknown path is brittle; nothing
   branches on it.
3. **`Clock` is `{ now(): Date }`**, declared in core. A `Date` rather than a
   number so that `createFakeClock()` satisfies it structurally with no
   adapter, the same way a `zod` schema satisfies `Schema<T>`. Core does not
   import the testing package at runtime.
4. **An already-aborted signal short-circuits** to `aborted` without calling the
   runtime. Handing work to an adapter that the contract then obliges it to
   abandon is pointless, and it would make "the runtime saw this run" false in
   the trace while true in the adapter's records. Because input validation is
   awaited first, a signal firing during validation also takes this path; a
   signal firing during the run is the adapter's to honour and it reports
   `aborted` itself. A unit test covers each path.
5. **Budget overrides are not checked for being narrowings.** The harness has no
   basis for comparing an absent limit (unlimited) with a present one, and a
   rule it cannot enforce is worse than none. Permissions **replace** rather
   than merge, so a caller states the whole list or none. Documented in
   `docs/contracts/harness.md`.
6. **`CapabilityRef` is an alias of `DomainRef`, not a structural twin.** The
   plan writes the identical shape for both; one type means a domain reference
   can be handed to the registry without a conversion and the two cannot drift.
7. **An unknown capability reference is a `ValidationError`**, with the issue
   path `[kind, id, version]`. `WorkflowError` was rejected because nothing is a
   workflow yet. Noted in the contract that M4 may introduce a dedicated error
   when reference resolution becomes part of IR validation.
8. **Five capability kinds, not AD-015's seven.** `evaluator` (M6) and
   `artifact` (M4) are left out rather than declared empty, following the scope
   discipline that kept `packages/core` empty through M0.
9. **The example's module specifiers are repository-relative paths.**
   `apps/example-agent` publishes no subpath exports and two capabilities live
   under `agent/`, which the package does not export at all. A path names every
   capability consistently and is what a consuming repository would write.
10. **The agent capability's value is a plain descriptor**, not the `eve`
    definition. The registry needs to know where the agent is, not what `eve`
    makes of it, and importing `agent/agent.ts` would drag `eve` into the
    harness-facing half of the package. The descriptor is also the natural
    input for M2-T8's content fingerprint.
11. **`procurement-sop` is not registered.** A SOP is content, not an
    executable capability; putting a wrong kind on a permanent ID is not
    reversible. SOP-as-capability is M2-T8/M5.
12. **The identifier and version rules moved out of `domain.ts`** into
    `identifiers.ts`, exported as `isCapabilityIdentifier` and `isExactVersion`.
    Two boundaries enforce the same rule and must not drift. `defineDomain()`'s
    behaviour is unchanged and its existing tests still pass.

One thing that had to be worked around rather than decided:

13. **REVERSED on 2026-09-19 18:28 at the orchestrator's request. Do not
    reinstate; see the addendum entry below.** The workspace graph is now
    cyclic, and turbo refused it. Adding
    `@internal/testing` to `@internal/core`'s devDependencies (so the harness's
    own tests use the same fakes as everything else) makes
    `@internal/core#build -> @internal/testing#build -> @internal/core#build`
    under the root `build` task's `dependsOn: ["^build"]`. `pnpm build` failed
    with `Cyclic dependency detected`, naming both edges. The fix is
    `packages/core/turbo.json`, which drops `^build` for this one package and
    explains why in a comment: `tsconfig.build.json` excludes `*.test.ts` and
    `@internal/core` declares no runtime dependency at all and must keep none,
    so `^build` was provably vacuous for it. `@internal/testing#build` keeps its
    own `^build`. The pattern matches `apps/example-agent/turbo.json`, which
    already overrides the root task definitions for the same kind of reason.
    **`pnpm install` now prints `There are cyclic workspace dependencies`** for
    these two packages. pnpm proceeds; the warning is expected and is the visible
    cost of this choice.

### Known issues / blockers

- **Not blockers for this task, but the tree is not green.** Three stages of
  `pnpm check` fail on M1-T6's in-flight files, and `tests/architecture/package-boundaries.test.ts`
  needs `@internal/eve-fixture-agent` added to its expected workspace inventory.
  All four are M1-T6's to resolve; this task deliberately did not edit files
  outside its own scope.
- `pnpm example:run` still does not exist. It is M1-T6's, together with
  `EveAgentRuntime` and `apps/example-agent/src/run.ts`, which is why the
  milestone's first acceptance criterion is recorded as not met.
- Nothing enforces a budget. `Budget` reaches the job and the context and a
  runtime may read it; the harness does not stop a run that exceeds one. That
  is M2's.
- `resolve<TValue>()` returns what the caller names, because the registry's
  five kinds hold five unrelated types. M4, which resolves references while
  validating workflow IR, is where that becomes checkable against a node's
  declared schemas.

### Next exact step

Orchestrator reviews and commits. M1-T6 (`EveAgentRuntime`,
`apps/example-agent/src/run.ts`, `pnpm example:run`, ADR-0028) is the only
Milestone 1 task left; it calls `createHarness({ agentRuntime })` from
`src/run.ts` and should add `@internal/eve-fixture-agent` to the expected
workspace inventory in `tests/architecture/package-boundaries.test.ts`.

## 2026-09-19 18:25 — M1-T4, M1-T9 — Addendum: grant `load_skill` in the vendor-triage domain

**Status:** completed
**Actor/session:** coding agent (implementation subagent)
**Commit:** not committed (the orchestrator reviews and commits)

### Goal

Follow-up to the entry above, requested by the concurrent M1-T6 agent. M1-T6
hardened `apps/example-agent/agent/agent.ts` with `defaultTools: false` and
re-added eve's framework `load_skill` tool at `agent/tools/load_skill.ts`,
because `agent/skills/triage-vendor.md` is an on-demand skill and `load_skill`
is the only way a model can pull it into a turn. `EveAgentRuntime` enforces
`context.permissions` by observation: on `actions.requested` it matches the tool
name against the grants and fails the run closed with a serialized
`PermissionDeniedError` when there is none. The domain granted only
`lookup_vendor_evidence`, so the first live `load_skill` call would have failed
a run that was behaving correctly.

### Implementation references

- verified before editing, rather than taken from the request: `ls
  apps/example-agent/agent/tools/` shows exactly `load_skill.ts` and
  `lookup_vendor_evidence.ts`; `web_search.ts` and `web_fetch.ts` are deleted;
  `pnpm --filter @internal/example-agent exec eve info --json` reports
  `["load_skill", "lookup_vendor_evidence"]`.
- `eve/docs/concepts/built-in-tools.md`, quoted by
  `agent/tools/load_skill.ts`: `load_skill` "adds no execution surface by
  itself", which is what makes `read` the right `ToolGrantMode` rather than
  `write`.

### Work completed

- `apps/example-agent/src/domain/index.ts`: `createJob` now grants
  `{ toolId: "load_skill", mode: "read" }` alongside
  `{ toolId: "lookup_vendor_evidence", mode: "read" }`, so the grants match
  exactly the two tools eve discovers. The comment explains both modes and why
  a framework tool is granted here but not registered as a domain capability.
- `apps/example-agent/src/domain/domain.test.ts` and
  `src/domain/harness.test.ts`: both permission assertions updated.
- `docs/examples/README.md`: "exactly one permission" corrected to the two, with
  the reason.

### Files changed

- `apps/example-agent/src/domain/index.ts`
- `apps/example-agent/src/domain/domain.test.ts`
- `apps/example-agent/src/domain/harness.test.ts`
- `docs/examples/README.md`
- `docs/progress/WORKLOG.md` (this entry)

### Verification

- `pnpm vitest run --project unit apps/example-agent packages/core` — **PASS**,
  248/248 across 17 files.
- `pnpm --filter @internal/example-agent run typecheck` — **PASS**.
- `biome check --formatter-enabled=false apps/example-agent packages/core` —
  **PASS**, 48 files, no fixes.
- `biome format apps/example-agent packages/core` — **PASS**, no fixes.
- `eve info --json` tool list, read before the edit — `["load_skill",
  "lookup_vendor_evidence"]`, which is what the grant list now mirrors.

### Decisions / deviations

- **The tool id is a plain string, not `LOAD_SKILL_TOOL_ID` from
  `@internal/runtime-eve`.** M1-T6 offered the constant. Importing it would make
  the harness-facing half of the example depend on the eve adapter, which is
  precisely the line ADR-0025 and the example's own structure keep: nothing
  under `src/domain/` knows which runtime will execute the job. A permission is
  a statement about a tool name, and `lookup_vendor_evidence` is already written
  the same way.
- **`load_skill` is granted but deliberately not registered as a capability.**
  It is a framework tool re-exported at its own slot, not something this domain
  authored, so it has no module or export of its own to record and no behavior
  of its own to fingerprint. The capability manifest still holds six entries.

### Known issues / blockers

- Unverifiable here. Only `pnpm example:run` against a live Gateway model
  exercises this path, and no credential is available in this environment.
  `pnpm example:run:mock` targets `apps/eve-fixture-agent`, which has no skills
  and never calls `load_skill`.

### Next exact step

Unchanged: the orchestrator reviews and commits. M1-T6 remains the only
Milestone 1 task open.

## 2026-09-19 18:28 — M1-T4 — Addendum: remove the `core` -> `testing` dev dependency and the turbo override

**Status:** completed
**Actor/session:** coding agent (implementation subagent)
**Commit:** not committed (the orchestrator reviews and commits)

### Goal

Reverse decision 13 of the 18:24 entry, at the orchestrator's instruction.
`@internal/core` declared `@internal/testing` in `devDependencies` so that
`harness.test.ts` could use the shared fakes. Because `@internal/testing`
depends on `@internal/core` for its types, that made the workspace graph
cyclic: pnpm warned on every install, and turbo refused the resulting `build`
task cycle until `packages/core/turbo.json` dropped `^build` for that one
package.

The orchestrator's judgment, which is correct and is recorded here so it is not
re-litigated: a cyclic workspace graph plus a per-package turbo override
suppressing `^build` is a **new architectural pattern** under AGENTS.md rule 11,
carrying a permanent install-time warning, adopted to save a few lines of test
code. `@internal/testing` stays the canonical home for fakes that consuming
packages and applications share; core's own tests use local ones.

### Implementation references

None needed. No framework surface, no new dependency, no removed behaviour.
The relevant local facts: `packages/core/tsconfig.build.json` excludes exactly
`src/**/*.test.ts` and nothing else, so a sibling `*.test-helpers.ts` module
would **not** have been excluded from the build and would have needed a new
exclusion rule. The doubles are therefore declared inline in `harness.test.ts`,
which the existing rule already covers. That is the one deviation from the
instruction's suggested file path, and it is the reason for it.

### Work completed

- `packages/core/src/harness.test.ts` now declares its own test doubles,
  none exported and none reachable from the barrel:
  - `createLocalAgentRuntime({ result?, handler?, delayMs?, runtime? })`, which
    records every call as `{ job, context }` and honours `context.signal` both
    when already aborted and when it fires during `delayMs`, so the two
    cancellation tests still prove what they proved before;
  - `createLocalTraceWriter()`, which keeps events in append order and counts
    `flush` calls;
  - `clockAt(iso)`, a fixed `Clock` with an `advance(ms)`.
  A comment at the top of the block states why they are local, so a future
  agent does not "tidy up" by adding the dependency back.
- `packages/core/package.json`: `@internal/testing` removed. Its
  devDependencies are now `@internal/config` and `vitest` again, and it still
  has no `dependencies` key at all.
- `packages/core/turbo.json`: **deleted.** `@internal/core#build` inherits the
  root task definition, `^build` included, like every other library package.
  `apps/example-agent/turbo.json` is untouched and unrelated; it exists because
  that package is an `eve` application, not because of this.
- `pnpm-lock.yaml` regenerated.

No behaviour changed in any shipped module. `@internal/testing` keeps
`createRecordingTraceWriter()`, which `apps/example-agent/src/domain/harness.test.ts`
uses along with `createFakeAgentRuntime()` and `createFakeClock()`; app to
library is the direction the dependency rule already allows, and that test is
unchanged.

### Files changed

- `packages/core/src/harness.test.ts`
- `packages/core/package.json`
- `packages/core/turbo.json` (deleted)
- `pnpm-lock.yaml`
- `docs/architecture/system-map.md` (the `packages/testing` paragraph)
- `docs/contracts/harness.md` (the tracing section now says core's own tests use
  local doubles, and not to add the dependency)
- `docs/milestones/m1-local-agent-and-public-harness-boundary.md` (the M1-T4
  result paragraph)
- `docs/progress/WORKLOG.md` (this entry, plus a pointer on the superseded
  decision 13 above)

`docs/development/commands.md` needed no change: its `turbo.json` paragraph is
about `@internal/example-agent`, which is unaffected.

### Verification

- `pnpm install --frozen-lockfile` — **PASS**, and **no cyclic-dependency
  warning**, which was the point. The previous run printed
  `There are cyclic workspace dependencies: .../packages/core, .../packages/testing`.
- `pnpm exec vitest run --project unit packages/core` — **PASS**, 195/195
  across 10 files, the same count as before the change.
- `pnpm typecheck` — **PASS**, 6/6 packages plus the root `tsc --noEmit`.
- `pnpm build` — **PASS**, 6/6, with no per-package turbo override for core.
- `biome format packages/core` and
  `biome check --formatter-enabled=false packages/core` — **PASS**, 26 files,
  no fixes.

### Decisions / deviations

- **The doubles are inline in `harness.test.ts`, not in a sibling
  `harness.test-helpers.ts`.** The instruction allowed either and asked that the
  file be covered by the existing build exclusion. `tsconfig.build.json`
  excludes `src/**/*.test.ts` only, so a `*.test-helpers.ts` sibling would have
  been compiled into `dist/` unless a new exclusion pattern were added. Adding
  one is a new convention for the same reason the turbo override was; inline
  needs nothing.
- The local runtime keeps the real-timer `raceAbort` that
  `@internal/testing`'s fake uses, rather than a fake clock, for the reason that
  fake already documents: a fake clock schedules nothing, so a delayed run would
  never resume. Roughly fifteen lines are duplicated between the two files. That
  duplication is the deliberate price of an acyclic graph.

### Known issues / blockers

- Unchanged from the 18:24 entry. The repository-wide `pnpm check` still fails
  on M1-T6's in-flight files and on the missing ADR-0028; nothing in this
  addendum touches either.

### Next exact step

Unchanged: the orchestrator reviews and commits. M1-T6 remains the only
Milestone 1 task open.

---

## 2026-09-19 18:39 — M1-T6 — Eve adapter (`EveAgentRuntime`)

**Status:** completed
**Actor/session:** Claude Opus 5 implementer subagent (orchestrated)
**Commit:** not committed

### Goal
As the `started` entry above (2026-09-19 18:22). The Implementation references
block there is this task's research checkpoint and is not repeated; §16 of
`docs/research/vercel/2026-09-19-m1-eve-programmatic-execution.md` records what
implementation added to it.

### Work completed

- **`EveAgentRuntime`** (`packages/runtime-eve/src/eve-agent-runtime.ts`), the
  harness's first real `AgentRuntime`. URL-only: it never spawns a process. One
  fresh session per run, `message` = `job.objective`, `clientContext` =
  `{ jobId, domain, jobType, input }`, the domain's `outputSchema` per turn, and
  the turn's event stream consumed live with `for await` so the adapter can
  trace, police permissions and enforce the budget as the run proceeds.
  Terminal state comes from turn boundary events and `isTurnFailureEvent`, never
  from `MessageResult.status`. `run()` never throws for an agent failure; the
  constructor throws `TypeError` for a bad argument.
- **`eve-events.ts`**: reading eve's stream events without letting their types
  escape the package, plus the whitelisted trace projection.
  **`eve-schema.ts`**: lowering a `Schema<T>` to the JSON Schema eve's
  `outputSchema` actually accepts.
- **`startEveDevServer()`** behind the new `@internal/runtime-eve/testing`
  subpath: spawns `eve dev --no-ui --port 0` the way eve's own Next/Nuxt/
  SvelteKit adapters do, parses the listening URL, waits on `client.health()`,
  and guarantees a kill on every failure path. Kept out of the main entrypoint
  so importing the adapter never pulls in `node:child_process`.
- **`apps/eve-fixture-agent`**, a new workspace package: a credential-free eve
  project whose model is eve's own `mockModel` with a scripted responder, two
  authored tools (`echo_fixture`, granted; `forbidden_tool`, deliberately not),
  and a small JSON-Schema-shaped value generator so the fixture can satisfy any
  caller's `outputSchema` without knowing the domain. `eve info`: `Compile
  ready`, 0 diagnostics, 2 tools.
- **Example agent hardened**: `defaultTools: false` on `agent/agent.ts`, the two
  `disableTool()` files deleted as redundant, and `agent/tools/load_skill.ts`
  re-adding the one default the skill needs. `eve info --json` went from nine
  tools to two, `load_skill` and `lookup_vendor_evidence`.
- **`pnpm example:run` and `pnpm example:run:mock`**, both running
  `apps/example-agent/src/run.ts`: start an eve server, build an
  `EveAgentRuntime`, run `vendorTriage` through `createHarness()`, print the
  `HarnessRunResult` as JSON, stop the server, exit non-zero unless completed.
  The live target exits 1 with a message naming `.env.example` when no
  credential is set.
- **Tests**: 29 unit cases against an injected fake client (no process, no
  server, no credential) covering completed-with-data, missing data, turn
  failure, permission denial, three budget dimensions plus the duration timer,
  abort before and during a run, usage arithmetic and trace emission; and 5
  contract cases against a real `eve dev` server.
- **Docs**: ADR-0028; `docs/architecture/runtime.md` (new); an "Amended by
  ADR-0028" note on ADR-0012; `docs/contracts/agent-runtime.md` gained an
  Implementations section; system map, milestone, commands, local-setup,
  `.env.example`, examples README, `docs/README.md`, AGENTS.md and both eve
  research notes updated.

### Files changed

Added:
- `packages/runtime-eve/src/eve-agent-runtime.ts`, `eve-events.ts`,
  `eve-schema.ts`, `eve-agent-runtime.test.ts`,
  `eve-agent-runtime.contract.test.ts`
- `packages/runtime-eve/src/testing/index.ts`, `testing/dev-server.ts`
- `apps/eve-fixture-agent/` (`package.json`, `tsconfig.json`, `turbo.json`,
  `agent/agent.ts`, `agent/instructions.md`, `agent/tools/echo_fixture.ts`,
  `agent/tools/forbidden_tool.ts`, `agent/lib/json-schema-value.ts` and its
  test, `src/dependency-pins.test.ts`)
- `apps/example-agent/src/run.ts`, `apps/example-agent/tsconfig.build.json`,
  `apps/example-agent/agent/tools/load_skill.ts`
- `docs/decisions/0028-eve-agent-runtime-is-a-url-only-client-that-observes-the-eve-event-stream.md`
- `docs/architecture/runtime.md`

Deleted:
- `apps/example-agent/agent/tools/web_search.ts`,
  `apps/example-agent/agent/tools/web_fetch.ts` (redundant under
  `defaultTools: false`)

Modified:
- `packages/runtime-eve/package.json` (the `./testing` subpath export,
  `@internal/core` dependency, `@internal/testing` devDependency), `src/index.ts`,
  `src/index.test.ts`
- `apps/example-agent/package.json` (`build` now compiles `src/` first, new
  `start`, `@internal/runtime-eve` dependency), `turbo.json`,
  `agent/agent.ts`
- root `package.json` (`example:run`, `example:run:mock`), `pnpm-lock.yaml`
- `tests/architecture/package-boundaries.test.ts` (inventory)
- `AGENTS.md`, `.env.example`, `docs/README.md`,
  `docs/architecture/system-map.md`, `docs/contracts/agent-runtime.md`,
  `docs/decisions/README.md`,
  `docs/decisions/0012-reuse-documented-eve-capabilities-instead-of-cloning-them.md`,
  `docs/development/commands.md`, `docs/development/local-setup.md`,
  `docs/examples/README.md`,
  `docs/milestones/m1-local-agent-and-public-harness-boundary.md`,
  `docs/research/vercel/2026-09-19-m1-eve-programmatic-execution.md`,
  `docs/research/vercel/2026-09-19-m1-eve-project-scaffold.md`

### Verification

- `pnpm install --frozen-lockfile` — PASS
- `pnpm test:unit` — PASS (28 files, 359 tests)
- `pnpm test:contract` — PASS (1 file, 5 tests, 4.21s including server boot)
- `pnpm check` — PASS, exit 0 (format:check, lint, typecheck, test 364/364
  across 29 files, build, check:handoff)
- `pnpm --filter @internal/example-agent run info` — PASS: `Compile ready`,
  `0 errors, 0 warnings`, 1 skill, **2 tools**
- `pnpm --filter @internal/eve-fixture-agent run info` — PASS: `Compile ready`,
  `0 errors, 0 warnings`, 0 skills, **2 tools**
- `pnpm example:run:mock` — PASS, exit 0:

```text
Starting an eve dev server for @internal/eve-fixture-agent...
{
  "target": "mock",
  "agent": "@internal/eve-fixture-agent",
  "host": "http://127.0.0.1:52820",
  "result": {
    "runId": "cb7c023f-786c-4574-b1f0-d711738689cf",
    "jobId": "db3a8fc6-4563-4d6a-8c4c-d31fa70d4060",
    "domain": { "id": "vendor-triage", "version": "1.0.0" },
    "attempt": 1,
    "usage": { "modelCalls": 1, "toolCalls": 0, "durationMs": 111 },
    "runtime": {
      "name": "eve",
      "version": "0.63.0",
      "metadata": {
        "sessionId": "wrun_01M2XX52DPVDVWTFGPR54JKK3R",
        "turnId": "turn_0"
      }
    },
    "status": "completed",
    "output": {
      "category": "fixture:category",
      "riskFlags": [],
      "missingInformation": [],
      "recommendation": {
        "decision": "proceed",
        "rationale": "fixture:recommendation.rationale"
      },
      "evidence": [
        { "claim": "fixture:evidence.0.claim", "source": "fixture:evidence.0.source" }
      ]
    }
  }
}
```

- `pnpm example:run` without a credential — PASS: exits 1 with the message
  naming `.env.example`. **Against a live Gateway model: NOT RUN**, no
  credential available. `AI_GATEWAY_API_KEY` and `VERCEL_OIDC_TOKEN` were
  confirmed unset for the whole session and no credential was written anywhere.
- `pgrep -fl "eve dev"` — empty. No `.tmp` directory left.
- **Contract-suite stability: 1 unexplained failure in ~13 runs.** One
  `pnpm check` (18:41) failed in `beforeAll` with `startEveDevServer: the eve
  dev server exited before it was ready (code=1)`. It did not reproduce: five
  consecutive `pnpm test:contract` runs passed, three more passed while an
  `eve build` ran concurrently against the other app root, a direct
  `eve dev --no-ui --port 0` on the fixture booted normally, and the final
  `pnpm check` passed. The theory that a concurrent eve compile collides over
  the build cache inside the installed package was **tested and not confirmed**.
  No fix was invented for an unconfirmed cause. What was fixed is the
  diagnosis: `startEveDevServer` now puts the child's own output in the error
  **message** rather than only in `details`, because a test runner prints the
  message, and that failure reported no reason at all. Flagged for the
  orchestrator rather than silently retried; if it recurs, the message will say
  why.

### Decisions / deviations

Recorded as **ADR-0028**: URL-only adapter with a separate spawn helper; the
`eve/client` stream as the observation source, amending ADR-0012; structured
output via the domain schema with no message fallback; permission enforcement by
observation as a named M1 limitation; budget enforcement in the adapter; one
fresh session per run with no reset; the fixture as its own `apps/*` package.

Smaller project decisions, recorded here rather than as ADRs:

1. **The adapter takes `domains`, not a registry.** `AgentRuntime.run(job,
   context)` hands over a job whose contracts are string references, and M1-T9's
   capability registry is what resolves them. Rather than widen the core
   contract, the runtime is constructed with the domains it may request output
   schemas for, and a job for an unlisted domain fails before a turn starts.
   **M1-T9's registry is expected to replace this option.**
2. **Retried steps are counted.** eve runs a durable step up to four times and
   records no attempt identity, so the roll-up over-reports for an interrupted
   turn. The figure is provider-attempted usage; over-reporting cost is the safe
   error, and deduplicating would risk keeping the abandoned attempt.
3. **The duration budget uses a timer, not an event check.** A wall-clock limit
   checked only when an event arrives is no limit at all, because a stalled turn
   emits nothing.
4. **`costUsd` stays absent rather than `0`** when nothing reported one.
5. **A health preflight runs before every turn**, so an unreachable server is a
   clear failure before a session exists rather than a transport error mid-run.
6. **`apps/example-agent` gained a `tsc` build** (`tsconfig.build.json`, and
   `build` is now `tsc && eve build`), because Node 24.21.0 does not rewrite a
   relative `./x.js` specifier to `./x.ts` and every module here uses the `.js`
   extension. Adding `tsx` or `vite-node` was rejected: the pinned toolchain
   already compiles TypeScript, and a second TypeScript runner would be a
   toolchain change nothing else needs. Its `rootDir` is the package rather than
   `src`, because `src/capabilities.ts` registers a handler from `agent/lib/`.
7. **`@internal/runtime-eve` now depends on `@internal/core`.** Library to
   library, untouched by the boundary rule, and unavoidable: the package
   implements a core contract.

Three discrepancies between a source and the installed package, all resolved in
favour of the installed package per the source-of-truth protocol §1, all
recorded in §16 of the programmatic-execution research note:

1. **eve's docs versus eve's types on `outputSchema`.** The docs say the client
   accepts Standard Schema implementations; the type is
   `StandardJSONSchemaV1 | JsonObject`, which needs `~standard.jsonSchema`,
   while ADR-0027's `Schema<T>` declares only `~standard.validate`. eve's
   `serializeOutputSchema` throws without the converter. The adapter lowers the
   schema itself. **This corrects §2 and §12 of the research note**, which had
   read the prose as covering the harness's own type.
2. **eve replaces every authored model with its own runtime mock when
   `NODE_ENV=test`** or `EVE_MOCK_AUTHORED_MODELS=1`, answering a turn's schema
   from an internal sample generator and never calling the authored responder.
   Documented nowhere. Vitest sets `NODE_ENV=test`, so a `mockModel` fixture is
   silently ignored inside a test run and only inside one; the symptom is a turn
   that succeeds with plausible data while every scripted branch is unreachable.
   `startEveDevServer()` strips both names.
3. **`eve/bin/eve.js` is not a declared export subpath.** `eve/package.json` is,
   and its `bin` field names the entrypoint, so the helper resolves the manifest
   and joins rather than reaching past the export map.

The scaffold research note's §6 recorded a decision that M1-T6 reversed
(`disableTool()` per tool versus `defaultTools: false`); a superseding note was
added there rather than editing the original reasoning.

### Known issues / blockers

- **`pnpm example:run` against a live AI Gateway model is unverified.** No
  credential was available and none was created. Everything below the model is
  covered by the contract suite and by `pnpm example:run:mock`.
- **Permission enforcement is detection, not prevention** (ADR-0028). An
  ungranted tool may have executed by the time the run fails. The auth-plus-
  approval composition is the M2/M5 upgrade path.
- Usage over-reports for a retried step, by deliberate choice (decision 2).
- The trace payload is an M1 placeholder; M2-T3 owns the taxonomy and schema,
  and M2-T9 owns redaction. The adapter carries no message content, tool input,
  tool output or structured result, so there is nothing to redact yet.

### Next exact step

Milestone 1 is functionally complete: M1-T1 through M1-T9 are all `completed`.
Rewrite `docs/context/current-state.md` for the M1 handoff, commit, and record
the SHA here. Then archive the milestone snapshot under
`docs/progress/milestones/m1.md` and open Milestone 2.

---

## 2026-09-19 18:55 — M1-T6 — Addendum: `eve dev` lifecycle, repeatable `example:run:mock`

**Status:** completed
**Actor/session:** Claude Opus 5 implementer subagent (orchestrated)
**Commit:** not committed

### Goal
Fix `pnpm example:run:mock` failing on a second consecutive run with
`startEveDevServer: the eve dev server exited before it was ready (code=1)` and
eve's own "A dev server is already running for this eve agent". Reported by the
orchestrator with the leftover `.eve/` state attached. This also explains the
one unexplained contract-suite failure recorded in the previous entry.

### Implementation references
- package/version: `eve@0.63.0`, unchanged.
- installed docs read: `$EVE/docs/reference/cli.md` §"`eve dev`" and the local
  dev paragraph at line 271, which is the decisive one. Searched the whole
  `$EVE/docs` tree for a documented stop command (`--stop`, "shut down",
  SIGTERM, "already running"): **there is none.** The only documented shutdown
  contract is that the record is cleared when the server stops.
- public types/exports inspected:
  `$EVE/dist/src/internal/nitro/host/dev-server-state.d.ts` (`DevelopmentServerState`:
  `read`, `write`, `remove`, with "It is not a lock: a stale or malformed record
  simply causes the caller to start a new server and overwrite it once that
  server is ready" and "Clears the record after the listening server has
  stopped"); `$EVE/dist/src/internal/nitro/host/start-development-server.js`
  (`isActiveDevelopmentServerForApp`, `isDevelopmentServerReady`, and the throw
  site of `createDevelopmentServerAlreadyRunningError`).
- selected documented pattern: read `.eve/dev-server-state.v1.json` and probe
  the recorded URL, which is what eve's own `isActiveDevelopmentServerForApp`
  does. Shut down with `SIGTERM`, which is what makes eve remove the record
  itself.

### Work completed

**Root cause, established from eve's own source.** `startNitroDevelopmentServer`
reads the recorded URL and, if it is loopback **and still answering**, either
attaches or throws:

```js
if (s !== undefined && isLoopbackServerUrl(s) && await isDevelopmentServerReady(s)) {
  if (t.existing === "attach-if-unconfigured" && !a) return { kind: "existing", url: s };
  throw await createDevelopmentServerAlreadyRunningError(n.appRoot, s);
}
```

`a` is true when a host, a port or `PORT` was configured. **This helper always
passes `--port 0`, so `a` is always true and the attach branch is unreachable**
— exactly what `cli.md` documents: "Passing `--host`, `--port`, or a `PORT`
environment value skips reconnection and reports a healthy recorded server
instead."

So the trigger is **a previous server still answering**, not a stale file: a
record whose server is dead fails the probe and is replaced, as documented.
Measured directly, a clean cycle leaves nothing behind (process gone, record
absent, port unreachable immediately and at +400ms, twice in a row). The failure
needs a server that outlived its `stop()`, which happens when the parent dies
without running it, or when the five-second `SIGKILL` escalation fires and
leaves both the record and the bound port.

**Fixes, all inside documented behaviour.**

1. `stop()` now verifies the address is free rather than only that the process
   exited: `SIGTERM`, await the child's `exit`, then poll the URL until it stops
   answering (bounded at 10s). A caller restarting immediately can no longer
   race a closing socket.
2. `startEveDevServer()` probes for a live server **before** spawning and fails
   with a message naming the URL, instead of letting eve's refusal arrive as
   `code=1`. It does **not** reuse the server: one started earlier may be
   serving different code, and a test passing against the wrong agent is worse
   than one that refuses to start. A caller who wants the running server passes
   its URL to `EveAgentRuntime` directly. Documented in
   `docs/architecture/runtime.md`.
3. A `process.on("exit")` guard `SIGKILL`s any surviving child, so a parent that
   crashes or exits without `stop()` no longer leaves an orphan. Ctrl-C needs no
   handler: the shell signals the whole foreground process group and the child
   is in it, because the helper never detaches.
4. `readRecordedDevServerUrl()` is exported from `@internal/runtime-eve/testing`
   and is **read-only**. The harness never writes or deletes eve's record,
   because eve documents that it replaces a stale one itself. No dead-pid
   heuristics and no touching `dev-cleanup-intent.*.json` or `dev-runtime/`.

### Files changed

- `packages/runtime-eve/src/testing/dev-server.ts` — the four changes above.
- `packages/runtime-eve/src/testing/index.ts` — exports `readRecordedDevServerUrl`.
- `packages/runtime-eve/src/testing/dev-server.test.ts` — **new**, 5 unit cases
  for the record reader (valid, absent, five malformed shapes, a non-app-root
  path, and that reading never mutates).
- `packages/runtime-eve/src/eve-agent-runtime.contract.test.ts` — the existing
  server lifecycle moved from file scope into its `describe`, so a second
  `describe` can own its own servers; new `startEveDevServer lifecycle` suite
  running start → turn → stop twice and asserting each cycle got its own port
  and left nothing answering.
- `docs/architecture/runtime.md` — new "Only one `eve dev` per app root"
  section, and the test table.

### Verification

- `pnpm example:run:mock` three times in a row from the repository root:
  **exit 0, exit 0, exit 0**, each printing `"status": "completed"`.
- `pgrep -f "eve.js dev"` empty before and after. (Note for future readers: the
  spawned process's command line is `node <path>/eve.js dev …`, so
  `pgrep -fl "eve dev"` does **not** match it. That pattern reporting nothing is
  not evidence that no server is running.)
- Orphan case, verified by starting a server by hand and leaving it up:
  `pnpm example:run:mock` exits 1 with
  `an eve dev server is already running for …/apps/eve-fixture-agent at
  http://127.0.0.1:63976/`, naming the URL and how to proceed, instead of
  `code=1`.
- `pnpm test:contract` — PASS, 7 tests, 13.5s (up from 4.2s; the restart suite
  boots two more servers).
- `pnpm check` — PASS, exit 0, 371 tests across 30 files.

### Decisions / deviations

- **Fail fast rather than reuse** when a live server exists, chosen over
  attaching. Recorded here and in `docs/architecture/runtime.md`. ADR-0028 is
  unchanged: it already says the adapter takes a URL, and reuse is that path.
- **Nothing in `.eve/` is written or deleted by the harness.** The orchestrator
  offered a dead-pid check on `dev-cleanup-intent.*.json` as a fallback; it is
  not needed, because eve documents that a stale record is replaced
  automatically, and the measured clean cycle confirms it. Reaching into another
  tool's state would have been an undocumented fix for a problem that does not
  exist.
- The previous entry's "1 unexplained failure in ~13 runs" is now explained: it
  was this bug, hit when a server from an earlier run was still answering.

### Known issues / blockers

- The contract suite is now 13.5s rather than 4.2s, because proving the restart
  path costs two extra server boots. That is the price of the demo being
  repeatable, and it stays well inside the milestone's budget.
- Everything else from the main M1-T6 entry stands, including that
  `pnpm example:run` against a live Gateway model remains unverified.

### Next exact step

Unchanged from the main M1-T6 entry: rewrite `docs/context/current-state.md` for
the Milestone 1 handoff, commit, and record the SHA.
