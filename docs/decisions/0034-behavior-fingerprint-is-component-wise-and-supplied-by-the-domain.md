---
status: accepted
date: 2026-09-19
deciders: orchestrator (Claude Fable 5.1) with repository owner constraints; recorded during M2-T8
related:
  - docs/contracts/behavior-fingerprint.md
  - docs/contracts/capability-registry.md
  - docs/contracts/harness.md
  - docs/contracts/trace-event.md
  - docs/contracts/domain-definition.md
  - docs/milestones/build-plan.md
  - docs/decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md
  - docs/decisions/0028-eve-agent-runtime-is-a-url-only-client-that-observes-the-eve-event-stream.md
  - docs/decisions/0025-application-packages-may-author-eve-agents-directly.md
  - docs/decisions/0032-jobs-are-deeply-immutable-and-the-effective-job-is-the-job.md
supersedes: null
superseded_by: null
---

# ADR-0034: The behavior fingerprint is component-wise, hashes content not source, and is supplied by the domain

## Context

North-star invariant 4 is "every behavior-affecting version is fingerprinted". M2-T8 is the task
that makes it true: "hash canonicalized behavior-affecting inputs: agent instructions, SOP, loaded
skills, tool definitions/version IDs, model configuration, schemas, workflow IR, policy thresholds.
Do not hash timestamps or irrelevant metadata." The M2 acceptance criterion is narrower and
sharper: "Behavior fingerprint changes when instructions/SOP/policy changes."

Three prior decisions fix most of the shape of the answer, and one leaves a hole.

**ADR-0029 already decided *how* to hash.** RFC 8785-style canonical JSON, SHA-256, a mandatory
`sha256:` prefix, in `packages/core/src/fingerprint.ts`. It says in as many words that "M2-T8
extends *what* is hashed without changing *how*". So this ADR is about inputs and composition, not
about digests.

**M1-T9 already fingerprints one thing, and it is not this.** `capabilityFingerprint()` hashes a
manifest entry's *reference* metadata: kind, id, version, module, export name, the two schema
references, the permission declarations. That is a fingerprint of a **declaration**, and it
deliberately does not read the file the declaration points at. `capability-registry.md` already
anticipated the distinction and called what M2-T8 needs a *content* fingerprint.

**`TraceEvent.behaviorFingerprint` exists and is `null`.** M2-T3 typed the field and refused to
fill it, on the grounds that a fabricated value is worse than an absent one. `TraceRecorder` takes
a `behaviorFingerprint` option that nothing passes. So the wiring is already there and the value is
not.

The hole is **who can see the inputs**. ADR-0028 makes `EveAgentRuntime` a URL-only client: it
talks to an eve server over HTTP and never reads that agent's files, never spawns its process and
never loads its modules. ADR-0025 makes the application, not the harness, the author of the eve
agent. So the harness cannot open `agent/instructions.md`, cannot enumerate `agent/skills/` and
cannot read the model configuration out of `agent/agent.ts` — and even if it could reach the files,
it has no general way to know which framework's slots to look in. Whatever gathers the inputs has
to be the application.

One smaller question was left open by ADR-0032 and is addressed here: `Job.contracts.sop` is a
bare, unversioned identifier (`procurement-sop`), and that ADR recorded "if M2-T8 concludes that a
reference must name a version, the change is to `JobContracts`".

## Decision

### 1. A behavior fingerprint is a composite of eight named component fingerprints

`packages/core/src/behavior.ts` defines `BehaviorDescriptor`, with exactly one field per component
of the build plan's list, in its order: `instructions`, `sop`, `skills`, `tools`, `model`,
`schemas`, `workflowIr`, `policy`. `createBehaviorFingerprint(descriptor)` returns:

```ts
{
  fingerprint: string;                                   // "sha256:…", the composite
  components: Readonly<Record<BehaviorComponentName, string>>;  // one "sha256:…" each
  algorithm: "sha256";
  scheme: 1;
}
```

Each component is `fingerprint()` over its own canonical JSON, and the composite is `fingerprint()`
over `{ scheme, components }`. Nothing here changes ADR-0029's algorithm.

