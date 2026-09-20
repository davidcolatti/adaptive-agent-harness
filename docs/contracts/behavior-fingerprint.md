---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/milestones/build-plan.md
  - docs/contracts/capability-registry.md
  - docs/contracts/domain-definition.md
  - docs/contracts/harness.md
  - docs/contracts/trace-event.md
  - docs/decisions/0034-behavior-fingerprint-is-component-wise-and-supplied-by-the-domain.md
  - docs/decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md
implementation:
  - packages/core
  - apps/example-agent
---

# Behavior fingerprint

The behavior fingerprint answers one question: **did the behavior change?** It is
defined in `packages/core/src/behavior.ts` and was created by M2-T8. The design
is recorded in
[ADR-0034](../decisions/0034-behavior-fingerprint-is-component-wise-and-supplied-by-the-domain.md);
the encoding and the digest it is built on are
[ADR-0029](../decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md).

North-star invariant 4 is "every behavior-affecting version is fingerprinted".
Everything downstream rests on that being reliable: M6's replay compares
fingerprints to decide whether two runs are comparable at all, M6-T7 compares a
candidate workflow against a named "full agent fingerprint X", and M7-T1 selects
learning batches by behavior fingerprint. A fingerprint that changes when
nothing changed, or fails to change when something did, breaks all three.

```ts
const behavior = createBehaviorFingerprint(descriptor);

behavior.fingerprint;             // "sha256:…"  the composite; what a trace carries
behavior.components.instructions; // "sha256:…"  which component changed
behavior.algorithm;               // "sha256"
behavior.scheme;                  // 1
```

## The descriptor

`BehaviorDescriptor` has exactly one field per component of the build plan's
M2-T8 list, in its order. The type is **closed**: no index signature, no
`metadata`, no escape hatch. That is how "do not hash timestamps or irrelevant
metadata" is enforced — there is nowhere to put one — and a type-level test
asserts `keyof BehaviorDescriptor` is exactly `BEHAVIOR_COMPONENT_NAMES`.

| Field | Type | What it holds |
| --- | --- | --- |
| `instructions` | `string` | The agent's base instruction text. Must be non-empty. |
| `sop` | `string` | The SOP **content**. May be empty, meaning the domain has none. |
| `skills` | `{ id, content }[]` | Every loadable skill. Ids unique; order irrelevant. |
| `tools` | `{ id, version, definitionFingerprint? }[]` | Every callable tool. Ids unique; order irrelevant. |
| `model` | `JsonObject` | The behavior-affecting model and runtime configuration. |
| `schemas` | `{ ref, fingerprint }[]` | Every bound schema. Refs unique; order irrelevant. |
| `workflowIr` | `JsonValue \| null` | The compiled IR, or `null` for a full-agent run. **`null` until M4.** |
| `policy` | `JsonObject` | The policy thresholds. |

`createBehaviorFingerprint` throws a `ValidationError` listing **every** problem
at once, each at its field's path: empty instructions, a non-array component, a
duplicate skill/tool id or schema ref, a `model` or `policy` that is not a JSON
object, a `workflowIr` that is not a JSON value.

A duplicate id is an error rather than a deduplication. Two entries under one id
with two different bodies have no defensible reading, and keeping either would
make the fingerprint depend on declaration order, which is the exact property
sorting exists to remove.

## What is deliberately not hashed

- **Anything time-dependent.** Enforced by the type, per above.
- **Executable source.** A tool enters as its id, its version and the
  fingerprint of its *declared definition*. ADR-0029 rejected hashing source:
  it moves with a formatter, a bundler or a TypeScript version while behavior
  stands still, and it would be the one route by which executable source could
  reach a persisted record.
- **The framework's build output.** It changes on every dependency bump and
  every patch release, so it would report constant behavior changes and be
  unattributable when it did.
- **Credentials.** They do not change behavior, and component digests are
  written into a `run.started` payload.
- **The per-run budget.** A budget belongs to the [`Job`](job.md) and a caller
  may override it per run, so folding it in would report two runs of the same
  behavior as different behaviors.

## Normalization

**Line endings only.** Every text is normalized to `\n` before hashing, so a
CRLF checkout of the same repository fingerprints identically; nothing about an
agent's behavior depends on how git handed the file back.

**Whitespace is not trimmed and blank lines are not collapsed.** Indentation and
blank lines are part of an instruction file's text and the model reads them.
Failing to report a change that happened is much worse than reporting one that
did not.

`skills`, `tools` and `schemas` are sorted by id or ref before hashing.
Order *inside* a text — the sequence of steps in a skill — is content, and is
preserved, because it is inside the string.

## Composition, and why components exist

Each component is `fingerprint()` over its own canonical JSON. The composite is
`fingerprint({ scheme, components })`.

Component digests are the product, not a convenience. "The behavior changed" is
not actionable; "the SOP changed and nothing else did" is, and it is the
difference between a replay mismatch a human can triage and one they cannot. The
information is impossible to recover later: the descriptor that produced a
stored fingerprint is gone.

`BEHAVIOR_FINGERPRINT_SCHEME` is hashed into the composite so that adding,
removing or redefining a component moves every composite at once and says why.
The `sha256:` prefix versions the *algorithm* and cannot carry that, because the
algorithm would be unchanged. Component digests survive a scheme bump, so two
runs across one can still be compared part by part.

Two comparisons are exported because they are the two the scheme exists for:

- `behaviorFingerprintsMatch(left, right)` compares composites, in either the
  object or the string form. **`null` never matches**, including another
  `null`: two runs whose behavior was not fingerprinted are not known to share
  one.
- `diffBehaviorComponents(left, right)` names every component that moved, in
  `BEHAVIOR_COMPONENT_NAMES` order.

