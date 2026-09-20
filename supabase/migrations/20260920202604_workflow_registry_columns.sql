-- M5-T1 / M5-T2: fill the workflow registry tables.
--
-- `20260920030256_workflow_registry_tables.sql` created `workflow_definitions`,
-- `workflow_versions` and `workflow_promotions` in their minimal keyed shape --
-- identity, foreign keys, a timestamp and one `payload jsonb` -- with a comment
-- on each saying the owning milestone would decide its columns. This is that
-- migration. The earlier file is not edited; a migration is a fact about what
-- was applied, and rewriting one makes the committed history stop describing
-- any database that ever existed.
--
-- The `payload jsonb` placeholder is DROPPED on all three tables rather than
-- kept beside the real columns. Nothing has ever written it: the tables were
-- created two milestones ahead of their owner and no code path inserts into
-- them before this migration. A dead column that every future reader has to
-- ask about is worse than a drop that this comment explains.
--
-- The rules from `20260920030254_domains_and_jobs.sql` still hold: `uuid` ids
-- with no database default (ids are harness-minted UUIDv7, ADR-0030), stable
-- indexed metadata in columns and versioned payloads in `jsonb`, and row-level
-- security enabled with no policies. ADR-0043 records the model these columns
-- encode; `docs/contracts/workflow-registry.md` documents the port.

-- Workflow definitions: the identity of a workflow across its versions.
alter table public.workflow_definitions
  drop column payload,
  add column workflow_key text not null,
  add column job_type text not null;

-- `(domain_id, workflow_key)` is the natural key. Re-registering a workflow
-- adds a version; it must not add a second workflow.
alter table public.workflow_definitions
  add constraint workflow_definitions_domain_key_unique unique (domain_id, workflow_key);

comment on table public.workflow_definitions is
  'M5 filled this. One row per workflow, identified by (domain_id, workflow_key); its versions live in workflow_versions.';

comment on column public.workflow_definitions.workflow_key is
  'The workflow IR''s own `id`, e.g. `vendor-triage`. Unique within the domain.';

comment on column public.workflow_definitions.job_type is
  'The job type every version of this workflow handles.';

-- Workflow versions: one row per fingerprinted IR.
alter table public.workflow_versions
  drop column payload,
  add column domain_id text not null,
  add column job_type text not null,
  add column fingerprint text not null,
  add column status text not null,
  add column definition jsonb not null,
  add column compatibility jsonb not null,
  add column status_changed_at timestamptz not null,
  add column metadata jsonb not null default '{}'::jsonb;

-- The seven statuses of `WORKFLOW_STATUSES` in `packages/core/src/workflow-registry.ts`.
-- The list is stated in the database as well as in the type for the same reason
-- `runs.status` is: a row is untrusted input even when the adapter wrote it.
alter table public.workflow_versions
  add constraint workflow_versions_status_check
    check (status in ('draft', 'candidate', 'shadow', 'canary', 'active', 'retired', 'rejected'));

-- The fingerprint is the version's identity within its workflow. Registering
-- byte-identical IR twice is a conflict, not two rows (north-star invariant 4).
alter table public.workflow_versions
  add constraint workflow_versions_workflow_fingerprint_unique unique (workflow_id, fingerprint);

-- "every active version" across all domains, newest first.
create index workflow_versions_status_idx on public.workflow_versions (status, id desc);

-- The router's only hot-path query: every active version that could serve this
-- job, newest first, which is also the selector's tie-break order.
create index workflow_versions_routing_idx
  on public.workflow_versions (domain_id, job_type, status, id desc);

comment on table public.workflow_versions is
  'M5 filled this. One row per fingerprinted workflow IR, with the compatibility it declares and the lifecycle status routing reads.';

comment on column public.workflow_versions.domain_id is
  'Denormalized from workflow_definitions so the router filters and pages one table. The authoritative copy is compatibility->>''domainId'', derived from the IR.';

comment on column public.workflow_versions.job_type is
  'Denormalized from workflow_definitions for the same reason as domain_id.';

comment on column public.workflow_versions.fingerprint is
  'sha256: digest over the canonical IR. The version''s identity; the read boundary recomputes it and rejects a row whose digest and definition disagree.';

comment on column public.workflow_versions.definition is
  'The workflow IR, exactly as parseWorkflowDefinition() accepts it.';

comment on column public.workflow_versions.compatibility is
  'What the version declares it can handle: domain, job type, both schemas, the capabilities it pins at exact versions, the SOP, and the minimum harness version.';

-- Workflow promotions: the append-only ledger of status changes.
alter table public.workflow_promotions
  drop column payload,
  add column from_status text not null,
  add column to_status text not null,
  add column actor text not null,
  add column reason text;

alter table public.workflow_promotions
  add constraint workflow_promotions_from_status_check
    check (from_status in ('draft', 'candidate', 'shadow', 'canary', 'active', 'retired', 'rejected')),
  add constraint workflow_promotions_to_status_check
    check (to_status in ('draft', 'candidate', 'shadow', 'canary', 'active', 'retired', 'rejected'));

comment on table public.workflow_promotions is
  'M5 filled this. One row per status change, so a version''s history is a ledger rather than a column that remembers only the last move. AD-005 keeps promotion human-invoked, which is why actor is NOT NULL.';

comment on column public.workflow_promotions.actor is
  'Who moved it. A person, a script, a CI job: something answerable.';