**Component fingerprints are not a convenience; they are the product.** "The behavior changed" is
not an actionable finding. "The SOP changed and nothing else did" is. M6-T4's replay compares
fingerprints to decide whether two runs are comparable at all, and a mismatch it cannot attribute
is a mismatch a human cannot triage. M7-T1 selects learning batches by behavior fingerprint and
must be able to group runs that differ only in a component it does not care about. A single flat
hash answers neither question, and recomputing the difference later is impossible, because the
descriptor that produced an old fingerprint is gone.

**`scheme` is hashed into the composite.** Adding, removing or redefining a component changes what
a composite means. The `sha256:` prefix versions the *algorithm* and cannot carry that, because the
algorithm would be unchanged. Hashing the scheme number makes such a change move every composite at
once and say why, while leaving the component digests comparable across the change. It is a
deviation from the three-field shape the task brief sketched, taken for that reason.

### 2. What is hashed, and what is deliberately not

Hashed:

| Component | What goes in |
| --- | --- |
| `instructions` | The agent's base instruction text. |
| `sop` | The SOP **content**, not its identifier. |
| `skills` | Every loadable skill, as `{ id, content }`. |
| `tools` | Every callable tool, as `{ id, version, definitionFingerprint }`. |
| `model` | The behavior-affecting model/runtime configuration, as a JSON object. |
| `schemas` | Every bound schema, as `{ ref, fingerprint }`. |
| `workflowIr` | The compiled IR, or `null` for a full-agent run. |
| `policy` | The policy thresholds, as a JSON object. |

Not hashed, each for a stated reason:

- **Anything time-dependent.** M2-T8 says so outright. This is enforced by the *type* rather than
  by review: `BehaviorDescriptor` is closed, with no index signature and no `metadata` field, so
  there is nowhere to put a timestamp, a run id, a hostname or a "last edited by". A type-level
  test asserts `keyof BehaviorDescriptor` is exactly the component list.
- **Executable source.** A tool enters the hash as its id, its version and the fingerprint of its
  *declared definition*, never as its function body. ADR-0029 already rejected
  `Function.prototype.toString`: source text moves with a formatter, a bundler, a minifier or a
  TypeScript version while behavior stands still, and it is the one way executable source could
  leak into a record that is persisted and shown.
- **The eve build output.** Hashing the compiled artefact would catch everything at once, and would
  also change on every dependency bump, every eve patch release and every non-deterministic build
  detail. A fingerprint that changes when nothing about the behavior changed is the failure mode
  this whole scheme exists to avoid.
- **Credentials.** They do not change behavior, and component digests are written into a
  `run.started` payload.
- **The per-run budget.** A budget belongs to the `Job`, a caller may override it per run
  (`harness.run({ budget })`), and folding an override into the behavior fingerprint would report
  two runs of the same behavior as different behaviors. The job is recorded in its own right
  (ADR-0032).

### 3. Normalization: line endings only

