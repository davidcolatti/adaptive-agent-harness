---
status: accepted
date: 2026-09-19
deciders: orchestrator (Claude Fable 5.1) with repository owner constraints; recorded during M0
related: [0011, 0014, 0018, 0021, 0022]
supersedes: null
superseded_by: null
---

# ADR-0023: Git hooks, secret scanning, and CI gates

## Context

Build plan M0-T5 requires Husky-based pre-commit (Biome on staged files, secret scan) and
pre-push (typecheck, unit tests) hooks, and explicitly forbids running "expensive agent/eval
tests on every commit." M0-T6 requires initial CI running install, `format:check`, `lint`,
`typecheck`, `unit`, `build`, with pinned lockfile usage. M0-T10 requires "a lightweight
verification script that fails milestone/task completion checks" for four specific handoff
violations (AD-014). `docs/milestones/build-plan.md` §12 (Definition of Done) names `pnpm check`
as "the single local quality gate" a task must pass.

`docs/research/tooling/2026-09-19-m0-toolchain-verification.md` §9 and §10 record the verified
facts behind the implementation:

- **Husky 9.1.7**: `prepare: "husky"` is the documented v9 install; after `pnpm install`, `git
  config core.hooksPath` is `.husky/_`; hook files are plain shell with no shebang and no
  `husky.sh` source line (both of which older Husky major versions required).
- **`set -e` is mandatory, and its absence was a real, reproduced bug.** The first hook draft
  without `set -e` ran every check but returned only the last command's exit code, so a Biome
  failure followed by a clean secret scan would have exited 0, masking the Biome failure. This
  was verified by reproducing the mask, then verified fixed: with `set -e` added, a staged lint
  error alone now fails the hook.
- **secretlint has no `--staged` mode.** The documented approach is to pass explicit file paths
  with `--no-glob` so each argument is treated as a literal path, not a pattern. The pre-commit
  hook pipes `git diff --cached --name-only --diff-filter=ACMR -z` into `xargs -0`, which keeps
  filenames containing spaces intact. **Caveat, stated in the hook's own comment and here:**
  secretlint reads the working-tree file, not the staged git blob, so a partially staged file
  (`git add -p` leaving unstaged hunks) is scanned in full, including content that is not actually
  being committed.
- **Verified allow-list caveat.** `AKIAIOSFODNN7EXAMPLE`, the canonical AWS documentation example
  key, is allow-listed by `@secretlint/secretlint-rule-aws` and is *not* reported; any future gate
  proof for the secret scanner must use a realistic, non-example credential (a realistic AWS
  secret access key and a Slack bot token were both confirmed detected, exit 1) rather than the
  well-known example key, which would produce a false negative.
- **CI action versions**, checked against the GitHub releases API on 2026-09-19: `actions/
  checkout@v7` (latest v7.0.1), `pnpm/action-setup@v6` (latest v6.1.0, and v6 reads the pnpm
  version from `package.json`'s `packageManager` field when `version` is omitted, so CI and local
  installs stay in step per ADR-0018), `actions/setup-node@v7` (latest v7.0.0; `node-version-file`
  accepts `.node-version`; `cache: pnpm` is supported; the only v7 breaking change is removal of a
  dummy `NODE_AUTH_TOKEN` fallback this workflow does not use). `pnpm/action-setup` runs before
  `actions/setup-node` because `setup-node`'s pnpm cache step invokes `pnpm store path`, which
  requires pnpm to already be on `PATH`.

## Decision

Husky 9 (`"prepare": "husky"` in `package.json`) MUST manage git hooks; hook files under
`.husky/` MUST be plain POSIX shell with no shebang line and no `husky.sh` sourcing, per the
documented v9 convention. Every hook script MUST begin with `set -e`, given the reproduced
exit-code-masking bug above; a hook without it is a regression, not a style preference.

`pre-commit` MUST run, in order: (1) a fast exit when no staged file matches
`--diff-filter=ACMR`; (2) secretlint against the staged paths via `git diff --cached --name-only
--diff-filter=ACMR -z | xargs -0 pnpm exec secretlint --no-glob --`, secret scanning first because
"a leaked credential is the most serious thing a commit can carry"; (3) `pnpm exec biome check
--staged --no-errors-on-unmatched` (formatting, lint rules, import organization, on staged files
only). `pre-push` MUST run `pnpm run typecheck` then `pnpm run test:unit`, i.e. whole-repository
but still cheap checks; it MUST NOT run integration, contract, replay, live-provider, agent, or
eval suites, per M0-T5's explicit instruction not to run expensive checks on every commit (and,
by the same reasoning, extended here to every push).

