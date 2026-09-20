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
**Commit:** 3d3d941

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
**Commit:** 3d3d941

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
**Commit:** 3d3d941

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
**Commit:** 3d3d941

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
**Commit:** 3d3d941

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
**Commit:** 3d3d941

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
**Commit:** 3d3d941

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
**Commit:** 3d3d941

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
**Commit:** 3d3d941

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
**Commit:** 3d3d941

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
**Commit:** 3d3d941

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
**Commit:** 3d3d941

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

## 2026-09-19 21:35 — M2 — Create the Milestone 2 status file

**Status:** completed
**Actor/session:** coding agent (documentation subagent)
**Commit:** `02b1261`

### Goal

Create `docs/milestones/m2-job-trace-supabase-and-run-ledger.md`, the M2 status file, in the same
shape as the M1 status file, and register it in `docs/milestones/README.md`, per
`../context/current-state.md`'s "Exact next task". This is a documentation-only task; M2-T1
(stable identifiers) is being implemented concurrently by another agent and is not described here
beyond noting it is `in_progress`.

### Implementation references

Not applicable. This task touches no framework-facing code; it transcribes the Milestone 2 section
of `docs/milestones/build-plan.md` (lines 1464-1730) into the per-milestone status-file shape
established by `docs/milestones/m1-local-agent-and-public-harness-boundary.md`.

### Work completed

- Read `AGENTS.md`, `docs/context/current-state.md`, `docs/milestones/README.md`,
  `docs/milestones/m1-local-agent-and-public-harness-boundary.md` in full, and
  `docs/milestones/build-plan.md` lines 1464-1730 (the Milestone 2 section).
- Wrote `docs/milestones/m2-job-trace-supabase-and-run-ledger.md`: title, status line naming
  M2-T1 `in_progress` and M2-T2 through M2-T11 `not started`; Goal/Blocked by/Parallel
  work/Deliverable quoted from the plan, including "This is the most important foundation in the
  project"; a "Before starting" section with eight prerequisites drawn from
  `current-state.md`'s "Findings the next agent needs" and the repository's own boundary rules
  (sequence numbering across `run.*`/`eve.*` events, identity-only adapter trace payloads today,
  the unregistered `procurement-sop` capability, M2-T11 gating M2-T5 through M2-T10, the
  `@internal/storage-supabase` reservation in `tests/architecture/boundaries.ts`, the generated
  `database.types.ts` rule, the WORKLOG "Implementation references" checkpoint requirement for
  framework-facing tasks, and the new `packages/trace` needing a `BOUNDARY_RULES` entry); eleven
  `### M2-Tn` task subsections reproducing the plan's task text and code blocks verbatim, each with
  its own status line; and an acceptance-criteria section with the plan's ten bullets, each marked
  "not yet verified".
- Added an M2 row to the table in `docs/milestones/README.md` (`in progress (M2-T1)`, linking the
  new file) and changed "Later milestones (M2 onward)" to "Later milestones (M3 onward)" in the
  sentence below the table, since M2 now has its own status file.

### Files changed

- `docs/milestones/m2-job-trace-supabase-and-run-ledger.md` — new file, the M2 status file.
- `docs/milestones/README.md` — added the M2 row and updated the now-stale "M2 onward" sentence to
  "M3 onward".

### Verification

- `pnpm format:check` — PASS (`Checked 102 files in 28ms. No fixes applied.`)
- `pnpm lint` — PASS (`Checked 102 files in 44ms. No fixes applied.`)
- `pnpm check:handoff` — PASS (see below)

### Decisions / deviations

- None. Followed the M1 status file's shape exactly, including reproducing the plan's code blocks
  as fenced code blocks rather than prose.

### Known issues / blockers

- None for this task. M2-T1 through M2-T11 remain to be implemented; see
  `docs/context/current-state.md`.

### Next exact step

M2-T1 (stable identifiers), already `in_progress` with another agent. Once it lands, M2-T2, M2-T3,
and M2-T4 can proceed in parallel; M2-T5 through M2-T10 wait on M2-T11 (local Supabase).

---

## 2026-09-19 21:35 — M2-T1 — Stable identifiers

**Status:** started
**Actor/session:** coding agent (Claude Opus 5, M2-T1 implementer)
**Commit:** `02b1261`

### Goal

Replace the two `globalThis.crypto.randomUUID()` (v4, unsortable) call sites with a **sortable**
entity-ID scheme, and give the harness the twelve branded ID types the build plan's M2-T1 lists
(`job_id`, `run_id`, `attempt_id`, `trace_event_id`, `workflow_id`, `workflow_version_id`,
`node_execution_id`, `decision_id`, `eval_run_id`, `learning_run_id`, `compiler_run_id`,
`promotion_id`). AD-016 names "UUID implementation" as an unprescribed internal choice that must be
recorded, so the choice gets ADR-0030.

Wiring is deliberately narrow: `defineDomain()` (job id) and `createHarness()` (run id) only, plus
the brand ripple through `ExecutionContext` and `TraceEvent.runId`. No new fields (`attemptId`,
`traceEventId`) are added to any type — where those surface is M2-T2's and M2-T3's decision.

### Implementation references

- **package/version:** Node.js **24.21.0** (pinned by `.node-version`/`.nvmrc`, confirmed with
  `node --version`); `@types/node` **24.13.6** (resolved at
  `node_modules/.pnpm/@types+node@24.13.6/node_modules/@types/node`); pnpm 12.4.2.
- **installed docs read:** `@types/node@24.13.6` `crypto.d.ts`. It declares
  `function randomUUID(options?: RandomUUIDOptions): UUID;` at line 4136 and the
  `type UUID = ...` alias at line 4130. It declares **no `randomUUIDv7`** — grep for the name in
  that file returns nothing. So the installed types do not expose the Node 24 built-in at all.
- **official docs/repos/examples read:** the official Node.js v24 API documentation for
  `node:crypto`, read as its machine-readable form
  <https://nodejs.org/docs/latest-v24.x/api/crypto.json> (the HTML page at
  <https://nodejs.org/docs/latest-v24.x/api/crypto.html#cryptorandomuuidv7options> is the same
  content). Verbatim facts taken from it:
  - `crypto.randomUUIDv7([options])` — `"added": ["v24.16.0"]`, no `changes`, and **no stability
    marker** (the `stability` field is `undefined`, exactly as it is for the long-stable
    `crypto.randomUUID`), so it inherits the `crypto` module's stability.
  - Its description: *"Generates a random RFC 9562 version 7 UUID. The UUID contains a millisecond
    precision Unix timestamp in the most significant 48 bits, followed by cryptographically secure
    random bits for the remaining fields, making it suitable for use as a database key with
    time-based sorting. **The embedded timestamp relies on a non-monotonic clock and is not
    guaranteed to be strictly increasing.**"*
  - Its only option is `disableEntropyCache` (boolean, default `false`), identical to
    `randomUUID`'s. There is no monotonic-counter option and no timestamp argument.
  - RFC 9562 §4.4 (UUIDv7 bit layout) and §6.2 ("Monotonicity and Counters", Method 1, "Fixed
    Bit-Length Dedicated Counter") are the normative source for the owned implementation.
- **public types/exports inspected:** `packages/core/src/identifiers.ts` (the existing
  `*_PATTERN` / `*_MESSAGE` / `is*` / `collectRefIssues` / `throwIfIssues` style this module
  mirrors), `packages/core/src/fingerprint.ts` (the `FINGERPRINT_ALGORITHM_PREFIX` precedent for a
  scheme-naming constant, and the ADR-0029 precedent for `node:crypto` in a zero-dependency core),
  `packages/core/src/job.ts` (the `declare const ... : unique symbol` phantom-brand idiom),
  `packages/core/src/index.ts` (the "listed by name" re-export convention).
- **Runtime verification performed (not taken on faith):** on the pinned Node 24.21.0,
  `require("node:crypto").randomUUIDv7` is a `function` of arity 1 and returns well-formed v7 UUIDs
  (e.g. `01a0bc70-c781-7e42-901d-04ec7e8d85ee`). Generating 20 000 ids in a tight loop produced
  **9 939 non-increasing consecutive pairs out of 19 999** — i.e. the built-in provides no ordering
  at all within a millisecond, exactly as its documentation warns. Passing a number throws
  (`The "options" argument must be of type object`); the single parameter is `options`, not a
  timestamp.
- **selected documented pattern:** **option (b), a harness-owned RFC 9562 UUIDv7** in
  `packages/core/src/ids.ts` over `node:crypto` `randomBytes`, with the RFC 9562 §6.2 Method 1
  fixed-bit-length dedicated counter in `rand_a` so ids minted inside one millisecond still sort in
  creation order. The built-in is rejected **on its own documented behaviour**, not on its missing
  type declaration: sortability is the entire property M2-T1 exists to buy, and a generator that is
  "not guaranteed to be strictly increasing" (and measurably is not, half the time) does not buy
  it. A TypeScript module augmentation would have fixed the typing gap but not the semantic one.
  Recorded in **ADR-0030**.
- **harness-owned, because nothing public provides it:** the monotonic counter, the
  clock-regression guard (a backwards system clock must never emit a smaller id), the
  counter-rollover rule, the twelve brands, and `ENTITY_ID_SCHEME`.

### Work completed

- (in progress)

### Files changed

- (in progress)

### Verification

- (in progress)

### Decisions / deviations

- (in progress)

### Known issues / blockers

- None so far.

### Next exact step

Implement `packages/core/src/ids.ts` + `ids.test.ts`, wire the two call sites, fix the brand
ripple, write ADR-0030 and the contract docs, then run the verification chain.

---

## 2026-09-19 21:45 — M2-T1 — Stable identifiers

**Status:** completed
**Actor/session:** coding agent (Claude Opus 5, M2-T1 implementer)
**Commit:** `02b1261`

### Goal

As the `started` entry above. A sortable, branded identifier scheme for the twelve entities M2-T1
names, wired at the two existing `crypto.randomUUID()` call sites and nowhere else.

### Implementation references

See the `started` entry at 21:35 for the full checkpoint. The one-line summary: Node 24.21.0 ships
`crypto.randomUUIDv7()` (added v24.16.0), its official documentation says the embedded timestamp
"is not guaranteed to be strictly increasing", and measurement on the pinned runtime confirmed it
(9 939 non-increasing pairs out of 19 999). **Option (b) was selected**: a harness-owned RFC 9562
UUIDv7 over `node:crypto` `randomBytes`, with the §6.2 Method 1 monotonic counter the built-in
lacks. The missing `@types/node@24.13.6` declaration was *not* the deciding factor; a module
augmentation would have fixed the typing and left the semantics unchanged.

### Work completed

- **`packages/core/src/ids.ts`** (new, the whole scheme):
  - `ENTITY_ID_SCHEME = "uuidv7"`, the constant a persisted record cites, mirroring
    `FINGERPRINT_ALGORITHM_PREFIX`; `ENTITY_KINDS`, the twelve kinds as a `const` tuple,
    mirroring `CAPABILITY_KINDS`.
  - One brand mechanism: `EntityId<TKind>` is `string` intersected with a phantom property under a
    `declare const ENTITY_ID_BRAND: unique symbol` key, the same idiom `job.ts` already uses for
    `JOB_OUTPUT_TYPE`. Twelve aliases: `JobId`, `RunId`, `AttemptId`, `TraceEventId`, `WorkflowId`,
    `WorkflowVersionId`, `NodeExecutionId`, `DecisionId`, `EvalRunId`, `LearningRunId`,
    `CompilerRunId`, `PromotionId`. Runtime representation is a plain lowercase UUID string.
  - Twelve zero-argument generators (`newJobId()`, `newRunId()`, ...). **Chosen over a generic
    `newEntityId(kind)`** because the kind has no runtime meaning at generation time: every id is
    the same string whatever it names, so a generic generator would take an argument purely to pick
    a return type, and `newRunId()` reads better at a call site.
  - **One generic parser**, `parseEntityId(kind, value, path?)`, throwing `ValidationError` with the
    issue at the caller's path, matching `collectRefIssues` in `identifiers.ts`. Generic *here*
    because `kind` genuinely does something: it names the entity in the failure message. Plus
    `isEntityId(value)`, a kind-agnostic type guard (the scheme encodes a timestamp, a counter and
    entropy, and nothing about which entity an id names, so no guard can recover a kind).
  - `ENTITY_ID_PATTERN` / `ENTITY_ID_MESSAGE` in the style `identifiers.ts` set. Lowercase
    `8-4-4-4-12` hex, version nibble `7`, variant nibble in `[89ab]`. Uppercase is **rejected, not
    normalized**.
  - The generator: 48-bit millisecond timestamp, version `7`, a 12-bit counter in `rand_a`,
    variant `10`, 62 random bits of `rand_b` from `node:crypto` `randomBytes(8)`. A new millisecond
    resets the counter; the same millisecond increments it; a **backwards clock** is treated as the
    same millisecond so an id never goes down when `Date.now()` does; **counter rollover** past
    4096/ms borrows the timestamp forward 1 ms.
- **`packages/core/src/ids.test.ts`** (new, 20 tests): format/version/variant for all twelve
  generators, the embedded timestamp, distinctness across 6 000 ids, `rand_b` entropy, rejection of
  v4 (both a literal and a live `crypto.randomUUID()`), rejection of uppercase, rejection of a
  wrong variant nibble and of nine malformed/non-string values, the `ValidationError` message and
  issue path, and three **sortability** tests: 5 000 ids strictly increasing with
  `[...ids].reverse().sort()` reproducing creation order, 10 000 ids strictly increasing inside a
  single frozen millisecond (exercising counter rollover), and 200 ids strictly increasing across a
  clock mocked to step *backwards* 1 s per call.
- **Wired the two call sites, and only those.** `defineDomain()`'s `createJob` uses `newJobId()`;
  `createHarness()` uses `newRunId()`. `Job.id` is `JobId`; `ExecutionContext.runId`/`jobId` and
  `CreateExecutionContextInput.runId`/`jobId` are `RunId`/`JobId`; `TraceEvent.runId` is `RunId`;
  `HarnessRunResultBase.runId`/`jobId` are branded. **No new field was added to any type.**
  `ExecutionContext.attempt` stays a `number`, and its doc comment now says explicitly that
  `AttemptId` exists but that where an attempt id surfaces is M2-T2's/M2-T3's decision.
- **Fixed the brand ripple in seven test files** using the generators, never a cast: two in
  `packages/testing`, two in `packages/runtime-eve`, three in `packages/core`. Where a test asserted
  on a literal id (`clientContext.jobId`, `event.runId === "run_1"`) a module-level `const JOB_ID =
  newJobId()` keeps the job and its context agreeing the way they do in a real run.
  `context.test.ts`'s type assertions now pin `RunId`/`JobId` rather than `string`, which is the
  brand documenting itself.
- **Exported** the fourteen types and eighteen values from `packages/core/src/index.ts` in the
  file's "listed by name" convention, under a comment naming M2-T1 and ADR-0030.
- **ADR-0030** written, covering the UUIDv7 choice, built-in-vs-owned with the measurement, the
  branding approach, an explicit "What this does NOT decide" section (attempt/trace-event id
  placement, storage column type, cross-process ordering), and seven rejected alternatives (the
  Node built-in with a module augmentation, v4 plus a sequence column, ULID, KSUID, a UUID library,
  plain strings, a single un-kinded brand, normalizing uppercase). Added to
  `docs/decisions/README.md` (table row + prose entry).
- **Docs alongside code:** new `docs/contracts/identifiers.md` with the standard frontmatter;
  `job.md`, `execution-context.md` and `harness.md` updated wherever they said ids were
  opaque/v4/"M2-T1 will replace this"; `docs/contracts/README.md` gained the `identifiers.md` row
  and a paragraph; `docs/architecture/system-map.md`'s `packages/core` file listing gained
  `ids.ts`/`ids.test.ts` with a note distinguishing it from `identifiers.ts`. The three
  "M2-T1 replaces this" source comments in `job.ts`, `domain.ts` and `harness.ts` were replaced
  with the truth.
- **`AGENTS.md`**: the ADR paragraph now names ADR-0030 and "the next free number" is **0031**.

### Files changed

New:

- `packages/core/src/ids.ts` — the scheme: twelve brands, twelve generators, the parser/guard, the
  monotonic UUIDv7 generator.
- `packages/core/src/ids.test.ts` — 20 tests, including the three sortability properties.
- `docs/decisions/0030-sortable-uuidv7-entity-identifiers-owned-not-delegated.md` — ADR-0030.
- `docs/contracts/identifiers.md` — the entity-identifier contract.

Modified:

- `packages/core/src/domain.ts` — `createJob` mints `newJobId()`.
- `packages/core/src/harness.ts` — `createHarness` mints `newRunId()`; result base ids branded.
- `packages/core/src/job.ts` — `Job.id` is `JobId`.
- `packages/core/src/context.ts` — `runId`/`jobId` branded on both the context and its input;
  `attempt` doc comment states it stays a number.
- `packages/core/src/trace.ts` — `TraceEvent.runId` is `RunId`.
- `packages/core/src/index.ts` — exports the new surface.
- `packages/core/src/{context,agent-runtime,harness,trace}.test.ts` — brand ripple; `harness.test.ts`
  additionally asserts `isEntityId()` on both ids the real path produces.
- `packages/runtime-eve/src/eve-agent-runtime.{test,contract.test}.ts` — brand ripple.
- `packages/testing/src/{fake-agent-runtime,recording-trace-writer}.test.ts` — brand ripple.
- `docs/contracts/{README,job,execution-context,harness}.md`, `docs/architecture/system-map.md`,
  `docs/decisions/README.md`, `AGENTS.md` — documentation alongside the code.

### Verification

- `pnpm vitest run --project unit packages/core/src/ids.test.ts` — **PASS** (`Test Files 1 passed
  (1)`, `Tests 20 passed (20)`).
- `pnpm vitest run --project unit packages/core` — **PASS** (`Test Files 11 passed (11)`,
  `Tests 215 passed (215)`).
- `pnpm typecheck` — **PASS** (`Tasks: 6 successful, 6 total`, plus the root
  `tsc --noEmit -p tsconfig.json` over `scripts/`, `tests/` and `vitest.config.ts`).
- `pnpm format:check` — **PASS** (`Checked 104 files in 23ms. No fixes applied.`)
- `pnpm lint` — **PASS** (`Checked 104 files in 33ms. No fixes applied.`)
- `pnpm check` — **PASS**, exit 0. Tail:

  ```text
  Checked 104 files in 23ms. No fixes applied.     (format:check)
  Checked 104 files in 33ms. No fixes applied.     (lint)
   Tasks:    6 successful, 6 total                 (typecheck)
   Test Files  31 passed (31)
        Tests  391 passed (391)
   Tasks:    6 successful, 6 total                 (build)
  check:handoff — OK
  ```

  **Test count: 371 across 30 files before, 391 across 31 files after** (+20 in the one new file).
  The `contract` project booted real `eve dev` servers as usual.
- `pnpm example:run:mock` — **PASS**, exit 0, `"status": "completed"`. The ids in the emitted
  result prove the scheme reaches the real path, and that the run id sorts after the job id
  because it was minted after it:

  ```json
  "runId": "01a0bc7b-f16e-7000-9736-c959ea313c8c",
  "jobId": "01a0bc7b-f16d-7000-b830-615493d54fcc"
  ```

### Decisions / deviations

- **Option (b), owned implementation, not (a), the Node built-in.** The `started` entry has the
  evidence. Worth restating because it inverts the task's stated preference: (a) was preferred *if*
  the docs established stability and monotonicity. `randomUUIDv7` carries no experimental marker,
  so the stability half held, but the documentation explicitly disclaims strict increase and
  measurement confirmed it fails about half the time within a millisecond. Sortability is the whole
  point of M2-T1, so the built-in was rejected on semantics. ADR-0030 records this.
- **No module augmentation of `node:crypto` was written**, since the built-in is not used. If a
  future Node documents a monotonic `randomUUIDv7`, the swap is one internal function behind twelve
  stable exports and would not reach a call site.
- **`ENTITY_KINDS` strings are kebab-case** (`trace-event`, `workflow-version`), not the plan's
  `snake_case` column names, matching `IDENTIFIER_PATTERN`'s existing style. They are a type-level
  tag and a validation-message noun, never a wire format, so M2-T5 is free to name its columns
  `trace_event_id`.
- **Generators are per-entity, parser is generic.** Stated in Work completed with the reasoning:
  the kind is meaningless at generation time and meaningful at parse time.
- **Module-level mutable state** (last timestamp, counter) is deliberate and is the mechanism.
  Ordering within a millisecond is only definable relative to what was already issued. It is
  per-process; cross-process ordering is the timestamp's, to millisecond resolution.
- **A backwards clock increments the counter rather than emitting a smaller id.** The cost is ids
  that read slightly old until the clock catches up; the alternative silently corrupts every
  ordering built on them. Tested.
- **Nine of the twelve brands have no field on any contract.** Deliberate, per the task and per
  AGENTS.md's scope discipline: the type exists so a later milestone does not invent a thirteenth
  scheme, but a field now would publish a guess as a contract.
- **`AGENTS.md` was edited** (the ADR paragraph and "next free number 0030" → `0031`). It was not
  on the do-not-touch list, and leaving the number stale would hand the next agent a colliding ADR
  number.
- Deliberately untouched: `docs/context/current-state.md`, `docs/milestones/*` (both were being
  written concurrently by other agents), `docs/milestones/build-plan.md`,
  `tests/architecture/boundaries.ts` (no new package), git staging.

### Known issues / blockers

- None. One note for M2-T5: if an id is stored in a Postgres `uuid` column rather than `text`, that
  column's sort order must be verified to match the textual lexicographic order this scheme
  guarantees, since `uuid` compares as bytes rather than as the printed string. Recorded in
  ADR-0030 and in `docs/contracts/identifiers.md`.
- An entity id is **not** a capability token. The timestamp and counter are not secret and the
  first id of a millisecond has `rand_a` of `000`; unguessability is the 62 bits of `rand_b`.
  Recorded in both documents so M2-T9 and M5 do not mistake an id for authorization.

### Next exact step

**M2-T2 (finalize the `Job` contract), M2-T3 (trace event schema) and M2-T4 (buffered trace writer,
`packages/trace`) can now all start, in parallel.** They each need to decide whether their new
fields carry a brand from `packages/core/src/ids.ts`: M2-T2 owns whether an attempt surfaces as an
`AttemptId` beside the numeric `ExecutionContext.attempt`, and M2-T3 owns where `TraceEventId`
lands and whether the harness's `sequence` survives alongside a sortable event id. Neither is
decided by M2-T1; ADR-0030's "What this does NOT decide" section says so explicitly.
M2-T5 onward still need a local Supabase (M2-T11 first).

## 2026-09-19 21:51 — M2-T2 — Job contract

**Status:** started
**Actor/session:** coding agent (Claude Opus 5, implementer subagent under the M2 orchestrator)
**Commit:** `5721f7d`

### Goal

Finalize the `Job` schema per M2-T2: "Jobs are immutable after execution begins." Settle seven
questions the M1 shape left open — deep versus shallow immutability, which job is the one that
"begins execution", whether a `createdAt` field is needed now that a `JobId` is a UUIDv7, a
boundary validator for reading a job back as `unknown`, whether an attempt belongs on the job,
whether `JobContracts` needs a fourth field — and record the contract decisions in ADR-0032.

### Implementation references

- package/version: **not framework-facing.** No Vercel primitive is touched: no `eve`, no `ai`, no
  AI Gateway, no Jev, no Workflow, no Sandbox, no Supabase. The work is entirely inside
  `@internal/core`, which declares zero third-party dependencies and may use only Node built-ins
  (ADR-0029, ADR-0030). The source-of-truth protocol's research checkpoint therefore has no
  external API to establish; what follows is the in-repository material read instead.
- installed docs read: none applicable (no third-party package involved). Node's own
  `Object.freeze`/`Object.isFrozen` semantics are ECMAScript, not a dependency.
- official docs/repos/examples read: none applicable.
- public types/exports inspected: `packages/core/src/job.ts`, `domain.ts`, `harness.ts` (step 2,
  the `effectiveJob` construction), `context.ts` (`Budget`, `ToolGrant`, `DomainRef`,
  `ExecutionContext.attempt`), `ids.ts` (the UUIDv7 layout, `parseEntityId`, `ENTITY_ID_PATTERN`),
  `identifiers.ts` (`collectRefIssues`, `IDENTIFIER_PATTERN`, `isCapabilityIdentifier`),
  `capabilities.ts` (`parseCapabilityRefString`), `json.ts` (the JSON value model),
  `fingerprint.ts` (`canonicalJson`'s JSON-shape walk, as the style precedent for a recursive
  value walk in core), `errors.ts` (`ValidationError`, `ValidationIssue`), `schema.ts`, and
  `apps/example-agent/src/domain/index.ts` (the real `contracts`, `budget` and `permissions` a job
  carries today, including the bare `procurement-sop` SOP reference with no version).
- selected documented pattern: none imposed externally. The choices are harness-owned and are
  recorded in ADR-0032, in the style ADR-0029 and ADR-0030 set for the two previous
  AD-016 "unprescribed internal choice" decisions.
- ADRs read: `0029` (canonical JSON, `node:crypto` in a zero-dependency core), `0030` (UUIDv7
  entity identifiers, and its explicit "What this does NOT decide" list handing the attempt-id
  question to M2-T2), `0026` (trace-safe errors), `0027` (Standard Schema), `0000-template.md`.
- Docs read: `AGENTS.md` in full, `docs/context/current-state.md`, the build plan's §5 `Job`
  section and its M2-T2 and M2 acceptance criteria, the M2 status file's "Before starting",
  `docs/contracts/job.md`, `harness.md`, `domain-definition.md`, `identifiers.md`,
  `docs/contracts/README.md`, `docs/decisions/README.md`.

### Work completed

- Nothing yet; this is the pre-implementation entry required by AGENTS.md rule 7.

### Files changed

- `docs/progress/WORKLOG.md` (this entry).

### Verification

- Not yet run. The `completed` entry carries the results.

### Decisions / deviations

- Recorded in the `completed` entry and in ADR-0032.

### Known issues / blockers

- Another agent is working concurrently on M2-T3/M2-T4 (the trace schema and `packages/trace`).
  `trace.ts`, the emit/finish machinery in `harness.ts`, and `context.ts` are off limits to this
  task; only the step-2 job-construction block of `harness.ts` is touched.

### Next exact step

Implement the deep-freeze helper, `parseJob`, and the id-timestamp helper; then the docs and
ADR-0032; then verify.

## 2026-09-19 21:58 — M2-T3, M2-T4 — Trace event schema and buffered trace writer

**Status:** started
**Actor/session:** coding agent (Claude Opus 5, implementer subagent under the M2 orchestrator)
**Commit:** `5721f7d`

### Goal

Define the real `TraceEvent` schema (M2-T3) and the buffered, order-preserving trace writer
(M2-T4) together, because the one question both depend on is the same: **who owns `sequence`**.
Today the harness numbers its `run.*` events from 0 and `EveAgentRuntime` numbers its `eve.*`
events from 0 again, so a run's events collide and no total order exists (the M2 status file's
"Before starting", first bullet).

Concretely: a closed `TraceEventType` taxonomy from the build plan's list plus `run.aborted`; the
twelve-field event the plan requires ("every event contains"); a run-scoped `TraceRecorder` in
core that is the single owner of `sequence`, `id`, `attempt`, `version` and `behaviorFingerprint`;
`EveAgentRuntime` mapped onto the taxonomy instead of emitting raw `eve.<type>`; a new
`@internal/trace` package with `createBufferedTraceWriter`, a `TraceSink` interface, an in-memory
sink and a JSONL file sink; and `pnpm example:run:mock` writing a real ordered trace to disk.

### Implementation references

- package/version: **`eve` 0.63.0**, resolved from
  `node_modules/.pnpm/eve@0.63.0_ai@7.0.107_zod@4.6.5_/node_modules/eve` via
  `require.resolve('eve/package.json', { paths: ['packages/runtime-eve'] })`, matching
  `packages/runtime-eve/package.json` and `pnpm-lock.yaml`. This half of the task is
  framework-facing: the adapter maps eve's stream-event taxonomy onto the harness taxonomy, so
  every eve event type and field relied on is verified against the installed package rather than
  recalled. The rest (the core schema, the recorder, `packages/trace`) touches no third-party
  surface: `@internal/core` and `@internal/trace` declare zero third-party dependencies and use
  Node built-ins only (`node:fs/promises`, `node:path`), per ADR-0029 and ADR-0030.
- installed docs read: `eve/docs/concepts/sessions-runs-and-streaming.md` (the event envelope,
  `meta.id`/`meta.at`, turn boundaries), `eve/docs/concepts/execution-model-and-durability.mdx`
  (durable step retries, which is why a retried `step.completed` is counted), `eve/docs/README.md`
  and `eve/docs/meta.json` for the docs map.
- official docs/repos/examples read: none beyond the installed package; eve is preview software
  and AGENTS.md makes `node_modules/eve/docs/` authoritative for it.
- public types/exports inspected: `eve/dist/src/protocol/message.d.ts` in full — the
  `UnstampedMessageStreamEvent` union (all 32 members), `MessageStreamEvent`,
  `MessageStreamEventMeta` (`id`, `at`, `deliveryIds`), `TurnStartedStreamEvent`,
  `TurnCompletedStreamEvent`, `TurnFailedStreamEvent`, `TurnCancelledStreamEvent`,
  `StepStartedStreamEvent` (`modelId`, `stepIndex`), `StepCompletedStreamEvent`
  (`finishReason`, optional `usage.{costUsd,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens}`,
  `providerMetadata.gateway.generationId`), `StepFailedStreamEvent` (`code`, `message`,
  `details`), `ActionsRequestedStreamEvent` (`actions`, `stepIndex`), `ActionResultStreamEvent`
  (`result`, `status`, optional `error: { code, message }`), `ActionResultStatus`
  (`"completed" | "failed" | "rejected"`, where `rejected` is a HITL-denied call that never ran),
  `ActionPartialStreamEvent`, `InputRequestedStreamEvent`, `InputResolvedStreamEvent`
  (`resolutions[].outcome`), `ApprovalCandidateStreamEvent`, `ApprovalSettledStreamEvent`,
  `AuthorizationRequiredStreamEvent`, `AuthorizationCompletedStreamEvent`,
  `SessionStartedStreamEvent`, `SessionWaitingStreamEvent`, `SessionFailedStreamEvent`,
  `SessionCompletedStreamEvent`, `ResultCompletedStreamEvent`, `MessageReceivedStreamEvent`,
  `MessageAppendedStreamEvent`, `MessageCompletedStreamEvent`, `ReasoningAppendedStreamEvent`,
  `ReasoningCompletedStreamEvent`, `ActionInputAppendedStreamEvent`, `ContextClearedStreamEvent`,
  `CompactionRequestedStreamEvent`, `CompactionCompletedStreamEvent`, the four `subagent.*`
  events, `isTurnFailureEvent` and `isCurrentTurnBoundaryEvent`. Also
  `eve/dist/src/shared/action-types.d.ts`: `RuntimeActionRequest` (five members, every one with a
  `callId`) and `RuntimeActionResult` (`tool-result`, `subagent-result`, `load-skill-result`,
  every one with a `callId`), which is what makes a tool span correlatable.
