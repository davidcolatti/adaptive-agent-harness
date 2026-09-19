---
status: accepted
date: 2026-09-19
deciders: project owner (build plan); recorded during M0
related: [0002, 0003, 0012, 0016]
supersedes: null
superseded_by: null
---

# ADR-0011: No Vercel implementation detail may be guessed; mandatory source precedence and research checkpoint

## Context

AD-011 states: "Any task that touches a Vercel primitive MUST verify the current API and runtime
semantics before implementation," and gives a strict source order the implementing agent must
follow:

```text
1. Installed package docs matching pnpm-lock.yaml
2. Installed package public TypeScript exports/types
3. Official Vercel GitHub repository source and examples
4. Official Vercel documentation
5. Official vercel-labs reference implementations
6. Harness-owned design only when the behavior is not provided publicly
```

The agent MUST NOT invent an import path, infer a method signature from memory, copy a stale blog
example without checking the installed version, assume preview APIs are unchanged, reach into
unexported package internals, or claim a Vercel primitive provides behavior its current docs do
not establish. "When sources disagree, the lockfile-matched installed package wins. Record the
discrepancy in an ADR or research note." AD-011 further requires a "required research checkpoint"
before any framework-facing task moves to `in_progress`: an `Implementation references` section
in the work log recording package/version, docs/files read, official repo/examples read, public
exports/types inspected, exact API/pattern selected, and anything undocumented that must become
harness-owned. It also defines four sub-protocols: the eve-specific protocol (read
`node_modules/eve/docs/README.md` and the relevant topic guide, inspect matching public
export/type definitions, use only authored filesystem slots, run `pnpm exec eve info` after
structural changes, run the documented build/check command, never import unexported `eve`
internals); the Workflow SDK protocol (`"use workflow"` only for deterministic orchestration,
side effects/API/DB/SDK/filesystem/env-var access in `"use step"` functions unless docs say
otherwise, use documented retry/error/idempotency primitives, verify generated source with the
actual Workflow compiler); the AI SDK/Jev protocol (verify installed `ai` package version and
public types/docs, verify the current Jev model identifier and question types from AI Gateway
documentation, isolate experimental AI SDK APIs behind `decision-jev`, never expose an
experimental API name in the harness public API); and the Sandbox protocol (inspect installed
`@vercel/sandbox` docs/types, inspect Vercel Labs reference implementations, verify
authentication/creation/command/filesystem/snapshot/timeout/teardown semantics, encode only
documented lifecycle behavior).

## Decision

Any task that touches a Vercel primitive (`eve`, AI SDK, AI Gateway, Jev, Vercel Workflow, Vercel
Sandbox) MUST follow the six-step source precedence above before writing implementation code, and
MUST NOT proceed on memory, inference, or an unverified web example. Before such a task moves to
`in_progress`, the work log MUST contain an `Implementation references` section listing the
installed package and version, the docs/files actually read, the official repo/examples read, the
public exports/types inspected, the selected pattern, and any behavior gap that must be
harness-owned. Where sources disagree, the lockfile-matched installed package's behavior wins,
and the discrepancy MUST be recorded in an ADR or research note under `docs/research/`. The four
sub-protocols (eve, Workflow SDK, AI SDK/Jev, Sandbox) as specified above MUST each be followed
verbatim for tasks touching that primitive; `decision-jev` specifically MUST isolate the
experimental AI SDK evaluation API and MUST NOT expose an experimental API name through the
harness's public API surface.

## Consequences

### Positive

- Prevents an entire class of defects (stale APIs, invented import paths, guessed method
  signatures, incorrectly assumed preview-API stability) that are otherwise common when working
  against a fast-moving, partially preview-status stack (`eve` is explicitly preview software).
- Produces a durable research trail (`Implementation references` in the WORKLOG, per ADR-0014)
  that later engineers and coding agents can use to understand why a given API pattern was
  chosen, rather than having to re-derive it.

## Negative

- Adds real per-task overhead: no framework-facing task can start implementation before its
  research checkpoint is complete, which is slower than writing code directly from memory or a
  quick web search.
- Requires ongoing discipline to re-verify behavior whenever a Vercel-facing dependency is
  upgraded, since previously-recorded research notes can go stale.

## Neutral

- Constrains every milestone from M1 onward that touches `eve`, AI SDK, Jev, Vercel Workflow, or
  Vercel Sandbox, most concentratedly Milestone 1 (eve adapter), Milestone 3 (Jev), and Milestone
  11 (Vercel Workflow/Sandbox adapters, eve production adapter validation).
- Governs the mandatory structure of `docs/progress/WORKLOG.md` entries (ADR-0014) and the
  existence of `docs/development/source-of-truth-protocol.md` (Milestone 0, M0-T11).

## Alternatives considered

- **Allow implementers to rely on general framework knowledge or memory for Vercel-facing code**:
  rejected outright; AD-011 states the agent "MUST NOT ... infer a method signature from memory"
  and treats installed, lockfile-matched documentation as authoritative over recollection or
  older examples.
- **Treat official web documentation as authoritative over the installed package**: rejected; the
  source order places installed package docs and public types above official documentation, and
  states "the lockfile-matched installed package wins" on disagreement.

## References

- `docs/milestones/build-plan.md` §1 AD-011 (including the required research checkpoint and the
  eve/Workflow SDK/AI SDK-Jev/Sandbox protocols), Appendix A
- Related ADRs: 0002, 0003, 0012, 0016
- Related code paths: `docs/development/source-of-truth-protocol.md`, `docs/research/`
