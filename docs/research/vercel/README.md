This directory is reserved for dated Vercel-specific research notes, per AD-011
(`docs/decisions/0011-no-vercel-implementation-detail-may-be-guessed.md`), following the naming
convention `docs/research/vercel/YYYY-MM-DD-<slug>.md` and covering findings about packages such as
`eve`, the AI SDK, the Workflow SDK, or `@vercel/sandbox`.

- [`2026-09-19-m1-eve-ai-sdk-install-survey.md`](2026-09-19-m1-eve-ai-sdk-install-survey.md):
  written by M1-T1, the task that installed `eve` 0.63.0 and `ai` 7.0.107. Covers the installed
  versions and peer dependencies, the eve/ai compatibility finding, the inventory of the docs
  `eve` ships, both public export maps, the `eve` CLI surface, and the explicit list of behaviour
  that is not provided publicly and must therefore be harness-owned.

- [`2026-09-19-m1-eve-project-scaffold.md`](2026-09-19-m1-eve-project-scaffold.md): written by
  M1-T2, the task that scaffolded `apps/example-agent` as a real `eve` project. Covers the authored
  filesystem layout the installed docs define, path-derived capability naming, the `define*`
  surface actually used and the declaration files that establish it, the absence of any read-only
  or side-effect flag on a tool definition, the `.js`-extension finding for relative imports,
  eve's optional default tools (including the live web tools this fixture domain disables), the
  exact `eve info` and `eve build` output, and the questions M1-T4 and M1-T6 still have to answer.

The Workflow SDK and `@vercel/sandbox` are still not installed, so no note covers them yet.
