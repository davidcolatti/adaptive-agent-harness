This directory is reserved for dated Vercel-specific research notes, per AD-011
(`docs/decisions/0011-no-vercel-implementation-detail-may-be-guessed.md`), following the naming
convention `docs/research/vercel/YYYY-MM-DD-<slug>.md` and covering findings about packages such as
`eve`, the AI SDK, the Workflow SDK, or `@vercel/sandbox`.

- [`2026-09-19-m1-eve-ai-sdk-install-survey.md`](2026-09-19-m1-eve-ai-sdk-install-survey.md):
  written by M1-T1, the task that installed `eve` 0.63.0 and `ai` 7.0.107. Covers the installed
  versions and peer dependencies, the eve/ai compatibility finding, the inventory of the docs
  `eve` ships, both public export maps, the `eve` CLI surface, and the explicit list of behaviour
  that is not provided publicly and must therefore be harness-owned.

The Workflow SDK and `@vercel/sandbox` are still not installed, so no note covers them yet.
