# Framework source-of-truth protocol

How this repository establishes what a framework actually does before any code is written against
it. This is the operational form of AD-011 ("No Vercel implementation detail may be guessed") from
`docs/milestones/build-plan.md`, together with the reuse rule of AD-012, the recording rule of
AD-016, and the no-assumption stop condition from the build plan's Mandatory Task Execution
Protocol.

It applies to every task that touches a Vercel primitive, and its inspection habits apply to any
third-party dependency.

## 1. Mandatory source precedence

Any task that touches a Vercel primitive MUST verify the current API and runtime semantics before
implementation, using this source order:

```text
1. Installed package docs matching pnpm-lock.yaml
2. Installed package public TypeScript exports/types
3. Official Vercel GitHub repository source and examples
4. Official Vercel documentation
5. Official vercel-labs reference implementations
6. Harness-owned design only when the behavior is not provided publicly
```

**When sources disagree, the lockfile-matched installed package wins.** The disagreement is not
silently resolved and forgotten: it is recorded in an ADR under `docs/decisions/` or in a dated
research note under `docs/research/`.

## 2. What the implementing agent must not do

The agent MUST NOT:

- invent an import path;
- infer a method signature from memory;
- copy an old blog example without checking the installed version;
- assume preview APIs are unchanged;
- reach into unexported package internals;
- claim a Vercel primitive provides behavior that its current docs do not establish.

## 3. The "Implementation references" checkpoint

Before coding, a framework-facing task adds a short `Implementation references` section to the
task entry in `docs/progress/WORKLOG.md`, containing:

```text
Package + installed version
Docs/files read
Official repository/examples read
Public exports/types inspected
Exact API/pattern selected
Anything not documented that must be harness-owned
```

**No framework-facing task may move to `in_progress` until this checkpoint exists in the task /
work log.** The checkpoint is the artifact that makes the verification auditable after the fact; a
task that was verified but did not record it is treated as unverified.

## 4. Web examples are references, not version authority

Blog posts, Stack Overflow answers, conference talks and tutorials found while researching are
references, not version authority. Any pattern found this way must be reconciled against the
currently installed package version's own docs and types before it is used, and if the two
disagree the installed package wins and the discrepancy is recorded.

## 5. Guessed Vercel APIs are forbidden

An implementation must never assume a Vercel primitive's method name, option, or return shape
without having verified it against one of the six precedence sources in section 1. "It probably
works like this" is not an acceptable basis for a line of code in this repository. If verification
is impossible, section 12's stop condition applies instead.

## 6. `eve` protocol

`eve` is preview software, and its repository explicitly directs authors to the docs shipped inside
`node_modules/eve/docs/`. That shipped copy, not the web, is the primary source.

For any `eve` task:

1. read `node_modules/eve/docs/README.md`;
2. read the relevant installed topic guide;
3. inspect the matching public export / type definition;
4. use authored filesystem slots exactly as documented;
5. run `pnpm exec eve info` after structural integration changes when the command applies;
6. run the documented build/check command before completion;
7. never import from an unexported `eve` internal path.

Reuse rule (AD-012): use the public authored surfaces such as `eve/hooks`, `eve/client`,
`eve/evals`, `defineWorkflowTool`, and eve approvals / tool policies rather than cloning a
documented eve capability into the harness.

## 7. Workflow SDK protocol

Before modifying the hosted workflow backend:

1. inspect the installed Workflow SDK docs / skill;
2. verify the installed package's directive and testing behavior;
3. use `"use workflow"` only for deterministic orchestration;
4. put API calls, database access, SDK calls, filesystem access, environment-variable reads and
   other side effects in `"use step"` functions, unless current official docs explicitly support
   another pattern;
5. use the SDK's documented retry / error / idempotency primitives rather than inventing
   equivalents;
6. verify generated source with the actual Workflow compiler / build.

The harness IR is not allowed to encode assumptions about the SDK's private transformation
internals.

## 8. AI SDK / Jev protocol

Before modifying `decision-jev`:

1. inspect the installed `ai` package version and its public types / docs;
2. verify the current Jev model identifier and supported question types from Vercel AI Gateway
   documentation;
3. isolate any experimental AI SDK API behind `decision-jev`;
4. never expose an experimental API name in the harness public API.

## 9. Sandbox protocol

Before implementing hosted compilation / execution:

1. inspect the installed `@vercel/sandbox` docs / types;
2. inspect relevant Vercel Labs reference implementations;
3. verify authentication, creation, command, filesystem, snapshot, timeout and teardown semantics;
4. encode only documented lifecycle behavior in the adapter.

## 10. Inspection checklists

> **`eve`, the AI SDK (`ai`), the Workflow SDK and `@vercel/sandbox` are NOT installed in this
> repository yet.** They arrive in Milestone 1 and later. Everything in this section is the
> procedure to run *once each dependency is installed*, not something to run today. Running these
> commands against the current tree will simply report that the path does not exist, and that is
> the expected result for Milestone 0.

### `node_modules/eve/docs/`

```sh
# List the docs eve ships, then read its entrypoint; `eve info` reports the
# integration state once the command applies to the current project.
ls node_modules/eve/docs
cat node_modules/eve/docs/README.md
pnpm exec eve info
```

