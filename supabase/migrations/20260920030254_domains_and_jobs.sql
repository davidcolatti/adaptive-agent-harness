-- M2-T5 / M2-T6: `domains` and `jobs`.
--
-- The two tables everything else hangs off. See ADR-0036 for the storage design
-- and docs/contracts/storage.md for the port that writes them.
--
-- Three rules apply to every table in this schema and are not repeated per file:
--
--   1. Every id column is `uuid`. Ids are harness-minted RFC 9562 UUIDv7
--      (ADR-0030), never `gen_random_uuid()`, so there is no column default:
--      the harness mints the id before the row exists, and a database-generated
--      id would be a second, conflicting identity. `uuid` comparison was
--      measured on this Postgres (17.6) to be unsigned bytewise and therefore
--      equal to the lowercase textual order of the same values, so
--      `order by <id>` is creation order.
--   2. Stable, indexed metadata lives in columns; versioned payloads live in
--      `jsonb` (build plan, M2-T5). Nothing model- or tool-shaped is normalized
--      into its own table.
--   3. Row-level security is enabled with **no policies**. `service_role` holds
--      `bypassrls` and is the only role the harness ever connects as; `anon` and
--      `authenticated` therefore reach nothing, which is the documented Supabase
--      behaviour for an RLS-enabled table with no policy. There is no
--      multi-tenant auth in this milestone and inventing policies for it would
--      be the speculative kind of work AGENTS.md's scope discipline forbids.
--
-- `created_at` is the moment the **row** was written, which is not the moment
-- the entity was created: a UUIDv7 id already embeds the latter, readable with
-- `entityIdTimestamp()`. Both are kept because they answer different questions,
-- and a replay that re-inserts historical evidence makes them differ on purpose.

-- Domains
--
-- One row per (domain id, domain version). The pair is the primary key rather
-- than a surrogate: a domain is already named by a stable string and a version
-- string (`DomainRef` in `@internal/core`), nothing mints an id for one, and
-- `jobs`/`runs` reference the pair.
--
-- `organization_id` is what makes AD-008's learning scope
-- (organization/workspace -> domain -> job type) expressible. It defaults to
-- `local` because this milestone is local-first (AD-004) and there is no
-- tenancy model yet; the column exists so that scoping a learning query is a
-- `where`, not a migration. No organizations table is created: a table with one
-- row and no columns anyone reads would be speculation.
create table public.domains (
  id text not null,
  version text not null,
  organization_id text not null default 'local',
  created_at timestamptz not null default now(),
  primary key (id, version)
);

comment on table public.domains is
  'One row per (domain id, domain version). Upserted by Storage.saveJob. organization_id carries AD-008''s outermost learning scope.';

create index domains_organization_id_idx on public.domains (organization_id, id);

alter table public.domains enable row level security;

-- Jobs
--
-- One row per `Job` (build plan section 5). The full effective job is stored
-- verbatim in `job jsonb` so that `parseJob()` can turn a row straight back
-- into a `Job`; the columns beside it are the ones queries filter and join on,
-- duplicated from the payload on purpose so an index can exist.
create table public.jobs (
  id uuid primary key,
  domain_id text not null,
  domain_version text not null,
  job_type text not null,
  objective text not null,
  -- The whole effective job, exactly as `parseJob()` accepts it, including
  -- `input`, `contracts`, `budget`, `permissions` and `metadata`.
  job jsonb not null,
  -- The composite `sha256:` behavior fingerprint of the run that created this
  -- job (M2-T8). Nullable: a domain that declares no `behavior` source has
  -- none, and a fabricated digest would be worse than an absent one.
  behavior_fingerprint text,
  created_at timestamptz not null default now(),
  constraint jobs_domain_fkey
    foreign key (domain_id, domain_version) references public.domains (id, version)
);

comment on table public.jobs is
  'The immutable unit of work. `job` holds the full effective job; the columns beside it are the indexed projection of it.';
comment on column public.jobs.job is
  'The full effective job as parseJob() accepts it. Versioned payload, never normalized into columns (build plan M2-T5).';

create index jobs_domain_job_type_idx on public.jobs (domain_id, job_type, id desc);

alter table public.jobs enable row level security;
