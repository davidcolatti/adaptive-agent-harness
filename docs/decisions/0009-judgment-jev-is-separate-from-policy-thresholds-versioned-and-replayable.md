---
status: accepted
date: 2026-09-19
deciders: project owner (build plan); recorded during M0
related: [0005, 0008, 0015]
supersedes: null
superseded_by: null
---

# ADR-0009: Judgment (Jev) is separate from policy (TypeScript thresholds), thresholds versioned and replayable

## Context

AD-009 states: "Jev answers bounded questions. TypeScript decides what follows," with the
worked example:

```text
Jev:
  probability lead is qualified = .93

Policy:
  >= .95 -> auto continue
  .70-.95 -> agent review
  < .70 -> reject
```

"Thresholds are versioned and replayable." Milestone 3 operationalizes this split: `JevDecisionEngine`
implements the `DecisionEngine` interface with "no domain imports" (M3-T2); decision evidence
(question ID/version, input-state fingerprint, answer, probability distribution, confidence
metadata, model/provider, cost, latency, and "policy version that consumed the answer") is
persisted separately from the policy outcome (M3-T3); the Policy API is a distinct call,
`policy.evaluate(result)`, over the stored `DecisionEngine` result (M3-T4); confidence bands are
per-question, not one global threshold (M3-T5); and the Milestone 3 acceptance criteria require
that "changing a policy threshold can replay stored decisions without rerunning Jev." North-Star
Invariant #8 (§17) states: "Jev judgment and application policy remain separate."

## Decision

Jev (via `packages/decision-jev`, implementing `DecisionEngine`) MUST answer only bounded
questions (Boolean, Choice, Score per M3-T1) and MUST NOT itself decide routing, escalation, or
any application-level outcome. Routing/escalation decisions MUST be made by separate, deterministic,
unit-tested TypeScript policy code (`policy.evaluate(result)`) that consumes the `DecisionEngine`
result. The raw Jev result (question ID/version, input-state fingerprint, answer, probability
distribution, confidence metadata, provider, cost, latency) MUST be persisted independently of,
and alongside, the policy version and outcome it fed. Policy thresholds MUST be versioned, and
changing a threshold MUST allow replaying previously stored Jev decisions to recompute outcomes
without re-invoking Jev, except where evidence is stale or insufficient (Milestone 12, M12-T6).
No single global confidence threshold is permitted; confidence bands are calibrated per question
(M3-T5). Jev is adopted as the project's first, default `DecisionEngine` implementation; the
`DecisionEngine` interface exists so a different bounded-judgment engine could be substituted
later without changing policy code.

## Consequences

### Positive

- Satisfies North-Star Invariant #8 by construction: judgment and policy are separate code paths
  with separate persisted records, so a threshold change is a policy-only change.
- Enables cheap, fast policy iteration (Milestone 12, M12-T6 "Policy replay") without re-running
  expensive Jev calls, and gives auditors a clean separation between "what the model observed"
  and "what the organization decided to do about it."

### Negative

- Requires persisting and versioning two related but distinct records per decision (the Jev
  answer and the policy outcome), plus the policy version that consumed it, adding schema and
  bookkeeping overhead beyond a single combined "decision" record.
- Per-question confidence calibration (rather than one global threshold) means each new Jev
  question needs its own calibration fixture (M3-T9) before it can be trusted in production
  policy.

### Neutral

- Constrains Milestone 3 (Jev as a First-Class Decision Primitive), Milestone 4 (`jev` workflow
  nodes consume `DecisionEngine` results, policy logic lives in `code` nodes), and Milestone 12
  (policy replay against stored Jev probabilities).
- Constrains `packages/decision-jev` (implements `DecisionEngine`, isolates the experimental AI
  SDK evaluation API per AD-011's Sandbox/AI SDK protocols) and the `decisions` table (build plan
  §9), which stores `result`, `provider_metadata`, and `policy_version` as separate fields.

## Alternatives considered

- **Let Jev's answer directly determine the routing outcome (e.g., a single global confidence
  threshold baked into the decision engine)**: rejected; AD-009 and Invariant #8 require judgment
  and policy to remain separate, and Milestone 3 explicitly rejects "one global `.90` threshold"
  in favor of per-question confidence bands.

## References

- `docs/milestones/build-plan.md` §1 AD-009, §17 Invariant #8, Milestone 3 (M3-T1 through
  M3-T5), Milestone 12 (M12-T6), §9 Supabase Data Model (`decisions`)
- Related ADRs: 0005, 0008, 0015
- Related code paths: `packages/decision-jev`
