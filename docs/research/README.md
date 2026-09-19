# Research

This directory holds dated, external research notes: facts gathered from installed packages,
official documentation, and official repositories about frameworks and tooling this project uses.
Research notes are not architectural truth. They record what was found in a specific package,
document, or repository on a specific date, so a future reader does not have to re-derive it from
scratch.

If a research note and an architecture doc disagree about current framework behavior, the research
note is closer to the ground truth, because it was verified directly against the installed package
or an official source. When that happens, the architecture doc should be corrected, not the
research note.

## Naming convention

```
docs/research/<topic>/YYYY-MM-DD-<slug>.md
```

`<topic>` groups notes by subject area (for example `tooling`, `vercel`). `YYYY-MM-DD` is the date
the research was performed, not the date the topic was first raised. `<slug>` is a short
kebab-case description of what was verified.

## Required frontmatter

Every research note carries the same frontmatter shape as architecture and contract documents:

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

## Research notes never override the packages themselves

A research note documents what was found in an installed package's types, an official doc, or an
official repository at the time it was written. It is not a substitute for reading the packages
directly on the next task: package versions change, APIs move, and a note can go stale. Treat a
research note as a starting point and a record of prior findings, not as a permanent authority that
excuses skipping verification against the actual installed code.

## Index

- `tooling/2026-09-19-m0-toolchain-verification.md`: Milestone 0 toolchain verification (Node,
  pnpm, TypeScript, Biome, Vitest, Turborepo, Husky, secretlint, GitHub Actions).
- `vercel/2026-09-19-m1-eve-ai-sdk-install-survey.md`: M1-T1 install survey for `eve` 0.63.0 and
  the AI SDK (`ai`) 7.0.107 (installed versions, peer dependencies, the eve/ai compatibility
  finding, the shipped `eve` docs inventory, both public export maps, and what is harness-owned).