- selected documented pattern: correlate action lifecycles **by `callId`**, which
  `ActionsRequestedStreamEvent`'s own doc comment requires ("consumers must correlate action
  lifecycles by call ID rather than assume one event contains every call from an assistant
  step"); correlate model spans by `turnId` + `stepIndex`; take each event's instant from
  `meta.at` (ISO-8601, stamped once and stable across re-reads) and its cross-reference identity
  from `meta.id`; read terminal state from turn boundary events, never `MessageResult.status`
  (ADR-0028, unchanged).
- ADRs read: `0010` (observability is a product surface), `0026` (trace-safe error
  serialization), `0028` (the eve adapter observes the event stream), `0029` (canonical JSON),
  `0030` (`TraceEventId`, `RunId`, and its explicit hand-off of the attempt-id question),
  `0000-template.md`.
- Docs read: `AGENTS.md` in full, `docs/context/current-state.md`, the build plan's M2-T3, M2-T4,
  M2 acceptance criteria and AD-010, the M2 status file's "Before starting",
  `docs/contracts/README.md`, `harness.md`, `execution-context.md`,
  `docs/architecture/runtime.md`, `system-map.md`, `docs/decisions/README.md`.

### Work completed

- Nothing yet; this is the pre-implementation entry required by AGENTS.md rule 7 and the
  research checkpoint AD-011 requires before framework-facing code.

### Files changed

- `docs/progress/WORKLOG.md` (this entry).

### Verification

- Not yet run. The `completed` entry carries the results.

### Decisions / deviations

- Recorded in the `completed` entry and in ADR-0031.

### Known issues / blockers

- Another agent is working concurrently on M2-T2 (`job.ts`, `domain.ts`, `docs/contracts/job.md`,
  ADR-0032). Those files, plus `ids.ts`, `json.ts`, `identifiers.ts`, `capabilities.ts` and the
  step-2 job-construction block of `harness.ts`, are off limits to this task.

### Next exact step

Write the taxonomy, `TraceEvent` and `TraceRecorder` in `packages/core/src/trace.ts`, then the
`ExecutionContext` and `createHarness` changes, then the adapter mapping, then `packages/trace`.

## 2026-09-19 22:10 — M2-T2 — Job contract

**Status:** completed
**Actor/session:** coding agent (Claude Opus 5, implementer subagent under the M2 orchestrator)
**Commit:** `5721f7d`

### Goal

Finalize the `Job` schema per M2-T2, "jobs are immutable after execution begins": settle deep
versus shallow immutability, which of the two values called "the job" is authoritative, whether a
`createdAt` field is needed, how an untrusted value becomes a `Job`, whether an attempt belongs on
a job, and whether `JobContracts` needs a fourth field. Record the contract decisions in ADR-0032.

### Implementation references

Not framework-facing: no Vercel primitive is touched (no `eve`, `ai`, AI Gateway, Jev, Workflow,
Sandbox, Supabase). The work is inside `@internal/core`, which declares zero third-party
dependencies and may use only Node built-ins (ADR-0029, ADR-0030), so the source-of-truth protocol
has no external API to establish. The in-repository material read instead:

- core sources: `job.ts`, `domain.ts`, `harness.ts` (the step-2 `effectiveJob` block), `context.ts`
  (`Budget`, `ToolGrant`, `DomainRef`, `ExecutionContext.attempt`), `ids.ts` (UUIDv7 layout,
  `parseEntityId`), `identifiers.ts` (`collectRefIssues`, `IDENTIFIER_PATTERN`),
  `capabilities.ts` (`parseCapabilityRefString`), `json.ts`, `fingerprint.ts` (`canonicalJson`'s
  recursive JSON walk, the style precedent), `errors.ts`, `schema.ts`, `index.ts`
- the real job a domain produces: `apps/example-agent/src/domain/index.ts`, including the bare
  unversioned `procurement-sop` SOP reference
- ADRs: 0029, 0030 (whose "What this does NOT decide" hands the attempt-id question here), 0026,
  0027, `0000-template.md`
- docs: `AGENTS.md`, `docs/context/current-state.md`, build plan §5 and M2-T2 and the M2
  acceptance criteria, the M2 status file's "Before starting", `docs/contracts/job.md`,
  `harness.md`, `domain-definition.md`, `identifiers.md`, `docs/contracts/README.md`,
  `docs/decisions/README.md`
- ECMAScript semantics relied on, stated rather than assumed: `Object.freeze` freezes own
  properties and not the objects they reference; a `Date`'s time and a `Map`'s entries live in
  internal slots, so freezing one does not stop `setTime()` or `set()`; every module here is an ES
  module and therefore strict, so a write to a frozen property throws a `TypeError` rather than
  failing silently, which is what makes deep immutability assertable in a test

### Work completed

- **`packages/core/src/freeze.ts` (new), `deepFreeze()`.** The whole of the harness's freezing
  surface. Recurses into arrays and plain objects only; a `Date`, `Map`, `Set`, class instance or
  function is left as found, neither frozen nor walked. Cycle-guarded with a `WeakSet` rather than
  `Object.isFrozen`, because an already-frozen object can hold an unfrozen child.
- **`defineDomain()`'s `createJob` and `createHarness()`'s job construction now `deepFreeze`.** The
  three `Object.freeze` calls inside `createJob` became one deep one. Only the step-2 block of
  `harness.ts` was touched, plus its import line.
- **`packages/core/src/json.ts`:** added `isPlainObject`, `isJsonValue` and `isJsonObject`, the
  runtime half of the value model. `isJsonValue` rejects non-finite numbers, `undefined`, symbols,
  bigints, functions, exotic objects and cycles, and accepts an `undefined` object property (which
  `JSON.stringify` drops) while rejecting an `undefined` array element (which it turns into `null`).
- **`packages/core/src/ids.ts`:** added `entityIdTimestampMs(id, path?)` and
  `entityIdTimestamp(id, path?)`, which read the 48-bit creation time out of any id in the scheme
  and throw `ValidationError` for anything that is not one.
- **`packages/core/src/job.ts`:** added `parseJob(value, path?)` and `isJob(value)` over one shared
  validation pass, and rewrote the `Job` and `JobContracts` doc comments as the finalized contract.
- **`packages/core/src/index.ts`:** exported `deepFreeze`, `entityIdTimestamp`,
  `entityIdTimestampMs`, `isJob`, `parseJob`, `isJsonObject`, `isJsonValue`, `isPlainObject`.
- **Tests:** new `freeze.test.ts` (11) and `job.test.ts` (48); additions to `json.test.ts` (+10),
  `ids.test.ts` (+9), `domain.test.ts` (+1) and `harness.test.ts` (+2). Among them: nested mutation of
  a job's budget, grant, metadata and input each throws `TypeError`; the JSON round trip
  `parseJob(JSON.parse(JSON.stringify(job)))` deep-equals the job the harness built, for a job
  built through `defineDomain()` mirroring the example domain; the effective job the runtime
  receives carries the result's `jobId` and is deep-frozen; and `isJob` freezes nothing.
- **Docs:** `docs/contracts/job.md` rewritten as the finalized contract; `harness.md` gained a
  "The effective job is the job" section; `identifiers.md` gained "Reading the creation time back"
  and had its `AttemptId` row and open question resolved; `domain-definition.md`'s `createJob` step
  5 now states the deep freeze; `docs/contracts/README.md`'s job row and closing paragraph;
  `docs/architecture/system-map.md`'s core file list (`freeze.ts` added, `job.ts` no longer types
  only); `docs/decisions/README.md` gained the ADR-0032 paragraph.

### Files changed

- `packages/core/src/freeze.ts`, `freeze.test.ts` (new)
- `packages/core/src/job.ts`, `job.test.ts` (new test file)
- `packages/core/src/json.ts`, `json.test.ts`
- `packages/core/src/ids.ts`, `ids.test.ts`
- `packages/core/src/domain.ts`, `domain.test.ts`
- `packages/core/src/harness.ts` (step-2 block and one import), `harness.test.ts`
- `packages/core/src/index.ts`
- `docs/decisions/0032-jobs-are-deeply-immutable-and-the-effective-job-is-the-job.md` (new)
- `docs/decisions/README.md`
- `docs/contracts/job.md`, `harness.md`, `identifiers.md`, `domain-definition.md`, `README.md`
- `docs/architecture/system-map.md`
- `docs/milestones/m2-job-trace-supabase-and-run-ledger.md` (the M2-T2 subsection only)
- `docs/progress/WORKLOG.md`

### Verification

- `pnpm vitest run --project unit packages/core` — **PASS**. 13 files, 360 tests, against 11 files
  and 279 before this task: **+81**, being two new files (`freeze.test.ts` 11, `job.test.ts` 48)
  and four extended ones (`json.test.ts` +10, `ids.test.ts` +9, `domain.test.ts` +1,
  `harness.test.ts` +2).
- `pnpm typecheck` — **PASS**, 6/6 tasks.
- `pnpm test` (all four projects) — **PASS**, 33 files, 545 tests, 12.8 s. The `contract` project
  booted real `eve dev` servers as usual.
- `pnpm build` — **PASS**, 7/7 tasks.
- `pnpm example:run:mock` — **PASS**, exit 0, `"status": "completed"`, against a real `eve dev`
  server with `mockModel`. This is the deep-frozen effective job travelling the real path into
  `EveAgentRuntime`.
- `biome check --formatter-enabled=false` and `biome format` over the twelve files this task
  touched — **PASS**, no findings.
- **`pnpm check` — FAIL, and not on this task's work.** It stops at its first stage,
  `format:check`, on `packages/runtime-eve/src/eve-agent-runtime.ts`,
  `eve-agent-runtime.test.ts` and `packages/trace/src/buffered-trace-writer.test.ts`; `pnpm lint`
  then fails on `packages/core/src/trace.ts`
  (`assist/source/organizeImports`); and `pnpm check:handoff` fails with
  `[missing-decision-record] … references decision record 0031, but no file starting with "0031-"
  exists`. All three are the concurrent M2-T3/M2-T4 task's in-progress files, every one of which is
  on this task's do-not-edit list, and ADR-0031 is the number reserved for it. Re-run once after an
  interval: the same stages failed, on the same task's files and no others (the second run's
  `format:check` listed one more of its files, `packages/trace/src/buffered-trace-writer.test.ts`,
  as that package was still being written). Every stage that does not depend on those
  files passes, as listed above.

### Decisions / deviations

All seven questions were settled as recommended; the reasoning and the alternatives are in
[ADR-0032](../decisions/0032-jobs-are-deeply-immutable-and-the-effective-job-is-the-job.md).

- **Deep immutability, with a stated boundary.** `deepFreeze` recurses into arrays and plain
  objects only. This is a deviation in detail from "freeze everything": freezing a `Date` does not
  stop `setTime()` and freezing a `Map` does not stop `set()`, because that state is in internal
  slots, so the protection would be advertised and absent; and freezing a memoizing class instance
  breaks it at a distance from the code that froze it. **The input is frozen** on the same terms.
  The rule is stated positively: a job is deeply immutable exactly as far as it is
  JSON-representable, which is exactly as far as it is persistable, traceable and replayable.
- **`deepFreeze` lives in a new `freeze.ts`, not in `json.ts`.** `json.ts` was types only and is
  the value model; immutability is a different concern and is now one module rather than a
  `freeze` call per field. `json.ts` did gain runtime code, but only the three guards `parseJob`
  needs to ask "is this JSON".
- **The effective job is the job.** Recorded in `job.md` and `harness.md`. `createJob(input)`'s
  signature is unchanged and `defineDomain()` gained no clock.
- **No `createdAt`.** `entityIdTimestampMs`/`entityIdTimestamp` added to `ids.ts` with tests; both
  refuse a non-id rather than reading a v4 UUID's random bits as a confident wrong date. The two
  monotonicity caveats inherited from ADR-0030 (marginally ahead after a burst, marginally behind
  through a backwards clock step) are documented at the function and in `identifiers.md`.
- **`parseJob` is strict about unknown fields** at the top level, in `contracts`, in `budget` and
  in a `ToolGrant`, and lenient only where the contract is open (`metadata`, and `input` beyond
  "is it JSON"). Dropping a field on read loses data from the record whose purpose is
  reproducibility, and a mistyped budget dimension would otherwise read as unlimited. The cost —
  a job written by a future version with a tenth field is rejected rather than degraded — is
  recorded as an open question in the ADR.
- **Budget dimensions: `maxCostUsd` may be fractional, the other three must be whole.** Money is
  fractional; a model call is not, and `Date.now()` cannot express a fractional millisecond.
- **`contracts.sop` is a bare identifier**, matching what the example domain writes and what M1-T9
  deliberately left unregistered. `IDENTIFIER_PATTERN` excludes `@`, so a versioned SOP reference
  would not pass today. Per the task, this is recorded as an **open question for M2-T8** in
  ADR-0032 rather than answered with a fourth `JobContracts` field.
- **No attempt field on `Job`**, answering the question ADR-0030 deferred here.
- **`AGENTS.md` was deliberately not edited.** Its "next free number" line still says 0031; the
  orchestrator reconciles it once both M2-T2 (ADR-0032) and the concurrent trace task (ADR-0031)
  have landed. `docs/context/current-state.md` and `docs/milestones/build-plan.md` were also left
  alone, as were `trace.ts`, the trace machinery in `harness.ts`, `context.ts`, and everything
  under `packages/runtime-eve`, `packages/testing`, `packages/trace`, `apps/` and `tests/`.

### Known issues / blockers

- `pnpm check` cannot be made to pass from inside this task: all three of its failing stages fail
  on the concurrent task's files (see Verification). This is not a blocker for M2-T2's own work,
  which is verified by the targeted runs, but the milestone cannot be declared clean until
  `packages/runtime-eve/src/eve-agent-runtime.ts`, `eve-agent-runtime.test.ts` and
  `packages/trace/src/buffered-trace-writer.test.ts` are formatted, `packages/core/src/trace.ts`'s
  imports are sorted, and ADR-0031 exists.
- One forward-compatibility consequence worth carrying into M2-T5: `parseJob` rejects an unknown
  field, so the moment a tenth field is wanted, the stored record needs a version discriminator or
  a coordinated migration. The ADR records it as an open question rather than pre-solving it.
- `parseJob` walks the whole `input` to prove it is JSON, so reading a very large stored job costs
  a full traversal. Accepted against the alternative, which is trusting a database row.

### Next exact step

M2-T3 and M2-T4 are in progress concurrently. When they land: run `pnpm format`, sort
`packages/core/src/trace.ts`'s imports, land ADR-0031, then run `pnpm check` to green and update `docs/context/current-state.md`
and `AGENTS.md`'s next-free-ADR line (now 0033). After that, **M2-T5 (Supabase schema)** is the
next task on this milestone and `parseJob`'s rules in `docs/contracts/job.md` are the written
specification its `jobs` table columns and constraints have to match; it still needs M2-T11's local
Supabase first.

## 2026-09-19 22:25 — M2-T3, M2-T4 — Trace event schema and buffered trace writer

**Status:** completed
**Actor/session:** coding agent (Claude Opus 5, implementer subagent under the M2 orchestrator)
**Commit:** `5721f7d`

### Goal

As the `started` entry above. The event taxonomy and the twelve-field event (M2-T3), the buffered
order-preserving writer and the `packages/trace` package (M2-T4), and the one question both turn
on: who owns a run's `sequence`.

### Implementation references

As recorded in the `started` entry above (eve 0.63.0, `dist/src/protocol/message.d.ts` and
`dist/src/shared/action-types.d.ts` read in full, `docs/concepts/sessions-runs-and-streaming.md`).
Nothing in the source list changed during implementation. Two documented facts decided the adapter
design: `ActionsRequestedStreamEvent`'s "consumers must correlate action lifecycles by call ID"
(so tool spans are keyed by `callId`, not by event), and `ActionResultStatus`'s `"rejected"` being
a call denied at an approval gate that never ran (so it maps to `PermissionDeniedError`, not
`ToolExecutionError`).

### Work completed

- **Taxonomy (M2-T3).** `TRACE_EVENT_TYPES` is the build plan's list plus `run.aborted`, exported
  as a runtime constant with `isTraceEventType()`. `TraceEventType` is the closed union.
  `TRACE_EVENT_VERSION` is the literal `1`.
- **Event.** `TraceEvent` carries `id`, `runId`, `attempt`, `sequence`, `timestamp`, `type`,
  `parentId`, `node`, `version`, `behaviorFingerprint`, `payload`, `usage`, `latencyMs`, `error`.
  Declared as a type alias so it is assignable to `JsonObject` and needs no conversion to be
  canonicalized, written as JSONL or stored as JSONB. `TraceEventUsage` is the union of what
  `AgentExecutionUsage` and eve's step usage already report, every field optional.
- **`TraceRecorder` (the M2-T3/M2-T4 joint decision).** `createTraceRecorder()` in
  `@internal/core` is the single owner of a run's `sequence` and stamps the six fields a caller
  must not choose. `record()` assigns `sequence` synchronously and chains appends, so the writer
  sees events in order under concurrency; a rejected append does not poison later ones. `span()`
  returns a handle whose `end()` sets `parentId` and measures `latencyMs`. `rootId` exposes the
  run's `run.started` so an adapter parents its `agent.started` without bookkeeping.
- **`ExecutionContext.trace` is now a `TraceRecorder`.** `createExecutionContext` accepts either a
  `TraceWriter` (wrapped) or a `recorder` (used as-is), plus `clock` and `behaviorFingerprint`.
- **`createHarness()`** builds one recorder per run, records `run.started` through it, passes the
  same recorder into the context, and derives each terminal event's `usage`, `latencyMs` and
  `error` from the result. `flush()` is awaited and **not** caught, so a `StorageError` leaves
  `harness.run()`.
- **`EveAgentRuntime`** maps eve's stream onto the taxonomy instead of emitting `eve.<type>`, with
  agent/model/tool spans; `state.sequence` deleted. Table and drops in ADR-0031 and
  `docs/architecture/runtime.md`.
- **`packages/trace`** (`@internal/trace`): `TraceSink`, `createBufferedTraceWriter()`,
  `createInMemoryTraceSink()`, `createJsonlFileTraceSink()`, `createJsonlDirectoryTraceSink()`.
  Added to `BOUNDARY_RULES` as a non-adapter with core's bans, and the boundary test now fails if
  a `packages/*` package is governed by no rule at all.
- **`pnpm example:run:mock`** writes `apps/<agent>/.harness/traces/<runId>.jsonl` and prints the
  path; `.harness/` is git-ignored.
- **Docs:** new `docs/contracts/trace-event.md`; `harness.md`, `execution-context.md`,
  `docs/contracts/README.md`, `docs/architecture/runtime.md`, `system-map.md`, the AGENTS.md
  layout tree and ADR-0031 updated or written.

### Files changed

- `packages/core/src/trace.ts` — rewritten: taxonomy, `TraceEvent`, `TraceEventUsage`,
  `TraceWriter`, `TraceClock`, `TraceEventInput`, `TraceSpan`, `TraceRecorder`,
  `createTraceRecorder()`.
- `packages/core/src/trace.test.ts` — rewritten (4 -> 30 `it` blocks, 63 cases).
- `packages/core/src/context.ts` — `trace` is a `TraceRecorder`; new `recorder`, `clock`,
  `behaviorFingerprint` inputs.
- `packages/core/src/context.test.ts` — recorder assertions (11 -> 13).
- `packages/core/src/harness.ts` — trace code only: `RUN_EVENTS` typed against the taxonomy,
  `TraceEmitExtra`, `traceUsage()`, recorder construction, `emit`/`finish`, terminal payloads.
- `packages/core/src/harness.test.ts` — trace assertions (16 -> 21), including the flush-failure
  test.
- `packages/core/src/index.ts` — trace exports.
- `packages/trace/package.json`, `tsconfig.json`, `tsconfig.build.json`, `src/index.ts`,
  `src/sink.ts`, `src/buffered-trace-writer.ts`, `src/jsonl-sink.ts`,
  `src/buffered-trace-writer.test.ts`, `src/jsonl-sink.test.ts` — new package.
- `packages/runtime-eve/src/eve-events.ts` — `traceEventType`/`projectEveEvent` replaced by
  `eveEventIdentity()`, `stepTraceUsage()`, `actionResultCallId()`, `readErrorCode()`.
- `packages/runtime-eve/src/eve-agent-runtime.ts` — `#trace()` mapping, `TurnSpans`, span helpers,
  `toolFailure()`; `state.sequence` removed.
- `packages/runtime-eve/src/eve-agent-runtime.test.ts` — trace suite rewritten (29 -> 37).
- `packages/runtime-eve/src/eve-agent-runtime.contract.test.ts` — taxonomy assertions.
- `packages/testing/src/recording-trace-writer.ts`, `recording-trace-writer.test.ts` — typed
  `types()`, events built through a recorder.
- `tests/architecture/boundaries.ts`, `package-boundaries.test.ts` — `@internal/trace`.
- `apps/example-agent/package.json`, `src/run.ts` — JSONL trace wiring and printed path.
- `.gitignore` — `.harness/`.
- `docs/contracts/trace-event.md` (new), `harness.md`, `execution-context.md`, `README.md`;
  `docs/architecture/runtime.md`, `system-map.md`; `docs/decisions/0031-...md` (new),
  `docs/decisions/README.md`; `AGENTS.md` (layout tree line);
  `docs/milestones/m2-job-trace-supabase-and-run-ledger.md` (M2-T3, M2-T4 subsections);
  `docs/progress/WORKLOG.md`.

### Verification

- `pnpm vitest run --project unit packages/core packages/trace packages/testing packages/runtime-eve` — PASS (450 tests, 21 files)
- `pnpm vitest run --project contract` — PASS (7 tests, 12.7 s, real `eve dev` server)
- `pnpm check` — PASS (format, lint, typecheck, 569 tests across 35 files, build, handoff). Run
  with M2-T2's concurrent work also in the tree.
- `pnpm example:run:mock` — PASS, exit 0, `"status": "completed"`, trace written to
  `apps/eve-fixture-agent/.harness/traces/01a0bc9c-25f8-7000-ab91-a4f665e1af2b.jsonl`: six lines,
  sequences `0,1,2,3,4,5`, types `run.started agent.started model.started model.completed
  agent.completed run.completed`, each `agent.*`/`model.*` event parented on the event before it
  and both `run.*` events parented on `null`.

### Decisions / deviations

All recorded in **ADR-0031**. The ones that are deviations or additions rather than restatements
of the task brief:

- **`createJsonlDirectoryTraceSink(directory)` exists alongside `createJsonlFileTraceSink(path)`.**
  The brief asked for a JSONL sink taking a path and for the example to write
  `.harness/traces/<runId>.jsonl`. Those cannot both be true with a path alone: a run id is minted
  inside `harness.run()`, so a caller cannot name the file before the run starts. The file sink is
  exactly as specified; the directory sink names each file from the `runId` on the events it is
  handed.
- **`ExecutionContext.trace` keeps its name** and takes the recorder; `createExecutionContext`
  gains a `recorder` input so the harness can share one recorder with the adapter.
- **`run.*` events all have `parentId: null`**, including the terminal ones, per the brief's "run.*
  has null". `agent.started` points at `run.started`, so the run is still the top of the tree.
- **A cancelled eve turn is `agent.failed` with `payload.cancelled: true`**, not silence: an
  unclosed span makes a trace unreadable and the taxonomy has no `agent.aborted`.
- **eve's `input.requested`/`input.resolved` map to `approval.requested`/`approval.resolved`.**
  They have a counterpart in the taxonomy, so dropping them would lose why a run stopped.
- **eve's own approval-gate events (`approval.candidate`, `approval.settled`) and connection
  authorization events are dropped**, and named in ADR-0031 as M5's producers for `approval.*`
  once the harness can answer one. `subagent.*` is dropped and should become a child run with its
  own `runId`, not a taxonomy member.
- **A trace event's error carries eve's failure `code`, never its `message`.** A harness
  `run.failed` event does carry the full `SerializedHarnessError` including `details`, which is
  where an adapter's message reaches a trace; M2-T9 must sanitize it.
- **`append` auto-flushes at `maxBufferedEvents`, default 256**, and a failed batch stays buffered
  rather than being reported lost.
- **AGENTS.md:** the brief said to add only the `packages/trace/` line. One more token changed in
  the same file: the "planned" block's `packages/trace/, storage-supabase/ (planned, M2)` became
  `packages/storage-supabase/ (planned, M2)`, because leaving `packages/trace` listed as planned
  directly under a tree that now contains it would be stale on the same screen.

### Known issues / blockers

- **`pnpm example:run:mock` produces no `tool.*` events.** The fixture agent's scripted model only
  calls `echo_fixture` when the prompt contains `FIXTURE_TOOLCALL`, and the vendor-triage objective
  does not; the domain does not grant `echo_fixture` either. Tool spans are covered by the adapter
  unit tests and by the contract suite, which polls for a real `tool.started` against a live
  `eve dev` server. Making the demo exercise a tool would mean changing the domain's objective or
  its grants, which is out of this task's scope.
- `behaviorFingerprint` is `null` on every event until M2-T8; `node` is `null` until M4.
- The recorder is per-run mutable state. Nothing shares one across runs, but the type cannot stop
  a caller doing so.

### Next exact step

M2-T5 (Supabase schema) adds a `trace_events` table whose columns mirror
`docs/contracts/trace-event.md`'s field table, and a Supabase `TraceSink` in
`packages/storage-supabase` behind the same `createBufferedTraceWriter()`. It also decides when an
attempt becomes a row, which is the question `TraceEvent.attempt` deliberately leaves open. M2-T11
(local Supabase) must land first.

## 2026-09-19 22:30 — M2-T11 — Reproducible local Supabase environment

**Status:** started
**Actor/session:** coding agent (Claude Opus 5, implementer subagent, concurrent M2 session)
**Commit:** `62548d6`

### Goal

Make a local Supabase reproducible from the repository alone: the CLI pinned as a project dev
dependency, `supabase/config.toml` committed, the four `pnpm supabase:*` lifecycle scripts, the
`packages/storage-supabase` scaffold holding the generated `database.types.ts`, a CI job that fails
on type drift, and the docs/runbook/ADR that say how it is operated. This task gates M2-T5 through
M2-T10, none of which can be verified without a database.

### Implementation references

- **package/version:** `supabase@2.117.0`, installed as a root `devDependencies` pin (exact, no
  range, per ADR-0024). `npm view supabase version` -> `2.117.0`; `dist-tags.latest` is the same
  and `time.modified` is `2026-09-18T13:38:40.990Z`. `node_modules/supabase/package.json` confirms
  `"version": "2.117.0"`, `bin.supabase = dist/supabase.js`, and that the platform binary arrives
  as an **optional dependency** (`@supabase/cli-darwin-arm64@2.117.0` and seven siblings), not as a
  postinstall download. No `onlyBuiltDependencies` entry is therefore needed: pnpm 12's blocked
  lifecycle scripts do not affect it. `pnpm exec supabase --version` prints `2.117.0`.
- **release-age gate:** not triggered. `pnpm install` printed
  `✓ Lockfile passes supply-chain policies` and appended nothing to
  `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`; the package was published about 33 hours
  before the install. That file is therefore unchanged by this task.
- **installed CLI surface read** (all via `pnpm exec supabase <cmd> --help` against 2.117.0, which
  is the lockfile-matched installed package and therefore the top of the source-precedence list):
  - `supabase init [--interactive|-i] [--use-orioledb] [--force]`. **Non-interactive is the
    default**; `-i` is what prompts for IDE (VS Code / IntelliJ) settings, so plain `supabase init`
    generates no editor files. It writes exactly `supabase/config.toml` and `supabase/.gitignore`,
    and touches `supabase/.temp/cli-latest` as a version-check cache.
  - `supabase start [--exclude|-x <containers>] [--ignore-health-check]`.
  - `supabase stop [--project-id] [--no-backup] [--all]`. `--no-backup` is what deletes the data
    volumes; plain `stop` keeps them.
  - `supabase db reset [--local] [--linked] [--db-url] [--no-seed] [--sql-paths] [--version]
    [--last]`. Description: "Resets the local database to current migrations." Local is the
    default target.
  - `supabase gen types [--local|--linked|--db-url|--project-id] [--lang
    typescript|go|swift|python] [--schema|-s] [--query-timeout]`. **There is no output-file flag
    in 2.117.0**; the documented examples all write to stdout (`supabase gen types --local`), so
    the script must use shell redirection. Recorded as a deviation risk below.
  - `supabase status [--override-name]`, plus the **global** `--output, -o
    env|pretty|json|toml|yaml|table|csv`. `supabase status -o env` is therefore the supported way
    to capture local URLs and keys into an env file.
- **generated `supabase/config.toml` (2.117.0 defaults), ports:** `project_id` defaulted to the
  working-directory name, `adaptive-agent-harness`, which is exactly the stable value wanted, so
  it is committed unchanged. Ports: API `54321`, DB `54322`, DB shadow `54320`, Studio `54323`,
  local SMTP `54324` (optional `smtp_port` 54325 / `pop3_port` 54326 commented out), analytics
  `54327`, pooler `54329` (`[db.pooler] enabled = false`), edge-runtime Chrome inspector `8083`.
  `[db.migrations] enabled = true`, `[db.seed] enabled = true` with
  `sql_paths = ["./seed.sql"]`, which is why `supabase/seed.sql` is the file this task creates.
- **port collision check:** none. `eve start` defaults to `$PORT` then `3000` and `eve dev`
  defaults to `$PORT` then `2000`
  (`node_modules/.pnpm/eve@0.63.0_*/node_modules/eve/docs/reference/cli.md` lines 197-221); the
  contract suite starts `eve dev --no-ui --port 0`. Nothing in the repository uses 8083 or the
  `543xx` range. `lsof -nP -iTCP -sTCP:LISTEN` on the development host showed nothing listening in
  either range.
- **what must stay out of git:** `supabase init` writes its own `supabase/.gitignore` covering
  `.branches`, `.temp`, `.env.keys`, `.env.local` and `.env.*.local`. `git check-ignore -v`
  confirms `supabase/.temp/cli-latest` and `supabase/.branches` resolve through it, and that the
  root `.gitignore`'s existing `.env.*` line (with `!.env.example`) already ignores `.env.local`.
  The root file still gains explicit entries so the rule survives the CLI's file being regenerated.
