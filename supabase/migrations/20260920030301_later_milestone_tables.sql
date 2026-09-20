-- M2-T5 / M2-T6: the five remaining tables on M2-T5's list, in minimal keyed
-- shape.
--
-- `decisions` (M3), `eval_runs` and `eval_results` (M6), `learning_runs` (M7)
-- and `compiler_runs` (M8). Each gets identity, the foreign keys that fix how
-- it relates to what already exists, a timestamp and one `payload jsonb`.
--
-- Their columns are **not** invented here. The build plan names the tables in
-- M2-T5 so that the schema's shape is visible from the start, not so that M2
-- designs five milestones' data models; a column guessed now is a column the
-- owning milestone has to migrate away from. What is decided here, and worth
-- deciding early, is only how they attach: a decision belongs to a run, an eval
-- result belongs to an eval run, and learning and compiler runs stand alone.

-- Decisions (M3)
--
-- One Jev judgment. Attached to the run it was made in, because the trace
-- already carries `decision.started`/`decision.completed` events and the two
-- must be joinable.
create table public.decisions (
  id uuid primary key,
  run_id uuid not null references public.runs (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.decisions is
  'M3 fills this. Minimal keyed shape only: a DecisionId, the run it was made in, and a payload. ADR-0009 keeps judgment separate from policy.';

create index decisions_run_id_idx on public.decisions (run_id, id desc);

alter table public.decisions enable row level security;

-- Eval runs (M6)
create table public.eval_runs (
  id uuid primary key,
  domain_id text not null,
  domain_version text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint eval_runs_domain_fkey
    foreign key (domain_id, domain_version) references public.domains (id, version)
);

comment on table public.eval_runs is
  'M6 fills this. Minimal keyed shape only: an EvalRunId, the domain evaluated, and a payload.';

create index eval_runs_domain_idx on public.eval_runs (domain_id, domain_version, id desc);

alter table public.eval_runs enable row level security;

-- Eval results (M6)
--
-- `id` has no brand in ADR-0030's twelve, which is honest: nothing mints one
-- yet. It is still a harness-minted `uuid` with no database default, for the
-- same reason as every other id here; M6 decides which brand it carries.
create table public.eval_results (
  id uuid primary key,
  eval_run_id uuid not null references public.eval_runs (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.eval_results is
  'M6 fills this. Minimal keyed shape only. Its id has no entity brand yet (ADR-0030 defines twelve and this is not one of them); M6 decides.';

create index eval_results_eval_run_id_idx on public.eval_results (eval_run_id, id desc);

alter table public.eval_results enable row level security;

-- Learning runs (M7)
create table public.learning_runs (
  id uuid primary key,
  domain_id text not null,
  domain_version text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint learning_runs_domain_fkey
    foreign key (domain_id, domain_version) references public.domains (id, version)
);

comment on table public.learning_runs is
  'M7 fills this. Minimal keyed shape only. Scoped to one domain because ADR-0008 forbids learning in one domain silently altering another.';

create index learning_runs_domain_idx on public.learning_runs (domain_id, domain_version, id desc);

alter table public.learning_runs enable row level security;

-- Compiler runs (M8)
create table public.compiler_runs (
  id uuid primary key,
  domain_id text not null,
  domain_version text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint compiler_runs_domain_fkey
    foreign key (domain_id, domain_version) references public.domains (id, version)
);

comment on table public.compiler_runs is
  'M8 fills this. Minimal keyed shape only. ADR-0006 keeps the IR authoritative and generated source committed, so this records the run, not the output.';

create index compiler_runs_domain_idx on public.compiler_runs (domain_id, domain_version, id desc);

alter table public.compiler_runs enable row level security;
