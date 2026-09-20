// The public surface of `@internal/storage-supabase`: the Supabase `Storage`
// adapter (M2-T5, M2-T7) and the generated database types (M2-T11).
//
// This package is a declared adapter in `tests/architecture/boundaries.ts`,
// which makes it the only workspace package permitted to depend on
// `@supabase/*`. No Supabase concept leaves it: `createSupabaseStorage()`
// returns the `Storage` port from `@internal/core`, and a `PostgrestError`
// becomes a `StorageError` before it crosses the boundary (AGENTS.md, "No
// direct database access outside `packages/storage-supabase`").
//
// `SupabaseClient` is re-exported as a **type only**, because
// `CreateSupabaseStorageOptions.client` names it and a caller supplying one has
// to be able to say so. Nothing in the package exposes a value from
// `@supabase/*`.
//
// `./database.types.js` is generated and never hand-edited (AGENTS.md rule 12).
// Regenerate it with `pnpm supabase:reset && pnpm supabase:types`; the
// `supabase-types` CI job fails if the committed file drifts from what the
// committed migrations produce.
export type { Database, Json, Tables, TablesInsert, TablesUpdate } from "./database.types.js";
export type {
  CreateSupabaseStorageOptions,
  SupabaseStorage,
} from "./supabase-storage.js";
export { createSupabaseStorage } from "./supabase-storage.js";