- **secrets:** local URLs and keys are printed by `supabase start`/`supabase status` and are never
  written to a tracked file. No key value, including the well-known local demo anon/service keys,
  appears anywhere in this task's output.
- **selected documented pattern:** the build plan's own M2-T11 wrapper set, wrapping the four
  commands verbatim, with `gen types` redirected to
  `packages/storage-supabase/src/database.types.ts` because 2.117.0 offers no output flag.
- **not documented / harness-owned:** the reproducibility discipline itself (reset then regenerate
  then `git diff --exit-code`) is a repository policy, not a CLI feature; it becomes ADR-0033 and
  the `supabase-types` CI job.
- **still to establish during verification:** what `supabase gen types --lang typescript --local`
  emits against a database with zero migrations applied, whether its stdout carries any log line
  that would pollute the redirected file, and whether Biome's formatter accepts the generated file
  unchanged.

### Work completed

Nothing yet beyond establishing the references above and installing the pinned dev dependency.

### Files changed

- `package.json` — `supabase@2.117.0` added to `devDependencies`.
- `pnpm-lock.yaml` — regenerated by `pnpm install`.
- `supabase/config.toml`, `supabase/.gitignore` — written by `pnpm exec supabase init`.

### Verification

- `pnpm exec supabase --version` — PASS, prints `2.117.0`.
- `pnpm exec supabase init` — PASS, exit 0, "Finished supabase init."

### Decisions / deviations

- To be recorded in the result entry and in ADR-0033.

### Known issues / blockers

- `supabase gen types` writing to stdout means a failed generation truncates the committed
  generated file. The CI drift gate catches it; the runbook says to re-run after a successful
  `supabase db reset`.

### Next exact step

Create `supabase/migrations/` and `supabase/seed.sql`, scaffold `packages/storage-supabase`, add
the four scripts, then run the reproducibility sequence (`start`, `reset`, `types`, regenerate,
`git diff --exit-code`, `stop`).

## 2026-09-19 22:31 — M2-T8 — Behavior fingerprint

**Status:** started
**Actor/session:** coding agent (Claude Opus 5, implementer subagent under a Fable orchestrator)
**Commit:** `62548d6`

### Goal

Give every trace event and every run result a real `behaviorFingerprint`: a `sha256:` digest over
the canonicalized behavior-affecting inputs the build plan's M2-T8 lists — agent instructions, SOP,
loaded skills, tool definitions/version ids, model configuration, schemas, workflow IR and policy
thresholds — and nothing time-dependent. The acceptance criterion is that changing the
instructions, the SOP or a policy threshold changes the fingerprint, and that changing nothing
behavior-affecting does not.

### Implementation references

- package/version: `eve@0.63.0` (pinned by `packages/runtime-eve/package.json` and
  `apps/example-agent/package.json`), `ai@7.0.107`, Node 24.21.0, pnpm 12.4.2.
- installed docs read: `node_modules/eve/docs/skills.mdx` (skill layout: `agent/skills/`, flat
  markdown or a packaged directory with `SKILL.md`; the name comes from the path; `description`
  frontmatter is a routing hint, and a flat file may omit it), `docs/reference/agent-files.md`
  (the authored slot table: `agent/skills/<name>.md` resolves to skill `<name>`, and `lib/` is
  "Shared authored helper code … Import-only; not copied into the sandbox"),
  `docs/agent-config.md` (`agent.ts` is optional but `model` is required once it exists; the
  behavior-affecting settings a config may carry: `model`, `reasoning`, `compaction`, `limits`).
- official docs/repos/examples read: none beyond the installed docs; nothing here is a new eve
  API call.
- public types/exports inspected: `packages/core/src/fingerprint.ts` (`canonicalJson`,
  `fingerprint`, `FINGERPRINT_ALGORITHM_PREFIX`), `capabilities.ts` (`capabilityFingerprint`,
  `CapabilityManifestEntry`), `trace.ts` (`TraceEvent.behaviorFingerprint`,
  `CreateTraceRecorderOptions.behaviorFingerprint`), `harness.ts`, `domain.ts`, `json.ts`.
- selected documented pattern: the behavior descriptor is **supplied by the domain**, not read by
  the harness. ADR-0028 makes `EveAgentRuntime` a URL-only client that cannot see an agent's files,
  and ADR-0025 makes the application the author of the eve agent, so the application is the only
  party that can read `agent/instructions.md`, `agent/skills/` and the authored model
  configuration. The model configuration is extracted into `agent/lib/`, which eve's own slot table
  documents as the import-only shared-helper slot, so `agent/agent.ts` and `src/behavior.ts` read
  one constant instead of two copies that drift.

### Work completed

- (in progress)

### Files changed

- (in progress)

### Verification

- (pending)

### Decisions / deviations

- (pending; ADR-0034)

### Known issues / blockers

- None yet.

### Next exact step

Implement `packages/core/src/behavior.ts`, wire it through `defineDomain()` and `createHarness()`,
and give the example app a real descriptor.

## 2026-09-19 22:31 — M2-T9 — Secret and sensitive-data redaction

**Status:** started
**Actor/session:** coding agent (Claude Opus 5, M2-T9 implementation session)
**Commit:** `62548d6`

### Goal

Redact before persistence. Build the four mechanisms M2-T9 names — field-path redaction,
secret-pattern redaction, headers redaction and tool-specific sanitizer hooks — as a pure redactor
over the JSON value model plus a `TraceWriter` decorator placed ahead of the buffered writer, so
nothing buffers or persists an unredacted event. Prove M2's acceptance criterion "seeded secrets
never appear in stored trace payloads" with fake secrets seeded through a real `createHarness()`
run and through a JSONL round trip.

### Implementation references

- package/version: no new dependency. `@internal/trace` depends on `@internal/core` only and uses
  Node built-ins, unchanged.
- installed docs read: `.secretlintrc.json` (`@secretlint/secretlint-rule-preset-recommend@13.0.5`,
  the only configured rule), `.secretlintignore`, `.husky/pre-commit` (how staged paths reach
  `secretlint --no-glob`), so seeded fake secrets in tests do not block a commit.
- official docs/repos/examples read, for the token formats the default pattern set claims:
  - Supabase, <https://supabase.com/docs/guides/getting-started/api-keys> and
    <https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys> — secret keys have
    the form `sb_secret_…` and replace the legacy `service_role` key (itself a JWT).
  - Supabase, <https://supabase.com/docs/guides/platform/personal-access-tokens> — personal access
    tokens start with `sbp_`.
  - Vercel, <https://vercel.com/docs/ai-gateway/authentication-and-byok/api-keys> — AI Gateway API
    keys have the prefix `vck_`, which is the format `AI_GATEWAY_API_KEY` carries.
- public types/exports inspected: `packages/core/src/json.ts` (`JsonValue`, `JsonObject`,
  `isJsonObject`), `packages/core/src/trace.ts` (`TraceEvent`, `TraceWriter`, `TraceRecorder`),
  `packages/core/src/errors.ts` (`SerializedHarnessError`, `ValidationError`),
  `packages/trace/src/{buffered-trace-writer,sink,jsonl-sink}.ts`,
  `packages/runtime-eve/src/eve-agent-runtime.ts` (`tool.*` payloads carry the tool name at
  `payload.tool`, which is the key a sanitizer hook matches on).
- selected documented pattern: none imposed by a framework. Redaction is harness-owned; the design
  is recorded in ADR-0035.

### Work completed

- (in progress)

### Files changed

- (in progress)

### Verification

- (in progress)

### Decisions / deviations

- (in progress)

### Known issues / blockers

- None yet.

### Next exact step

Implement `packages/trace/src/redaction.ts` and `redacting-trace-writer.ts`, wire
`apps/example-agent/src/run.ts`, then verify.

## 2026-09-19 22:45 — M2-T11 — Reproducible local Supabase environment

**Status:** completed
**Actor/session:** coding agent (Claude Opus 5, implementer subagent, concurrent M2 session)
**Commit:** `62548d6`

### Goal

As in the `started` entry at 22:30: a local Supabase reproducible from the repository alone, with
the CLI pinned as a project dev dependency, the four lifecycle scripts, the
`packages/storage-supabase` scaffold holding the generated types, a CI drift gate, and the
documentation to operate it. Gates M2-T5 through M2-T10.

### Implementation references

As recorded in the `started` entry at 22:30 (`supabase@2.117.0`, the installed CLI's help surface
for `init`/`start`/`stop`/`db reset`/`gen types`/`status`, the generated `config.toml` port map,
the eve port comparison, and the ignore-file survey). Three of the four open questions that entry
listed are now answered by execution rather than by reading:

- **`gen types` against zero migrations** emits a complete, valid module: `Json`, a `Database` type
  with empty `graphql_public` and `public` schemas, the `Tables`/`TablesInsert`/`TablesUpdate`/
  `Enums`/`CompositeTypes` helper types, and `Constants`. Nothing about it is conditional on tables
  existing, so the committed file is meaningful before M2-T6 writes a migration.
- **Its log output goes to stderr**, not stdout: the redirected file contains only TypeScript.
  (`Connecting to db 5432` and a `MaxListenersExceededWarning` from the CLI appear on the terminal
  and not in the file.)
- **Biome's formatter rejects the generated file** (the generator omits statement-terminating
  semicolons); Biome's linter accepts it. Hence a `formatter: { enabled: false }` override for
  that one path rather than a whole-file exclusion.

### Work completed

- **Pinned the CLI.** `supabase@2.117.0` added to the root `devDependencies`, exact, installed with
  `pnpm install`. The release-age gate did not trigger (`Lockfile passes supply-chain policies`)
  and nothing was appended to `minimumReleaseAgeExclude`, so `pnpm-workspace.yaml` is **unchanged**
  by this task. No `onlyBuiltDependencies` entry was needed either: 2.117.0 ships its platform
  binary as an optional dependency, not as a postinstall download, so pnpm 12's blocked lifecycle
  scripts do not affect it.
- **Extended ADR-0024's mechanism to it.** `tests/toolchain/supabase-cli-pin.test.ts` reads the
  pinned string from the root manifest and the `version` from the installed
  `supabase/package.json`, both from disk with no literal, and asserts they agree; asserts the pin
  carries no range operator; and asserts the four scripts still wrap the four CLI commands
  verbatim. It lives under `tests/toolchain/` rather than co-located because the dependency it
  guards is the root's.
- **Initialized the repository-local config.** `pnpm exec supabase init`, non-interactively (`-i`
  is what generates editor settings and was not used), producing `supabase/config.toml` and the
  CLI's own `supabase/.gitignore`. `project_id` defaulted to the working-directory name,
  `adaptive-agent-harness`, which is exactly the stable value wanted, so the file is committed at
  the CLI's defaults with nothing edited. Added `supabase/migrations/README.md` (what the directory
  is for, how to create a migration, why it is empty until M2-T6) and `supabase/seed.sql` (header
  comment only).
- **Added the four scripts** to the root `package.json`: `supabase:start`, `supabase:stop`,
  `supabase:reset`, and `supabase:types` with the stdout redirection the CLI forces.
- **Scaffolded `packages/storage-supabase`** (`@internal/storage-supabase`, private, on the
  `packages/trace` template: the `@internal/source` export condition, both tsconfigs,
  `build`/`dev`/`typecheck`, `@internal/core` as its only dependency and `vitest` as a
  devDependency). `src/index.ts` re-exports the generated `Database` type and nothing else, with a
  header saying M2-T5 adds the adapter. `@supabase/supabase-js` deliberately **not** installed.
- **Generated and committed `src/database.types.ts`**, unmodified output of `pnpm supabase:types`.
- **Biome override.** `biome.json` gained an `overrides` entry disabling the formatter for
  `packages/storage-supabase/src/database.types.ts`. Configuration, not a hand edit of generated
  source; linting still applies and passes.
- **CI drift gate.** A second job, `supabase-types`, in `.github/workflows/ci.yml`: checkout, the
  existing pnpm/Node setup, `pnpm install --frozen-lockfile`, start, reset, regenerate,
  `git diff --exit-code` on the one generated path, and stop with `if: always()`. The `check` job
  is untouched. The YAML was parsed with the repository's own `yaml` dependency to confirm it is
  valid and that both jobs are present.
- **Ignore rules.** Root `.gitignore` gained `supabase/.temp/`, `supabase/.branches/`, `.env.local`
  and `.env*.local`. The CLI's own `supabase/.gitignore` already covers the first three; the root
  entries exist so the rule survives that file being regenerated, and so the whole policy is
  readable in one place.
- **Documentation.** New runbook `docs/runbooks/supabase-local.md` (the four commands, the
  schema-change routine, the reproducibility sequence, the port table, key capture, and five
  failure modes: Docker down, port in use, wedged stack, truncated generated file, CI-only drift),
  registered in `docs/runbooks/README.md` and removed from that file's "later milestones must add"
  list. `docs/development/local-setup.md` gained a "Docker, for the local database" section and
  lost its stale "Milestone 0 needs no Docker" framing. `docs/development/commands.md` gained the
  four scripts, the two new packages in the per-package table, the `supabase-types` CI job, and a
  runbook cross-reference. `docs/architecture/system-map.md` gained prose for
  `packages/storage-supabase` and the `supabase/` directory, flipped that package's status row from
  "planned (M2)", and added both to its frontmatter.
- **ADR-0033**, `docs/decisions/0033-supabase-cli-as-a-pinned-dev-dependency-with-reset-as-the-reproducibility-gate.md`,
  indexed in `docs/decisions/README.md` with a summary paragraph.
- **Milestone status.** `docs/milestones/m2-job-trace-supabase-and-run-ledger.md`: the `### M2-T11`
  subsection marked completed with a `**Result.**` paragraph, and the two `pnpm supabase:*`
  acceptance bullets moved from "not yet verified" to a dated verified note.

### Files changed

- `package.json` — `supabase@2.117.0` devDependency; four `supabase:*` scripts.
- `pnpm-lock.yaml` — regenerated.
- `biome.json` — `overrides` entry disabling the formatter for the generated types file.
- `.gitignore` — Supabase and `.env*.local` entries.
- `.github/workflows/ci.yml` — new `supabase-types` job; `check` untouched.
- `supabase/config.toml`, `supabase/.gitignore` — written by `supabase init` (new).
- `supabase/migrations/README.md`, `supabase/seed.sql` — new.
- `packages/storage-supabase/package.json`, `tsconfig.json`, `tsconfig.build.json`,
  `src/index.ts` — new.
- `packages/storage-supabase/src/database.types.ts` — new, **generated**.
- `tests/toolchain/supabase-cli-pin.test.ts` — new.
- `tests/architecture/package-boundaries.test.ts` — `@internal/storage-supabase` added to the
  workspace-discovery assertion. `tests/architecture/boundaries.ts` needed **no** change.
- `docs/decisions/0033-...md` (new), `docs/decisions/README.md`,
  `docs/runbooks/supabase-local.md` (new), `docs/runbooks/README.md`,
  `docs/development/local-setup.md`, `docs/development/commands.md`,
  `docs/architecture/system-map.md`,
  `docs/milestones/m2-job-trace-supabase-and-run-ledger.md` (M2-T11 subsection and the two
  supabase acceptance bullets only), `docs/progress/WORKLOG.md`.

### Verification

Reproducibility sequence, against real Docker:

- `pnpm exec supabase --version` — PASS, `2.117.0`.
- `pnpm supabase:start` — PASS, exit 0. First run pulled about a dozen images; the stack came up
  and printed its URLs and keys (not recorded anywhere, deliberately).
- `pnpm supabase:reset` — PASS, exit 0, from an empty database: `Recreating database...`,
  `Initialising schema...`, `Seeding globals from roles.sql...`, `Seeding data from
  supabase/seed.sql...`, `Finished supabase db reset on branch main.` Zero migrations applied, as
  expected before M2-T6. Run twice, both PASS.
- `pnpm supabase:types` — PASS, exit 0, writing a complete module. `sha256` of the result:
  `5e938e4dc93aeb63e1e38a653fbd68250467896ed1eafef9c1dc97939fc2ea0c`.
- **Determinism** — PASS. Snapshot the generated file, run a second full `pnpm supabase:reset`,
  regenerate, compare: identical `sha256`, and `git diff --no-index --exit-code` between the two
  exits 0 with no output. (`--no-index` because the file is not yet committed; the CI job uses the
  plain `git diff --exit-code` form against the committed file.)
- `pnpm supabase:stop` — PASS, exit 0, `Stopped supabase local development setup.`
  `docker ps` afterwards lists nothing. **Supabase is left stopped.**
- `node -e "require('yaml').parse(...)"` on `.github/workflows/ci.yml` — PASS: jobs
  `[check, supabase-types]`, nine steps on the new job, ten still on `check`.
- `git check-ignore -v .env.local supabase/.temp/cli-latest supabase/.branches
  apps/x/.env.development.local` — PASS, all four ignored.

Repository gates:

- `pnpm typecheck` — PASS. 8 packages including `@internal/storage-supabase`, plus the root.
- `pnpm build` — PASS. 8 packages.
- `pnpm test` — PASS. **676 tests across 39 files**, all four projects.
- `pnpm exec vitest run --project unit tests/` (this task's own suites) — PASS, 22 tests, 3 files.
- `pnpm exec biome format` over every file this task touched — PASS.
- `pnpm example:run:mock` — PASS, exit 0, `"status": "completed"`, trace written to
  `apps/eve-fixture-agent/.harness/traces/01a0bcad-f497-7000-97c8-2a8b4ab02f93.jsonl`.
- **`pnpm check` — FAIL**, at stage 1 (`format:check`), for reasons entirely outside this task.
  `biome format` reports five unformatted files and `biome lint` two import-order fixes, all of
  them files owned by the concurrent M2-T8 and M2-T9 work in the same tree:
  `packages/core/src/behavior.ts`, `packages/core/src/behavior.test.ts`,
  `packages/core/src/harness.test.ts`, `packages/trace/src/secret-patterns.ts`,
  `packages/trace/src/redaction.test.ts`, `packages/trace/src/redacting-trace-writer.ts` and
  `apps/example-agent/src/behavior.ts`. Re-run once after the first observation; the list had grown
  rather than shrunk, which is what an actively-edited tree looks like. Every file this task
  touched passes both gates, and every other stage of `pnpm check` (typecheck, test, build) passes
  over the whole workspace. The orchestrator should re-run `pnpm check` once M2-T8 and M2-T9 land.

### Decisions / deviations

All recorded in **ADR-0033**. The ones that are deviations from the task brief rather than
restatements of it:

- **No hand-written header on the generated file**, although the brief asked for one if the
  generator omits one. It does omit one, and adding it by hand would be self-defeating: the next
  `pnpm supabase:types` deletes it, and the `supabase-types` job then reports drift on a file
  nobody touched. Making the script prepend the header instead was rejected because it would stop
  the script being the verbatim wrapper the build plan specifies and the pin test asserts. The
  "generated, never hand-edit" statement therefore lives in AGENTS.md rule 12,
  `packages/storage-supabase/src/index.ts`, the runbook and the ADR.
- **`pnpm supabase:types` uses shell redirection**, because `supabase gen types` in 2.117.0 has no
  output-file flag. The brief allowed this and preferred a flag; there is none. The consequence, a
  failed generation truncating the committed file, is stated in the ADR's Negative consequences,
  in the commands table, and as a runbook failure mode.
- **`supabase/migrations/` holds a `README.md`, not a `.gitkeep`.** Both were measured and both
  make the CLI print `Skipping migration <name>... (file name must match pattern
  "<timestamp>_name.sql")` on every start and reset, so the noise is not avoidable by naming. The
  README was kept because it is worth more than one informational line, and the runbook explains
  the message and when to take it seriously.
- **`tests/architecture/package-boundaries.test.ts` was edited**, which the brief scoped to
  `boundaries.ts` only. `boundaries.ts` genuinely needed nothing: `@internal/storage-supabase` was
  already in `adapterPackages` and `@supabase/*` already in `adapterOnlyDependencies`. But the test
  file carries an explicit list of every workspace package, which exists so a new package cannot be
  silently ungoverned, and it failed until the new name was added. One entry, with a comment.
- **`pnpm-workspace.yaml` is unchanged.** The brief anticipated a `minimumReleaseAgeExclude` entry;
  the gate did not trigger, so adding one would have been a stale record of nothing.
- **The `-o env` capture uses `--override-name`.** `supabase status -o env` emits `API_URL`,
  `ANON_KEY` and `SERVICE_ROLE_KEY`, which are not the names `.env.example` already declares. The
  runbook's documented command maps them onto `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_DB_URL`, verified to work against the running stack.
  It also warns that `>` would clobber the AI Gateway credential `eve link` writes to the same
  file.

### Known issues / blockers

- **`pnpm check` fails on other agents' in-flight files** (detail under Verification). Not caused
  by and not fixable from this task.
- **AGENTS.md needs four edits this task is not permitted to make**, listed for the orchestrator:
  the Commands table needs the four `supabase:*` rows; the repository-layout tree needs
  `packages/storage-supabase/` and a root `supabase/` entry, both moved out of the "planned" block;
  the ADR paragraph needs ADR-0033 described and "next free number" advanced; and the "Local
  persistence" / Docker prerequisite wording could note that Docker is now required for M2 work.
- The M2 status file's **top-level `**Status:**` line** still says M2-T11 is `in_progress`. The
  brief scoped this task to the `### M2-T11` subsection and the two acceptance bullets, so that
  line was deliberately left for the orchestrator, which also has to reconcile M2-T8's and M2-T9's
  states in the same line.
- The CI `supabase-types` job has **never run**: it is new, and the first execution will be on the
  next push. Its steps were verified locally one by one, and the YAML parses.
- `supabase/config.toml` is committed at 2.117.0's defaults. A CLI upgrade may rewrite parts of it;
  under ADR-0033 that upgrade is its own task with its own source-of-truth checkpoint.

### Next exact step

**M2-T5, Supabase schema.** The environment it needs now exists. Design the fourteen tables the
build plan lists, with stable indexed metadata in columns and versioned payloads in JSONB; decide
whether `@internal/storage-supabase` declares `@supabase/supabase-js`; and decide when an attempt
becomes a row, the question `TraceEvent.attempt` leaves open. M2-T6 then writes the migrations,
after which `pnpm supabase:reset && pnpm supabase:types` produces a `database.types.ts` with real
tables in it, and the `supabase-types` CI job starts earning its runtime. Start with:

```bash
pnpm supabase:start && pnpm supabase:reset
```

## 2026-09-19 22:46 — M2-T9 — Secret and sensitive-data redaction

**Status:** completed
**Actor/session:** coding agent (Claude Opus 5, M2-T9 implementation session)
**Commit:** `62548d6`

### Goal

As in the `started` entry above: the four redaction mechanisms M2-T9 names, applied before
anything buffers or persists a trace event, with M2's "seeded secrets never appear in stored trace
payloads" proven rather than asserted.

### Implementation references

As recorded in the `started` entry above, unchanged. No new dependency: `@internal/trace` still
depends on `@internal/core` only. The token formats the default pattern set claims were verified
against Supabase's "API keys" and "Personal Access Tokens" guides (`sb_secret_…`, `sbp_…`) and
Vercel's AI Gateway "API Keys" page (`vck_…`); `.secretlintrc.json` (the recommended preset at
13.0.5) and `.husky/pre-commit` were read so the seeded fakes cannot block a commit.

### Work completed

- **`packages/trace/src/redaction.ts`**, the pure redactor: `RedactionPolicy`,
  `createRedactor(policy?)` with `redactValue(value, path?)`, `redactEvent(event)` and
  `redactEvents(events)`, plus `DEFAULT_REDACTION_POLICY`, `createRedactionPolicy(overrides)`, the
  token constants and `redactionToken(name)`.
  - **Field paths** are a glob over the JSON tree: literal segments, `*` for exactly one segment,
    `**` for any number including none, array indices as segments, literal comparison
    case-insensitive by default with `caseSensitive: true` per rule. A match replaces the value
    whatever its type. Eighteen default rules covering the camel and snake spelling of `api-key`,
    `access-token`, `refresh-token`, `session-token`, `client-secret`, `private-key`,
    `service-role-key`, `password`, `secret`, `credentials` and `token`.
  - **Headers**: `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`,
    `x-auth-token`, `x-supabase-auth`, `apikey`, matched case-insensitively under any object whose
    own key is `headers`, at any depth. The header rule wins over a field-path rule inside a
    `headers` object, so a redacted header always reports itself as one.
  - **Tool sanitizers**: `{ toolId, sanitize(payload, event) }`, matched against `payload.tool` on
    a `tool.*` event, run before the generic rules with their output still put through them, and
    rejected with a `ValidationError` if they return something JSON cannot represent.
  - Scope: `payload`, and an error's `message`, `details`, `stack` and whole `cause` chain.
    `name`/`code` and every identity, ordering and usage field pass through. A new frozen event is
    returned and the input is neither mutated nor frozen.
- **`packages/trace/src/secret-patterns.ts`**, the documented default pattern set as
  `DEFAULT_SECRET_PATTERN_RULES`: `private-key-block`, `aws-access-key-id`, `github-token`,
  `slack-token`, `supabase-secret-key`, `supabase-access-token`, `vercel-ai-gateway-key`,
  `api-key-sk-prefix`, `jwt`, `authorization-bearer`, `authorization-basic`. Each replaces only the
  span it matched; the two `Authorization` rules use a lookbehind so the scheme word survives.
- **`packages/trace/src/redacting-trace-writer.ts`**: `createRedactingTraceWriter({ writer,
  policy? })`, the `TraceWriter` decorator, placed above the buffered writer.
- **`apps/example-agent/src/run.ts`**: the writer construction now reads
  `createRedactingTraceWriter({ writer: createBufferedTraceWriter({ sink: traces }) })`. Only the
  import, that expression and one line of the file's header comment changed.
- Docs: new `docs/contracts/redaction.md`; a Redaction section and an updated M2-T9 open item in
  `docs/contracts/trace-event.md`; a "redaction happens in the trace pipeline" note and updated
  open item in `docs/contracts/errors.md`; a row and an updated summary in
  `docs/contracts/README.md`; the package row and a new source-file bullet in
  `docs/architecture/system-map.md`; **ADR-0035** plus its index row and paragraph in
  `docs/decisions/README.md`; the M2-T9 result and the seeded-secrets acceptance bullet in the M2
  status file.

### Files changed

- `packages/trace/src/redaction.ts` (new), `secret-patterns.ts` (new),
  `redacting-trace-writer.ts` (new), `redaction.test.ts` (new),
  `redacting-trace-writer.test.ts` (new), `index.ts` (exports).
- `apps/example-agent/src/run.ts` (writer construction and its import).
- `docs/contracts/redaction.md` (new), `trace-event.md`, `errors.md`, `README.md`;
  `docs/architecture/system-map.md`;
  `docs/decisions/0035-redaction-is-a-trace-writer-decorator-placed-before-buffering.md` (new),
  `docs/decisions/README.md`;
  `docs/milestones/m2-job-trace-supabase-and-run-ledger.md` (M2-T9 subsection and one acceptance
  bullet); `docs/progress/WORKLOG.md`.

### Verification

- `pnpm vitest run --project unit packages/trace` — PASS (77 tests across 4 files, up from 23
  across 2; +54 tests, +2 files).
- `pnpm exec secretlint --no-glob -- packages/trace/src/redaction.test.ts
  packages/trace/src/redacting-trace-writer.test.ts packages/trace/src/redaction.ts
  packages/trace/src/secret-patterns.ts packages/trace/src/redacting-trace-writer.ts
  packages/trace/src/index.ts` — PASS (exit 0). No secretlint configuration was changed.
- `pnpm typecheck` — PASS (8 tasks).
- `pnpm test` — PASS (691 tests across 40 files).
- `pnpm build` — PASS (8 tasks).
- `pnpm check:handoff` — PASS.
- `pnpm example:run:mock` — PASS, exit 0, `"status": "completed"`, trace at
  `apps/eve-fixture-agent/.harness/traces/01a0bcaf-d0b3-7001-ae58-35caae7a52ff.jsonl`: six lines,
  sequences 0 to 5, the same types and payload keys as before redaction was wired, and
  `grep -c "\[REDACTED" ` returns **0** — adapter payloads are identity-only, so there is nothing
  for the redactor to remove and it removes nothing.
- `pnpm check` — **FAIL**, at its first stage (`format:check`) and again at `lint`, in four files
  belonging to the concurrent M2-T8 task and none of this task's:
  `packages/core/src/behavior.ts`, `packages/core/src/behavior.test.ts`,
  `packages/core/src/harness.test.ts` and `apps/example-agent/src/behavior.test.ts` are
  unformatted, and `apps/example-agent/src/behavior.ts` and `behavior.test.ts` need import
  organisation. Re-run after M2-T8 lands. Every other stage of the gate passes, and every file
  this task touched passes `biome check`.

### Decisions / deviations

All recorded in **ADR-0035**. The ones that are deviations from the task brief rather than
restatements of it:

- **The end-to-end acceptance test uses local test doubles rather than
  `createFakeAgentRuntime`/`createRecordingTraceWriter` from `@internal/testing`.** The brief
  allowed adding the workspace devDependency; it was not added. Doing so means editing
  `packages/trace/package.json` and the root `pnpm-lock.yaml` while M2-T11 is installing into the
  same lockfile, and it would make a package whose stated claim is "no dependency but
  `@internal/core`" depend on a second one. `packages/core/src/harness.test.ts` already sets the
  precedent of local doubles, for a related reason. The doubles are about sixty lines and the
  coverage is unchanged: a real `createHarness()`, a real recorder, the real redacting writer, the
  real buffered writer and both an in-memory sink and a JSONL file on disk.
- **`sbp_` (Supabase personal access token) and `vck_` (Vercel AI Gateway) are in the default
  pattern set**, because both formats are documented; the brief left both conditional on
  verification. `sb_secret_` is used rather than a guessed service-role prefix, and the legacy
  `service_role` key is a JWT and is caught by the `jwt` rule.
- **The `Bearer`/`Basic` rules use a lookbehind** so the scheme word survives and only the
  credential is replaced, and they require a 16-character minimum (plus mixed case for `Basic`) so
  that prose like "Bearer token missing" and "Basic authentication required" does not match. Both
  false positives were found while writing the tests and both are now regression-tested.
- **Inside a `headers` object the header rule wins over a field-path rule.** Without the tie-break,
  the default `**.authorization` rule would label a redacted `Authorization` header
  `[REDACTED:authorization]` in one place and `[REDACTED:header]` in another.
- **A field-path rule matching `payload` or an error's `details` whole nests the token under
  `redacted`** (`REDACTED_VALUE_KEY`), because both positions are typed as objects and a string
  cannot go there. Named in ADR-0035's negative consequences as the wart it is.
- **`docs/architecture/runtime.md` was not edited.** It documents the eve adapter and its
  event-to-trace mapping; it does not describe the writer chain, so there was nothing there to
  correct. The chain is documented in `docs/contracts/trace-event.md`,
  `docs/contracts/redaction.md` and `docs/architecture/system-map.md`.