Every text (`instructions`, `sop`, a skill's `content`) is normalized to `\n` before hashing, and
**nothing else is**.

Line endings are normalized because a CRLF checkout of the same repository must not produce a
different fingerprint. Nothing about an agent's behavior depends on how git handed the file back,
and a fingerprint that moved on clone would make every cross-machine comparison useless.

Whitespace is **not** trimmed and blank lines are **not** collapsed. Indentation, blank lines and
trailing spaces are part of an instruction file's text; the model reads them, so they are behavior.
Between the two possible errors — reporting a change that is not one, and failing to report a
change that is — the second is far worse, because everything downstream is built on the fingerprint
being able to say "this is different".

`skills`, `tools` and `schemas` are sorted by id or ref before hashing, so declaration order is not
behavior. Order *inside* a text — the sequence of steps in a skill — is content and is preserved,
because it is inside the string. A duplicate id or ref is a `ValidationError` rather than a
silently deduplicated entry: two entries with one id and two bodies have no defensible reading, and
keeping either would reintroduce the order dependence sorting exists to remove.

### 4. The domain supplies the descriptor; the harness resolves it once per run

`DefineDomainConfig` and `DomainDefinition` gain an optional
`behavior?: BehaviorDescriptor | (() => BehaviorDescriptor | Promise<BehaviorDescriptor>)`.
`defineDomain()` checks its shape and carries it through; it does not call it.

`createHarness().run()` resolves it **once, before `run.started`**, and:

- passes the composite to `createTraceRecorder({ behaviorFingerprint })`, so every event of the run
  carries the same string;
- includes the full `BehaviorFingerprint` on `HarnessRunResult` (on the base, so all three
  variants carry it, including `failed` — a failed run must stay comparable);
- writes the component digests into the `run.started` payload under `behavior`, so a stored trace
  alone can say which component changed. Every value there is a `sha256:` string, which keeps the
  payload identity-only as ADR-0031 requires.

Resolving before the first event, rather than lazily, is what makes "every event of a run carries
the same fingerprint" true: an `agent/` edit made while a run is in flight cannot split one run
across two behaviors.

**A domain that declares no `behavior` records `null`**, on every event and on the result, exactly
as M2-T3 left it. No placeholder digest is ever substituted, because a fingerprint that does not
track behavior silently breaks every comparison built on it.

**A descriptor that cannot be gathered fails the run before it starts.** A loader that throws, or a
descriptor `createBehaviorFingerprint` rejects, propagates out of `harness.run()` rather than
degrading to `null`. This adds a second throwing case to a method documented as returning every
other outcome as a result; it belongs with the first one (input validation) because both happen
while the run is still being prepared, so there is no run to report a failure against and nothing
has been spent. The alternative — recording the run with a `null` fingerprint — would manufacture
precisely the unfingerprinted run invariant 4 forbids, at the moment the system already knows
something is wrong.

### 5. The model configuration has one source, shared with the authored agent

For `apps/example-agent`, the behavior-affecting agent configuration lives in
`agent/lib/agent-config.ts` as one plain constant. `agent/agent.ts` passes it to `defineAgent`, and
`src/behavior.ts` hashes it. `agent/lib/` is eve's own documented slot for this: its
`docs/reference/agent-files.md` lists it as "Shared authored helper code … Import-only; not copied
into the sandbox", and `src/capabilities.ts` already imports `agent/lib/vendor-evidence.ts` the same
way. Nothing under `agent/` imports the harness, so the boundary the example has kept since M1 is
intact.

Two copies of the configuration was the alternative, and it is the worse failure: a drifted
fingerprint keeps reporting the old model after someone changes the real one, which is
indistinguishable from a correct fingerprint until a promotion decision rests on it.

The constant is read as the **whole authored agent configuration**, not only the model id. That is
a superset of "model configuration", taken deliberately: eve 0.63's `defineAgent` also accepts
`reasoning`, `compaction`, `limits` and `defaultTools`, all of which change behavior, and hashing
the whole constant means adding one of them is fingerprinted the moment it is set rather than after
someone remembers to widen the descriptor.

The model id is read from `EXAMPLE_AGENT_MODEL` with a fallback, so the fingerprint moves when that
environment variable moves. That is correct: a different model is different behavior, and a run
that used one must not compare equal to a run that used the other.

### 6. `contracts.sop` stays an unversioned identifier

ADR-0032's open question is answered by declining to change `JobContracts`. The identifier says
*which* SOP; the `sop` component fingerprint says *which revision of it* ran. A version field would
be a second, hand-maintained source of truth for the same fact, and the hand-maintained one is the
one that goes stale — an edited SOP under an unchanged version number is exactly the silent failure
the content hash prevents. `IDENTIFIER_PATTERN` therefore continues to reject `procurement-sop@1.0.0`,
and the question is closed rather than left open.

### 7. The fixture target's fingerprint describes the example agent

`src/run.ts` runs the same `vendorTriage` domain against either target: `apps/example-agent` (live
model) or `apps/eve-fixture-agent` (eve's `mockModel`, credential-free). The descriptor belongs to
the domain, and the domain's descriptor names the example agent's authored files. So a
`pnpm example:run:mock` trace carries a fingerprint describing `apps/example-agent`'s behavior while
the events came from the fixture agent.

This is accepted for the credential-free smoke path, whose purpose is to prove the harness path
works without a model credential, not to characterize the fixture agent. It is not acceptable for
the run ledger, and M2-T5 should record **which target ran** alongside the fingerprint. Listed as
an open question below rather than solved here.

## Consequences

### Positive

- North-star invariant 4 is true of a real run for the first time:
  `pnpm example:run:mock` writes a trace whose every event carries one non-null
  `sha256:` fingerprint, and whose `run.started` carries all eight component digests.
- The M2 acceptance criterion is verified rather than asserted: editing one character of
  `agent/instructions.md` moves the composite and exactly the `instructions` component, and a
  reordered or CRLF-converted descriptor does not move it at all.
- A replay mismatch (M6) and a learning batch (M7) can be reasoned about component by component,
  which is the difference between a triageable difference and an opaque one.
- "Do not hash timestamps or irrelevant metadata" is enforced by a closed type, so a future
  contributor cannot add one without changing the component list, the runtime constant and a
  type-level test at once.
- The harness needs no filesystem access and no framework knowledge to fingerprint a behavior,
  so ADR-0028's URL-only adapter and ADR-0025's app-authored agents both stand unchanged.
- The `model` component is shared with the authored agent by construction, so it cannot describe a
  configuration the agent does not run under.

### Negative

- **The descriptor is only as complete as the domain makes it.** A domain that forgets a skill, or
  authors one as a `defineSkill` module the loader cannot read, gets a fingerprint that misses a
  real behavior input. The example's loader **throws** on a skill file it cannot read rather than
  skipping it, which converts the silent failure into a loud one, but the general risk is
  structural: only the domain knows what its behavior is made of.
- **Gathering costs a filesystem read per run.** The example reads `agent/instructions.md` and
  every skill on every run, deliberately, because caching would report two runs as the same
  behavior after an edit between them. For the example that is three small files; a domain with
  many large skills should expect the cost and may need a cache keyed on file mtimes.
- **A second throwing case on `harness.run()`.** Callers that treated the method as total except
  for input validation now have one more case. It is documented on the interface and in
  `harness.md`.
- **Adding a ninth component invalidates every stored composite.** `scheme` makes that visible and
  deliberate rather than silent, but it does not make it free: a comparison across the change has
  to be made component by component.
- **`load_skill`'s version is eve's package version**, so an eve upgrade moves the `tools`
  component even when `load_skill` did not change. That is the conservative direction, and it is
  cheap; the opposite error would be missing a framework tool change entirely.

### Neutral

- `capabilityFingerprint()` is unchanged. It remains a *reference* fingerprint over one manifest
  entry's declaration, and the behavior fingerprint consumes it as the `definitionFingerprint` of a
  tool and the `fingerprint` of a schema. The two compose rather than compete.
- `TraceEvent` and `TraceRecorder` are unchanged: the field and the option already existed and were
  already typed `string | null`. M2-T8 supplies a value where M2-T3 supplied `null`.
- `behaviorFingerprintsMatch()` and `diffBehaviorComponents()` are exported now, before M6 needs
  them, because they are the two comparisons the whole scheme exists to support and naming them
  keeps an accidental comparison of a composite against a component digest from reading as
  correct.

## Alternatives considered

- **The harness reads the agent's files itself.** Rejected on ADR-0028 and ADR-0025: the eve
  adapter is a URL-only client that never touches an agent's filesystem, and the application is the
  author. It would also require the harness to know each framework's authored slots, which is
  exactly the coupling the `AgentRuntime` boundary exists to prevent.
- **Hash the eve build output (`.output/`, the compiled manifest).** Rejected: it would change on
  every dependency bump, every eve patch release and any non-deterministic build detail, so it
  would report behavior changes constantly and stop being usable for the one question it is asked.
  It would also be unattributable — nothing could say *what* changed.
- **A single flat hash over the whole descriptor.** Rejected: it answers "did anything change?" and
  nothing else, and the information needed to answer "what changed?" is destroyed at hash time and
  cannot be recovered later from a stored fingerprint. M6 and M7 both need attribution.
- **Hash executable source (`Function.prototype.toString`, the tool module's bytes).** Rejected for
  ADR-0029's reason, restated: source text is not stable across a formatter, a bundler or a
  TypeScript version, and hashing it would put executable source into a persisted record.
- **Make `contracts.sop` a versioned capability reference.** Rejected; see Decision 6. It would add
  a hand-maintained version that can disagree with the content, and the disagreement is silent.
- **Register the SOP as a `handler` or `policy` capability so it has a manifest fingerprint.**
  Rejected for the reason M1-T9 already gave: a SOP is content, not an executable capability, and
  putting a wrong kind on a permanent id is not reversible cheaply.
- **Normalize whitespace as well as line endings.** Rejected: whitespace in instructions is read by
  the model, so collapsing it would make the fingerprint fail to change when behavior did.
- **Compute the fingerprint lazily, on the first event that needs it.** Rejected: it would allow a
  mid-run edit to split one run across two behaviors, and it would put a filesystem read on the
  adapter's event path.
- **Record `null` when a descriptor cannot be gathered, and let the run proceed.** Rejected: it
  manufactures an unfingerprinted run at the exact moment the system knows something is wrong, and
  invariant 4 has no "unless the file was missing" clause.
- **Put the model configuration in `src/` and leave `agent/agent.ts` as it was.** Rejected: two
  copies drift, and a drifted fingerprint is worse than an absent one because it looks correct.
  eve documents `agent/lib/` as the import-only shared-code slot, so the single-source version needs
  no exception.

## Open questions

- **Which target ran.** The fixture and live targets share one domain and therefore one descriptor,
  so a mock run's fingerprint describes the example agent (Decision 7). M2-T5's run ledger should
  carry the target alongside the fingerprint. Out of scope for M2-T8.
- **Whether a capability manifest entry should fold its content fingerprint in.**
  `capability-registry.md` anticipated that an entry might hash its content into
  `capabilityFingerprint()`. It is not done here: the behavior fingerprint consumes the reference
  fingerprint, and inverting the direction would make a manifest entry depend on reading files.
  M4, which resolves capability references while validating IR, is where that question becomes
  concrete.
- **Caching for large skill sets.** The example reads its files per run. A domain with many or
  large skills will want a cache; the invalidation rule (mtime? a watcher? a build step?) is not
  decided, because nothing here has the problem yet.
- **A descriptor a framework can produce.** Every domain writing its own loader means every domain
  can get it wrong. A future `@internal/runtime-eve` helper that builds a descriptor from an eve
  project's authored slots is the obvious mitigation, and it is a runtime-adapter concern rather
  than a core one. Not built, because one worked example is not yet a pattern.

## References

- `docs/milestones/build-plan.md` M2-T8 (the component list and "do not hash timestamps or
  irrelevant metadata"), M2 acceptance criteria ("Behavior fingerprint changes when
  instructions/SOP/policy changes"), §AD-015 (the capability record's "behavior fingerprint"),
  §AD-016, M6-T4 (replay keyed on a canonical fingerprint), M6-T7 (baseline comparison against a
  "full agent fingerprint X"), M7-T1 (learning batches selected by behavior fingerprint),
  north-star invariant 4
- `eve` 0.63.0 installed docs: `docs/reference/agent-files.md` (the authored slot table; `lib/` is
  "Shared authored helper code … Import-only", and `agent/skills/<name>.md` resolves to skill
  `<name>`), `docs/skills.mdx` (flat markdown and packaged `SKILL.md` layouts, `defineSkill`
  modules), `docs/agent-config.md` (`model`, `reasoning`, `compaction`, `limits`)
- Related ADRs: ADR-0029 (canonical JSON and the `sha256:` scheme this extends), ADR-0028
  (URL-only eve adapter), ADR-0025 (apps author eve agents), ADR-0032 (`contracts.sop` open
  question, answered in Decision 6), ADR-0031 (`behaviorFingerprint` typed and left `null`;
  identity-only payloads), ADR-0009 (judgment separate from policy thresholds), ADR-0015
  (capability registry)
- Related code paths: `packages/core/src/behavior.ts`, `domain.ts`, `harness.ts`,
  `apps/example-agent/src/behavior.ts`, `apps/example-agent/agent/lib/agent-config.ts`,
  `apps/example-agent/src/policies/no-proceed-with-open-risk-flags.ts`
