-- M3-T3: fill the `decisions` table.
--
-- `20260920030301_later_milestone_tables.sql` created `decisions` in its
-- minimal keyed shape -- a `DecisionId`, the `run_id` it attaches to, one
-- `payload jsonb` and a timestamp -- with a comment saying "M3 fills this".
-- This is that migration, and it follows the model
-- `20260920202604_workflow_registry_columns.sql` set for M5: the earlier file
-- is not edited, because a migration is a fact about what was applied and
-- rewriting one makes the committed history stop describing any database that
-- ever existed.
--
-- The `payload jsonb` placeholder is DROPPED rather than kept beside the real
-- columns. Nothing has ever written it: the table was created a milestone ahead
-- of its owner and no code path inserted into it before this migration. A dead
-- column every future reader has to ask about is worse than a drop this comment
-- explains.
--
-- ## The split this schema enforces
--
-- `result` and `policy` are two columns, and that is Milestone 3's acceptance
-- criterion "raw Jev result is stored separately from policy outcome" written
-- into the schema rather than promised in prose. `result` is exactly what the
-- engine produced; `policy` is exactly what the organization decided about it,
-- and is NULL when no policy consumed the answer. Adding, changing or removing
-- a policy cannot alter a byte of `result`, which is what makes replaying
-- stored decisions through a changed threshold (ADR-0009) a pure function of
-- this table.
--
-- ## Why anything is denormalized out of `result`
--
-- `state_fingerprint`, `question_ids`, `model_provider`, `model_id`, `cost_usd`
-- and `latency_ms` all live inside the `result` document as well. They are
-- columns for the same reason `runs` is a ledger rather than a payload: "what
-- did this question cost, and how slow was it, across every run of this
-- domain?" is a `group by`, and a query that has to open a JSON document to
-- answer it is a query nobody writes. The authoritative copies stay in
-- `result`; the read boundary (`parseDecisionRecord()`) reads the document and
-- deliberately does not read these columns, so a row that had drifted cannot
-- look consistent.
--
-- The rules from `20260920030254_domains_and_jobs.sql` still hold: `uuid` ids
-- with no database default (ids are harness-minted UUIDv7, ADR-0030), stable
-- indexed metadata in columns and versioned payloads in `jsonb`, and row-level
-- security enabled with no policies. ADR-0045 records the model;
-- `docs/contracts/decision-engine.md` documents the port.

alter table public.decisions
  drop column payload,
  add column node_id text,
  add column state_fingerprint text not null,
  add column question_ids text[] not null,
  add column result jsonb not null,
  add column policy jsonb,
  add column model_provider text not null,
  add column model_id text not null,
  add column cost_usd numeric,
  add column latency_ms integer not null;

-- A decision was made by at most one node. NULL is a real case rather than a
-- gap: a `code` node may call the engine directly, and a decision made outside
-- a workflow has no node at all.
comment on column public.decisions.node_id is
  'The workflow node that asked, or NULL when no node did. Not a foreign key: a node id is unique within a workflow version, not globally.';

comment on column public.decisions.state_fingerprint is
  'sha256: digest over the canonical JSON of the evidence this decision was made from (ADR-0029). What lets a replay say "the same state" without storing the state twice.';

comment on column public.decisions.question_ids is
  'Every `id@version` this call answered, so "which decisions answered this question?" is an index scan rather than a jsonb walk. One call may answer several questions about one shared state (M3-T6).';

comment on column public.decisions.result is
  'The DecisionResult, verbatim: answers, distributions, harness-derived confidence, provider metadata, model, usage, latency and warnings. Never edited by a policy.';

comment on column public.decisions.policy is
  'The PolicyOutcome that consumed the answer -- route, the policy id@version, and at least one reason -- or NULL when no policy consumed it. Separate from result by design (ADR-0009).';

comment on column public.decisions.cost_usd is
  'What the decision cost, when the provider reports it. NULL for every row this milestone writes: the installed AI SDK evaluation API exposes no cost anywhere, and an estimate would be indistinguishable from a measurement once it was in this column.';

comment on column public.decisions.latency_ms is
  'Wall-clock duration of the engine call. NOT NULL because a completed call always has one; a call that never completed has no decision row.';

comment on table public.decisions is
  'M3 filled this. One row per engine call: the raw judgment in `result` and the organization''s decision about it in `policy`, separately, so changing a policy can replay stored evidence without rerunning Jev.';

-- "Every decision of this run, in the order they were made." A DecisionId is a
-- sortable UUIDv7, so `id` order is that order. The M2 placeholder created
-- `decisions_run_id_idx on (run_id, id desc)`; the port reads oldest first, so
-- this is the ascending companion rather than a replacement.
create index decisions_run_id_asc_idx on public.decisions (run_id, id);

-- "Which decisions answered this question?", across runs. GIN because
-- `question_ids` is an array and the query is containment.
create index decisions_question_ids_idx on public.decisions using gin (question_ids);