- **A `strict: false`-style escape hatch is deliberately absent**, as the brief asked, and
  `createRedactionPolicy()` concatenates onto the defaults rather than replacing them.

### Known issues / blockers

- `pnpm check` is red on M2-T8's four files, as recorded above. Nothing this task owns is involved.
- **Redaction is a safety net, not the boundary.** ADR-0031's identity-only payload rule is still
  what keeps content out of a trace; nothing here licenses widening a payload. The acceptance test
  deliberately violates that rule inside a fake runtime to prove the net catches something.
- **The default field-path set is a list of spellings.** A new one (`apiSecret`, say) is a rule
  someone has to add; matching substrings of key names instead would fire on `tokenCount`.
- **The `token` field-path rule is broad** and would redact a payload field called exactly `token`
  that was not a credential.
- No verification against a real database yet: M2-T5's Supabase sink does not exist, so "stored"
  means the in-memory sink and the JSONL file. The batch helper `redactEvents()` is exported for
  that sink to re-apply when it lands.

### Next exact step

M2-T5 (Supabase schema) adds the `trace_events` table and a Supabase `TraceSink` in
`packages/storage-supabase`, behind the same `createBufferedTraceWriter()` and therefore behind the
same redacting writer. It should call `redactEvents()` on its batch as well, belt and braces, and
re-verify the seeded-secret acceptance criterion against a real row. M2-T11 (local Supabase) must
land first.

## 2026-09-19 22:58 — M2-T8 — Behavior fingerprint

**Status:** completed
**Actor/session:** coding agent (Claude Opus 5, implementer subagent under a Fable orchestrator)
**Commit:** `62548d6`

### Goal

As in the `started` entry above: fill `TraceEvent.behaviorFingerprint` with a real `sha256:` digest
over the canonicalized behavior-affecting inputs, and satisfy the M2 acceptance criterion
"Behavior fingerprint changes when instructions/SOP/policy changes".

### Implementation references

Unchanged from the `started` entry: `eve@0.63.0`'s installed `docs/skills.mdx`,
`docs/reference/agent-files.md` and `docs/agent-config.md`; `packages/core/src/fingerprint.ts`,
`capabilities.ts`, `trace.ts`, `harness.ts`, `domain.ts`, `json.ts`.

Two facts from the installed eve docs decided real design points rather than only informing them:

- `docs/reference/agent-files.md` lists `lib/` as "Shared authored helper code … Import-only; not
  copied into the sandbox", which is what makes the shared model-configuration constant a
  documented pattern rather than a liberty taken with eve's authored tree.
- the same file's "Naming from paths" table (`agent/skills/summarize.md` resolves to skill
  `summarize`) plus `docs/skills.mdx`'s packaged `SKILL.md` layout are what the example's skill
  loader implements, so a descriptor's skill ids are the ids eve itself resolves.

### Work completed

- **`packages/core/src/behavior.ts` (new).** `BehaviorDescriptor` with one field per input the
  build plan lists, `createBehaviorFingerprint()` returning one `sha256:` digest per component plus
  the composite, `resolveBehaviorFingerprint()`, `behaviorFingerprintPayload()`,
  `behaviorFingerprintsMatch()` and `diffBehaviorComponents()`. Built on ADR-0029's
  `fingerprint()`; nothing about the digest changed.
- **`domain.ts`.** `DefineDomainConfig`/`DomainDefinition` gained an optional `behavior` source,
  validated for shape and carried through unchanged.
- **`harness.ts`.** Resolution before `run.started`; the composite passed to
  `createTraceRecorder`; `behaviorFingerprint` on the `HarnessRunResult` base so all three variants
  carry it; the component digests written into the `run.started` payload.
- **`apps/example-agent`.** `agent/lib/agent-config.ts` (new) holds the authored runtime
  configuration, `agent/agent.ts` passes it to `defineAgent`, `src/behavior.ts` (new) gathers the
  real descriptor and `src/domain/index.ts` declares it. The policy's threshold became an exported
  constant the function itself reads, so the value fingerprinted is the value enforced.
- **Docs.** New `docs/contracts/behavior-fingerprint.md` (registered in the contracts README),
  ADR-0034, and updates to `capability-registry.md`, `harness.md`, `domain-definition.md`,
  `trace-event.md` (its `behaviorFingerprint` field row and M2-T8 open-item line only) and
  `docs/architecture/system-map.md`.

### Files changed

- `packages/core/src/behavior.ts`, `behavior.test.ts` (new)
- `packages/core/src/domain.ts`, `domain.test.ts`
- `packages/core/src/harness.ts`, `harness.test.ts`
- `packages/core/src/index.ts`
- `apps/example-agent/agent/lib/agent-config.ts` (new)
- `apps/example-agent/agent/agent.ts`
- `apps/example-agent/src/behavior.ts`, `src/behavior.test.ts` (new)
- `apps/example-agent/src/domain/index.ts`
- `apps/example-agent/src/policies/no-proceed-with-open-risk-flags.ts`
- `docs/contracts/behavior-fingerprint.md` (new), `docs/contracts/README.md`,
  `capability-registry.md`, `harness.md`, `domain-definition.md`, `trace-event.md`
- `docs/decisions/0034-behavior-fingerprint-is-component-wise-and-supplied-by-the-domain.md` (new),
  `docs/decisions/README.md`
- `docs/architecture/system-map.md`
- `docs/milestones/m2-job-trace-supabase-and-run-ledger.md` (the M2-T8 subsection and its one
  acceptance bullet)

### Verification

- `pnpm vitest run --project unit packages/core apps/example-agent` — PASS (477 tests, 22 files).
- `pnpm check` — PASS (691 tests across 40 files; format, lint, typecheck, test, build,
  check:handoff), run after the concurrent M2-T9 and M2-T11 work had landed in the same tree.
- `pnpm example:run:mock` — PASS, exit 0, `"status": "completed"`. All six events of
  `apps/eve-fixture-agent/.harness/traces/01a0bcaf-7770-7000-88b4-f95db68b56c2.jsonl` carry the
  same non-null `sha256:c0ab81341295c36655b5c4614d9352bd29deec74c7d75f65c82b8dd33f0f8c2d`, and
  `run.started` carries all eight component digests. First line:

  ```json
  {"attempt":1,"behaviorFingerprint":"sha256:c0ab81341295c36655b5c4614d9352bd29deec74c7d75f65c82b8dd33f0f8c2d","error":null,"id":"01a0bcaf-7772-7000-bc45-2ca989646249","latencyMs":null,"node":null,"parentId":null,"payload":{"attempt":1,"behavior":{"algorithm":"sha256","components":{"instructions":"sha256:d57880944e71ac43a61c6b749e702f0067256c4ceaa14d9cb4b9691569977070","model":"sha256:fad1b415f49984cc1802629c9ff6688ab85a85ff949b5c4db49b0a5abde39b1b","policy":"sha256:a8b6b14f75fb81d9144f6182f1d94210e2e4af7afc38870b62c7632171f3ab7a","schemas":"sha256:11a3258dbc9b7351c6df986de2b7b4a96bb6c11ec14605db154082e6062f9f3d","skills":"sha256:d46c489df163105874be323e980c7c9f9dcda8700b7ddba0e884b44cf33266e7","sop":"sha256:720f6cb18cc5ec619ed0f92da4dbd30930c0b2cf174a4a3b0f18b0f25599431f","tools":"sha256:021f9fa5a44613ec60d139d04ca046c1be21f96cc6a19f2b1d11d2238796fdba","workflowIr":"sha256:74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b"},"scheme":1},"domain":"vendor-triage","domainVersion":"1.0.0","jobId":"01a0bcaf-776f-7000-ba89-47d1827f526f","jobType":"vendor-triage"},"runId":"01a0bcaf-7770-7000-88b4-f95db68b56c2","sequence":0,"timestamp":"2026-09-20T02:40:11.122Z","type":"run.started","usage":null,"version":1}
  ```

- **The acceptance criterion, end to end** — PASS. One line appended to
  `apps/example-agent/agent/instructions.md`, then `pnpm example:run:mock` again: the composite
  moved to `sha256:c9b02cd6d1b4436ba06eacb575af5589c61214108282fac2b7167d8a4f465e35`, the
  `instructions` component moved to `sha256:f5efab73610e6ae1044664308daab599da84f4d45d1db6692ba551c43d8a0cb3`,
  and `sop` stayed `sha256:720f6cb1…`. The edit was reverted with
  `git checkout -- apps/example-agent/agent/instructions.md`, and a third run returned the
  composite to `sha256:c0ab8134…`, which is also the evidence that the revert was complete.

### Decisions / deviations

All recorded in **ADR-0034**. The ones that are choices rather than restatements of the task brief:

- **`BehaviorFingerprint` carries a `scheme` number, and it is hashed into the composite.** The
  brief sketched `{ fingerprint, components, algorithm }`. Adding, removing or redefining a
  component changes what a composite means, and the `sha256:` prefix cannot signal that because the
  algorithm would be unchanged. Hashing the scheme makes such a change move every composite at once
  and say why, while leaving the component digests comparable across it.
- **The example's `model` component is the whole authored agent configuration**, not only the model
  id. eve's `defineAgent` also takes `reasoning`, `compaction`, `limits` and `defaultTools`, all
  behavior-affecting; hashing the constant `agent.ts` actually passes means setting one of them is
  fingerprinted immediately rather than after someone remembers to widen the descriptor.
- **The shared constant is `agent/lib/agent-config.ts`, not `agent/lib/model-config.ts`**, for the
  same reason: it is the agent's configuration, and naming it after the model would misdescribe it.
- **`src/behavior.ts` reads eve's version from `eve/package.json` rather than importing
  `@internal/runtime-eve`.** Importing the adapter for one constant would pull `eve` into every
  module that imports the domain, including the fake-runtime unit tests, and `src/domain/index.ts`
  has imported only `@internal/core` since M1. Reading a declared export-map subpath is the same
  technique `eveVersion()` and `src/dependency-pins.test.ts` already use.
- **The example's skill loader throws on a file it cannot read** (a `defineSkill` module) rather
  than skipping it. A skill silently missing from the descriptor is a behavior change the
  fingerprint would miss, which is the failure mode this task exists to prevent; refusing to start
  the run is the recoverable direction.
- **`harness.run()` now throws in a second case.** A `behavior` loader that throws, or a descriptor
  `createBehaviorFingerprint` rejects, propagates rather than degrading to `null`. It belongs with
  input validation: both happen while the run is being prepared, so nothing has been spent and
  there is no run to report against. Recording the run with a `null` fingerprint would manufacture
  the unfingerprinted run invariant 4 forbids at the moment the system already knows something is
  wrong.
- **The per-run budget is deliberately not a policy threshold.** A caller can override a budget per
  run, so including it would report two runs of one behavior as two behaviors. The job records it.
- **ADR-0032's open question is closed rather than left open.** `Job.contracts.sop` stays a bare,
  unversioned identifier: the content digest is the version, and a hand-maintained version field is
  the one that goes stale silently. `JobContracts` is unchanged.
- **One unrelated one-line fix in a file this task already edited:** `docs/decisions/README.md`'s
  index table had no row for ADR-0032 (an M2-T2 omission; the prose paragraph was there). Added
  alongside the 0034 row rather than left inconsistent in the table being edited.

### Known issues / blockers

- **A mock run's fingerprint describes the example agent, not the fixture agent.** `src/run.ts`
  runs one domain against either target and the descriptor belongs to the domain. Acceptable for a
  credential-free smoke path; **M2-T5's run ledger should record which target ran**. Recorded as an
  open question in ADR-0034.
- **A domain's descriptor is only as complete as the domain makes it.** Nothing can check that an
  application declared everything its behavior depends on. A future `@internal/runtime-eve` helper
  that builds a descriptor from an eve project's authored slots is the obvious mitigation; not
  built, because one worked example is not yet a pattern.
- **The example re-reads its authored files on every run**, deliberately, so an edit between two
  runs shows up. A domain with many or large skills will want a cache, and the invalidation rule is
  undecided.
- `pnpm example:run` against a live Gateway model is still unverified here: no credential.

### Next exact step

M2-T5's Supabase schema should persist `behavior_fingerprint` per trace event and carry the
component digests plus **which target ran** on the run row, which is the one open question this
task recorded rather than answered.

## 2026-09-19 23:05 — M2-T5, M2-T6, M2-T7 — Storage port, Supabase schema and migrations, outcome ledger

**Status:** started
**Actor/session:** coding agent (Claude Opus 5, 1M context), delegated by the Fable orchestrator
**Commit:** `1b16a1a`

### Goal

Give the harness durable persistence: a `Storage` port in `@internal/core` that `createHarness()`
talks to, the thirteen-table Supabase schema behind it as committed SQL migrations, and the
outcome ledger as one query-friendly row per run. Three build-plan tasks, done together because
they are one storage design: the port's shape, the tables it writes and the ledger columns are not
separable decisions.

### Implementation references

- **package/version:** `@supabase/supabase-js@2.116.0`, installed into
  `packages/storage-supabase` only, pinned exact (no range). Published 2026-09-07, twelve days
  before this install, so pnpm's release-age gate did not trigger: `pnpm install` reported
  `Lockfile passes supply-chain policies` and **`pnpm-workspace.yaml` is unchanged**, with no
  `minimumReleaseAgeExclude` entry needed. It pulls eight transitive `@supabase/*` packages
  (`auth-js`, `postgrest-js`, `realtime-js`, `storage-js`, `functions-js`, `node-fetch`,
  `phoenix`, `gotrue-js`), all at 2.116.0 except `node-fetch@2.6.15` and `phoenix@0.4.5`.
  The CLI stays at the separately pinned `supabase@2.117.0` (ADR-0033); the two are unrelated
  packages that happen to share a version series.
- **installed docs read:**
  `node_modules/.pnpm/@supabase+supabase-js@2.116.0/node_modules/@supabase/supabase-js/AGENTS.md`
  (which states that `src/` is the canonical version-pinned reference and every public method
  carries TSDoc), `README.md` (`createClient`, custom `fetch`, tracing subpath), and
  `migrations/README.md`.
- **public types/exports inspected:**
  - `@supabase/supabase-js` `src/index.ts`: `createClient<Database, SchemaNameOrClientOptions,
    SchemaName>(url, key, options?)`, and the re-exported `PostgrestError` class and
    `PostgrestSingleResponse`/`PostgrestResponse` types.
  - `src/SupabaseClient.ts`: `from<TableName extends string & keyof Schema['Tables']>(relation)`
    returning a typed `PostgrestQueryBuilder`; `schema()`; the `Database['__InternalSupabase']`
    `PostgrestVersion` inference.
  - `src/lib/types.ts` and `src/lib/constants.ts`: `SupabaseClientOptions`, `DEFAULT_DB_OPTIONS`
    (`schema: 'public'`), `DEFAULT_AUTH_OPTIONS` (`autoRefreshToken`, `persistSession`,
    `detectSessionInUrl` all default **true**, which is a browser default and wrong for a
    server-side service-role client).
  - `@supabase/postgrest-js@2.116.0` `src/PostgrestError.ts`: the failure shape is
    `{ message, details, hint, code }` on an `Error` subclass, and its own TSDoc says to branch on
    `code` rather than on `message` text and that `hint` carries the actionable fix.
  - `src/types/types.ts`: `PostgrestResponseSuccess<T>` / `PostgrestResponseFailure` —
    `{ data, error, count, status, statusText }`, never a throw. Every call site must read `error`.
  - `src/PostgrestQueryBuilder.ts`: `insert(values, { count?, defaultToNull? })` and
    `upsert(values, { onConflict?, ignoreDuplicates?, count?, defaultToNull? })`.
    `ignoreDuplicates: true` sends `Prefer: resolution=ignore-duplicates`, which PostgREST turns
    into `ON CONFLICT … DO NOTHING`; `onConflict` sets the `on_conflict` query parameter and must
    name UNIQUE column(s). This is the documented mechanism the idempotent trace insert uses.
  - `src/PostgrestTransformBuilder.ts`: `order(column, { ascending, nullsFirst, referencedTable })`,
    `limit(rows)`, `range(from, to)` (0-based, inclusive), `single()`, `maybeSingle()`.
- **official docs/repos/examples read:**
  - <https://supabase.com/docs/guides/database/postgres/row-level-security> — a new table in
    `public` starts with privileges granted to `anon`/`authenticated` and **RLS not enabled**; once
    RLS is enabled with no policies, "no data is accessible through the API when using a
    publishable key"; a secret key "authorizes access through the `service_role` Postgres role,
    which has the `bypassrls` attribute", and bypasses RLS only when the request carries no user
    access token.
  - <https://supabase.com/docs/guides/api/api-keys> — the documented server-side pattern is
    `createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!)`, passed "only in
    code that never reaches a user's device". It documents no `auth` options for that pattern;
    disabling `autoRefreshToken`/`persistSession`/`detectSessionInUrl` is therefore a
    harness-owned choice, taken because the installed defaults are all `true` and are browser
    behaviours (a refresh timer and `localStorage`) that a server process must not start.
  - <https://supabase.com/docs/reference/javascript/initializing> — the `createClient` option list.
