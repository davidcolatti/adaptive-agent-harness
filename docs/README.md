# Documentation map

This is the entry point for every human and coding agent working in this repository.

## Read order

This is the exact order every fresh session, human or coding agent, should read documentation in
before making a change:

```
1. AGENTS.md
2. docs/context/current-state.md
3. docs/README.md
4. relevant architecture/contracts
5. relevant ADRs
6. current milestone/task
7. relevant installed framework docs
```

## Documentation categories

| Category | Responsibility | Entry point |
|---|---|---|
| `architecture/` | how the current system works | [docs/architecture/system-map.md](architecture/system-map.md), [docs/architecture/runtime.md](architecture/runtime.md) |
| `contracts/` | stable boundaries and schemas | [docs/contracts/README.md](contracts/README.md) |
| `decisions/` | why architectural choices were made | [docs/decisions/README.md](decisions/README.md) |
| `concepts/` | mental models and definitions | [docs/concepts/README.md](concepts/README.md) |
| `development/` | how to work in the repo | [docs/development/local-setup.md](development/local-setup.md) |
| `milestones/` | planned implementation work | [docs/milestones/README.md](milestones/README.md) |
| `runbooks/` | operational procedures | [docs/runbooks/README.md](runbooks/README.md) |
| `research/` | dated external research, not architectural truth | [docs/research/README.md](research/README.md) |
| `context/` | concise present-tense handoff | [docs/context/current-state.md](context/current-state.md) |
| `progress/` | chronological execution history | [docs/progress/README.md](progress/README.md) |
| `examples/` | worked examples | [docs/examples/README.md](examples/README.md) |

## Frontmatter rule

Every file under `docs/architecture/` and `docs/contracts/` must carry this frontmatter block:

```yaml
---
status: active
owner: core
last_verified: YYYY-MM-DD
related:
  - docs/...
implementation:
  - packages/...
---
```

## If code and docs disagree

If code and documentation disagree, the coding agent must stop treating the doc as authoritative,
verify the actual behavior by reading the code or the installed package, and update or mark the
stale doc as part of the same task. Never silently proceed on a doc that is known to be wrong.

## Where the authoritative build plan lives

`docs/milestones/build-plan.md` is a verbatim copy of the owner's authoritative implementation
plan. It is never edited directly. Changes to it are proposed via an ADR under `docs/decisions/`.
