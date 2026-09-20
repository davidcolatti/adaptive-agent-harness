-- M2-T5 / M2-T6: the workflow registry tables.
--
-- `workflow_definitions`, `workflow_versions` and `workflow_promotions` are on
-- M2-T5's table list, but M4 (workflow IR and registry) and M6 (promotion) are
-- what give them meaning. They are created now in their **minimal keyed shape**
-- only: identity, the foreign keys that fix how they relate, a timestamp, and
-- one `payload jsonb` for everything the owning milestone will decide.
--
-- Nothing here invents their columns. Guessing at a workflow IR's column layout
-- two milestones early would publish a schema the milestone then has to break,
-- and the build plan is explicit that versioned payloads belong in JSONB rather
-- than being prematurely normalized.
--
-- They are created in this migration, ahead of `runs`, because the outcome
-- ledger carries `workflow_version_id` and the foreign key needs its target to
-- already exist.

-- Workflow definitions (M4)
create table public.workflow_definitions (
  id uuid primary key,
  domain_id text not null,
  domain_version text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint workflow_definitions_domain_fkey
    foreign key (domain_id, domain_version) references public.domains (id, version)
);

comment on table public.workflow_definitions is
  'M4 fills this. Minimal keyed shape only: a WorkflowId, the domain it belongs to, and a payload. M4 owns its columns.';

create index workflow_definitions_domain_idx
  on public.workflow_definitions (domain_id, domain_version, id desc);

alter table public.workflow_definitions enable row level security;

-- Workflow versions (M4)
create table public.workflow_versions (
  id uuid primary key,
  workflow_id uuid not null references public.workflow_definitions (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.workflow_versions is
  'M4 fills this. Minimal keyed shape only: a WorkflowVersionId, its workflow, and a payload that will hold the versioned IR.';

create index workflow_versions_workflow_id_idx on public.workflow_versions (workflow_id, id desc);

alter table public.workflow_versions enable row level security;

-- Workflow promotions (M6)
create table public.workflow_promotions (
  id uuid primary key,
  workflow_version_id uuid not null references public.workflow_versions (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.workflow_promotions is
  'M6 fills this. Minimal keyed shape only: a PromotionId, the version promoted, and a payload. ADR-0005 keeps promotion human-reviewed.';

create index workflow_promotions_workflow_version_id_idx
  on public.workflow_promotions (workflow_version_id, id desc);

alter table public.workflow_promotions enable row level security;
