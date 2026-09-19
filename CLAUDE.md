# CLAUDE.md

This repository's engineering rules live in `AGENTS.md`. Read it first, in
full, before making any change.

Read order: `AGENTS.md` -> `docs/context/current-state.md` -> `docs/README.md`
-> current milestone -> relevant architecture/contracts/ADRs.

`docs/context/current-state.md` is the concise, present-tense truth about
what currently works. `docs/README.md` is the documentation map.

This project pins Node `24.21.0` (`.node-version`, `.nvmrc`) and pnpm
`12.4.2` (`packageManager` in `package.json`). Use them exactly.

`pnpm check` must pass before any work is declared done.
