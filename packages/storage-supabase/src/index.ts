// The public surface of `@internal/storage-supabase`.
//
// M2-T11 created this package to hold one thing: the TypeScript types generated
// from the local Supabase database by `pnpm supabase:types`. There is no adapter
// here yet. **M2-T5 adds it** — the `Storage` port, the `trace_events` sink that
// sits behind `createBufferedTraceWriter()`, and the decision about whether this
// package declares `@supabase/supabase-js`. That dependency is deliberately not
// declared yet, because nothing here calls Supabase at runtime.
//
// This package is a declared adapter in `tests/architecture/boundaries.ts`, which
// makes it the only workspace package permitted to depend on `@supabase/*`. No
// Supabase concept may leak past it into `@internal/core` (AGENTS.md, "No direct
// database access outside `packages/storage-supabase`").
//
// `./database.types.js` is generated and never hand-edited (AGENTS.md rule 12).
// Regenerate it with `pnpm supabase:reset && pnpm supabase:types`; the
// `supabase-types` CI job fails if the committed file drifts from what the
// committed migrations produce.
export type { Database } from "./database.types.js";
