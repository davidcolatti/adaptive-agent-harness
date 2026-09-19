# Concepts

These are definitions from the build plan. Implementation for each concept lands in the milestone
noted in `docs/milestones/README.md` and, where one exists, the relevant entry in
`docs/contracts/README.md`.

- **harness**: A reusable TypeScript package that owns the agent execution lifecycle (routing,
  tracing, compiling, replaying, promoting) so many independent domain-agent repositories can
  install it.

- **domain**: A consuming package that owns instructions, SOPs, tools, skills, schemas,
  permissions, and evals for one kind of work, and registers itself with the harness via
  `defineDomain()`.

- **job**: An immutable unit of work with an id, domain reference, job type, objective, input,
  contract references, budget, and permissions.

- **job type**: The specific kind of task within a domain (for example, vendor triage) that a job
  instance belongs to; jobs of the same type share input/output schemas and an SOP.

- **SOP**: The standard operating procedure text a domain supplies describing how a job type
  should be performed; referenced by a job's contracts and hashed into its behavior fingerprint.

- **trace**: The append-only, ordered sequence of structured events (run, agent, model, tool,
  decision, node, and so on) captured for every execution, sufficient to reconstruct what happened
  without application logs.

- **behavior fingerprint**: A hash of the canonicalized behavior-affecting inputs (instructions,
  SOP, loaded skills, tool versions, model configuration, schemas, workflow IR, policy thresholds)
  used to detect when execution semantics have changed.

- **workflow IR**: The versioned, serializable intermediate representation of a compiled workflow
  (nodes, control shapes, capability references) that is the authoritative source of compiled
  semantics; generated TypeScript is derived from it and never hand-edited.

- **capability registry**: The typed registry mapping stable capability IDs and versions
  (schemas, agents, tools, handlers, policies) to executable values and manifest metadata, used to
  resolve workflow node references and to drive deterministic code generation.

- **Jev**: A bounded-judgment decision primitive, exposed through AI Gateway and the AI SDK's
  evaluation API, that answers scoped probabilistic questions (Boolean, Choice, Score) without
  deciding what happens next.

- **policy**: The deterministic TypeScript logic that consumes a Jev (or other decision) result
  and decides the route to take; versioned and replayable independently of the judgment it
  consumes.

- **fallback**: The mechanism by which a compiled workflow execution that cannot confidently
  complete hands off to the full agent, carrying the original job, workflow evidence, and trusted
  completed node results.

- **replay**: Re-executing a workflow against frozen or historical evidence and recorded tool
  results instead of live external calls, to compare workflow or reasoning changes without
  evidence drift.

- **reserved set**: The dataset split the compiler must never see before final promotion
  evaluation; an unbiased holdout the compiler cannot optimize against.

- **promotion**: The gated transition of a candidate workflow from draft or candidate status to
  active production routing, requiring passing static checks, replay, and evaluation against a
  promotion policy, with human review preceding autonomous promotion.

- **learning**: The advisory process of turning traces into generalized, evidence-linked notes
  about stable behavior, without altering production routing until that behavior is compiled and
  promoted.