## Who supplies it

**The domain**, through `DomainDefinition.behavior`, which is either a
descriptor or a function returning one (usually async, because gathering one
means reading files):

```ts
export const vendorTriage = defineDomain({
  // ...
  behavior: loadVendorTriageBehavior,
});
```

The harness cannot gather the inputs itself.
[ADR-0028](../decisions/0028-eve-agent-runtime-is-a-url-only-client-that-observes-the-eve-event-stream.md)
makes `EveAgentRuntime` a URL-only client that never reads an agent's files, and
[ADR-0025](../decisions/0025-application-packages-may-author-eve-agents-directly.md)
makes the application the author of that agent. Only the application knows where
its instructions, skills and model configuration are, or which framework's slots
they live in.

`defineDomain()` checks the option's shape and carries it through; it never calls
it. Resolution is the harness's, once per run.

## How a run uses it

`createHarness().run()` resolves the source **once, before `run.started`**, and:

1. passes the composite to `createTraceRecorder({ behaviorFingerprint })`, so
   every event of the run carries the same string in
   [`TraceEvent.behaviorFingerprint`](trace-event.md);
2. puts the whole `BehaviorFingerprint` on [`HarnessRunResult`](harness.md), on
   the base, so every variant carries it — including `failed`, because a failed
   run must stay comparable;
3. writes the component digests into the `run.started` payload under `behavior`,
   as `{ scheme, algorithm, components }`, so a stored trace alone can say which
   component changed. Every value there is a `sha256:` string, which keeps the
   payload identity-only as ADR-0031 requires.

Resolving before the first event is what makes "every event of a run carries the
same fingerprint" true: an edit made while a run is in flight cannot split one
run across two behaviors.

A domain that declares no `behavior` records `null`, on every event and on the
result. **No placeholder digest is ever substituted.** A descriptor that cannot
be gathered — a missing file, an invalid descriptor — propagates out of
`harness.run()` instead of degrading to `null`, because recording the run
unfingerprinted would manufacture exactly what invariant 4 forbids, at the moment
the system already knows something is wrong.

## Relationship to the capability fingerprint

They compose rather than compete.
[`capabilityFingerprint()`](capability-registry.md#fingerprints) hashes one
manifest entry's **declaration**: kind, id, version, module, export name, the two
schema references and the permission declarations. It never opens the file the
declaration points at.

The behavior fingerprint hashes **content**, and consumes the reference
fingerprints as inputs: a manifest `tool` entry's fingerprint becomes that tool's
`definitionFingerprint`, and a `schema` entry's becomes that schema's
`fingerprint`. So a registered capability moving version, module or permission
declaration moves the behavior fingerprint through the component that carries it.

## The worked example

`apps/example-agent/src/behavior.ts` builds the real descriptor:

| Component | Source |
| --- | --- |
| `instructions` | `agent/instructions.md`, read from disk per run |
| `sop` | `PROCUREMENT_SOP`, the content `Job.contracts.sop` names |
| `skills` | every skill under `agent/skills/`, read from disk per run |
| `tools` | the manifest's `tool` entries, plus eve's `load_skill` at the installed eve version |
| `model` | `agent/lib/agent-config.ts`, the same constant `agent/agent.ts` passes to `defineAgent` |
| `schemas` | the manifest's `schema` entries |
| `workflowIr` | `null` |
| `policy` | `NO_PROCEED_WITH_OPEN_RISK_FLAGS_THRESHOLDS`, the constant the policy enforces |

Three details are decisions rather than mechanics.

**The model configuration has one source.** `agent/lib/agent-config.ts` holds it,
`agent/agent.ts` passes it to `defineAgent`, and `src/behavior.ts` hashes it.
Two copies would drift, and a drifted fingerprint is worse than an absent one
because it looks correct. `agent/lib/` is eve's own documented slot for shared
import-only authored code (`eve/docs/reference/agent-files.md`), and nothing
under `agent/` imports the harness.

**Skill ids follow eve's naming.** `agent/skills/<name>.md` is the skill
`<name>`, and a packaged `agent/skills/<name>/SKILL.md` is also `<name>`
(`eve/docs/reference/agent-files.md`, `eve/docs/skills.mdx`). A `defineSkill`
TypeScript module would need evaluating to read, so the loader **throws** on one
rather than skipping it: a skill silently left out of the fingerprint is a
behavior change the fingerprint would miss.

**The files are read per run, not cached.** An `agent/` edit between two runs of
the same process must change the second run's fingerprint, because it changed
the agent.

**The SOP is content, and `contracts.sop` stays unversioned.** ADR-0032 left
open whether a SOP reference needs a version; ADR-0034 closes it by declining.
The identifier says which SOP, the `sop` component digest says which revision of
it ran, and a hand-maintained version field would be a second source of truth
that goes stale silently.

## Caveat: the fixture target

`pnpm example:run:mock` runs the same `vendorTriage` domain against
`apps/eve-fixture-agent`. The descriptor belongs to the domain and names
`apps/example-agent`'s authored files, so a mock run's trace carries a
fingerprint describing the **example** agent's behavior while the events came
from the fixture agent. That is accepted for a credential-free smoke path whose
purpose is to prove the harness path works; the run ledger (M2-T5) should record
which target ran alongside the fingerprint.

## Milestone boundaries

- **M4** fills `workflowIr`. The field is typed and hashed now so that the
  component set, and therefore every composite, does not move on the day it
  does.
- **M2-T5** persists the composite per event and should carry the component
  digests and the target with the run row.
- **M6** compares fingerprints for replay comparability and baselines;
  **M7** groups runs by them. Both are why the digests are component-wise.