- **`uuid` column ordering (ADR-0030's open caveat), verified rather than assumed:** neither
  <https://www.postgresql.org/docs/17/datatype-uuid.html> nor
  <https://www.postgresql.org/docs/18/functions-uuid.html> states how `uuid` values compare; the
  first says only that a `uuid` is "a 128-bit quantity" and the second only that `uuidv7()`
  generates a "version 7 (time-ordered) UUID". The property was therefore **measured** against the
  running local Postgres 17.6, with the cases that would distinguish unsigned bytewise comparison
  from a signed or textual one (variant nibbles `8`/`9`/`a`/`b`, and a byte crossing `0x80`):

  ```sql
  select (array_agg(id::text order by id) = array_agg(id::text order by id::text)) from t;
  -- t
  ```

  `uuid` ordering equals lowercase textual ordering, so `order by id` on a UUIDv7 column is
  creation order and the caveat is closed.
- **selected documented pattern:** one `SupabaseClient<Database>` per `createSupabaseStorage()`,
  built with `createClient(url, serviceRoleKey, { auth: { autoRefreshToken: false,
  persistSession: false, detectSessionInUrl: false } })`; every call reads `{ data, error }` and
  maps a `PostgrestError` onto `StorageError` with `details` carrying `code`/`hint`/`message` and
  never a key; `appendTraceEvents` uses
  `upsert(rows, { onConflict: "run_id,sequence", ignoreDuplicates: true })` so a re-sent batch
  creates no duplicate rows; reads use `order()` plus keyset ranges rather than offsets.
- **not documented, therefore harness-owned:** the `Storage` port itself, the thirteen-table
  schema, the ledger columns, the cursor shapes, and the decision to enable RLS with no policies on
  every table. Recorded in ADR-0036.

### Work completed

Nothing yet; this entry is the pre-implementation checkpoint AD-011 and the source-of-truth
protocol require.

### Files changed

- `packages/storage-supabase/package.json`, `pnpm-lock.yaml` (the pinned dependency only).

### Verification

- `npm view @supabase/supabase-js version` — 2.116.0, PASS (matches the version pinned).
- `pnpm --filter @internal/storage-supabase add @supabase/supabase-js@2.116.0` — PASS,
  `Lockfile passes supply-chain policies`, `pnpm-workspace.yaml` unchanged.
- `pnpm supabase:start` — PASS (exit 0).
- `uuid` ordering query above — PASS (`t`).

### Decisions / deviations

Recorded in the completion entry and in ADR-0036.

### Known issues / blockers

None.

### Next exact step

Write the five migrations, then the `Storage` port, the in-memory implementation, the Supabase
adapter, the storage trace sink and the harness wiring.

## 2026-09-19 23:40 — M2-T5, M2-T6, M2-T7 — Storage port, Supabase schema and migrations, outcome ledger

**Status:** completed
**Actor/session:** coding agent (Claude Opus 5, 1M context), delegated by the Fable orchestrator
**Commit:** `1b16a1a`

### Goal

As the `started` entry above. Three build-plan tasks done together because the port's shape, the
tables it writes and the ledger's columns are one design rather than three.

### Implementation references

As recorded in the `started` entry above (`@supabase/supabase-js@2.116.0`, its installed `src/`,
the PostgREST error and upsert semantics, the Supabase RLS and API-key docs, and the two Postgres
`uuid` pages that turn out **not** to state the property that had to be checked).

### Work completed

- **The `Storage` port** (`packages/core/src/storage.ts`, new). Eight async methods, `RunRecord`
  with every column M2-T7's list names, `RunStart`/`RunFinish`/`RunFilter`/`RunListCursor`/
  `TraceCursor` and the two page types, `RUN_STATUSES` as a closed set, `resolvePageLimit()`, and
  `parseRunRecord()` as the strict read boundary in the `parseJob` style. Re-exported by name from
  `packages/core/src/index.ts`.
- **Harness wiring** (`packages/core/src/harness.ts`). `CreateHarnessOptions.storage?: Storage` and
  `CreateHarnessOptions.target?: string`. `saveJob` + `startRun` run after the job and fingerprint
  exist and **before** `run.started` is recorded; `finishRun` runs in `finish()` **after** the trace
  flush. A private `callStorage()` guarantees anything an implementation throws reaches the caller
  as a `StorageError` with the cause preserved. A harness with no `storage` is unchanged.
- **The Supabase adapter** (`packages/storage-supabase/src/supabase-storage.ts`, new).
  `createSupabaseStorage({ url, serviceRoleKey, policy?, client? })`, typed with the generated
  `Database`. Every `PostgrestError` becomes a `StorageError` carrying `code`, `hint` and `details`
  and never a key, a URL or a row. `readTraceEvent()` is the row-to-event boundary, since M2-T3
  defined events as something a recorder mints rather than something read back.
- **The in-memory implementation** (`packages/testing/src/in-memory-storage.ts`, new). A real
  implementation of the port, not a stub: it keys events on `(runId, sequence)` for the same reason
  the database has a constraint on it, and puts everything through `parseJob`/`parseRunRecord` so a
  test passing against it is testing the same contract a row has to satisfy.
- **The storage sink and the fan-out sink** (`packages/trace/src/storage-sink.ts`,
  `fan-out-sink.ts`, both new). `createStorageTraceSink({ storage })` takes the **port**, so the
  in-memory implementation works behind it; `createFanOutTraceSink([...])` puts the JSONL file and
  the database behind one buffered writer, one order and one flush.
- **Five migrations** (`supabase/migrations/`), creating M2-T5's thirteen tables in dependency
  order. The regenerated `packages/storage-supabase/src/database.types.ts` went from 49 to 694
  lines.
- **The example app** (`apps/example-agent/src/run.ts`). Uses storage when `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` are both set, and says on stderr which mode it is in either way. Its
  `start` script gained `--env-file-if-exists=../../.env.local` (Node 24, verified in
  `node --help`), so no variable has to be exported by hand.
- **Docs**: new `docs/contracts/storage.md` and ADR-0036; updated `docs/contracts/README.md`,
  `harness.md`, `trace-event.md`, `docs/decisions/README.md`, `docs/architecture/system-map.md`,
  `docs/runbooks/supabase-local.md`, `docs/development/local-setup.md` and `commands.md`,
  `supabase/migrations/README.md`, `.env.example`, and the M2-T5/T6/T7 subsections plus all six
  outstanding acceptance criteria in the M2 status file.

### Files changed

New: `packages/core/src/storage.ts`, `storage.test.ts`;
`packages/storage-supabase/src/supabase-storage.ts`, `index.test.ts`,
`storage.contract.test.ts`, `supabase-schema.integration.test.ts`;
`packages/trace/src/storage-sink.ts`, `storage-sink.test.ts`, `fan-out-sink.ts`,
`fan-out-sink.test.ts`;
`packages/testing/src/in-memory-storage.ts`, `in-memory-storage.test.ts`;
`supabase/migrations/20260920030254_domains_and_jobs.sql`,
`20260920030256_workflow_registry_tables.sql`, `20260920030258_runs_outcome_ledger.sql`,
`20260920030300_trace_events_and_artifacts.sql`, `20260920030301_later_milestone_tables.sql`;
`docs/contracts/storage.md`;
`docs/decisions/0036-storage-is-a-core-port-over-a-supabase-schema-with-runs-as-the-ledger.md`.

Changed: `packages/core/src/harness.ts`, `harness.test.ts`, `index.ts`;
`packages/trace/src/index.ts`; `packages/testing/src/index.ts`;
`packages/storage-supabase/src/index.ts`, `package.json`;
`packages/storage-supabase/src/database.types.ts` (regenerated, never hand-edited);
`apps/example-agent/src/run.ts`, `package.json`; `pnpm-lock.yaml`;
`supabase/migrations/README.md`; `.env.example`; `docs/contracts/README.md`, `harness.md`,
`trace-event.md`; `docs/decisions/README.md`; `docs/architecture/system-map.md`;
`docs/runbooks/supabase-local.md`; `docs/development/local-setup.md`, `commands.md`;
`docs/milestones/m2-job-trace-supabase-and-run-ledger.md`.

**Unchanged on purpose:** `tests/architecture/boundaries.ts` and
`tests/architecture/package-boundaries.test.ts`. `@internal/storage-supabase` was already a
declared adapter and already listed in the workspace-discovery assertion, and `@supabase/*` was
already adapter-only. `apps/example-agent` depending on the adapter *package* is not the same as
depending on `@supabase/*`. `supabase/seed.sql` is also unchanged: `saveJob` upserts the domain
row, so no seed has to be kept in step with the domains an application defines.

### Verification

Against a running local Supabase (`pnpm supabase:start`, exit 0):

- `pnpm supabase:reset` — **PASS**. Applied all five migrations from an empty database, then
  `seed.sql`, exit 0.
- `pnpm supabase:types` twice, byte-compared between — **PASS**. The two generations are identical
  (`diff -q`, exit 0).
- The `uuid` ordering query (the ADR-0030 caveat) — **PASS**:
  `select (array_agg(id::text order by id) = array_agg(id::text order by id::text)) from t;`
  returns `t` for nine values chosen to cross the `0x80` byte boundary and to span the four
  variant nibbles `8`/`9`/`a`/`b`. `uuid` comparison is unsigned bytewise and equals the lowercase
  textual order, so `order by id` is creation order.
- Row-level security, read from the catalog — **PASS**. All thirteen `public` tables report
  `relrowsecurity = t` and `0` policies.
- `pnpm vitest run --project contract packages/storage-supabase` — **PASS**, 45 tests in 1 file.
  Verbose output confirms the Supabase leg **ran** rather than skipping: 22 cases under
  `Storage contract: in-memory (@internal/testing)` and the same 22 under
  `Supabase leg > Storage contract: supabase (@internal/storage-supabase)`, plus one construction
  case. Among them: the durable run row and ordered trace, the idempotent re-insert (twice, and a
  re-sent position keeping the first payload), the failed and aborted runs, the rejected duplicate
  attempt, and "reconstructs a whole execution from storage alone".
- `pnpm vitest run --project integration` — **PASS**, 31 tests. The thirteen tables exposed to the
  service role; thirteen anon reads returning `[]` plus a refused anon insert (`42501`); the
  `uuid` ordering against ten real rows; the taxonomy check constraint refusing `run.exploded`
  (`23514`) and accepting all 25 valid types; and a trace event for a non-existent run refused
  (`23503`).
- `pnpm typecheck` — **PASS**, 8 packages.
- `pnpm test` (all four projects) — **PASS**, 855 tests across 47 files, up from 691/40.
- `pnpm example:run:mock` with both variables set — **PASS**, exit 0, `completed`, printing
  `Run row written to http://127.0.0.1:54321 as runs.id = 01a0bcd7-1256-7001-b00d-60e9296aa3d0`.
  Queried back: one `runs` row with `status = completed`, `success = t`, `attempt = 1`,
  `model_calls = 1`, `tool_calls = 0`, `jev_calls = 0`, `fallback_count = 0`, `latency_ms = 173`,
  `runtime_name = eve`, `runtime_version = 0.63.0`, `runtime_metadata` carrying the eve session and
  turn ids, `agent_version = sha256:c0ab81341295c366…`, `target = @internal/eve-fixture-agent`, and
  `error` null; `select count(*) from trace_events where run_id = …` returns **6**, sequences 0–5,
  `run.started`, `agent.started`, `model.started`, `model.completed`, `agent.completed`,
  `run.completed`, with `parent_id` set on the four non-`run.*` events.
- `pnpm example:run:mock` with the two variables unset, Supabase still up — **PASS**, exit 0. It
  printed `No Supabase storage: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set.`,
  `"storage": null` in the summary, and wrote only the JSONL trace.

After `pnpm supabase:stop` (exit 0):

- `pnpm example:run:mock` with no `.env.local` — **PASS**, exit 0, JSONL only.
- `pnpm example:run:mock` with `.env.local` still present and the database **down** — **exit 1**,
  and that is correct rather than a failure of this task: it stops with
  `StorageError: supabase storage: \`saveJob\` failed: TypeError: fetch failed` instead of
  reporting a run nothing recorded. That is "storage failures cannot silently turn into successful
  runs" observed end to end rather than only in a unit test.
- `pnpm format:check` — **PASS**. `pnpm lint` — **PASS**. `pnpm check` — **PASS** (all six stages;
  `check:handoff — OK`). With Supabase stopped, `pnpm test` reports
  `Test Files 46 passed | 1 skipped (47)` and `Tests 801 passed | 40 skipped (855)`, and both
  Supabase suites print why they skipped.

### Decisions / deviations

Full reasoning in ADR-0036. The ones worth reading here:

- **The three tasks were done as one.** The port's shape, the schema and the ledger columns are not
  separable decisions, and splitting them would have meant deciding the same things three times.
- **No attempts table**, as the recommendation anticipated. An attempt is an ordinal on the run row
  and on each trace event, `unique (job_id, attempt)` is the rule, and ADR-0030's `AttemptId` brand
  stays unused until the milestone that introduces retries.
- **`target` is on `CreateHarnessOptions`, not on `HarnessRunInput`.** It identifies the deployment
  rather than the work: one harness is built against one agent and runs many jobs through it, so
  per-run would be the same string repeated with a chance to get it wrong.
- **`@internal/storage-supabase` depends on `@internal/trace`.** The dependency diagram already
  puts storage under trace. It is needed because the adapter redacts the **run row's `error` and
  `runtime.metadata`**, which no writer chain reaches: ADR-0026 says a serialized error's `details`
  is not a redaction boundary, so redacting the trace's copy of a value while leaving the ledger's
  copy alone would be an inconsistency with a secret in it. The storage sink also applies
  `redactEvents` as ADR-0035's belt and braces; redaction is idempotent, so the second pass changes
  nothing when the first ran, which `storage-sink.test.ts` asserts.
- **No second index on `(run_id, sequence)`.** The task's phrasing asked for a unique constraint
  *and* an index; the constraint's own btree index is exactly the index every trace read uses, so a
  second one would be byte-for-byte redundant. Recorded in the migration and the ADR.
- **The trace event type is a `check` constraint, not a Postgres enum**, so adding a type does not
  churn a type object that `database.types.ts` and everything downstream depend on. It renders as
  `string` and still refuses a value outside the taxonomy, which the integration suite proves.
- **The Supabase leg of the storage suite is a `contract` test, not an `integration` one.** Its
  purpose is proving two implementations of one port agree, which is the `contract` project's
  definition and would be meaningless against one of them. Schema facts — thirteen tables, RLS,
  `uuid` ordering, the check constraint — went to `supabase-schema.integration.test.ts` instead.
  Precedent: `eve-agent-runtime.contract.test.ts` already starts a real `eve dev` server.
- **`domains.organization_id` exists, defaulting to `local`,** so AD-008's outermost learning scope
  is a `where` rather than a future migration. No organizations table and no tenancy model.
- **The service-role client disables `autoRefreshToken`, `persistSession` and
  `detectSessionInUrl`,** all of which the installed package defaults to `true`. The official docs
  show the server-side pattern without them and document no `auth` options for it, so this is a
  harness-owned choice: they are browser behaviours (a refresh timer that keeps a Node process
  alive, storage a server has no business having, a URL fragment that does not exist).
- **`createFanOutTraceSink()` is a small addition that was not asked for.** The example wants both
  the JSONL file and the database, and two `TraceWriter`s would each buffer separately, so a crash
  between their flushes would leave two traces that disagree. One writer over several sinks keeps
  one buffer, one order and one flush. Its failure semantics are in the ADR.
- **A job is deliberately not redacted.** Its `input` is the work itself, and a harness that stored
  a redacted job could not replay one.
- **The example run prints the Supabase URL, never a key**, and no key value appears in any file,
  document, WORKLOG entry or commit message, per ADR-0033's unconditional rule.

### Known issues / blockers

- **There is no cross-call transaction.** PostgREST is request-per-call, so `saveJob` + `startRun`
  is two requests and a failure between them leaves a job row with no run. That is a visible,
  recoverable state — a job nothing references — rather than a corrupt one, and the run itself
  fails loudly. A future need for atomicity means a Postgres function called over RPC, not a second
  driver.
- **`listRuns` cannot filter by organization.** `organization_id` is on `domains` and the filter
  would need a join; adding it before a second organization exists would be designing for a case
  that does not.
- **The CLI's migration timestamps are second-resolution.** Five migrations created in a loop
  collided and sorted by name, which put `runs` ahead of the `workflow_versions` it references.
  They were recreated one per second and `supabase/migrations/README.md` now warns about it, but
  the next person creating several at once has to check the resulting order.
- **A fan-out retry can duplicate lines in the local JSONL file.** The fan-out sink fails the write
  when any sink failed, so the buffered writer retries the batch to every sink; the Supabase sink is
  idempotent and the JSONL sink appends. The durable store stays exact; the convenience file may
  repeat itself after a transient database failure.
- **The `supabase-types` CI job has still never run.** It was added by M2-T11 and there has been no
  CI run since; this task is the first that would actually give it something to diff.
- `pnpm example:run` against a live Gateway model remains unverified: no credential.

### Next exact step

**M2-T10, the local run inspector** (`pnpm harness run show <run-id>`), which is the last open task
in this milestone. Everything it needs is already on the port: `Storage.getRun()` gives the job
reference, the route-relevant columns, the cost, the timings and the fingerprints;
`Storage.getJob()` gives the job through `parseJob()`; and `Storage.getTrace()` gives the ordered
timeline with its model, tool and (from M3) decision events, parent links, usage and errors. The
one design question it has to answer is whether it also reads the JSONL file, which is the only
record a run made with no database leaves.

## 2026-09-19 23:58 — M2-T5, M2-T7 — Addendum: a configured-but-unreachable Supabase must fail readably

**Status:** completed
**Actor/session:** coding agent (Claude Opus 5, 1M context), on review feedback from the orchestrator
**Commit:** `1b16a1a`

### Goal

Fix the *presentation* of a failure the previous entry verified was correct. With `.env.local`
present and Supabase stopped, `pnpm example:run:mock` exited 1 — which is right — but did it by
letting an uncaught `StorageError` reach the top level, printing a stack trace, and only after
paying for an `eve dev` server it then threw away. The behaviour stays; the noise goes.

It also corrects an ambiguity in the previous entry's verification list. Both cases were run and
both were recorded there, but the summary read as though "exit 0 after `pnpm supabase:stop`" held
unconditionally. It does not: that run had `.env.local` moved aside
(`mv .env.local .env.local.bak`). With the file present and the database down the run exits 1, and
that is the intended behaviour rather than a defect.

### Work completed

- `apps/example-agent/src/run.ts`: a `reportStorageFailure()` that prints **one** stderr block with
  the `SUPABASE_URL` (never the key), the underlying message, and the two ways out; no stack. It is
  called from three places: a `StorageError` thrown while constructing the storage, the new
  preflight, and a `StorageError` out of `harness.run()`. Each returns exit 1. **Every other error
  keeps its previous behaviour** and propagates with its stack, because an unexpected defect is
  exactly the case where a stack is worth having.
- **A reachability preflight was added** (the orchestrator left it optional; it is worth it). It
  runs **before** `startEveDevServer`, so a database that was never up costs one HTTP request
  rather than a compile and a boot. It is `storage.listRuns({}, { limit: 1 })` — a real call
  through the **port**, not a bespoke health check or a reach into the adapter's client — so it
  exercises the same URL, the same key and the same PostgREST surface the run will use, and a URL
  that answers but rejects the key fails here too. It fails with the same message shape, because
  the formatting lives in one function.
- **No silent fallback.** When storage is configured and unreachable the run stops; it never
  downgrades to a JSONL-only success. The message says so explicitly, so nobody has to infer it.
- `docs/runbooks/supabase-local.md`: a new "Once `.env.local` exists, the example run requires
  Supabase to be up" section with the three-case table, the verbatim failure output, the two ways
  out, and a note that `pnpm check` and CI have no `.env.local` and stay JSONL-only.
- The file header comment in `run.ts` gained the same three-case statement.

### Files changed

- `apps/example-agent/src/run.ts`
- `docs/runbooks/supabase-local.md`
- `docs/progress/WORKLOG.md` (this entry)

### Verification

- **(a) Supabase stopped, `.env.local` present** — exit 1, and the eve server is never started
  (no `Starting an eve dev server...` line). Output, verbatim and complete:

  ```text
  Supabase storage is configured (SUPABASE_URL=http://127.0.0.1:54321) but unreachable: supabase storage: `listRuns` failed: TypeError: fetch failed

  Start it with `pnpm supabase:start`, or remove SUPABASE_URL and
  SUPABASE_SERVICE_ROLE_KEY (or `.env.local`) to run JSONL-only.

  This run is **not** falling back to a JSONL-only trace. Storage was asked for, so a
  run that storage never recorded is not a run to report as anything but a failure
  (Milestone 2: storage failures cannot silently turn into successful runs).

  See docs/runbooks/supabase-local.md.
  ```

  No stack trace. PASS.
- **(b) `.env.local` moved aside, Supabase still stopped** — exit 0. Printed
  `No Supabase storage: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set.`,
  `"storage": null`, `"status": "completed"`, and a JSONL trace path. PASS.
- **(c) Supabase started, `.env.local` restored** — exit 0, `"storage": "http://127.0.0.1:54321"`,
  `"status": "completed"`, and both
  `Run row written to http://127.0.0.1:54321 as runs.id = 01a0bce9-d971-7001-98b0-11640be5c902`
  and the matching `trace_events` line. Queried back: the `runs` row is
  `completed / success = t / target = @internal/eve-fixture-agent / model_calls = 1 /
  latency_ms = 167`, and `trace_events` has **6** rows for that run. PASS.
- `pnpm supabase:stop` — exit 0. Supabase left stopped, `.env.local` left in place.
- `pnpm check` — **PASS**, all six stages, `Tests 801 passed | 40 skipped (855)`,
  `check:handoff — OK`.

### Decisions / deviations

- **The preflight is a port call, not a ping.** `listRuns({}, { limit: 1 })` costs one indexed
  query against an empty-or-small table and proves the whole path: DNS, the port, PostgREST, the
  key and the schema cache. A `HEAD` to the URL would pass against a stack whose database is not
  ready and against a wrong key.
- **The preflight runs before the eve server, not inside the `try` that owns it.** That is the
  entire reason for adding it: the failure now costs one request instead of a compile and a boot.
- **Only `StorageError` is caught.** A `ValidationError` from a malformed URL, and anything else,
  still propagates with its stack. Catching more would hide defects behind a friendly message.

### Known issues / blockers

- **`pnpm example:run` (the live target) shares this path**, so a developer with `.env.local` and a
  stopped database now sees this message before the credential check has any effect. That ordering
  is deliberate — the cheaper check runs first — but it means the two failure messages can be met
  in either order depending on what is missing.
- The rest of the previous entry's known issues are unchanged.

### Next exact step

Unchanged: **M2-T10, the local run inspector**.

---

## 2026-09-19 22:05 — M2-T10 — Local run inspector

**Status:** started
**Actor/session:** Claude Opus 5 (1M context) implementer subagent
**Commit:** `5eaba18`

### Goal

Build the local run inspector the build plan specifies as
`pnpm harness run show <run-id>`, displaying a run's job, route, timeline,
tool/model/Jev calls, errors, result, cost and fingerprints. It is the last
Milestone 2 task and the first command of the CLI the build plan's section 10
calls "the initial control plane".

Concretely: a new `@internal/observability` package holding a pure
`inspectRun()` over the `Storage` port plus a plain-text renderer, a
`parseTraceEvent()` read boundary in `@internal/core`, a credential-free JSONL
trace source so a run is inspectable with no database at all, and a
`node:util` `parseArgs` entry point wired to a root `pnpm harness` script.

### Implementation references

- package/version: Node **24.21.0** (`.node-version`, `.nvmrc`); pnpm
  **12.4.2**. No new third-party dependency is added by this task.
- installed docs read: `node --help` on the installed 24.21.0 for the
  `--env-file` family; it lists both `--env-file=...` and
  `--env-file-if-exists=...`, the latter being what
  `apps/example-agent`'s `start` script already uses.
- public types/exports inspected: `node:util`'s `parseArgs` on the installed
  runtime, probed directly rather than from memory —
  `parseArgs({ args, options: { json: { type: "boolean" }, jsonl: { type: "string" } }, allowPositionals: true, strict: true })`
  returns `{ values, positionals }`, with
  `["run","show","<id>","--json","--jsonl","p.jsonl"]` yielding
  `positionals: ["run","show","<id>"]` and
  `values: { json: true, jsonl: "p.jsonl" }`. `@types/node` 24.13.6 supplies
  its types.
- pnpm argument forwarding verified empirically, not assumed: a throwaway
  package with `"harness": "echo building && node --env-file-if-exists=.env.local echo.js"`
  invoked as `pnpm harness run show ID --json` appends the four arguments to
  the **last** command of the `&&` chain and delivers
  `["run","show","ID","--json"]` to `process.argv.slice(2)`. No `--` separator
  is needed, and `run` is not swallowed as a pnpm builtin.
- selected documented pattern: Node's built-in `parseArgs` in strict mode with
  `allowPositionals: true`, as the CLI framework. AD-016 requires the choice be
  recorded; ADR-0037 does that.
- harness-owned: the `RunInspection` shape, its renderer, and the trace-only
  JSONL source. Nothing about them is prescribed by a framework.

### Next exact step

Implement `parseTraceEvent()` in `@internal/core`, then the
`@internal/observability` package, then the CLI, then verify against a real
local Supabase run.

---

## 2026-09-20 00:20 — M2-T10 — Local run inspector

**Status:** completed
**Actor/session:** Claude Opus 5 (1M context) implementer subagent
**Commit:** `5eaba18`

### Goal

As the `started` entry above. The last Milestone 2 task: `pnpm harness run show <run-id>`,
displaying a run's job, route, timeline, tool/model/Jev calls, errors, result, cost and
fingerprints from durable evidence alone.

### Implementation references

As the `started` entry above (Node 24.21.0's `node:util` `parseArgs` probed on the installed
runtime; `--env-file-if-exists` read off `node --help`; pnpm argument forwarding verified
empirically). No new third-party dependency was added by this task.

### Work completed

- **New package `@internal/observability`** (`packages/observability`), the build plan's planned
  `packages/observability`, modelled on `packages/trace`.
  - `inspectRun(source, runId)` returns a `RunInspection`: a plain, JSON-able value whose fields
    are the build plan's display list in the build plan's order. It accepts either a `Storage`
    (reads `getRun`, `getJob`, and pages `getTrace` to completion through the keyset cursor) or a
    `TraceOnlySource`. It never throws for absence: `found`, an `availability` triple and
    human-readable `notes` describe a partial record instead.
  - `renderRunInspection(inspection, { color?, summaryWidth? })` is a pure function from that value
    to text: eight sections, fixed-width timeline columns, **no ANSI by default**.
  - `createJsonlTraceSource(path)` is the trace-only source over a `.harness/traces/<runId>.jsonl`
    file.
  - `src/cli.ts` holds `parseHarnessCommand()` and `runHarnessCli()`, which take argv, environment,
    output sinks and a store factory as arguments so the whole command is unit-testable with no
    subprocess. `src/bin/harness.ts` is the four-line shell that supplies `process`.
- **`parseTraceEvent()` added to `@internal/core`** (`src/trace.ts`, re-exported from `index.ts`),
  beside `parseJob()` and `parseRunRecord()`, in the same style: every failing field reported at
  once with its path, an unknown field an error rather than a drop, the result deep-frozen.
  `version` is read rather than asserted (any integer >= 1), because a row from an older schema
  must read back saying so.
- **`packages/storage-supabase`'s `readTraceEvent` now calls it**, and is reduced to the
  column-name mapping. Its own comment had said that a second reader is what would move those
  checks into core; the inspector is that reader. Four imports the local checks needed
  (`isTraceEventType`, `SerializedHarnessError`, `TRACE_EVENT_VERSION`, `TraceEventUsage`) are gone.
- **`readJsonlTraceEvents(path)` added to `@internal/trace`** (`src/jsonl-source.ts`), in the module
  beside the sinks that define the format, so "one canonical-JSON event per line" keeps one owner.
  It parses every line through `parseTraceEvent`, skips blanks, sorts by `sequence`, throws a
  `StorageError` naming the file it cannot read and a `ValidationError` naming the line that is not
  an event.
- **Root `package.json`**: a `harness` script (alphabetically between `format:check` and `lint`).
  Turbo's output is redirected to **stderr** (`1>&2`) with `--output-logs=none`, so stdout carries
  the inspection alone and `--json` pipes cleanly — without that redirect, turbo's banner is the
  first thing `jq` sees.
- **Boundaries**: `@internal/observability` added to `BOUNDARY_RULES.forbiddenByPackage` with
  core's six bans, and to the workspace-discovery assertion in `package-boundaries.test.ts`.
- **Docs**: new `docs/runbooks/inspecting-a-run.md` (registered in `docs/runbooks/README.md`, whose
  "runbooks later milestones must add" entry for the inspector is removed);
  `docs/development/commands.md` (the `pnpm harness` row and the per-package script row);
  `docs/architecture/system-map.md` (the planned row flipped, a prose entry, and the stale "Six
  packages" count corrected to nine); `docs/contracts/trace-event.md` (a "Reading an event back"
  section and a table row for `parseTraceEvent`); `docs/contracts/storage.md` (the inspector named
  as the port's first read-only consumer); `docs/contracts/README.md` (the `trace-event.md`
  summary); **ADR-0037** and its row plus closing paragraph in `docs/decisions/README.md`.
- **Milestone status**: `### M2-T10`'s `**Status:**` and `**Result.**`, and the "A failed run
  remains inspectable" acceptance bullet extended with the inspector's evidence.

### Files changed

Added:

- `packages/observability/package.json`, `tsconfig.json`, `tsconfig.build.json`
- `packages/observability/src/inspect-run.ts`, `render.ts`, `jsonl-trace-source.ts`, `cli.ts`,
  `index.ts`, `bin/harness.ts`
- `packages/observability/src/fixtures.ts` (test-only; excluded from `tsconfig.build.json`)
- `packages/observability/src/inspect-run.test.ts`, `render.test.ts`, `jsonl-trace-source.test.ts`,
  `cli.test.ts`, `run-inspector.integration.test.ts`
- `packages/trace/src/jsonl-source.ts`, `jsonl-source.test.ts`
- `docs/decisions/0037-the-run-inspector-is-a-library-over-the-storage-port-with-a-parseargs-cli.md`
- `docs/runbooks/inspecting-a-run.md`

Changed:

- `packages/core/src/trace.ts` (`parseTraceEvent` and its helpers), `trace.test.ts`, `index.ts`
- `packages/storage-supabase/src/supabase-storage.ts` (`readTraceEvent`, imports, module doc)
- `packages/trace/src/index.ts`
- `tests/architecture/boundaries.ts`, `tests/architecture/package-boundaries.test.ts`
- `package.json` (the `harness` script), `pnpm-lock.yaml`
- `docs/contracts/README.md`, `docs/contracts/storage.md`, `docs/contracts/trace-event.md`
- `docs/architecture/system-map.md`, `docs/development/commands.md`, `docs/runbooks/README.md`
- `docs/decisions/README.md`
- `docs/milestones/m2-job-trace-supabase-and-run-ledger.md` (the `### M2-T10` body and one
  acceptance bullet only)
- `docs/progress/WORKLOG.md` (this entry)

### Verification

Ordered as run.

- `pnpm exec vitest run --project unit packages/observability` — **PASS**, 52 tests in 4 files.
- `pnpm exec vitest run --project unit packages/core packages/storage-supabase packages/trace` —
  **PASS**, including 15 new `parseTraceEvent` cases and 8 new `readJsonlTraceEvents` cases.
- `pnpm supabase:start` — exit 0.
- `set -a; . ./.env.local; set +a; pnpm example:run:mock` — exit 0, `"status": "completed"`, run
  `01a0bd00-3903-7001-9ee5-c9d68f7ecb3b` written to Supabase and to
  `apps/eve-fixture-agent/.harness/traces/01a0bd00-3903-7001-9ee5-c9d68f7ecb3b.jsonl`.
- `pnpm harness run show 01a0bd00-3903-7001-9ee5-c9d68f7ecb3b` — **PASS**, exit 0. Full output
  (turbo's banner, which goes to stderr, omitted):

  ```text
  run 01a0bd00-3903-7001-9ee5-c9d68f7ecb3b
  read from the Storage port

  Job
  ───
    id:            01a0bd00-3903-7000-88ed-59a63cab5fb3
    domain:        vendor-triage@1.0.0
    type:          vendor-triage
    objective:     Triage Northwind Ledger against the supplied procurement SOP and recommend what should happen next.
    input schema:  vendor-triage.input@1.0.0
    output schema: vendor-triage.output@1.0.0
    sop:           procurement-sop
    budget:        {"maxDurationMs":120000,"maxModelCalls":8,"maxToolCalls":8}
    permissions:   lookup_vendor_evidence:read, load_skill:read
    input:
      {
        "vendorName": "Northwind Ledger",
        "procurementSop": "# Procurement SOP v1.0\n\n## Categories\n\nClassify every vendor as one of: fi…
      }

  Route
  ─────
    route:     full-agent
    domain:    vendor-triage@1.0.0
    job type:  vendor-triage
    target:    @internal/eve-fixture-agent
    runtime:   eve@0.63.0
    attempt:   1
    fallbacks: 0 (from the ledger)

  Timeline
  ────────
     seq       +ms  type                  latency  detail
       0         0  run.started                 -  attempt=1 domain=vendor-triage domainVersion=1.0.0 jobI…
       1        90  agent.started               -  eveEventId=evt_01M2YG0EBTCMBM3107CE7W1J72 runtime=eve s…
       2        91  model.started               -  eveEventId=evt_01M2YG0EBVGMMNGDH4MPS51N6G modelId=adapt…
       3        98  model.completed             7  eveEventId=evt_01M2YG0EC2NKRRRYG8DXWBYAKH finishReason=…
       4       104  agent.completed            14  eveEventId=evt_01M2YG0EC8TZWPQCH4FHXPZFPN turnId=turn_0
       5       110  run.completed             137  jobId=01a0bd00-3903-7000-88ed-59a63cab5fb3

  Calls
  ─────
    model:   1 call, 7 ms total
      seq   2  adaptive-agent-harness/harness-fixture  completed       7 ms
    tool:    0
    jev:     0
    jev: 0 is a real measurement, not a gap: the `decision.*` taxonomy exists and nothing produces one until M3 adds the Jev decision engine.

  Errors
  ──────
    none

  Result
  ──────
    status:   completed (from the ledger)
    success:  true
    started:  2026-09-20T04:08:23.557Z
    finished: 2026-09-20T04:08:23.694Z
    latency:  137 ms
    output:   (none) not persisted in Milestone 2: `HarnessRunResult.output` is returned in process, and a trace payload is identity-only by rule (ADR-0031), so no durable record of it exists. The `artifacts` table is where a durable output goes; M5 is what fills it.

  Cost
  ────
    cost (ledger): (none)
    cost (trace):  (none)
    model calls:   1
    tool calls:    0
    jev calls:     0
    input tokens:  612
    output tokens: 61
    cache read:    0
    cache write:   0
    total tokens:  673

  Fingerprints
  ────────────
    run (ledger):   sha256:c0ab81341295c36655b5c4614d9352bd29deec74c7d75f65c82b8dd33f0f8c2d
    agent version:  sha256:c0ab81341295c36655b5c4614d9352bd29deec74c7d75f65c82b8dd33f0f8c2d
    trace:          sha256:c0ab81341295c36655b5c4614d9352bd29deec74c7d75f65c82b8dd33f0f8c2d
    consistent:     yes, every event carries the run's fingerprint
    scheme:         1
    algorithm:      sha256
    components:
      sop:          sha256:720f6cb18cc5ec619ed0f92da4dbd30930c0b2cf174a4a3b0f18b0f25599431f
      model:        sha256:fad1b415f49984cc1802629c9ff6688ab85a85ff949b5c4db49b0a5abde39b1b
      tools:        sha256:021f9fa5a44613ec60d139d04ca046c1be21f96cc6a19f2b1d11d2238796fdba
      policy:       sha256:a8b6b14f75fb81d9144f6182f1d94210e2e4af7afc38870b62c7632171f3ab7a
      skills:       sha256:d46c489df163105874be323e980c7c9f9dcda8700b7ddba0e884b44cf33266e7
      schemas:      sha256:11a3258dbc9b7351c6df986de2b7b4a96bb6c11ec14605db154082e6062f9f3d
      workflowIr:   sha256:74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b
      instructions: sha256:d57880944e71ac43a61c6b749e702f0067256c4ceaa14d9cb4b9691569977070
  ```

  The composite matches the one M2-T8 recorded for this agent
  (`sha256:c0ab8134…`), and `agent_version`, the ledger fingerprint and every event agree.

- `pnpm harness run show <id> --json | head -c 400` — **PASS**, exit 0, and **stdout is clean**:

  ```json
  {
    "runId": "01a0bd00-3903-7001-9ee5-c9d68f7ecb3b",
    "source": "storage",
    "sourceDescription": "the Storage port",
    "found": true,
    "availability": {
      "run": true,
      "job": true,
      "trace": true
    },
    "notes": [],
    "job": {
      "id": "01a0bd00-3903-7000-88ed-59a63cab5fb3",
  ```

- `set -a; . ./.env.local; set +a; pnpm test:integration` — **PASS**, 34 tests in 2 files, the
  three new `run-inspector.integration.test.ts` cases included (a completed run, a failed run, and
  Postgres-versus-in-memory agreement). This is the Supabase leg run for real, not skipped.
- `pnpm harness run show <id> --jsonl apps/eve-fixture-agent/.harness/traces/<id>.jsonl` —
  **PASS**, exit 0, with no Supabase read. Differences from the Supabase output, all of them
  correct:

  ```text
  run 01a0bd00-3903-7001-9ee5-c9d68f7ecb3b
  read from the JSONL trace /Users/.../apps/eve-fixture-agent/.harness/traces/01a0bd00-3903-7001-9ee5-c9d68f7ecb3b.jsonl
  note: job and ledger row unavailable (trace-only source)

  Job
  ───
    (unavailable)

  Route
  ─────
    route:     full-agent
    domain:    vendor-triage@1.0.0
    job type:  vendor-triage
    target:    (none)
    runtime:   (none)
    attempt:   (none)
    fallbacks: 0 (from the trace)
  ```

  The Timeline, Calls, Errors, Cost tokens and Fingerprints sections are byte-identical to the
  Supabase run's, and `status: completed (from the trace)` is derived from `run.completed`.
  `run (ledger)` and `agent version` read `(none)`, which is the truth for a trace-only source.

- Unknown run id: `pnpm harness run show 01a0bd00-0000-7001-9ee5-000000000000` — **PASS**,
  `run 01a0bd00-0000-7001-9ee5-000000000000 not found` on stderr, **exit 1**.
- `pnpm harness workflow list` — **PASS**, **exit 2**, printing
  `` `harness workflow list` is not implemented `` and the build plan's fourteen section-10
  targets, each marked `available now` or `not yet implemented (Mx)`.
- No source at all (both Supabase variables unset, no `--jsonl`) — **PASS**, **exit 2**, naming
  both options and pointing at `docs/runbooks/supabase-local.md`.
- `pnpm supabase:stop` — exit 0. **Supabase left stopped.**
- Configured-but-unreachable, Supabase now stopped and `.env.local` still present — **PASS**,
  **exit 1**, one line and no stack:

  ```text
  Supabase storage is configured (SUPABASE_URL=http://127.0.0.1:54321) but unreachable: supabase storage: `getRun` failed: TypeError: fetch failed

  Start it with `pnpm supabase:start`, or inspect the run's local JSONL trace with
  `pnpm harness run show <run-id> --jsonl <path>` instead.

  See docs/runbooks/supabase-local.md.
  ```

- `pnpm check` (Supabase stopped) — **PASS**, all six stages.
  `Test Files 51 passed | 2 skipped (53)`, `Tests 876 passed | 43 skipped (933)`,
  `check:handoff — OK`.

### Decisions / deviations

- **`node:util` `parseArgs` is the CLI framework**, recorded in ADR-0037 as AD-016 requires. No
  dependency added. Probed on the installed runtime rather than recalled.
- **The CLI entry point lives in `packages/observability`**, not a `packages/cli` the build plan's
  section 4 layout does not name; section 10 says to build the CLI incrementally and a later ADR
  can split it. Only `src/cli.ts` — which `src/index.ts` does not re-export — depends on
  `@internal/storage-supabase`, so the library surface stays adapter-free and the database is still
  reached only through the declared adapter.
- **The JSONL reader went into `@internal/trace`, not the inspector.** The format is defined by
  that package's sinks; a reader stating it a second time would drift. Only the run filter and the
  source description stayed in `@internal/observability`.
- **Turbo's output is redirected to stderr in the `harness` script.** Without `1>&2` the banner is
  on stdout and `--json | jq` fails. `--output-logs=none` additionally silences the per-task lines.
  This differs from `pnpm example:run`'s script, deliberately: that command's stdout is not a
  machine-readable document.
- **`RunInspection` has no `job.behaviorFingerprint` field**, because `Job` has none. The task
  brief named one; the fingerprints section reports the ledger row's `behaviorFingerprint`, its
  `agentVersion`, the composite every event carries, the `run.started` payload's `scheme`,
  `algorithm` and eight component digests, and a `consistent` boolean with the sequences that
  disagree.
- **`cost.tracedCostUsd` sums the run's non-`run.*` events only.** A `run.*` event carries the
  run's totals rather than its own usage (`TraceEventUsage`), so the first implementation summed
  everything and reported double. A unit test caught it.
- **The text renderer abbreviates a job's `input`** to twenty lines of at most a hundred characters
  each, with a pointer to `--json`. The vendor-triage input is a whole SOP in one string and would
  otherwise push every section below it off the screen. `inspectRun` itself is untouched; only the
  view is short.
- **`src/fixtures.ts` is excluded from `tsconfig.build.json`** alongside the tests. It builds a
  real `createHarness()` run recorded through the real writer chain, which every test in the
  package starts from; a hand-written `RunRecord` and event list would have tested the inspector
  against an imagined shape rather than against what the harness writes.
- One unrelated typecheck defect was fixed in passing: a new `trace.test.ts` case passed
  `{ tool: … }` to `ToolExecutionError`, whose option is `toolId`. Vitest transpiles rather than
  typechecks, so only `pnpm typecheck` caught it.

### Known issues / blockers

- `pnpm harness` rebuilds the package on every invocation. It is a warm turbo cache hit (about
  10 ms) but it is not nothing, and a `node packages/observability/dist/bin/harness.js` invocation
  skips it when the build is known current.
- The inspector cannot show a run's **output value** in Milestone 2; nothing persists one. It says
  so and names the `artifacts` table. M5.
- `parseArgs` has no subcommand model. The dispatch is hand-written positional matching, which is
  fine for one command and will not be at ten; ADR-0037 names that as the point to revisit both the
  framework and a `packages/cli`.
- The M2 acceptance bullet **"A trace reconstructs execution without application logs"** was
  verified by M2-T5 and is not edited here, though the inspector is now a second and stronger
  witness for it. Left to the milestone sweep, which owns the acceptance section.
- `docs/development/commands.md` still contains a stale line from M0 ("There is no `pnpm
  example:run` yet") and an `example:run` paragraph interrupting the script table. Both predate
  this task and belong to whoever owns that file next.

### Next exact step

**Milestone 2 is feature-complete**: M2-T1 through M2-T11 are all `completed`. Next is the M2
acceptance-criteria sweep and the milestone snapshot under `docs/progress/milestones/m2.md`, then
Milestone 3.

## 2026-09-20 00:35 — M2 — Milestone 2 complete: snapshot and handoff

**Status:** completed
**Actor/session:** coding agent (documentation subagent)
**Commit:** not committed

### Goal

Close out Milestone 2, now that M2-T10 (the last task) is complete, reviewed, and committed as
`5eaba18`, and all ten acceptance criteria in the status file carry dated evidence: write the
milestone snapshot, update the status file and README, extend AGENTS.md, and rewrite the handoff
to point at M3/M4.

### Implementation references

Not applicable. This task touches no framework-facing code; it archives the already-completed and
already-reviewed Milestone 2 work into a snapshot and rewrites the handoff files.

### Work completed

- Confirmed the newest commit (`git log --oneline -8`) is `5eaba18`, subject
  `feat(M2-T10): local run inspector and the first harness CLI command`.
- Read `docs/progress/milestones/m1.md` (the snapshot shape), `docs/progress/README.md`, the whole
  M2 status file, ADR-0037, `docs/runbooks/inspecting-a-run.md`, the two WORKLOG entries titled
  `M2-T10 — Local run inspector`, and the Milestone 3 and Milestone 4 sections of
  `docs/milestones/build-plan.md` (Goal, Blocked By, Parallel Work).
- Wrote `docs/progress/milestones/m2.md`: title, completion date, status, the eight-commit list in
  order (with `<pending>` for this closing docs commit), status-file path, WORKLOG range
  (2026-09-19 21:35 through 2026-09-20 00:20), Goal, a Tasks table (one line per M2-T1..T11 with
  its ADR), Verification at completion (876 passed / 43 skipped across 53 files; all three
  `example:run:mock` storage modes; the inspector against Supabase and JSONL; `supabase:reset`
  from zero; `uuid` ordering; RLS on 13 tables; CI has not seen any M2 commit), Deviations from the
  plan (nine items pulled from ADR-0030 through ADR-0037), and an Environment note.
- Updated `docs/milestones/m2-job-trace-supabase-and-run-ledger.md`: header status line now reads
  "every task is `completed` (M2-T1 through M2-T11); all ten acceptance criteria verified.
  Snapshot: `../progress/milestones/m2.md`."; added the missing `## Tasks` intro line
  ("M2-T1 through M2-T11 are `completed`.") to mirror M1's shape. The M2-T10 subsection's status
  line was already `completed (2026-09-20).`, so no change was needed there.
- Updated `docs/milestones/README.md`: the M2 row now reads
  "complete (snapshot: [../progress/milestones/m2.md](../progress/milestones/m2.md))", matching
  M1's row form. The "Later milestones (M3 onward)" sentence below the table already said "M3
  onward" from an earlier reconciliation pass, so it needed no further change.
- Checked `docs/progress/README.md` for an explicit list of milestone snapshots to extend: it only
  describes the general `docs/progress/milestones/mX.md` pattern and names no specific file, so
  nothing there needed a change.
- `AGENTS.md`: added a `pnpm harness` row to the commands table after `pnpm supabase:types`; added
  `packages/observability/` to the repository-layout tree (removing it from the "planned" block,
  since it now exists), expanded `docs/runbooks/` to list its three files, and changed the
  `decisions/` comment from "ADRs 0001-0029" to "ADRs 0001-0037"; extended the ADR paragraph with
  the ADR-0037 sentence and changed the closing sentence to "The next free number is 0038." (no
  more tasks reserved); confirmed the "Current status" line in the project summary already points
  at `docs/context/current-state.md` and needed no change.
- Rewrote `docs/context/current-state.md` in full: Milestone 2 marked complete; current milestone
  set to "M2 complete; next is M4 (critical path), M3 can proceed beside it"; current task "not
  started, create the next milestone's status file"; last commit SHA `5eaba18`; completed-milestones
  list now just names M0, M1, M2 with their snapshot/status-file paths (collapsing the
  per-task M2 entries from the previous handoff); "what works now" consolidated to ten packages
  (adding `@internal/observability`) plus the two apps, the three `example:run:mock` storage modes,
  the new `pnpm harness` CLI, and the 876-passed/43-skipped test count; "partially working" keeps
  the unpersisted-output, ledger-placeholder, ADR-0028 and `domains`-option items and drops the
  now-closed "which target ran" caveat's open status; "does not exist yet" narrowed to Jev, workflow
  IR, replay, evals, learner, compiler and the rest of the CLI; blockers updated for the eight
  unpushed M2 commits and the local `.env.local`/Supabase-stopped situation; active decisions
  extended through ADR-0037 with next free ADR 0038; findings extended with the CLI mechanics
  (positional-argument forwarding, stderr-redirected turbo output, `parseTraceEvent` as the read
  boundary, the JSONL reader's home in `@internal/trace`); "exact next task" points at creating the
  M4 status file first (critical path) with M3 able to start beside it, and the first command now
  chains `supabase:start`, `example:run:mock` and `harness run show`.

### Files changed

- `docs/progress/milestones/m2.md` — new file, the Milestone 2 snapshot.
- `docs/milestones/m2-job-trace-supabase-and-run-ledger.md` — header status line and `## Tasks`
  intro line.
- `docs/milestones/README.md` — M2 row now "complete (snapshot: ...)".
- `AGENTS.md` — commands table row, repository-layout tree, decisions-directory comment, ADR
  paragraph.
- `docs/context/current-state.md` — rewritten in full for the Milestone 2 -> Milestone 3/4
  handoff.

### Verification

- `pnpm format:check` — PASS
- `pnpm check:handoff` — PASS

### Decisions / deviations

- None beyond what M2-T1 through M2-T10's own entries already recorded; this entry only archives
  and reconciles documentation for already-completed, already-reviewed work.

### Known issues / blockers

- Eight M2 commits (`02b1261` through `5eaba18`, plus the docs commits between them) are unpushed
  to `origin/main`; CI, including the `supabase-types` job, has not run against any of Milestone 2.
- `pnpm example:run` against a live Gateway model remains unverified without a credential.

### Next exact step

Start Milestone 4 (Workflow IR, DSL, and Local Deterministic Runtime), the critical path, by
creating its status file from the build plan in the M2 file's shape. Milestone 3 (Jev) is blocked
only by M2 and may start beside M4 at any point.

---

## 2026-09-20 01:00 — M4-T1, M4-T2 — Serializable workflow IR and node contracts

**Status:** started
**Actor/session:** Claude Opus 5 (1M context) implementer subagent
**Commit:** `4c03e2e`

### Goal

Define the versioned, serializable workflow IR (M4-T1) and the contract every
node in it obeys (M4-T2), so that the validator (M4-T4/M4-T9), the local
deterministic runtime (M4-T6) and the typed DSL (M4-T5) can be built in
parallel against a stable shape.

Because the IR is one value, this task also fixes the *type half* of three
later tasks: the node-type union (M4-T3), the five control shapes (M4-T4), the
`call` node's effect and protection declarations (M4-T7) and the per-node tool
grants (M4-T8). It does **not** implement graph validation, capability
resolution, the runtime or the DSL.

Concretely:

- `@internal/core` gains the IR types, a strict `parseWorkflowDefinition()`
  boundary in the shape of `parseJob()` (unknown fields rejected at every
  level, `deepFreeze`d result, every failure a `ValidationError` with a path),
  an `isWorkflowDefinition()` guard, `canonicalWorkflowIr()` and
  `workflowFingerprint()` over the existing `canonicalJson`/`fingerprint`, and
  the `FallbackContext` envelope from build plan section 5.
- A new `packages/workflow` (`@internal/workflow`) is scaffolded with exactly
  one export, the `CompiledWorkflow` interface the validator produces and the
  runtime consumes.

### Implementation references

- package/version: Node **24.21.0** (`.node-version`, `.nvmrc`); pnpm
  **12.4.2**; TypeScript 6.0.x (ADR-0019); Vitest 5.0.1. **No new third-party
  dependency**, and `@internal/core` stays zero-dependency.
- installed docs read: not applicable. This task is framework-facing in no
  respect: nothing in `eve`, the AI SDK, AI Gateway, Jev, Workflow or Sandbox
  prescribes a workflow IR, so the no-assumption stop condition's last branch
  applies and the abstraction is harness-owned and recorded in an ADR.
- official docs/repos/examples read: none required for the same reason.
- public types/exports inspected: `packages/core/src/job.ts` (`parseJob`, the
  `collectUnknownKeyIssues`/`collectThrownIssues` style this follows),
  `capabilities.ts` (`CapabilityRef`, `parseCapabilityRefString`),
  `context.ts` (`Budget`, `ToolGrant`, `DomainRef`), `identifiers.ts`
  (`IDENTIFIER_PATTERN`, `EXACT_VERSION_PATTERN`, `collectRefIssues`,
  `throwIfIssues`), `fingerprint.ts` (`canonicalJson`, `fingerprint`),
  `freeze.ts` (`deepFreeze`), `json.ts` (`isJsonValue`, `isPlainObject`),
  `errors.ts` (`ValidationError`, `ValidationIssue`), `trace.ts` (the
  `node.*` event types and `TraceEvent.node`), `behavior.ts`
  (`BehaviorDescriptor.workflowIr`), and `packages/trace`'s package scaffold.
- selected documented pattern: the repository's own parse-boundary pattern,
  `parseJob()`. One shared `readWorkflowDefinition()` that both
  `isWorkflowDefinition()` and `parseWorkflowDefinition()` call, collecting
  every issue with a path rather than throwing on the first, and rebuilding
  the value from exactly the fields it validated so that "the result has no
  unknown fields" is true by construction rather than by assertion.
- harness-owned: the IR itself. The `Binding` data-flow model, the eleven node
  shapes, the reserved-and-rejected types, and the idempotency-key formula are
  this project's design, recorded in ADR-0038.

### Next exact step

Write `packages/core/src/workflow-nodes.ts` and `workflow-ir.ts` with their
co-located tests, then scaffold `packages/workflow`, then the contract doc,
ADR-0038, and the system-map and contracts-README updates.

---

## 2026-09-20 02:10 — M4-T1, M4-T2 — Serializable workflow IR and node contracts

**Status:** completed
**Actor/session:** Claude Opus 5 (1M context) implementer subagent
**Commit:** `4c03e2e`

### Goal

Unchanged from the `started` entry above: define the versioned, serializable
workflow IR (M4-T1) and the per-node contract (M4-T2), including the type half
of M4-T3 (node types), M4-T4 (control shapes), M4-T7 (idempotency declarations)
and M4-T8 (per-node tool grants), so the validator, runtime and DSL can be built
in parallel against a stable shape. Graph validation, capability resolution, the
runtime and the DSL are explicitly out of scope.

### Implementation references

As recorded in the `started` entry: no framework-facing surface, no new
third-party dependency, `@internal/core` still declares zero dependencies. The
pattern followed is the repository's own `parseJob()` boundary, and the
placement follows the `@internal/trace` precedent.

### Work completed

- **`packages/core/src/workflow-nodes.ts`** (1473 lines): the node half.
  `NodeId`/`isNodeId`; `NODE_TYPES` (eleven), `CONTROL_NODE_TYPES` (five),
  `RESERVED_NODE_TYPES` (`human`, `subworkflow`), `CALL_EFFECTS`,
  `JEV_QUESTION_KINDS`, `BINDING_KINDS`, `MAX_BINDING_DEPTH`; the five-case
  `Binding` union; `RetryPolicy`, `NodeProtection`, `NodeCapabilityRef`;
  `WorkflowNodeBase` with M4-T2's eight fields plus `input`; the eleven node
  interfaces and the `WorkflowNode` discriminated union; `BranchSelector` and
  `LoopCondition`; and `readWorkflowNode()`, the per-node validate-and-rebuild
  pass (module-internal, not re-exported from the package barrel).
- **`packages/core/src/workflow-ir.ts`** (511 lines): `WorkflowDefinition`,
  `WORKFLOW_SCHEMA_VERSION`, `FALLBACK_REASONS` / `FallbackReason` /
  `FallbackContext`, `parseWorkflowDefinition()`, `isWorkflowDefinition()`,
  `canonicalWorkflowIr()` and `workflowFingerprint()`. Both halves share one
  `readWorkflowDefinition()` pass, in the `readJob()` style: every issue
  collected with a path, the value rebuilt from exactly the validated fields,
  `deepFreeze`d on the way out.
- **`packages/core/src/workflow-ir.test.ts`** (926 lines, **59 tests**): a
  fixture covering all eleven node types, every binding kind and both selector
  forms; the round trip and deep freeze; unknown fields at top level, on a node,
  on a retry policy, on a binding and nested inside an object binding; a field
  borrowed from another node type; `next` on the two types that have none; both
  reserved types with their specific message; required fields per node type; key
  ≠ `id`; `schemaVersion` ≠ 1; non-exact versions; malformed capability
  references; non-JSON values (`Date`, non-finite, cycle); the binding-depth
  guard; a group pinning what parse deliberately leaves to the validator;
  `isWorkflowDefinition` agreeing with `parseWorkflowDefinition` case by case;
  and key-order independence plus one-field sensitivity for
  `canonicalWorkflowIr`/`workflowFingerprint`.
- **`packages/core/src/index.ts`**: named re-exports for both modules, in
  Biome's order, with a header note and per-block comments naming the tasks and
  ADR-0038.
- **`packages/workflow`** (`@internal/workflow`): scaffolded from
  `packages/trace`'s shape. `package.json` (depends on `@internal/core`;
  devDeps `@internal/config`, `@internal/testing`, `vitest@5.0.1`),
  `tsconfig.json`, `tsconfig.build.json`, `src/compiled.ts` (the
  `CompiledWorkflow` interface, documenting exactly what holding one guarantees)
  and `src/index.ts` exporting only that.
- **`tests/architecture/boundaries.ts`**: `@internal/workflow` added to
  `forbiddenByPackage` with core's bans and a comment explaining that the npm
  package named `workflow` is Vercel's durable primitive and a different thing.
- **`tests/architecture/package-boundaries.test.ts`**: the new package added to
  the "discovers every workspace package" list, which the test asserts
  exhaustively.
- **`pnpm install`** (not `--frozen-lockfile`, since a workspace package was
  added): `pnpm-lock.yaml` gained 16 lines and is part of this change.
- **`docs/contracts/workflow-ir.md`**: new, `status: active`. The definition,
  the node contract, the data-flow model, all eleven node types, the five
  control shapes, M4-T7's effects and the idempotency-key formula, the explicit
  parse-versus-validate table, canonicalization and the fingerprint, and the
  fallback envelope.
- **`docs/decisions/0038-workflow-ir-lives-in-core-behavior-lives-in-the-workflow-package.md`**:
  new, `accepted`. Placement, the two departures from the plan's example, the
  `Binding` model, named-not-registered Jev questions, reserved-and-rejected
  types, why no idempotency key is stored, and nine rejected alternatives.
- **`docs/decisions/README.md`**: the ADR-0038 index row.
- **`docs/contracts/README.md`**: the `workflow-ir.md` row changed from planned
  to active, plus the sentence that said `FallbackContext` waits for M4, the
  contract count (twelve to thirteen) and the "all live in `packages/core`
  except" clause, which now names two behavior halves rather than one.
- **`docs/architecture/system-map.md`**: the `packages/workflow` status row
  changed from planned to exists; a prose paragraph for the package beside the
  other package paragraphs; two source-file bullets for the new core modules and
  the new package; frontmatter `implementation` and `related` extended;
  `last_verified` moved to 2026-09-20.

### Files changed

Code:
- `packages/core/src/workflow-nodes.ts` (new)
- `packages/core/src/workflow-ir.ts` (new)
- `packages/core/src/index.ts`
- `packages/workflow/src/compiled.ts` (new)
- `packages/workflow/src/index.ts` (new)

Tests:
- `packages/core/src/workflow-ir.test.ts` (new)
- `tests/architecture/boundaries.ts`
- `tests/architecture/package-boundaries.test.ts`

Config:
- `packages/workflow/package.json` (new)
- `packages/workflow/tsconfig.json` (new)
- `packages/workflow/tsconfig.build.json` (new)
- `pnpm-lock.yaml`

Docs:
- `docs/contracts/workflow-ir.md` (new)
- `docs/decisions/0038-workflow-ir-lives-in-core-behavior-lives-in-the-workflow-package.md` (new)
- `docs/decisions/README.md`
- `docs/contracts/README.md`
- `docs/architecture/system-map.md`
- `docs/progress/WORKLOG.md` (this entry)

### Verification

- `node --version` / `pnpm --version` — `v24.21.0` / `12.4.2` — PASS
- `pnpm install` — PASS (12 workspace projects; `pnpm-lock.yaml` +16 lines)
- `pnpm vitest run --project unit packages/core/src/workflow-ir.test.ts` — 59
  passed, 1 file — PASS
- `pnpm vitest run tests/architecture` — 16 passed, 1 file; the "discovers every
  workspace package" assertion now lists `@internal/workflow`, so the new
  package is covered by a rule rather than silently ignored — PASS
- `pnpm --filter @internal/core typecheck` — PASS
- `pnpm check` — **PASS**, all six stages. `format:check` clean over 168 files;
  `lint` clean over 169; `typecheck` 10/10 tasks; `Test Files 52 passed | 2
  skipped (54)`, `Tests 935 passed | 43 skipped (992)`; `build` 10/10 tasks;
  `check:handoff — OK`. The 43 skipped are the unchanged Supabase legs of the
  storage and inspector contract suites, which skip without
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`.
- Biome reformatted three files on first run (`workflow-ir.ts`,
  `workflow-nodes.ts`, `workflow-ir.test.ts`); its formatting was accepted, and
  `format:check` is clean.

### Decisions / deviations

All of the following are recorded in ADR-0038; listed here because they are
departures from the task's own design direction or from the build plan.

- **`workflowFingerprint()` hashes the parsed definition, not the string
  `canonicalWorkflowIr()` returns.** The two differ by one layer of JSON string
  escaping. `fingerprint()` canonicalizes with the same `canonicalJson()` before
  hashing (ADR-0029), so the digest is over exactly the bytes
  `canonicalWorkflowIr()` produces — which is what the formula meant — rather
  than over a JSON-quoted copy of them.
- **`escalate` and `branch` carry no `next` field at all**, rather than an
  optional one that must be `null`. The direction said "`next` must be null /
  absent". Allowing both would give one node two canonical forms and therefore
  two fingerprints for the same workflow. The cost is that writing `next: null`
  on an `escalate` node reports "unknown field" rather than something more
  specific.
- **Every other node type requires `next` to be present**, either a `NodeId` or
  `null`. Same reason: terminality is stated, not inferred from absence.
- **`JEV_QUESTION_KINDS` is exported as a named constant**, matching the other
  closed vocabularies, rather than being an inline union only.
- **`MAX_BINDING_DEPTH` (32) was added** and is not in the direction. A binding
  is recursive and parse is a boundary that accepts untrusted input, including a
  compiler proposal; without a bound, a deeply nested value would overflow the
  stack inside the one function whose job is to survive bad input. It is a stack
  guard, not a semantic limit.
- **Node id, workflow id, domain, job type and an `artifact` node's `name` all
  use `identifiers.ts`'s existing identifier rule.** No new naming rule was
  invented; this also keeps `:` out of every component of the idempotency key,
  so the key parses back unambiguously.
- **Split into two modules** (`workflow-ir.ts`, `workflow-nodes.ts`) as the
  direction permitted: one file would have been about 1980 lines. The dependency
  is one-directional, so there is no import cycle.
- **The budget and tool-grant collectors are duplicated from `job.ts`** (about
  forty lines). Sharing them would mean exporting a validation surface from
  `job.ts` whose only consumer is this module. Noted in ADR-0038's Negative
  consequences so a future consolidation is deliberate.
- **`docs/contracts/README.md` got three small edits beyond the status row**:
  the contract count (twelve to thirteen), the enumeration, and the "all live in
  `packages/core` except" clause. Leaving them would have left the paragraph
  factually wrong, which rule 8 forbids.

### Known issues / blockers

- **None for this task.** The IR is stable and the three downstream tasks can
  start.
- `docs/context/current-state.md`, `docs/milestones/*` and `AGENTS.md` were
  deliberately **not** touched: another agent owns them concurrently. AGENTS.md's
  ADR paragraph still ends "The next free number is 0038", and its
  repository-layout block still lists `packages/workflow/` as planned; both need
  updating by whoever owns that file.
- The `@internal/workflow` package has **no test file yet**, because it exports
  only a type. Vitest reports no missing coverage; the first test arrives with
  `compileWorkflow()`.

### Next exact step

Three tasks can now proceed in parallel against this IR:

1. **M4-T4 + M4-T9** — `compileWorkflow()` in `packages/workflow`: graph
   validation (unreachable nodes, missing nodes, incompatible schemas, cycles
   not declared as bounded loops, a `branch` with no `default`, duplicate ids),
   the node-level rules parse deliberately skips (a `code` node's `permissions`
   must be empty; a `non-idempotent-write` `call` must declare `protection`),
   and capability resolution against `CapabilityRegistry` — **excluding**
   `jev` questions, which are not a capability kind. It returns
   `CompiledWorkflow`.
2. **M4-T5** — the typed DSL, compiling to `WorkflowDefinition` and fingerprinted
   through `workflowFingerprint()`, never through builder identity.
3. **M4-T6** — the local interpreter over `CompiledWorkflow`, which owns the
   idempotency key documented in `docs/contracts/workflow-ir.md` and fills
   `TraceEvent.node`, null since M2.

First command for any of them:

```bash
export PATH="$HOME/.n/bin:$PATH" && pnpm install --frozen-lockfile && pnpm check
```

Then read `docs/contracts/workflow-ir.md` and ADR-0038.

## 2026-09-20 11:50 — M4-T3, M4-T6, M4-T7, M4-T8 — Local deterministic workflow runtime, idempotency and tool grants

**Status:** started
**Actor/session:** Claude Opus 5 (1M context) implementer subagent
**Commit:** `0d12b43`

### Goal

Build the local deterministic interpreter for the workflow IR in
`packages/workflow/src/runtime/**`, completing the *execution* half of M4-T3
(the six executable node types plus the five control shapes), and with it
M4-T6 (validate input, execute, validate output, trace, timeout, budget,
follow edges, persist node result — no durability), M4-T7 (the per-execution
idempotency key and protected non-idempotent writes) and M4-T8 (per-node tool
grants, an `agent` node receiving only its own grants, a `code` node
inheriting none).

Out of scope, owned concurrently by other agents: `src/compile.ts` and
`src/validate/**` (M4-T4/M4-T9, the `validator` agent), `src/dsl/**`
(M4-T5, the `dsl` agent) and the hand-authored vendor workflow (M4-T10).

### Implementation references

- package/version: **no third-party framework is touched.** The runtime is a
  local interpreter over `@internal/core` and Node built-ins only;
  `@internal/workflow` declares no third-party dependency and gains none.
  AD-011's framework checkpoint therefore has no framework to check.
- installed docs read: n/a (no framework surface).
- official docs/repos/examples read: n/a.
- public types/exports inspected, all first-party:
  `packages/core/src/workflow-ir.ts` (`WorkflowDefinition`, `FallbackContext`,
  `FALLBACK_REASONS`), `workflow-nodes.ts` (the eleven node interfaces,
  `Binding`, `RetryPolicy`, `NodeProtection`), `packages/workflow/src/compiled.ts`
  (`CompiledWorkflow`), `packages/core/src/trace.ts` (`TraceRecorder`,
  `TraceSpan`, `TraceEventInput.node`, the `node.*`/`tool.*`/`decision.*`/
  `artifact.created`/`fallback.*` members of the closed taxonomy),
  `context.ts` (`ExecutionContext`, `createExecutionContext`,
  `CreateExecutionContextInput.recorder`, `Budget`, `ToolGrant`),
  `agent-runtime.ts`, `harness.ts`, `errors.ts`, `schema.ts` (`validateWith`),
  `capabilities.ts` (`CapabilityRegistry.resolve`), `job.ts`,
  `packages/testing/src/*`, `packages/runtime-eve/src/eve-agent-runtime.ts`.
- selected documented pattern: the interpreter consumes `CompiledWorkflow` and
  nothing else, so every guarantee that type's doc comment lists is assumed
  rather than re-checked; it records through the **run's existing**
  `TraceRecorder` (`context.trace`) so a workflow run keeps one total order
  (ADR-0031); and it is exposed to `createHarness()` through
  `asAgentRuntime(workflow)`, the design option the M4 status file's "Before
  starting" section names, so trace, storage and `pnpm harness run show` keep
  working unchanged.
- Node built-ins used: `AbortSignal.timeout` and `AbortSignal.any`, both
  verified present in the installed `@types/node@24.13.6` under this project's
  `lib: es2024` by compiling a probe file with
  `pnpm --filter @internal/workflow typecheck` before writing any code.

### Next exact step

Implement `packages/workflow/src/runtime/**`, then ADR-0040,
`docs/architecture/workflow-runtime.md`, the four M4 status-file rows, and the
`completed` WORKLOG entry.

## 2026-09-20 14:05 — M4-T4, M4-T9 — Workflow graph validation, node rules, and capability resolution

**Status:** started
**Actor/session:** coding agent (Claude Opus 5, implementer subagent, M4 Phase 2)
**Commit:** `0d12b43`

### Goal

Implement the validation half of M4-T4 (control-shape validation rules) and all of M4-T9 (IR
canonicalization and capability resolution) as `compileWorkflow()` and `validateWorkflow()` in
`@internal/workflow`, over the IR M4-T1/M4-T2 landed in `@internal/core`. A workflow with a
missing capability, a missing node, an unreachable node, an undeclared cycle, a `branch` with no
`default`, an `item` binding outside a `map` body, a node owned by two containers, a `code` node
carrying tool grants or a `non-idempotent-write` `call` without protection MUST fail before any
node executes.

### Implementation references

- package/version: none. No third-party framework is touched; this is harness-owned graph
  analysis over `@internal/core` (workspace) only.
- installed docs read: n/a (no framework-facing surface).
- official docs/repos/examples read: n/a.
- public types/exports inspected: `packages/core/src/workflow-ir.ts`
  (`WorkflowDefinition`, `parseWorkflowDefinition`, `canonicalWorkflowIr`, `workflowFingerprint`),
  `packages/core/src/workflow-nodes.ts` (all eleven node interfaces, `Binding`, `BranchSelector`,
  `LoopCondition`, `NodeCapabilityRef`), `packages/core/src/capabilities.ts`
  (`CapabilityRegistry.has/resolve/entries`, `CapabilityManifestEntry`, `formatCapabilityRef`),
  `packages/core/src/errors.ts` (`ValidationError`, `ValidationIssue`),
  `packages/core/src/context.ts` (`ToolGrant`, `ToolGrantMode`),
  `packages/workflow/src/compiled.ts` (`CompiledWorkflow`).
- selected documented pattern: the collect-every-issue-then-throw-once pass `parseJob()` and
  `parseWorkflowDefinition()` already use, with `ValidationIssue.path` rooted at the definition.

### Work completed

- (in progress)

### Files changed

- (in progress)

### Verification

- (in progress)

### Decisions / deviations

- (in progress)

### Known issues / blockers

- Two other agents work in the same tree concurrently (`packages/workflow/src/runtime/**`,
  `packages/workflow/src/dsl/**`), so a full `pnpm check` may fail on files this task does not own.

### Next exact step

Implement `packages/workflow/src/validate/**` and `compile.ts`, then the co-located tests.

## 2026-09-20 14:20 — M4-T5 — Typed workflow DSL over the serializable IR

**Status:** started
**Actor/session:** Claude Opus 5 (1M context) implementer subagent
**Commit:** `0d12b43`

### Goal

Build the typed TypeScript authoring surface AD-007 and ADR-0007 require: a
fluent builder in `@internal/workflow` that compiles to a `WorkflowDefinition`
and nothing else, so that "the DSL compiles to IR" and "the IR, not builder
object identity, is fingerprinted" (build plan M4-T5) are structural facts
rather than conventions.

Concretely:

- `workflow({ id, version, domain, jobType, input, output, defaults })` returns
  a fluent builder with a method per IR node type (`code`, `call`, `jev`,
  `agent`, `artifact`, `escalate`, `chain`, `branch`, `map`, `reduce`, `loop`).
- Sub-graphs (branch cases and default, `map` body, `loop` body, `chain` steps)
  are authored with nested builder callbacks that terminate with `.end()`,
  `.goto(nodeId)` or a terminal node, so the IR's one-owner-per-node rule holds
  by construction.
- Wiring and schemas default to the common case: a node's `input` defaults to
  the preceding node's output, its `inputSchema` is derived from that binding,
  and the last node of the top-level chain is terminal with the workflow's
  output schema.
- `build()` returns `parseWorkflowDefinition(ir)`, so the output is shape-valid
  and deep-frozen; `toIr()` is the unparsed escape hatch.
- The builder never resolves capabilities and never imports `compileWorkflow()`
  — that is M4-T4/M4-T9's boundary, being written concurrently.

### Implementation references

- package/version: Node **24.21.0**, pnpm **12.4.2**, TypeScript 6.0.x
  (ADR-0019), Vitest 5.0.1. **No new dependency**; `@internal/workflow` stays
  dependency-free apart from `@internal/core`.
- installed docs read: not applicable. No Vercel primitive (`eve`, AI SDK, AI
  Gateway, Jev, Workflow, Sandbox) prescribes a workflow authoring DSL, so the
  no-assumption stop condition's last branch applies: the abstraction is
  harness-owned and recorded in ADR-0041.
- official docs/repos/examples read: none required for the same reason.
- public types/exports inspected: `packages/core/src/workflow-ir.ts`
  (`WorkflowDefinition`, `parseWorkflowDefinition`, `workflowFingerprint`,
  `canonicalWorkflowIr`), `packages/core/src/workflow-nodes.ts` (all eleven
  node types, `Binding`, `RetryPolicy`, `NodeProtection`, `BranchSelector`,
  `LoopCondition`), `packages/core/src/capabilities.ts`
  (`CapabilityRef`, `formatCapabilityRef`, `parseCapabilityRefString`),
  `packages/core/src/context.ts` (`Budget`, `ToolGrant`),
  `packages/core/src/errors.ts` (`ValidationError`, `ValidationIssue`),
  `packages/workflow/src/compiled.ts`, `packages/workflow/src/index.ts`.
- selected documented pattern: harness-owned. The contract it must satisfy is
  `docs/contracts/workflow-ir.md` in full.

### Work completed

- (in progress)

### Files changed

- (in progress)

### Verification

- (pending)

### Decisions / deviations

- (pending)

### Known issues / blockers

- Two other agents own `packages/workflow/src/compile.ts` + `src/validate/**`
  (M4-T4/M4-T9) and `packages/workflow/src/runtime/**` (M4-T6/T7/T8) in the
  same tree concurrently. This task touches only `src/dsl/**` and its own
  export block in `src/index.ts`.

### Next exact step

Implement `packages/workflow/src/dsl/`.

## 2026-09-20 15:40 — M4-T4, M4-T9 — Workflow graph validation, node rules, and capability resolution

**Status:** completed
**Actor/session:** coding agent (Claude Opus 5, implementer subagent, M4 Phase 2)
**Commit:** `0d12b43`

### Goal

As the `started` entry above: the validation half of M4-T4 and all of M4-T9, as `compileWorkflow()`
and `validateWorkflow()` in `@internal/workflow`.

### Implementation references

As the `started` entry above. No third-party framework is touched, so AD-011's research checkpoint
applies only to the workspace types listed there.

### Work completed

- **`compileWorkflow(definition, registry): CompiledWorkflow`** runs M4-T9's six steps in order:
  `parseWorkflowDefinition()` (whose `ValidationError` propagates unchanged), graph and node-rule
  validation, capability resolution, `canonicalWorkflowIr()`, `workflowFingerprint()`. Steps 4 and
  6 run only after everything passes, so canonical bytes and a digest never exist for a workflow
  that cannot run. It is the only way to obtain a `CompiledWorkflow`, which is how "a workflow with
  a missing capability MUST fail validation before any node executes" becomes a type-level fact.
- **`validateWorkflow(definition, registry): readonly ValidationIssue[]`** is the middle two steps,
  pure and never throwing for a validation problem, for the DSL (M4-T5) and the run inspector.
- **A graph model** (`src/validate/graph.ts`): successor edges (`next`, `cases[*]`, `default`) and
  containment (`chain.steps[*]`, `map.body`, `loop.body`) as different relations; **regions** and
  the **one-owner rule**; reachability; any-cycle rejection; and a flow graph over which dominator
  sets are computed for `{ kind: "node" }` bindings.
- **Bindings** (`src/validate/bindings.ts`): `{ kind: "item" }` only inside a `map` body
  transitively, including nested in an `object` binding's fields; a `{ kind: "node" }` binding must
  name an existing node that is not itself and that **dominates** the reader.
- **Node rules** (`src/validate/rules.ts`): grants only on `agent` and `call`; a `call` must grant
  the tool it calls, with `mode: "write"` for a write effect; a `non-idempotent-write` must declare
  `protection`; a `call` node's grants must name a registered `tool` id while an `agent` node's need
  not; every `branch` must declare a `default`; the workflow must contain a reachable `escalate`.
- **Schema compatibility** (`src/validate/schemas.ts`): reference equality on `id@version` for the
  four checkable pairings; everything else documented as run-time only.
- **Capability resolution** (`src/validate/capabilities.ts`): exact versions only, all five kinds,
  plus the cross-check that a resolved manifest entry's declared `inputSchema`/`outputSchema` equals
  the node's. `jev.question` is deliberately not resolved (ADR-0038).
- 51 co-located unit tests, positive and negative for every rule, including one named "rejects an
  intentional unbounded cycle" (a Milestone 4 acceptance criterion), same-IR and reordered-literal
  fingerprint equality through `compileWorkflow()`, and a realistic vendor-triage-shaped workflow
  compiled against a registry built the way `apps/example-agent` builds its own.
- ADR-0039 written and indexed; a "Validation and compilation (M4-T4, M4-T9)" section appended to
  `docs/contracts/workflow-ir.md` with every rule in one table.

### Files changed

- `packages/workflow/src/compile.ts` (new) — `compileWorkflow()`.
- `packages/workflow/src/validate/graph.ts` (new) — regions, ownership, reachability, cycles,
  the flow graph and dominators.
- `packages/workflow/src/validate/bindings.ts` (new) — `item` scoping and `node` binding dominance.
- `packages/workflow/src/validate/rules.ts` (new) — per-node rules, `branch` default, escalation.
- `packages/workflow/src/validate/schemas.ts` (new) — reference-equality schema compatibility.
- `packages/workflow/src/validate/capabilities.ts` (new) — capability resolution (M4-T9).
- `packages/workflow/src/validate/index.ts` (new) — `validateWorkflow()` and the re-exports.
- `packages/workflow/src/compile.test.ts` (new) — 51 unit tests.
- `packages/workflow/src/index.ts` — added this task's export block; refreshed the stale
  "still to come" comment.
- `docs/decisions/0039-workflow-validation-is-a-graph-model-with-one-owner-per-node.md` (new).
- `docs/decisions/README.md` — the 0039 index row.
- `docs/contracts/workflow-ir.md` — appended the validation section; ADR-0039 in the front matter.
- `docs/milestones/m4-workflow-ir-dsl-and-local-deterministic-runtime.md` — M4-T4 and M4-T9 only.
- `docs/progress/WORKLOG.md` — this entry and the `started` one.

### Verification

- `pnpm vitest run --project unit packages/workflow packages/core` — PASS (596 tests, 17 files; 51
  of them this task's).
- `pnpm --filter @internal/workflow typecheck` — FAIL, on `src/runtime/workflow-runtime.ts(1133,55)`
  only, a file this task does not own (the M4-T6/T7/T8 agent's, in progress). Every module this task
  added typechecks; the same command reported zero errors before that file appeared.
- `pnpm exec biome check packages/workflow/src/compile.ts packages/workflow/src/compile.test.ts
  packages/workflow/src/validate packages/workflow/src/index.ts` — PASS (9 files, no fixes).
- `pnpm check` — FAIL at its first stage, `format:check`, on `packages/workflow/src/dsl/builder.ts`
  and `packages/workflow/src/runtime/workflow-runtime.ts`. Both belong to the two agents working
  concurrently in this tree; neither was touched by this task. `pnpm lint` fails on the same two
  files plus an `organizeImports` on the shared `src/index.ts`, whose export blocks are no longer in
  sorted order now that a second block has been appended after this one. **`pnpm check` has not
  passed for this task and must be re-run once the concurrent tasks land.**

### Decisions / deviations

- **Dominance, not "ancestor along some path", for `{ kind: "node" }` bindings.** The brief allowed
  either. The weaker rule accepts a binding that reads a sibling `branch` case's output, which is
  the mistake authors and compiler proposals actually make and which otherwise only appears at run
  time as a `WorkflowError`. Cost: some workflows that would work in practice are rejected.
  Recorded in ADR-0039's Negative consequences.
- **The flow graph treats `chain` differently from `map`/`loop`.** A chain always runs every step,
  so it flows into its first step and each step's terminals flow into the next and finally into the
  chain's `next`; a `map` body may run zero times and a `loop`'s `until` may stop it, so both flow
  into their body *and* straight on to their `next`. Without the distinction, a node after a chain
  could not read what a step produced, and a node after a map could.
- **Only `agent` and `call` nodes may carry tool grants**, which is stricter than M4-T8's literal
  text (it names `code`). `permissions` is a field of every node, so something had to say where it
  means anything, and permission nothing reads is the worst kind to have. The other agents' fixtures
  must not put grants on `jev`, `artifact` or a control node.
- **A `read-only` call is satisfied by a `read` **or** a `write` grant**; a write effect requires
  `mode: "write"`. `ToolGrantMode` states that `read` never satisfies a write and says nothing about
  the converse, and requiring a double grant would be noise.
- **The vendor-triage test builds its own registry** rather than importing
  `apps/example-agent`'s, as the brief suggested. A `packages/*` package may not depend on an
  `apps/*` package (AGENTS.md's dependency rule, ADR-0025), and a devDependency would have been a
  boundary violation. The test registers the same capability ids the example does, plus the four the
  workflow additionally needs.
- **`compileWorkflow()` parses three times** (itself, then inside `canonicalWorkflowIr()` and
  `workflowFingerprint()`, both of which parse by design). Accepted rather than adding a second,
  unchecked entry point to `@internal/core`.
- **Issues are emitted in sorted node-id order**, so the list is a function of the workflow rather
  than of its literal's key order — the same property ADR-0029 gives the canonical bytes.
- `pnpm format` was run once at the repository root and reformatted seven files, including
  in-progress files under `src/dsl/` and `src/runtime/` belonging to the other two agents. No
  semantics changed; both files still fail `format:check` after their owners' later edits.

### Known issues / blockers

- `pnpm check` cannot pass until the M4-T5 and M4-T6/T7/T8 tasks land: `src/dsl/builder.ts` fails
  format and lint, and `src/runtime/workflow-runtime.ts` fails format and typecheck.
- `packages/workflow/src/index.ts` needs one `pnpm exec biome check --write` pass once every M4
  Phase 2 export block is in place; the blocks are currently not in the order the assist wants.
- `docs/context/current-state.md`, `docs/milestones/README.md` and `AGENTS.md` were deliberately not
  touched; another agent owns them. AGENTS.md's ADR paragraph still says the next free number is
  0038, and 0039 now exists.

### Next exact step

Once M4-T5 and M4-T6/T7/T8 land, run:

```bash
export PATH="$HOME/.n/bin:$PATH" && pnpm exec biome check --write packages/workflow/src/index.ts && pnpm check
```

Then M4-T10 can author the real vendor workflow against `compileWorkflow()`.

## 2026-09-20 15:30 — M4-T5 — Typed workflow DSL over the serializable IR

**Status:** completed
**Actor/session:** Claude Opus 5 (1M context) implementer subagent
**Commit:** `0d12b43`

### Goal

As in the `started` entry above: the typed TypeScript authoring surface AD-007
and ADR-0007 require, compiling to `WorkflowDefinition` and to nothing else, so
that "the DSL compiles to IR" and "the IR, not builder object identity, is
fingerprinted" (build plan M4-T5) are structural facts.

### Implementation references

Unchanged from the `started` entry. No third-party framework is involved: no
Vercel primitive prescribes a workflow authoring DSL, so the no-assumption stop
condition's last branch applies and the abstraction is harness-owned and
recorded in ADR-0041. `@internal/workflow` still depends on `@internal/core`
alone, and no dependency was added.

### Work completed

- **`packages/workflow/src/dsl/types.ts`** — the authoring surface: `RefInput`
  (a capability reference as `"id@version"` or `{ id, version }`),
  `TypedBinding<TIds>` (the IR's `Binding` with `node` references narrowed to
  the ids declared so far), `WorkflowOptions`, `CommonNodeOptions` and the
  eleven per-node option types, `SubGraph`/`SubGraphBuilder`/`SubGraphEnd`, and
  the two exported default constants.
- **`packages/workflow/src/dsl/builder.ts`** — `workflow()`, the fluent builder.
  One method per IR node type. It applies defaults, wires edges, derives
  schemas, and emits the definition.
- **`packages/workflow/src/dsl/index.ts`** — the named re-export block.
- Two co-located `unit` test files: `builder.test.ts` (44 tests) and
  `vendor-triage.test.ts` (9), 53 in total.
- **ADR-0041**, `docs/contracts/workflow-dsl.md`, the two README rows, and the
  M4 status file's `### M4-T5` section.

The design, in the five points that matter:

1. **`build()` parses.** It returns `parseWorkflowDefinition(ir)`, so a value
   that leaves the DSL is shape-valid and deep-frozen. `toIr()` returns the same
   IR unparsed and unfrozen, for a test that wants to mutate a field and watch
   the parse boundary reject it. It never resolves a capability and never
   imports `compileWorkflow()`.
2. **There is no `next` option.** Nodes added to the builder form one chain;
   each node's `next` is the node added after it and the last is terminal.
   `branch` and `escalate` carry no `next`, so they end the chain, and a node
   added after one must state its own `input` because it has no unique
   predecessor.
3. **Sub-graphs are callbacks that must terminate.** A branch case, a branch
   default, a `map` body, a `loop` body and a `chain`'s steps are each
   `(b) => ...` returning `SubGraphEnd`, which only `.end()`, `.goto()`,
   `.branch()` and `.escalate()` produce, so an unterminated sub-graph is a type
   error. A `chain`'s steps are containment: each step is terminal on its own,
   because a step reachable from a sibling's `next` *and* listed in `steps`
   would have two owners (ADR-0039).
4. **`.goto(nodeId)` sets an edge, never ownership.** Allowed only from a branch
   case or default; forward targets are checked at `build()`. A case that adds
   nothing and only `goto`s makes that node the case target directly.
5. **Bindings and schemas are derived.** `input` defaults to the predecessor's
   output (`{ kind: "input" }` first, `{ kind: "item" }` for a `map` body head,
   the container for another sub-graph head); `inputSchema` follows from that
   binding; `outputSchema` is derived only for a node that ends the main graph
   and for `branch`/`escalate`, which pass their input through. That is exactly
   ADR-0039's reference-equality schema rule, so the common case is compatible
   by construction.

### Files changed

Code:
- `packages/workflow/src/dsl/types.ts` (new)
- `packages/workflow/src/dsl/builder.ts` (new)
- `packages/workflow/src/dsl/index.ts` (new)
- `packages/workflow/src/index.ts` (the DSL export block only)

Tests:
- `packages/workflow/src/dsl/builder.test.ts` (new)
- `packages/workflow/src/dsl/vendor-triage.test.ts` (new)

Docs:
- `docs/decisions/0041-the-typed-dsl-is-a-wiring-front-end-that-parses-its-own-ir.md` (new)
- `docs/decisions/README.md` (index row only)
- `docs/contracts/workflow-dsl.md` (new)
- `docs/contracts/README.md` (table row, plus the contract count and enumeration
  the row makes stale)
- `docs/milestones/m4-workflow-ir-dsl-and-local-deterministic-runtime.md`
  (`### M4-T5` only)
- `docs/progress/WORKLOG.md` (this entry)

### Verification

- `node --version` / `pnpm --version` — `v24.21.0` / `12.4.2` — PASS
- `pnpm vitest run --project unit packages/workflow/src/dsl` — 53 passed, 2
  files — PASS
- `pnpm vitest run --project unit packages/workflow` — 203 passed, 8 files
  (the DSL beside the validator's and the runtime's suites) — PASS
- `pnpm --filter @internal/workflow typecheck` — PASS
- `pnpm format:check` — 194 files, clean — PASS
- `pnpm typecheck` — PASS (10/10 tasks)
- `pnpm test` — `Test Files 60 passed | 2 skipped (62)`, `Tests 1138 passed | 43
  skipped (1195)` — PASS. The 43 skipped are the unchanged Supabase legs of the
  storage and inspector contract suites.
- `pnpm build` — PASS (10/10 tasks)
- `pnpm lint` — PASS. `biome check --formatter-enabled=false
  packages/workflow/src/dsl packages/workflow/src/index.ts` — clean, no
  diagnostics — PASS. (An earlier run failed on three
  `assist/source/organizeImports` errors in `packages/workflow/src/runtime/**`,
  which M4-T6/T7/T8 owns and was editing concurrently; that agent fixed them.)
- `pnpm check` — **PASS**, all six stages, with the three concurrent M4 Phase 2
  tasks' work in the tree: `format:check` clean over 194 files; `lint` clean;
  `typecheck` 10/10 tasks; `Test Files 60 passed | 2 skipped (62)`,
  `Tests 1138 passed | 43 skipped (1195)`; `build` 10/10 tasks;
  `check:handoff — OK`.

### Decisions / deviations

All recorded in ADR-0041; listed here because they depart from the task
direction or from the build plan's sketch.

- **The per-node schema options are `inputSchema` and `outputSchema`, not
  `output`.** The task's sketch wrote `output:` on a `jev` node, which would sit
  beside `input:` meaning a *binding* rather than a schema. Matching the IR's own
  field names removes the ambiguity. `workflow()` itself still takes `input` and
  `output`, as the build plan writes them, because at workflow level there is no
  binding to confuse them with.
- **No `next` option on any node method.** The direction did not ask for one, but
  it is worth stating as a deliberate limit: a graph the fluent wiring cannot
  express has to be written as an IR literal. The shapes it cannot express are
  the ones with two owners.
- **Branch cases are treated as edges, not containment**, so a node inside a
  branch case whose `next` is `null` ends the *workflow* and takes the
  workflow's output schema. This follows the graph model agreed with the
  validator ("Edges are `next`, `branch.cases[*]`, `branch.default`"). It is the
  reason the vendor-triage example needs no `outputSchema` on `finalize` or
  `decide`.
- **`.goto()` from an empty branch case is allowed and means "this case goes
  straight to that node".** Discovered while testing: the alternative was to
  force a pass-through node nobody asked for. The case target becomes the named
  node directly.
- **`escalate` and `branch` take their input schema as their output schema.**
  Neither transforms its input, and the validator constrains only the terminal
  *non-escalate* node's output schema, so nothing depends on the choice; it keeps
  `.escalate("full-agent", { reason })` a one-liner.
- **The five node defaults are `timeoutMs: 60_000`, `retry: { maxAttempts: 1 }`,
  `budget: {}`, `permissions: []`, `version: "1.0.0"`**, exported as
  `DSL_NODE_DEFAULTS`, plus `DSL_WORKFLOW_VERSION_DEFAULT` for the workflow's own
  version. The build plan leaves all of them open, so AD-016 requires the choice
  to be recorded; ADR-0041 gives the reasoning per field.
- **Type-level help stops at node ids.** Backward `{ kind: "node", node: ... }`
  references are typo-checked through a string-literal union; forward `goto`
  targets and every `Binding` value are checked at run time. No type-level schema
  inference was built, per the direction and because the IR stores schema
  *references* resolved against a registry, which a type-level model could not
  keep honest.
- **The builder mutates shared state and returns `this`.** The fluent type reads
  as if each call produced a new builder; it does not, so a builder value must be
  used linearly. Noted in ADR-0041's negative consequences.
- **`docs/contracts/README.md` got two edits beyond the table row**: the contract
  count (thirteen to fourteen) and its enumeration. Leaving them would have made
  the paragraph disagree with the table directly above it.
- **The M4 status file's acceptance-criteria list was not touched.** Two of its
  eight lines are this task's ("DSL output can be serialized to canonical IR",
  "Same IR produces same workflow fingerprint") and both are now covered by
  tests, but the task direction says to edit `### M4-T5` only, and the list is
  shared with the two agents working beside this one.

### Known issues / blockers

- **None for this task.** An intermediate `pnpm lint` failure came from
  `packages/workflow/src/runtime/**`, which M4-T6/T7/T8 owns and has since
  fixed; the final `pnpm check` is green.
- Nothing in this task touched `packages/core`, `src/compile.ts`,
  `src/validate/**`, `src/runtime/**`, `AGENTS.md`,
  `docs/context/current-state.md` or `docs/milestones/README.md`. No IR bug was
  found: the DSL emits every one of the eleven node types and both selector
  forms through `parseWorkflowDefinition()` unchanged.
- `AGENTS.md` is owned by another agent and was not touched here. Its ADR
  paragraph needs to end at "the next free number is 0042" once ADR-0039,
  ADR-0040 and ADR-0041 are all reflected, and its repository-layout block still
  lists `packages/workflow/` as planned.

### Next exact step

**M4-T10** can author the real vendor workflow with this DSL. It needs three
things from here, and nothing else:

1. `import { workflow } from "@internal/workflow";` then
   `workflow({ id, version, domain, jobType, input, output }).jev(...)...build()`.
   The full authoring surface is `docs/contracts/workflow-dsl.md`, and
   `packages/workflow/src/dsl/vendor-triage.test.ts` is the exact M4-T10 graph
   already written against it.
2. Write down only what a node genuinely introduces: an `outputSchema` where the
   node produces a new shape, and `permissions` on the `agent` node. Everything
   else — every edge, every `input` binding, every derived `inputSchema` — is the
   builder's job. State `input` explicitly only for a node added to the top level
   *after* a `branch`, which is the one position with no unique predecessor.
3. `build()` gives a parsed, frozen `WorkflowDefinition`; hand it to
   `compileWorkflow(definition, registry)` to resolve capabilities. Register the
   schemas *before* the handlers, agents and tools that reference them, and do
   not try to register a Jev question — a question is not a capability kind.

First command:

```bash
export PATH="$HOME/.n/bin:$PATH" && pnpm vitest run --project unit packages/workflow/src/dsl
```

## 2026-09-20 12:10 — M4-T3, M4-T6, M4-T7, M4-T8 — Local deterministic workflow runtime, idempotency and tool grants

**Status:** completed
**Actor/session:** Claude Opus 5 (1M context) implementer subagent
**Commit:** `0d12b43`

### Goal

Unchanged from the `started` entry above: the local deterministic interpreter
for the workflow IR in `packages/workflow/src/runtime/**`, completing the
*execution* half of M4-T3 (six node types) and M4-T4 (five control shapes), and
with it M4-T6 (validate, execute, validate, trace, timeout, budget, edges,
result — no durability), M4-T7 (the idempotency key and protected
non-idempotent writes) and M4-T8 (per-node tool grants).

### Implementation references

As recorded in the `started` entry, and unchanged by the work: **no third-party
framework is touched and no dependency was added.** `@internal/workflow` still
declares only `@internal/core`, plus `@internal/config`, `@internal/testing` and
`vitest` as dev dependencies. AD-011's framework checkpoint therefore has no
framework to check.

Node built-ins used and verified before writing any code:
`AbortSignal.timeout(ms)` and `AbortSignal.any(signals)`, both present in the
installed `@types/node@24.13.6` under this project's `lib: ["es2024", ...]`,
confirmed by compiling a two-line probe file with
`pnpm --filter @internal/workflow typecheck` and deleting it.

### Work completed

- **`packages/workflow/src/runtime/ports.ts`** — the three ports the runtime
  needs and does not own, each with an in-memory default:
  `WorkflowDecisionPort` (M3's engine seen from M4, one verb),
  `ArtifactStorePort` (M5's store) and `ProtectedEffectStore` (M4-T7).
- **`packages/workflow/src/runtime/bindings.ts`** — the five-case binding
  evaluator over the contract's run-state model, `readPath()`, `asJsonValue()`
  (a check, not a cast, at every JSON port boundary) and `traceValue()`.
- **`packages/workflow/src/runtime/budget.ts`** — `createBudgetLedger()`, a
  **stack** of budget scopes so the run's budget and every enclosing node's are
  in play at once, and `narrowBudget()` for an `agent` node's derived context.
- **`packages/workflow/src/runtime/grants.ts`** — `requiredMode()`,
  `assertGrantsWithinJob()` and `assertToolGranted()` (M4-T8).
- **`packages/workflow/src/runtime/idempotency.ts`** — `attemptIdempotencyKey()`
  and `protectionIdempotencyKey()`, the two keys and why there are two.
- **`packages/workflow/src/runtime/workflow-runtime.ts`** (~1,290 lines) —
  `createWorkflowRuntime()`, `WorkflowRuntime`, `WorkflowRunResult` (four cases),
  `NodeExecutionRecord`, `fallbackContextPayload()`, and `asAgentRuntime()`.
- **`packages/workflow/src/runtime/index.ts`** — the runtime barrel, re-exported
  by name from `packages/workflow/src/index.ts` (own block only; the file was
  re-read immediately before editing, and the DSL and validator blocks were left
  untouched).
- **`packages/workflow/tsconfig.build.json`** — one line: `test-fixtures.ts` is
  excluded from the build so test-only code and its `@internal/testing`
  devDependency never reach `dist/`. `tsconfig.json` still typechecks it.
- **Tests, 101 across five files**, all in the `unit` project, every schema a
  hand-written Standard Schema (no `zod` in this package):
  `workflow-runtime.test.ts` (44), `grants.test.ts` (14),
  `idempotency.test.ts` (11), `bindings.test.ts` (19), `budget.test.ts` (13),
  plus `test-fixtures.ts`. Five build-plan acceptance criteria appear **verbatim
  as test titles**: "A human-authored workflow runs locally", "Every node
  validates inputs and outputs", "An agent node cannot call an ungranted tool",
  "A failed node is visible in the trace", "A retry does not duplicate a
  protected side effect". Four of the 44 leave the hand-built fixtures behind:
  two compile a definition with the concurrently-landed `compileWorkflow()`, and
  two more author it with the typed DSL first, so the full M4-T5 -> M4-T9 ->
  M4-T6 path — `workflow().build()`, `compileWorkflow()`, `runtime.run()` — is
  exercised end to end and the three halves cannot drift apart silently.
- **`docs/decisions/0040-*.md`** (accepted, 2026-09-20, related 0028/0031/0035/
  0038/0039) and **`docs/architecture/workflow-runtime.md`**, including the
  worked trace event list a six-node run produces, taken from a real run rather
  than written by hand.

### Files changed

Source:
- `packages/workflow/src/runtime/ports.ts` (new)
- `packages/workflow/src/runtime/bindings.ts` (new)
- `packages/workflow/src/runtime/budget.ts` (new)
- `packages/workflow/src/runtime/grants.ts` (new)
- `packages/workflow/src/runtime/idempotency.ts` (new)
- `packages/workflow/src/runtime/workflow-runtime.ts` (new)
- `packages/workflow/src/runtime/index.ts` (new)
- `packages/workflow/src/index.ts` (runtime export block appended)

Tests:
- `packages/workflow/src/runtime/test-fixtures.ts` (new, test-only module)
- `packages/workflow/src/runtime/workflow-runtime.test.ts` (new)
- `packages/workflow/src/runtime/grants.test.ts` (new)
- `packages/workflow/src/runtime/idempotency.test.ts` (new)
- `packages/workflow/src/runtime/bindings.test.ts` (new)
- `packages/workflow/src/runtime/budget.test.ts` (new)

Config:
- `packages/workflow/tsconfig.build.json` (one `exclude` entry)

Docs:
- `docs/decisions/0040-the-local-workflow-runtime-interprets-a-compiled-workflow-and-escalates-rather-than-fails.md` (new)
- `docs/decisions/README.md` (index row 0040 only)
- `docs/architecture/workflow-runtime.md` (new)
- `docs/architecture/system-map.md` (frontmatter pointer plus the stale
  "none of them exist yet" sentence in "Per-topic architecture documents")
- `docs/milestones/m4-workflow-ir-dsl-and-local-deterministic-runtime.md`
  (`### M4-T3`, `### M4-T6`, `### M4-T7`, `### M4-T8` only)
- `docs/progress/WORKLOG.md` (this entry)

### Verification

- `node --version` / `pnpm --version` — `v24.21.0` / `12.4.2` — PASS
- `AbortSignal.timeout` / `AbortSignal.any` probe compiled against the installed
  `@types/node@24.13.6` — PASS
- `pnpm vitest run --project unit packages/workflow/src/runtime` — 101 passed,
  5 files — PASS
- `pnpm vitest run --project unit packages/workflow` — 211 passed, 8 files
  (the runtime's 101 plus the concurrently-landed validator and DSL suites) —
  PASS
- `pnpm --filter @internal/workflow typecheck` — PASS
- `pnpm format:check` — PASS (194 files)
- `pnpm lint` — PASS (195 files, 0 errors)
- `pnpm check` — **PASS**, exit 0, all six stages. `format:check` clean over 194
  files; `lint` clean over 195; `typecheck` 10/10 tasks; `Test Files 60 passed |
  2 skipped (62)`, `Tests 1146 passed | 43 skipped (1203)`; `build` 10/10 tasks;
  `check:handoff — OK`. The 43 skipped are the unchanged Supabase legs of the
  storage and inspector contract suites, which skip without
  `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`.
- An earlier `pnpm check` failed its `build` stage on another agent's in-flight
  file (`packages/workflow/src/dsl/builder.ts`, four TS2339/TS2353 errors about a
  `permissions` property its own `types.ts` did not declare). It cleared on its
  own when that agent finished; no file this task owns was involved.

### Decisions / deviations

All recorded in ADR-0040; listed here because each departs from the task text or
resolves something it left open.

- **A `branch` is pass-through**, outputting the value it routed rather than
  `{ label }`, with the label it chose and the node it chose recorded as `label`
  and `target` in its `node.completed` payload. This
  reverses the direction this task started from, after the concurrently-written
  validator landed the matching rule ("a `branch`'s `outputSchema` must be its
  own `inputSchema`, because a branch routes rather than computes") in
  `docs/contracts/workflow-ir.md` and ADR-0039. The two halves have to agree or a
  compiled workflow could not run, and pass-through is the better semantics
  anyway: the node after a branch binds the branch's output and receives the
  thing being decided about rather than a wrapper it has to reach around. Caught
  by the integration test that goes through `compileWorkflow()`, which is exactly
  what that test is for, and now locked in by two further tests that author the
  workflow with the DSL, whose builder wires each case's first node to
  `{ kind: "node", node: "<branch>" }` at the branch's own input schema.
- **The package's public surface is the runtime's contract, not its parts.**
  `index.ts` exports `createWorkflowRuntime`, its option and result types, the
  three ports with their request/record types, the two in-memory port factories,
  `NodeExecutionRecord`, the two idempotency-key functions and
  `fallbackContextPayload`. The binding evaluator, the budget ledger and the
  grant assertions stay module-private, along with `IdempotencyCoordinates`,
  `BindingScope`, `BindingItem`, `BudgetLedger` and `BudgetTotals`: they are how
  the interpreter is built rather than what a caller needs, and the repository's
  rule is that a symbol becomes public deliberately. The key functions are public
  because the contract doc states their formula, and they take a structural
  argument so a caller writes an object literal rather than naming the
  coordinates type; `fallbackContextPayload` is public because M5's router has to
  read an escalation's envelope as JSON. Everything else is reachable from
  `./runtime/index.js`, which is how this package's own tests import it.
- **Two idempotency keys, not one.** The build plan's formula contains the
  attempt; a retry is by definition a different attempt, so a protection key
  built from it would differ on every retry and never match, and M4-T7's own
  acceptance criterion would be unsatisfiable. The per-attempt key is the plan's
  formula verbatim and identifies an execution; the protection key is the same
  string without the attempt, so one is literally the other's prefix.
- **`node.*` trace payloads carry input and output, amending ADR-0031's
  identity-only rule** for those three event types only. M4-T6 says "persist
  node result" and forbids durability in the same breath, so the trace is the
  only place a result can go; M6's replay needs the values; redaction is a
  writer decorator above the buffer (ADR-0035), so secrets are still stripped.
- **A node that exhausts its retries escalates; `failed` is for defects.**
  North-star invariant 1. `failed` covers a binding that reads a node which has
  not run, an `item` binding outside a `map`, a `branch` label with neither case
  nor default, and a node id no node answers to — all graphs the validator is
  expected to have rejected.
- **An escalation raised inside a container node passes through unchanged.**
  Found by a failing test: re-wrapping turned a child's `budget-exceeded` into
  the container's `node-failed`. The reason the node that actually gave up chose
  is the one that reaches the envelope, and a sub-graph that exhausted its own
  attempts is not re-run.
- **`trusted` is decided by who produced the value**, not by whether it
  validated (everything in `completedNodes` validated). Trusted: `code`,
  `artifact`, every control shape, and a `read-only` `call`. Untrusted: `agent`,
  `jev`, and any write `call` — for a write, a retry, a partial write or a
  protected replay all mean the world and the recorded value may disagree.
- **A budget scope is opened per attempt, and a node budget covers nested work.**
  A charge hits every open scope, so a `map` with `maxToolCalls: 10` bounds the
  whole fan-out. The consequence is that a node with `maxToolCalls: 1` and
  `maxAttempts: 3` may make three calls across three attempts, which is the
  right reading of a limit on one execution.
- **`maxDurationMs` is checked at node boundaries, not enforced mid-node.** The
  interrupting deadline is `timeoutMs`, and the runtime *races* rather than
  cancels, because a handler or tool is a plain function under no obligation to
  watch a signal.
- **Binding narrowing yields `undefined` rather than throwing**, and the node's
  `inputSchema` decides. One rule for an absent key and for reading through a
  non-object, and schemas stay the single arbiter of a node's input. An `object`
  binding omits a field that resolved to nothing, so the in-memory value and its
  serialized form agree.
- **A protected replay records a `tool.started`/`tool.completed` pair marked
  `replayed` and charges zero tool calls.** Emitting nothing would hide that
  protection fired; emitting a bare `tool.completed` would break ADR-0031's
  "a terminal event points at its own `*.started`".
- **The runtime emits no `agent.*` of its own** around an `agent` node, because
  every adapter already emits its pair (verified against
  `createFakeAgentRuntime` and `EveAgentRuntime`). The cost is that the
  adapter's span is parented on `recorder.rootId` rather than the node span.
- **`escalated` maps to a `FailedAgentExecution`** through `asAgentRuntime()`,
  carrying the envelope in a `WorkflowError`'s `details.fallback`. Marked in code
  and in ADR-0040 as the mapping M5's router replaces.
- **An artifact id is a plain string**, minted as a sortable UUIDv7 whose brand
  is discarded: ADR-0030 defines twelve entity brands and an artifact is not one,
  and minting a thirteenth would be M5's decision made by M4.
- **A missing decision engine or agent runtime is a node failure, not a
  construction error**, so a workflow with no `jev` node need not be handed a
  stub it never calls.
- **A defensive ceiling of 100,000 visited nodes** exists in the traversal. It is
  unreachable for a validated graph; it is there so a broken guarantee stops with
  a named error rather than spinning.
- **`packages/workflow/tsconfig.build.json` gained one `exclude` entry.** Shared
  test fixtures live in an ordinary module rather than a `*.test.ts` one, so
  importing them does not re-run another file's suite; excluding it keeps
  test-only code and `@internal/testing` out of `dist/`.

### Known issues / blockers

- **None for this task.** `pnpm check` passes.
- **A `jev` node cannot execute against a real engine until M3.** M4's tests use
  a fake `WorkflowDecisionPort`, exactly as the milestone's "Before starting"
  section anticipates.
- **No durability**, by instruction (M4-T6). A node result lives in run state, in
  the returned result and in the trace, and a crashed process loses it. M5 and M6
  are what change that.
- `AGENTS.md`, `docs/context/current-state.md` and `docs/milestones/README.md`
  were deliberately **not** touched: other agents own them concurrently.
  AGENTS.md's ADR paragraph still says "The next free number is 0038" and its
  repository-layout block still lists `packages/workflow/` as planned.

### Next exact step

M4-T10, the hand-authored vendor workflow, is now unblocked: the IR, the
validator, the DSL and the runtime all exist. What its author needs to know
about this runtime:

1. A `jev` node's fake port returns a bare `JsonValue`, which the node's
   `outputSchema` then validates. For the vendor workflow's classify step,
   return something a `branch` can read a string label out of, e.g.
   `{ "label": "clear" }`.
2. A `branch` label is a string read from a field path over the branch node's
   **validated input**, or the return value of a registered `policy` capability
   called with that input. A `branch` is **pass-through**: its output is the
   value it routed, so its `outputSchema` must be its own `inputSchema` (the
   validator enforces this), and the label appears only in its `node.completed`
   trace payload. The validator also requires a `default`.
3. `runtime.asAgentRuntime(compiled)` is what `createHarness({ agentRuntime })`
   takes. The workflow's `inputSchema`/`outputSchema` capabilities must be
   registered in the same registry the runtime was constructed with, and the
   domain's own schemas still validate the job on both sides.
4. The validator requires a reachable `escalate` node, so the vendor workflow's
   "uncertain" branch is not optional — it is what makes the graph compile.

First command:

```bash
export PATH="$HOME/.n/bin:$PATH" && pnpm check
```

## 2026-09-20 16:10 — M4-T5 — DSL amendment: grants are offered only where the IR allows them

**Status:** completed
**Actor/session:** Claude Opus 5 (1M context) implementer subagent
**Commit:** `0d12b43`

### Goal

Close a real gap the M4-T4/M4-T9 agent found when it published the validator's
node rules: the DSL as first written let a workflow-level
`defaults: { permissions: [...] }` put a non-empty `permissions` on **every**
node, including `code`, `jev`, `artifact` and the five control shapes. The
validator rejects that — "a `code` node runs a registered handler and uses no
tools, so its `permissions` must be empty; it does not inherit an agent's tools"
(M4-T8) — so the DSL could build a definition that could never compile, which is
the one thing a typed authoring layer exists to prevent.

The same review also fixed a second, smaller gap: a `call` node must declare a
grant for the tool it calls, at `read` for `read-only` and `write` for either
write effect, and the DSL made the author restate an id it already had.

### Implementation references

Unchanged: no framework is involved. The rules implemented against are
`packages/workflow/src/validate/rules.ts` (`collectNodeRuleIssues`), read at the
version in the tree, and ADR-0039.

### Work completed

- **`permissions` left `NodeDefaults` and `CommonNodeOptions`.** A new
  `GrantingNodeOptions` carries it, and only `AgentNodeOptions` and
  `CallNodeOptions` extend it. It is therefore absent from the workflow-level
  `defaults` block and from every other node method's options, so M4-T8 is
  **unwritable** rather than merely rejected. `resolveCommon()` now takes the
  resolved grants as a parameter and defaults them to `[]`.
- **A `call` node with no stated `permissions` is granted its own tool**, at
  `read` for a `read-only` effect and `write` for `idempotent-write` and
  `non-idempotent-write` — exactly the grant `collectNodeRuleIssues` requires. An
  explicit `permissions` is used as written, which is how a scope or a second
  grant is added.
- `GrantingNodeOptions` is exported from `@internal/workflow`.
- Four new tests, and one existing test moved from `.code()` to `.agent()`
  because it can no longer be written against a `code` node. The new ones cover
  the derived `call` grant for both effect classes, an explicit `call` grant
  winning over the derived one, `permissions: []` on nodes that cannot carry
  grants, and two `@ts-expect-error` assertions proving the option is absent from
  `.code()` and from the workflow `defaults` block.

The validator's other two rules needed no code change and are now documented
rather than enforced, because neither is a property of a single builder call:

- **Binding dominance.** The DSL's own defaults never bind past a container: a
  node after a `map` or a `loop` binds to the `map`/`loop` node itself, not into
  its body, and a node inside a body binds to its predecessor in the same body.
  An explicitly stated binding can still violate the rule, and the validator
  catches it.
- **`.goto()` out of a container body** was already rejected at definition time
  and already had a test.
- **A workflow needs a reachable `escalate` node.** That is a property of a whole
  graph, so it stays the validator's; `docs/contracts/workflow-dsl.md` now warns
  that most of its own small examples would not compile for exactly this reason.

The test that the vendor-triage build passes `compileWorkflow()` against a
registry the test constructs already existed, in
`packages/workflow/src/dsl/vendor-triage.test.ts`. It builds its own
`createCapabilityRegistry()` with five hand-written Standard Schema objects, two
handlers, one agent and one tool; it imports nothing from `apps/*` and adds no
dependency.

### Files changed

- `packages/workflow/src/dsl/types.ts` (`NodeDefaults`, new `GrantingNodeOptions`,
  `CodeNodeOptions`, `CallNodeOptions`, `AgentNodeOptions`, `DSL_NODE_DEFAULTS`)
- `packages/workflow/src/dsl/builder.ts` (`resolveCommon`, `callDraft`,
  `agentDraft`, `workflow()`)
- `packages/workflow/src/dsl/index.ts`, `packages/workflow/src/index.ts`
  (one export name)
- `packages/workflow/src/dsl/builder.test.ts`
- `docs/decisions/0041-the-typed-dsl-is-a-wiring-front-end-that-parses-its-own-ir.md`
- `docs/contracts/workflow-dsl.md`
- `docs/milestones/m4-workflow-ir-dsl-and-local-deterministic-runtime.md` (`### M4-T5`)
- `docs/progress/WORKLOG.md` (this entry)

### Verification

- `pnpm vitest run --project unit packages/workflow/src/dsl` — 57 passed, 2
  files — PASS
- `pnpm --filter @internal/workflow typecheck` — PASS. Before the test was
  updated it failed on `builder.test.ts:259` with "'permissions' does not exist
  in type 'CodeNodeOptions<never>'", which is the gap closing: the compiler now
  rejects what the validator used to have to.
- `biome check --formatter-enabled=false packages/workflow/src/dsl
  packages/workflow/src/index.ts` — clean — PASS
- `pnpm format:check` — PASS
- `pnpm vitest run --project unit packages/workflow` — **3 failed, 206 passed**,
  all three in `packages/workflow/src/runtime/workflow-runtime.test.ts`
  ("derives a `branch` label from a registered policy", "runs a workflow produced
  by the validator, not hand-built", "escalates through the compiled workflow's
  own escalate branch"), which M4-T6/T7/T8 owns and was editing while this ran.
  All three are `compileWorkflow: workflow definition is invalid`, a disagreement
  between that task's hand-built fixtures and the validator's rules. No DSL file
  is involved. Reported to the orchestrator rather than fixed, per the file
  ownership split.

### Decisions / deviations

- **`permissions` is the one setting the workflow-level `defaults` block does not
  offer.** It was the simplest way to make a class of invalid workflow
  unwritable, and it is why `DSL_NODE_DEFAULTS` no longer
  `satisfies Required<NodeDefaults>` on its own.
- **A `call` node's grant is derived, not required.** The alternative — making
  `permissions` mandatory on `.call()` — would have been safe too, but it makes
  every call site restate an id the node already carries, and the derived value
  is the only one the validator accepts anyway.

### Known issues / blockers

- The three failing tests above belong to M4-T6/T7/T8 and were failing before
  this change. `pnpm check` cannot be green until that task's fixtures and the
  validator agree.

### Next exact step

Unchanged from the previous entry: **M4-T10** authors the real vendor workflow
with this DSL. One addition to what it needs to know: do **not** write
`permissions` on a `call` node unless a scope is needed — the DSL derives the
grant the validator wants — and remember that a compiled workflow needs a
reachable `escalate` node.

## 2026-09-20 16:30 — M4-T10 — Hand-authored compiled vendor workflow and M4 acceptance verification

**Status:** started
**Actor/session:** Claude Opus 5 (1M context) implementer subagent
**Commit:** `e461297`

### Goal

Author Milestone 4's vendor workflow for real, in `apps/example-agent`, with the
typed DSL (M4-T5), against the domain's own capability registry (M1-T9), and run
it through `createHarness()` on the local deterministic runtime (M4-T6). Then
verify all eight of Milestone 4's acceptance criteria with dated evidence in the
status file.

```text
jev classify ──┬── clear     → code finalize                      (→ vendor-triage.output)
               ├── research  → agent research → jev verify → code decide
               └── default   → escalate full-agent
```

The two Jev questions are answered by a deterministic fixture
`WorkflowDecisionPort`, a documented placeholder until M3 lands a
`DecisionEngine`; M4-T3 and the M4 status file both already say a fake decision
port stands in until then.

### Implementation references

- package/version: no new third-party dependency. The one dependency added is
  the workspace package `@internal/workflow` (`workspace:*`), which
  `apps/example-agent` may depend on because it is an internal harness package,
  not a third-party one; `tests/architecture/boundaries.ts` bans `workflow` (the
  npm package, Vercel's durable primitive), not `@internal/workflow`.
- installed docs read: not applicable; nothing framework-facing is touched. The
  `eve` surface used (`startEveDevServer`, `EveAgentRuntime`) is unchanged from
  M1-T6 and is reached through `@internal/runtime-eve`.
- public types/exports inspected: `@internal/workflow`'s `src/index.ts` — the
  whole public surface — plus `packages/workflow/src/dsl/vendor-triage.test.ts`
  (the same graph with placeholder refs), `runtime/workflow-runtime.ts`
  (`createWorkflowRuntime`, `asAgentRuntime`, `WorkflowDecisionPort`,
  `NodeExecutionRecord`), `runtime/ports.ts`, `compiled.ts`, `compile.ts`, and
  `validate/capabilities.ts` (the manifest-schema-equality rule).
- selected documented pattern: `docs/contracts/workflow-dsl.md` (the authoring
  surface, defaults, derived bindings and schemas),
  `docs/architecture/workflow-runtime.md`, ADR-0039/0040/0041.

### Work completed

(in progress)

### Next exact step

Register the new schemas and handlers in `src/capabilities.ts`, author
`src/workflow/vendor-triage-workflow.ts`, then the fixture decision port and the
tests.

## 2026-09-20 17:40 — M4-T10 — Hand-authored compiled vendor workflow and M4 acceptance verification

**Status:** completed
**Actor/session:** Claude Opus 5 (1M context) implementer subagent
**Commit:** `e461297`

### Goal

As the `started` entry above: author Milestone 4's vendor workflow for real in
`apps/example-agent`, with the typed DSL, against the domain's own capability
registry, run it through `createHarness()` on the local deterministic runtime,
and verify all eight of the milestone's acceptance criteria with dated evidence.

### Implementation references

Unchanged from the `started` entry. No third-party dependency was added; the one
dependency added is the workspace package `@internal/workflow` (`workspace:*`),
which updates `pnpm-lock.yaml`. Nothing framework-facing was touched: the `eve`
surface used is `startEveDevServer` and `EveAgentRuntime` from
`@internal/runtime-eve`, unchanged since M1-T6, and nothing under `agent/` was
edited.

### Work completed

- **`src/workflow/vendor-triage-workflow.ts`**: the seven-node graph, authored
  with the DSL. `vendorTriageWorkflowDefinition` is the IR;
  `compileVendorTriageWorkflow(registry)` produces the `CompiledWorkflow`.
  Fingerprint `sha256:27da4abdb90051185735663c32ea8767abe56d70bd30bcba0f626b6e0cbf612a`.
  Three bindings are stated rather than derived: `research` binds
  `{ kind: "input" }` because the registered agent capability declares both its
  schemas and the validator requires the node's to equal them, and `finalize` and
  `decide` each bind a `{ kind: "object" }` composite because a node bound to its
  predecessor would see half of what it needs. Both composites name nodes that
  dominate their reader.
- **Six new capabilities in `src/capabilities.ts`**, with Milestone 1's six left
  byte-identical: four `zod` schemas in `src/domain/schemas.ts`
  (`vendor-triage.classification`, `.verification`, `.finalize-input`,
  `.decision-input`) and two handlers. Both handlers **declare** the schemas they
  are registered for, so the validator's step-3 equality check has something to
  compare rather than nothing to say.
- **`src/handlers/finalize-clear-triage.ts`**: the `clear` route's whole triage in
  deterministic code — category from the vendor's own stated offering, SOP gaps
  from five text-checkable requirements, the existing `detectPaymentDetailChange`
  for the sixth, one evidence item per document on file, and a recommendation
  that is never an unconditional `proceed` while anything is unestablished. Pure,
  total, and valid for a vendor that is not on file.
- **`src/handlers/decide-verified-triage.ts`**: the `research` route's policy
  step. Two rules, both narrowing only: an unsupported triage escalates, and
  `noProceedWithOpenRiskFlags` escalates rather than being softened to
  `proceed_with_conditions`, because this code cannot invent the condition that
  would make an open risk flag acceptable. It never edits the record it escalates
  with.
- **`src/workflow/fixture-decision-port.ts`**: the deterministic
  `WorkflowDecisionPort`, documented at length as a placeholder until M3. It
  answers `classify` from the frozen fixture evidence and `verify` from whether
  the triage cites a source, and it **refuses** any question it does not
  recognize rather than answering by default.
- **`src/run.ts`**: `--workflow` / `EXAMPLE_RUN_MODE=workflow` swaps the
  harness's `AgentRuntime` for `WorkflowRuntime.asAgentRuntime(compiled)` and
  hands the workflow's `agent` node the same `EveAgentRuntime` the agent path
  would have used, so `--mock --workflow` still needs no credential. The ledger
  records `target = <agent>+workflow`. `--vendor <name>` /
  `EXAMPLE_RUN_VENDOR` chooses the vendor, because the workflow routes on the
  vendor's own evidence.
- **Behavior fingerprint**: `loadVendorTriageBehavior()` takes an optional
  `workflowIr`, and `createVendorTriageDomain({ workflowIr })` supplies it, so a
  compiled run and a full-agent run of the same domain fingerprint differently.
  `vendorTriage` is unchanged and still means the full agent.
- **Tests**: 50 new cases across five files —
  `src/workflow/vendor-triage-workflow.test.ts` (12),
  `src/workflow/vendor-triage-run.test.ts` (13),
  `src/workflow/fixture-decision-port.test.ts` (11),
  `src/handlers/finalize-clear-triage.test.ts` (8),
  `src/handlers/decide-verified-triage.test.ts` (6). Two existing tests were
  updated for the six new capabilities (`src/capabilities.test.ts`,
  `src/behavior.test.ts`); the manifest sorts within a kind, so the expected
  lists are registration-order independent.
- **Docs**: `docs/examples/README.md` gained a section on the workflow, its
  files and how to run all three routes, plus rows in the "What is in it" and
  capability-manifest tables; `docs/runbooks/inspecting-a-run.md` gained a
  section on what a workflow run looks like in `pnpm harness run show` and the
  four things it does not yet show; the M4 status file's `### M4-T10` and the
  whole `## Acceptance criteria` section were rewritten with dated evidence.

### Files changed

- `apps/example-agent/package.json`, `pnpm-lock.yaml` (`@internal/workflow`)
- `apps/example-agent/src/workflow/vendor-triage-workflow.ts` (new)
- `apps/example-agent/src/workflow/fixture-decision-port.ts` (new)
- `apps/example-agent/src/workflow/vendor-triage-workflow.test.ts` (new)
- `apps/example-agent/src/workflow/vendor-triage-run.test.ts` (new)
- `apps/example-agent/src/workflow/fixture-decision-port.test.ts` (new)
- `apps/example-agent/src/handlers/finalize-clear-triage.ts` (new) + test
- `apps/example-agent/src/handlers/decide-verified-triage.ts` (new) + test
- `apps/example-agent/src/domain/schemas.ts` (four schemas, four types)
- `apps/example-agent/src/domain/index.ts` (`createVendorTriageDomain`)
- `apps/example-agent/src/capabilities.ts` (six registrations)
- `apps/example-agent/src/behavior.ts` (`LoadVendorTriageBehaviorOptions`)
- `apps/example-agent/src/run.ts` (`--workflow`, `--vendor`)
- `apps/example-agent/src/capabilities.test.ts`, `src/behavior.test.ts`
- `packages/observability/src/inspect-run.ts` (one line; see deviations)
- `docs/examples/README.md`, `docs/runbooks/inspecting-a-run.md`
- `docs/milestones/m4-workflow-ir-dsl-and-local-deterministic-runtime.md`
- `docs/progress/WORKLOG.md` (this entry)

### Verification

- `pnpm check` — **PASS**. 1197 tests passed, 43 skipped across 67 files (2 files
  skipped). The 43 are the Supabase legs of the storage and inspector contract
  suites, which skip without `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` in the
  test process.
- `pnpm vitest run --project unit apps/example-agent` — **PASS**, 119 tests
  across 13 files.
- `pnpm supabase:start` — PASS (Docker running on this host).
- `pnpm example:run:mock -- --workflow` — **PASS**, exit 0, run
  `01a0bfa7-4484-7000-9060-dcba9756a378`. `clear` route, `modelCalls: 1`,
  `toolCalls: 0`, no agent call. Trace: `run.started`, `node.started(classify)`,
  `decision.started`, `decision.completed`, `node.completed(classify)`,
  `node.started(route)`, `node.completed(route)`, `node.started(finalize)`,
  `node.completed(finalize)`, `run.completed`.
- `pnpm example:run:mock -- --workflow --vendor "Tessellate Analytics"` —
  **PASS**, exit 0, run `01a0bfa7-71aa-7001-8d36-e62ee08c5bae`. `research` route
  through the real eve fixture agent, `modelCalls: 3`, twenty trace events.
- `pnpm example:run:mock -- --workflow --vendor "Aurelia Freight"` — **PASS**
  (exit 1 by design), run `01a0bfa7-9ce9-7001-8075-74110e84dce6`. Escalation:
  `node.completed(full-agent)`, `fallback.started`, `run.failed`, with the whole
  `FallbackContext` in the `WorkflowError`'s `details`.
- `pnpm harness run show <runId>` and `... --jsonl <path>` for all three runs —
  **PASS**. Both sources render the `node.*` events in the timeline; see the
  runbook for the four gaps.
- Cited tests from other tasks, each re-run individually with `-t`, all **PASS**:
  `compile.test.ts` > "rejects an intentional unbounded cycle";
  `runtime/idempotency.test.ts` > "A retry does not duplicate a protected side
  effect"; `runtime/grants.test.ts` > "An agent node cannot call an ungranted
  tool"; `runtime/workflow-runtime.test.ts` > "A human-authored workflow runs
  locally", "Every node validates inputs and outputs", "A failed node is visible
  in the trace"; `dsl/builder.test.ts` > "survives a JSON round trip, which is
  the acceptance criterion", "gives the same fingerprint to two builds of the
  same workflow".
- `pnpm example:run:mock` with **no** flags — **PASS**, exit 0, run
  `01a0bfad-b44f-7001-afd1-cfa5aafa72ac`, `mode: "agent"`, `workflow: null`,
  `runtime.name: "eve"`. Existing behaviour is unchanged.
- Behavior fingerprints of the two runs above differ in exactly one component:
  the agent run has `workflowIr = sha256:74234e98…` (the digest of `null`) and
  composite `sha256:d3fd7841…`; the workflow run has
  `workflowIr = sha256:27da4abd…`, equal to the compiled workflow's own
  fingerprint, and composite `sha256:4f57ec9a…`.
- `eve info` — not run, and not required: nothing under `agent/` was touched.
  `eve build` ran as part of `pnpm check` and succeeded.

### Decisions / deviations

- **The fixture decision port lives in `apps/example-agent/src/workflow/`, not in
  `@internal/workflow`.** No ADR: it is this domain's fixture answering this
  domain's two questions, not a harness capability, and putting it in the
  package would have made a placeholder look like part of the contract. The
  module says in its own header what has to happen when M3 lands and that it is
  then deleted.
- **`--vendor <name>` was added beyond the task's scope**, because the workflow
  routes on the vendor's own frozen evidence and the default vendor,
  `Northwind Ledger`, takes the `clear` route. Without it, the `research` route
  through the real eve agent and the escalation route could not be demonstrated
  from the command line at all, and two thirds of the acceptance evidence would
  have rested on unit tests alone.
- **The `research` node uses `vendor-triage-agent@1.0.0` and therefore binds the
  job input.** The validator requires a node's schemas to equal the ones its
  resolved capability declares, and the registered agent declares
  `vendor-triage.input`/`vendor-triage.output`. The alternative — registering a
  second, narrower `vendor-researcher` agent capability — would have invented a
  capability the domain does not ship in order to make a binding prettier.
- **One line changed outside `apps/example-agent`.**
  `packages/observability/src/inspect-run.ts`'s decision-identity key list now
  tries `questionId` first, because a `jev` node names a **question** (M4-T2) and
  every Jev call row printed `(none)` without it. Nothing else in the inspector
  was touched; the other gaps are reported, not fixed.
- **Addendum (after commit `e461297`): the stale Jev note was fixed too.**
  `CallsInspection.jevNote` is now `string | null`, set only when the run made no
  Jev call, and reworded to say that M4's workflow runtime emits a `decision.*`
  pair per `jev` node through a decision port while M3 is when Jev itself answers
  them. The renderer omits the line when it is `null`. The other three inspector
  gaps still need `runs.workflow_version_id` and `runs.fallback_count`, which M5
  fills, so they stay reported rather than fixed.
- **`registerVendorTriageCapabilities` grew rather than being split.** The
  registry `compileWorkflow()` resolves against must be the domain's one
  registry; a second would be a second answer to "what can this domain do?".
- `packages/workflow` and `packages/core` were not modified, and no bug in either
  was found: the DSL expressed the graph, the validator accepted it, and the
  runtime ran all three routes without a workaround.

### Known issues / blockers

- **The inspector predates workflows in four ways**, all reported in
  `docs/runbooks/inspecting-a-run.md` and none of them misleading about what ran:
  `route:` always prints `full-agent` (it reads `runs.workflow_version_id`, an
  M5 placeholder); `fallbacks:` reads `0 (from the ledger)` even for a run that
  escalated (`runs.fallback_count` is also a placeholder); `TraceEvent.node` has
  no column of its own, so a node id is visible only via the payload's `nodeId`
  and truncates on a long line; and the note "jev: 0 is a real measurement …
  until M3 adds the Jev decision engine" prints even when the run made Jev calls.
  Making that note conditional changes a field's type and the renderer, so it was
  left for whoever owns the inspector next.
- **The workflow has no `call` node**, so it cannot exercise M4-T7's protection
  itself. That is a property of the graph the milestone specified, and the
  criterion is covered by `packages/workflow/src/runtime/idempotency.test.ts`.
- `pnpm example:run -- --workflow` against a live Gateway model is unverified, for
  the same reason `pnpm example:run` has always been: no credential on this host.

### Next exact step

Milestone 4 close-out, which is the orchestrator's: commit M4-T10, write the
`docs/progress/milestones/m4.md` snapshot, and rewrite
`docs/context/current-state.md` for the end of M4 and the start of M5 (workflow
registry, router and fallback), with M3 still available to run beside it.

---

## 2026-09-20 18:15 — M4 — Milestone 4 complete: snapshot and handoff

**Status:** completed
**Actor/session:** coding agent (documentation subagent)
**Commit:** not committed

### Goal

Close out Milestone 4, now that M4-T10 (the last task) is complete, reviewed, and committed as
`e461297`, and all eight acceptance criteria in the status file carry dated evidence: write the
milestone snapshot, update the status file and README, extend AGENTS.md, and rewrite the handoff
to point at M5/M3.

### Implementation references

Not applicable. This task touches no framework-facing code; it archives the already-completed and
already-reviewed Milestone 4 work into a snapshot and rewrites the handoff files.

### Work completed

- Confirmed the newest commits (`git log --oneline -5`) are `e461297` (M4-T10), `0562ac8` (M4-T1..T9
  docs), `0d12b43` (M4-T3..T9), `4c03e2e` (M4-T1/M4-T2).
- Read `docs/progress/milestones/m2.md` (the snapshot shape), the whole M4 status file, ADR-0038
  through ADR-0041, and the M4-T10 WORKLOG entries (started at 16:30, completed at 17:40).
- Wrote `docs/progress/milestones/m4.md`: title, completion date, status, the four-commit list in
  order, status-file path, WORKLOG range (2026-09-20 01:00 through 17:40), Goal, a Tasks table (one
  line per M4-T1..T10 with its ADR), Verification at completion (1197 passed / 43 skipped across 67
  files; all three demo routes with run ids and trace summaries, plus the orchestrator's own
  re-verification run `01a0bfaf-ffd5-7001-b493-9662ef3e9035`; the unchanged full-agent path; the
  inspector against both), Deviations from the plan (twelve items pulled from ADR-0038 through
  ADR-0041 and the task Result paragraphs), and an Environment note.
- Updated `docs/milestones/m4-workflow-ir-dsl-and-local-deterministic-runtime.md`: header status
  line now reads "every task is completed (M4-T1 through M4-T10); all eight acceptance criteria
  verified. Snapshot: `../progress/milestones/m4.md`."; no task subsection was touched, per the
  fixture agent's file-ownership split during Phase 3.
- Updated `docs/milestones/README.md`: the M4 row now reads "complete (snapshot:
  [../progress/milestones/m4.md](../progress/milestones/m4.md))", matching M2's row form. The "M3
  and M5 onward" footnote sentence remained accurate (M3 and M5 are the only milestones still
  without status files) and needed no further change.
- `AGENTS.md`: added `src/workflow/ (M4-T10)` to the `apps/example-agent/src/` layout-tree comment.
  The ADR paragraph and "next free number is 0042" line had already been reconciled to their final
  form during Phase 2 close-out and needed no further edit for this pass. No sentence claiming the
  workflow IR or runtime does not exist yet was found remaining in the file.
- Rewrote `docs/context/current-state.md` in full: Milestone 4 marked complete with its snapshot
  path added to "Completed milestones / tasks"; current milestone set to "M4 complete; next is M5
  (critical path, blocked only by M4 per the build plan), M3 still available to start now and
  needed before M5's Jev-dependent parts"; current task "not started, create the M5 or M3 status
  file"; last commit SHA `e461297` with the full M4 commit chain; "what works now" updated to the
  twelve-workspace-project count, `@internal/workflow`'s full surface, `apps/example-agent`'s
  `--workflow`/`--vendor` flags and twelve registered capabilities, the 1197-passed/43-skipped/67-file
  test count, and the inspector's new workflow-run rendering; "partially working" rewritten for
  escalation-as-failure until M5, the fixture decision port standing in for Jev until M3, the
  inspector's four still-outstanding gaps, in-memory-only artifacts, and no durability; "does not
  exist yet" narrowed to the router, workflow registry rows, a real Jev engine, replay, evals,
  learner and compiler; active decisions extended through ADR-0041 with next free ADR 0042; findings
  extended with the Phase 2 bullets already present plus four new ones (`asAgentRuntime()` as the
  harness presentation mechanism, the `research` node's `{ kind: "input" }` binding and why,
  `--workflow`'s shared `EveAgentRuntime`, and Supabase currently running on this host); "exact next
  task" and "exact first command" updated to point at M5/M3 status-file creation and the
  `--workflow` demo command respectively.

### Files changed

- `docs/progress/milestones/m4.md` — new file, the Milestone 4 snapshot.
- `docs/milestones/m4-workflow-ir-dsl-and-local-deterministic-runtime.md` — header status line only.
- `docs/milestones/README.md` — M4 row now "complete (snapshot: ...)".
- `AGENTS.md` — repository-layout tree (`apps/example-agent/src/` comment).
- `docs/context/current-state.md` — rewritten in full for the Milestone 4 -> Milestone 5/3 handoff.

### Verification

- `pnpm format:check` — PASS
- `pnpm check:handoff` — PASS

### Decisions / deviations

- None beyond what M4-T1 through M4-T10's own entries already recorded; this entry only archives
  and reconciles documentation for already-completed, already-reviewed work.

### Known issues / blockers

- The four M4 commits (`4c03e2e`, `0d12b43`, `0562ac8`, `e461297`) are unpushed to `origin/main`;
  CI has not run against any of Milestone 4.
- `pnpm example:run` and `pnpm example:run -- --workflow` against a live Gateway model remain
  unverified without a credential.

### Next exact step

Start Milestone 5 (Workflow Registry, Router, and Fallback), the critical path, by creating its
status file from the build plan in the M4 file's shape. Milestone 3 (Jev) is blocked only by M2
(already complete) and may start beside M5 at any point; M5's Jev-dependent parts need M3 to have
landed by the time they are reached.