CI (`.github/workflows/ci.yml`) MUST run `actions/checkout@v7`, `pnpm/action-setup@v6` with no
`version` input (so it reads `packageManager`), then `actions/setup-node@v7` with
`node-version-file: .node-version` and `cache: pnpm`, in that order. `pnpm install
--frozen-lockfile` MUST be used (pinned-lockfile installation, per M0-T6). The six `pnpm check`
stages (`format:check`, `lint`, `typecheck`, `test`, `build`, `check:handoff`) MUST run as
separate named steps in that order, not as one combined `pnpm check` invocation, so a red build
names the specific gate that failed rather than requiring a log scroll.

`pnpm check` (`format:check && lint && typecheck && test && build && check:handoff`) remains the
single local quality gate a contributor runs before considering a task done (build plan §12).
`check:handoff` (`node scripts/verify-handoff.ts`) is the M0-T10 enforcement of AD-014 and MUST
continue to check exactly the four documented rules: `docs/context/current-state.md` missing;
`docs/progress/WORKLOG.md` missing; a WORKLOG entry whose `**Status:**` line says `completed` with
no `### Verification` section containing a `PASS`/`FAIL` result; and a WORKLOG reference to a
decision record (`ADR-NNNN` or a `docs/decisions/NNNN-...` path) whose four-digit prefix has no
matching file under `docs/decisions/`. Per the build plan, this script deliberately does not
attempt to infer whether every code edit was logged; that remains a task-workflow and review
concern, not something `verify-handoff.ts` tries to detect.

## Consequences

### Positive

- The reproduced `set -e` bug means this is not a theoretical style choice: without it, the
  pre-commit hook can silently let a formatting or lint failure through whenever it happens to be
  followed by a passing check, which is exactly the failure mode a pre-commit hook exists to
  prevent.
- Splitting CI's `pnpm check` into six named steps gives a failing pull request an immediately
  legible failure reason (e.g. "Lint" failed) instead of a single opaque "check" step a reviewer
  has to open and read logs to diagnose.
- `check:handoff`'s four narrow, mechanical rules enforce AD-014's mandatory-handoff requirement
  without the fragile approach of trying to infer whether "every code edit was logged," which the
  build plan explicitly says not to attempt.

### Negative

- secretlint's working-tree-not-staged-blob scanning behavior means a contributor who partially
  stages a file (`git add -p`) gets scanned content that will not actually be committed; this is
  an accepted, documented gap rather than a bug to fix, since secretlint has no staged-content
  mode to scan against instead.
- The `AKIAIOSFODNN7EXAMPLE` allow-list means the secret scanner has at least one known,
  documented false negative; anyone writing a new gate-verification fixture must remember to use
  a realistic (non-canonical-example) credential or the test will falsely appear to pass with no
  detection happening at all.
- Pinning GitHub Action majors (`@v7`, `@v6`, `@v7`) means a future action major release requires
  a deliberate, re-verified bump (checking the release notes/API surface again, per AD-011)
  rather than picking up new action behavior automatically.

### Neutral

- Constrains Milestone 0 (M0-T5, M0-T6, M0-T10) and every subsequent commit/push/CI run for the
  life of the project until these hooks or the CI workflow are deliberately revised.
- Constrains `.husky/pre-commit`, `.husky/pre-push`, `.secretlintrc.json`, `.github/workflows/
  ci.yml`, `package.json` (`check`, `check:handoff` scripts), and `scripts/verify-handoff.ts`.

## Alternatives considered

- **A standalone `gitleaks` binary instead of secretlint**: not adopted; secretlint was chosen
  (recorded as a project-owned decision in the toolchain research note, §11 item 3) specifically
  for its documented staged-file-compatible CLI pattern and rule preset, with no external service
  dependency, which fit the existing Node/pnpm toolchain without adding a separate binary
  distribution and version-pinning concern.
- **`lint-staged`** to orchestrate staged-file checks instead of a hand-written hook: not
  adopted; the current pre-commit hook's staged-file selection (`git diff --cached --name-only
  --diff-filter=ACMR -z` piped to the relevant command) is simple enough, and specific enough to
  secretlint's own `--no-glob` requirement and Biome's own `--staged` mode, that introducing an
  additional orchestration dependency was not judged to simplify the hook.
- **Running `pnpm check` as a single CI step**: rejected in favor of six named steps, specifically
  so a CI failure names the gate that failed (format, lint, typecheck, test, build, or handoff)
  without requiring a reviewer to read step output to find out which of the six `pnpm check`
  stages actually failed.

## References

- `docs/research/tooling/2026-09-19-m0-toolchain-verification.md` §9 (Husky 9.1.7 and secretlint
  13.0.5), §10 (GitHub Actions), §11 item 3 and item 6
- `docs/milestones/build-plan.md` §12 Definition of Done, §1 AD-011, §1 AD-014, Milestone 0
  (M0-T5, M0-T6, M0-T10)
- Related ADRs: 0011, 0014, 0018, 0021, 0022
- Related code paths: `.husky/pre-commit`, `.husky/pre-push`, `.secretlintrc.json`, `.github/
  workflows/ci.yml`, `package.json`, `scripts/verify-handoff.ts`
