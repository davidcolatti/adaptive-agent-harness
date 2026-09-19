---
status: accepted
date: 2026-09-19
deciders: orchestrator (Claude Fable 5.1) with repository owner constraints; recorded during M0
related: [0016, 0018, 0019, 0022]
supersedes: null
superseded_by: null
---

# ADR-0020: `@internal/source` export condition for workspace resolution

## Context

`docs/research/tooling/2026-09-19-m0-toolchain-verification.md` §5 states plainly: "This is a
project-owned decision, not a documented framework requirement." AD-016 requires such choices to
be recorded explicitly rather than implied. The problem it solves: without it, typechecking one
workspace package that depends on another would require the dependency to already be built
(`dist/*.d.ts` present), coupling `pnpm typecheck` to build order and defeating the point of a
fast local loop.

The mechanism, as implemented and verified in the repository: every workspace package's
`package.json` declares

```json
"exports": {
  ".": {
    "@internal/source": "./src/index.ts",
    "types": "./dist/index.d.ts",
    "default": "./dist/index.js"
  }
}
```

Typecheck configs (`tsconfig.json` in each package, and the root `tsconfig.json`) set
`"customConditions": ["@internal/source"]`, so `tsc --noEmit` resolves a workspace dependency
straight to its TypeScript source and never needs a prior build. Build configs
(`tsconfig.build.json`) deliberately omit the condition, so `tsc -p tsconfig.build.json` compiles
against a dependency's emitted `.d.ts`; this is exactly why Turborepo's `build` task declares
`dependsOn: ["^build"]` (ADR-0018). The research note verified both directions with `packages/*/
dist` deleted: `tsc --noEmit -p tsconfig.json` exits 0 with the condition present, and fails with
`TS2307: Cannot find module '@internal/testing'` when it is removed.

The same condition has to be threaded into Vitest separately, because Vitest 5 resolves test
modules through Vite's server (SSR) environment, not through `tsc`. The research note found,
by direct experiment, that setting top-level `resolve.conditions` in `vitest.config.ts` failed
with `Failed to resolve entry for package "@internal/testing"`; the condition must instead be set
under `ssr.resolve.conditions` (for dependencies Vite processes) and `ssr.resolve.
externalConditions` (for dependencies Vite externalizes to Node). Because assigning either option
replaces Vite's own defaults rather than extending them, `vitest.config.ts` imports
`defaultServerConditions` and `defaultExternalConditions` from `vite` and spreads them alongside
`@internal/source`, rather than retyping Vite's defaults by hand.

`tests/toolchain/source-condition.test.ts` asserts the contract at runtime (that
`import.meta.resolve("@internal/testing")` resolves to `packages/testing/src/index.ts`, not
`dist`, and that a cross-package import actually works), "so it cannot rot silently" per its own
comment.

## Decision

Every workspace package under `packages/*` MUST declare an `exports` map with three conditions in
this order: `"@internal/source"` pointing at `./src/index.ts`, `"types"` pointing at the built
declaration file, and `"default"` pointing at the built JavaScript entry. Every typecheck
`tsconfig.json` (per-package and root) MUST set `"customConditions": ["@internal/source"]`. Every
build `tsconfig.build.json` MUST omit that condition, and any Turborepo `build` task MUST declare
`dependsOn: ["^build"]` to preserve dependency build order for consumers that rely on emitted
`.d.ts` files. `vitest.config.ts` MUST set the condition under `ssr.resolve.conditions` and
`ssr.resolve.externalConditions`, not under top-level `resolve.conditions`, and MUST spread Vite's
`defaultServerConditions`/`defaultExternalConditions` rather than hand-list Vite's own default
condition set. `tests/toolchain/source-condition.test.ts` MUST continue to assert both that a
workspace import resolves to source (not `dist`) under test, and that the resolved module is
actually usable, so a future change to any of the three places this contract is declared (a
package's `exports`, a tsconfig's `customConditions`, or `vitest.config.ts`) that breaks it fails
a test immediately rather than surfacing as a confusing resolution error later.

## Consequences

### Positive

- Decouples `pnpm typecheck` from build order entirely: a package's types are checked against a
  dependency's actual current source, not a possibly-stale `dist/`, and without requiring
  `pnpm build` to run first.
- Because the contract is spread across three independent files per package (exports map,
  tsconfig, and the shared `vitest.config.ts`), the dedicated runtime test closes the gap that no
  single file's own correctness would otherwise guarantee.

### Negative

- The mechanism does not exist in any tool's own documentation as a workspace-resolution
  pattern; it is entirely project-owned, so a new contributor must read this ADR (or the
  toolchain research note) to understand why `exports` has three conditions and why
  `vitest.config.ts` looks the way it does, rather than being able to look it up in Vitest's or
  Node's own docs.
- Every new workspace package must remember to add the `@internal/source` condition to its
  `exports` map and both tsconfigs; forgetting it produces a working build but a typecheck/test
  failure only when another package tries to depend on it, not at the moment the package is
  scaffolded.

### Neutral

- Constrains every current and future package under `packages/*` (currently `@internal/config`,
  `@internal/core`, `@internal/testing`), and constrains `vitest.config.ts` and every package's
  `tsconfig.json`/`tsconfig.build.json`.
- `tests/toolchain/source-condition.test.ts` and `packages/testing` (the first package this
  condition round-trips through) are the load-bearing verification for this ADR.

## Alternatives considered

- **Build-before-test / build-before-typecheck**: rejected; it would make the fast local loop
  (`pnpm typecheck`, `pnpm test`) depend on a prior `pnpm build` completing successfully,
  reintroducing exactly the coupling this condition removes, and would slow the loop as the
  number of packages grows.
- **Path aliases (`paths` in tsconfig, or a bundler alias) instead of an export condition**:
  rejected; `packages/config/tsconfig.base.json` deliberately carries no path-valued options
  (ADR-0019) because a relative path in a shared, extended config resolves against the file that
  declares it, not the consuming package, which would make a shared `paths` map either wrong or
  require per-package overrides that duplicate the export-condition approach with more
  boilerplate.
- **TypeScript project references with `tsc -b`**: rejected; project references still require a
  package's referenced dependencies to have valid build output (declaration files) to typecheck
  against, which does not solve the goal of typechecking directly against a dependency's current
  source without a prior build step.

## References

- `docs/research/tooling/2026-09-19-m0-toolchain-verification.md` §5 (the `@internal/source`
  condition), §6 (Vitest `ssr.resolve.conditions` requirement), §11 item 1
- `docs/milestones/build-plan.md` §1 AD-016
- Related ADRs: 0016, 0018, 0019, 0022
- Related code paths: `packages/*/package.json` (`exports`), `packages/*/tsconfig.json`,
  `packages/*/tsconfig.build.json`, `tsconfig.json`, `vitest.config.ts`,
  `tests/toolchain/source-condition.test.ts`