### `eve` public exports and types

```sh
# Print the subpath export map without needing jq, then the same with jq if it
# is available, then the shipped declaration files that define those surfaces.
node -e "console.log(JSON.stringify(require('./node_modules/eve/package.json').exports, null, 2))"
cat node_modules/eve/package.json | jq .exports
ls node_modules/eve/dist/*.d.ts
```

### Installed AI SDK (`ai`) docs and types

```sh
# Confirm the installed version matches pnpm-lock.yaml, then read the shipped
# types and the package's own doc entrypoint.
cat node_modules/ai/package.json | grep '"version"'
ls node_modules/ai/dist/index.d.ts
cat node_modules/ai/README.md
```

If `README.md` is absent, read whichever doc entrypoint the package actually ships (`ls
node_modules/ai` first) rather than substituting a web page.

### Installed Workflow SDK docs, skills and types

```sh
# Read the manifest, look for shipped docs or an agent skill directory, then
# the declaration files that define the public surface.
cat node_modules/workflow/package.json
ls node_modules/workflow
ls node_modules/workflow/docs node_modules/workflow/skill 2>/dev/null
ls node_modules/workflow/dist/*.d.ts
```

### Installed Sandbox docs and types

```sh
# Manifest first (version, exports), then the shipped declaration files.
cat node_modules/@vercel/sandbox/package.json
ls node_modules/@vercel/sandbox/dist/*.d.ts
```

### Official Vercel repositories

When the installed package does not settle the question, these are the official repositories to
check, in this order:

- `vercel/eve`
- `vercel/ai`
- `vercel/workflow`
- `vercel/workflow-examples`
- `vercel/sandbox`

### Official vercel-labs examples

Per Appendix A of the build plan, search `vercel-labs` for a working implementation reference
before designing from scratch:

- `vercel-labs/workflow-workshop`
- other vercel-labs examples relevant to code execution with Vercel Sandbox, computer-use Sandbox
  snapshots, GitHub agents, and Workflow SDK workshops.

These repositories demonstrate patterns. They do not override the API contract of the installed
package version.

### Any non-Vercel dependency

The same habit, generically:

```sh
# Confirm the published version, read the shipped README, read the shipped
# types or JSON schema, then ask the package's own CLI what it supports.
npm view <pkg> version
cat node_modules/<pkg>/README.md
ls node_modules/<pkg>/dist/*.d.ts
cat node_modules/<pkg>/*.schema.json
pnpm exec <pkg> --help
```

## 11. The no-assumption stop condition

When an implementation detail is not established by the current public API, docs or types:

```text
STOP guessing
    ↓
search installed docs/types
    ↓
search official Vercel repo/docs/vercel-labs
    ↓
still undocumented?
    ↓
record open technical decision
    ↓
design a harness-owned abstraction explicitly
```

Ordinary internal engineering choices, where the framework imposes no contract at all, are
perfectly allowed. They must be labelled as project decisions rather than presented as framework
behaviour, and material architectural ones are captured in an ADR. That is AD-016: internal
implementation choices are recorded, not implied.

## 12. Where the record goes

| What | Where |
| --- | --- |
| A verification run, a version-specific finding, a docs-vs-installed-package discrepancy | A dated research note: `docs/research/<topic>/YYYY-MM-DD-<slug>.md` |
| A material architectural choice, including a harness-owned abstraction adopted because nothing public provides the behaviour | An ADR under [`docs/decisions/`](../decisions/) |
| The per-task `Implementation references` checkpoint | The task entry in `docs/progress/WORKLOG.md` |

## 13. A worked example

[`docs/research/tooling/2026-09-19-m0-toolchain-verification.md`](../research/tooling/2026-09-19-m0-toolchain-verification.md)
is this exact protocol applied end to end. None of its subjects is a Vercel primitive: it covers
Node, pnpm, TypeScript, Biome, Vitest, Turborepo, Husky, secretlint and GitHub Actions. That is the
point. It shows what a properly-sourced implementation-reference record looks like in practice:

- exact installed versions taken from the lockfile, not from memory;
- the specific files read inside `node_modules` (`turbo/schema.json`,
  `@biomejs/biome/configuration_schema.json`, `typescript/lib/typescript.d.ts`, the Vitest plugin
  declaration files) rather than a recollection of the API;
- claims verified by execution, including the Node 24 type-stripping behaviour and the
  `@internal/source` condition tested in both directions;
- a documented discrepancy resolved in favour of the installed package: pnpm's docs claim an
  install always fails on an incompatible project `engines.node`, and pnpm 12.4.2 does not do that,
  so the Node pin is enforced by `.node-version` and CI instead;
- a version-line choice (TypeScript 6.0 rather than 7.0) settled by quoting the official
  TypeScript 6.0 and 7.0 release announcements and by checking `npm view ts-morph dependencies`
  directly, rather than by recollection, together with the explicit trigger for re-evaluating it;
- a closing section listing the project-owned decisions that no tool prescribed, per AD-016.

Read it before writing your first `Implementation references` block.
