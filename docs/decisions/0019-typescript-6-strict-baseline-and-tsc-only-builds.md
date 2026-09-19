---
status: accepted
date: 2026-09-19
deciders: orchestrator (Claude Fable 5.1) with repository owner constraints; recorded during M0
related: [0016, 0018, 0020]
supersedes: null
superseded_by: null
---

# ADR-0019: TypeScript 6 strict baseline and tsc-only builds

## Context

Build plan M0-T2 requires a strict TypeScript baseline with a specific flag list: `strict`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`, `noImplicitReturns`, `useUnknownInCatchVariables`,
`forceConsistentCasingInFileNames`, and forbids `any` in core packages except at justified
adapter boundaries. AD-016 requires internal, non-Vercel-prescribed choices to be recorded
explicitly, which is what the TypeScript version line itself is: TypeScript is not a Vercel
primitive, so its exact version and build strategy are project-owned decisions.

`docs/research/tooling/2026-09-19-m0-toolchain-verification.md` §4 records what was verified
against the installed compiler: TypeScript 6.0.3 is what `pnpm-lock.yaml` installs; `tsc --help
--all` reports exactly one deprecated option (`out`, superseded by `outFile`), which this project
does not use, so the configuration is forward-compatible with TypeScript 7; `node_modules/
typescript/lib/typescript.d.ts` confirms `customConditions?: string[]` exists (load-bearing for
ADR-0020); and the official `@tsconfig/node24` base (v24.0.5) was read directly from npm to fix
`target: "es2024"` and the matching `lib` array, which `packages/config/tsconfig.base.json`
follows exactly.

**Version-line choice, now independently verified.** TypeScript 7.0.2 is the current latest
release; 6.0.3 is the newest release in the 6.0 line. The official TypeScript 7.0 announcement
(<https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/>) confirms 7.0 is the
native Go port and states directly: "TypeScript 7.0 is made available without an API. We expect
TypeScript 7.1 to ship with a new (and different) API." It recommends that tooling authors who
need the API either stay on 6.0 or install the `@typescript/typescript6` compatibility package
alongside 7.0. The same announcement lists compiler options no longer supported in 7.0:
`target: es5`, `downlevelIteration`, `moduleResolution: node`/`node10`/`classic`,
`module: amd`/`umd`/`systemjs`/`none`, `baseUrl`, `esModuleInterop`/`allowSyntheticDefaultImports`
set to `false`, and `alwaysStrict` set to `false`. None of these appear anywhere in this
repository's TypeScript configuration; verified by reading every tsconfig file present
(`packages/config/tsconfig.base.json`, `packages/config/tsconfig.package.json`, the root
`tsconfig.json`, and every workspace package's `tsconfig.json`/`tsconfig.build.json`).

The official TypeScript 6.0 announcement
(<https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/>) independently confirms
the orchestrator's original rationale: "TypeScript 6.0 is a unique release in that we intend for
it to be the last release based on the current JavaScript codebase," and "TypeScript 6.0 acts as
the bridge between TypeScript 5.9 and 7.0."

ts-morph itself turns out not to be the actual blocker. `npm view ts-morph` (checked 2026-09-19;
latest release 28.0.0, published 2026-04-12) shows ts-morph depends on `@ts-morph/common
~0.29.0`, which vendors its own copy of the TypeScript compiler rather than depending on this
project's own `typescript` package. The real constraint is narrower than "ts-morph might be
incompatible with 7.0": it is that TypeScript 7.0 ships no programmatic compiler API at all until
7.1, so any tool this project builds or adopts that needs to inspect a TypeScript AST or invoke
the compiler programmatically through the `typescript` package (as opposed to a vendored copy
like ts-morph's) has no API to call under 7.0. TypeScript SHOULD be upgraded to 7.x once 7.1
ships its new API, and MUST be re-evaluated at the latest before Milestone 8 introduces ts-morph,
since Milestone 8 tooling or harness-owned code beyond ts-morph itself may still need the
programmatic API directly.

## Decision

TypeScript 6.0.3 is the pinned compiler version for v1. This is a deliberate, verified choice:
TypeScript 7.0 ships no programmatic compiler API until 7.1, and staying on 6.0 (or the
`@typescript/typescript6` compatibility package once on 7.x) keeps that API available for any
current or future harness tooling that needs it, without waiting on 7.1. `packages/config/
tsconfig.base.json` is the single shared language-level baseline and
MUST set every M0-T2 strict flag (`strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`,
`noImplicitReturns`, `useUnknownInCatchVariables`, `forceConsistentCasingInFileNames`), plus
`isolatedModules: true` and `verbatimModuleSyntax: true` (ESM-only import/export semantics,
required because `type: "module"` is set at the workspace root), `module`/`moduleResolution`:
`"nodenext"`, and `target`/`lib` matching the official `@tsconfig/node24` base exactly
(`target: "es2024"`, the five `esnext.*` lib entries `@tsconfig/node24` v24.0.5 specifies).
`packages/config/tsconfig.base.json` MUST NOT contain any path-valued compiler option (`rootDir`,
`outDir`, `paths`), because TypeScript resolves a relative path declared in an extended config
against the file that declares it, which would resolve into `packages/config/` rather than the
consuming package; every path-valued option is set in the consuming package's own `tsconfig.json`
/ `tsconfig.build.json`.

Every workspace package and the repository root use a plain `tsc` invocation, never a bundler.
Each package declares two configs: `tsconfig.json` (extends `@internal/config/
tsconfig.package.json`, sets `noEmit: true` and the `@internal/source` custom condition, used for
`tsc --noEmit`, i.e. typecheck) and `tsconfig.build.json` (extends the same base, sets `rootDir`/
`outDir`, omits the custom condition, used for `tsc -p tsconfig.build.json`, i.e. emit). The root
`tsconfig.json` extends `@internal/config/tsconfig.base.json` directly (not through
`tsconfig.package.json`, since the root emits nothing) and covers `scripts/**/*.ts`,
`tests/**/*.ts`, and `vitest.config.ts`, the files outside any workspace package.

## Consequences

### Positive

- A single strict baseline means no package can silently opt out of `strict`,
  `noUncheckedIndexedAccess`, or the other M0-T2 flags; adding a new package means extending an
  existing base, not re-deciding compiler strictness.
- Plain `tsc` with no bundler keeps the build step simple and directly inspectable (`dist/**` is
  exactly what `tsc -p tsconfig.build.json` emits), which matters for a project whose own
  Milestone 8 deliverable is a deterministic TypeScript code generator; the harness's own build
  pipeline models the "no unexplained transformation" property it will later require of generated
  workflow source.

### Negative

- Choosing the 6.0 line over the current 7.0 release means starting one major version behind
  latest, and depending on TypeScript 7.1 (not yet released) to close the API gap before this
  project can move to the native compiler; ts-morph itself does not force this (it vendors its
  own compiler copy), but other future harness tooling that needs the programmatic API directly
  still would. Upgrading later requires touching every package's `tsconfig.json`/
  `tsconfig.build.json` and re-running the verification pass this ADR performed for 6.0.3.
- No bundler means each package's build output is one-to-one with its `src/` tree; packages that
  later want bundling, tree-shaking, or non-Node output targets (a browser bundle, for example)
  are not served by this decision and would need a separate build pipeline.

### Neutral

- Constrains Milestone 0 (M0-T2, the strict baseline) and directly gates Milestone 8 (Compiler
  v1), which is the latest point by which the TypeScript 6-vs-7 re-evaluation named above must
  happen, alongside any TypeScript 7.1 API release that happens sooner.
- Constrains `packages/config/tsconfig.base.json`, `packages/config/tsconfig.package.json`, every
  workspace package's `tsconfig.json`/`tsconfig.build.json`, and the root `tsconfig.json`.

## Alternatives considered

- **tsup or tsdown as the build tool**: rejected for v1; plain `tsc` per package is sufficient
  while every package targets Node/ESM output only, and avoids adding a bundler dependency and
  its own configuration surface before there is a concrete need (a browser target, code
  splitting) that plain `tsc` cannot serve.
- **Adopt TypeScript 7.0 now**: rejected; TypeScript's own 7.0 announcement states 7.0 ships no
  compiler API until 7.1, so adopting it now would remove programmatic TypeScript API access this
  project may need before that gap closes, for no offsetting benefit already realized (ts-morph
  itself does not depend on the project's `typescript` package, so it does not force the
  upgrade).
- **Stay on TypeScript 5.9**: rejected; 6.0.3 is the newest release in the last
  JavaScript-based compiler line and was verified end-to-end (typecheck, build, declaration
  emission, no deprecated options) against this repository's actual configuration, so there is no
  documented reason to pin an older 5.x release instead.

## References

- `docs/research/tooling/2026-09-19-m0-toolchain-verification.md` §1, §4
- TypeScript 7.0 announcement:
  <https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/> (no compiler API until
  7.1; options no longer supported in 7.0; `@typescript/typescript6` compatibility package)
- TypeScript 6.0 announcement:
  <https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/> ("last release based on
  the current JavaScript codebase"; "bridge between TypeScript 5.9 and 7.0")
- `npm view ts-morph` (checked 2026-09-19; ts-morph 28.0.0 depends on `@ts-morph/common ~0.29.0`,
  which vendors its own TypeScript compiler)
- `docs/milestones/build-plan.md` §1 AD-016, Milestone 0 (M0-T2), Milestone 8
- Related ADRs: 0016, 0018, 0020
- Related code paths: `packages/config/tsconfig.base.json`, `packages/config/
  tsconfig.package.json`, `tsconfig.json`, `packages/*/tsconfig.json`, `packages/*/
  tsconfig.build.json`
