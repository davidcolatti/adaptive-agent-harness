---
status: accepted
date: 2026-09-19
deciders: harness owner, M2-T9 implementation agent
related:
  - docs/milestones/build-plan.md
  - docs/contracts/redaction.md
  - docs/contracts/trace-event.md
  - docs/contracts/errors.md
  - docs/architecture/system-map.md
  - docs/decisions/0010-observability-trace-is-a-product-surface-captured-from-the-first-run.md
  - docs/decisions/0026-harness-errors-serialize-to-a-whitelisted-trace-safe-shape.md
  - docs/decisions/0031-trace-event-taxonomy-recorder-owned-sequencing-and-the-buffered-writer.md
supersedes: null
superseded_by: null
---

# ADR-0035: Redaction is a `TraceWriter` decorator placed before buffering

## Context

M2-T9 says "redact before persistence" and names four mechanisms: field-path
redaction, secret-pattern redaction, headers redaction, and tool-specific
sanitizer hooks. M2's acceptance criteria include "seeded secrets never appear
in stored trace payloads".

The build plan says nothing about *where* redaction runs, and the answer is not
obvious, because the trace pipeline already has four places it could go
(ADR-0031): the run-scoped `TraceRecorder` that stamps events, the `TraceWriter`
that receives them, the buffer inside `createBufferedTraceWriter()`, and each
`TraceSink` that persists them.

Two facts constrain the answer.

**Payloads are already identity-only.** ADR-0031 fixed the rule and
`EveAgentRuntime` obeys it by construction: no message content, no tool
arguments, no tool results, no model output. A verified `pnpm example:run:mock`
trace contains nothing to redact. So redaction is not fixing a leak that exists
today in a payload.

**Two leaks do exist today, and a third is scheduled.** A
`SerializedHarnessError` carries a `message` written by whatever threw, and a
`details` object holding whatever the thrower chose to publish; ADR-0026 is
explicit that `details` is **not** a redaction boundary, and the M2 status file
repeats it under "Before starting". Both already reach `run.failed`. Separately,
M5 widens what a trace records, and a mechanism that does not exist and is not
wired by then will be retrofitted onto a table that has been filling for two
milestones. And a domain, not the harness, is the only party that can know that
one of its tools returns a credential.

So the mechanism is a **safety net over a boundary that already holds**, and the
question is where to hang it so that it still holds when the boundary moves.

## Decision

### 1. Redaction is a pure function over the JSON value model, in `@internal/trace`

`createRedactor(policy)` returns a `Redactor` with `redactValue(value, path?)`
and `redactEvent(event)`. It performs no I/O, holds no run state, and never
mutates its input. It lives in `packages/trace` and **not** in `packages/core`,
because core owns *what an event is* and this package owns *what happens on the
way to storage*; a redactor in core would make the event contract depend on a
storage policy, and every consumer of `TraceEvent` would inherit rules it has no
use for.

### 2. It is applied by a `TraceWriter` decorator, above the buffer

`createRedactingTraceWriter({ writer, policy? })` returns a `TraceWriter` that
redacts each event and delegates `append` and `flush`. The chain an application
assembles is:

```text
TraceRecorder -> redacting writer -> buffered writer -> TraceSink
```

Redaction MUST sit **above the buffer**. An unredacted event that reached the
buffer would sit in process memory in the clear, would be retried from there
after a sink rejection, and would be written unredacted by any sink added later
that forgot to redact.

It MUST sit **below the recorder**. The recorder owns identity and order
(ADR-0031); the event it mints is the truth about what happened, and this is the
projection of it that is safe to keep.

`redactEvents(events, policy?)` is exported as a batch helper so that a sink MAY
re-apply redaction defensively. Redaction is idempotent for the default rules —
a token contains no secret, so a second pass finds nothing — so the only cost is
CPU. M2-T5's Supabase sink is the intended caller.

### 3. The four mechanisms

**Field-path redaction** replaces a whole value because of where it sits. The
pattern language is a glob over the JSON tree with `.` between segments: a
literal segment, `*` for exactly one segment, `**` for any number including
none. Array indices are segments, so `payload.items.0.token` addresses one
element. Literal segments are compared **case-insensitively by default**,
because `apiKey`, `apikey` and `APIKEY` are one field, with `caseSensitive: true`
available per rule. A match replaces the value whatever its type.

**Secret-pattern redaction** applies regular expressions to every string leaf
and replaces **only the matched span**, so a sentence containing a credential
keeps its sentence. Every pattern MUST carry the `g` flag; a policy containing
one that does not is rejected with a `ValidationError` at construction.

**Headers redaction** replaces a known header name wherever it is a key of an
object whose own key is `headers`, at any depth, matching both the `headers` key
and the header names case-insensitively. Inside a `headers` object the header
rule wins over a field-path rule, so a redacted header always reports itself as
one.

**Tool-specific sanitizer hooks** are `{ toolId, sanitize(payload, event) }`,
applied to `tool.*` events whose `payload.tool` matches — the field
`EveAgentRuntime` actually writes the tool name into. A hook runs **before** the
generic rules and its output is still put through them, so a hook is a way to
know more than the harness does, never a way to opt out of what the harness
enforces. A hook that returns something JSON cannot represent is rejected with a
`ValidationError`.

### 4. The token names the rule that fired

A redacted value becomes `[REDACTED:<rule-name>]`, and a matched span inside a
string is replaced by the same token in place. The format is a constant
(`REDACTION_TOKEN_PREFIX`, `REDACTION_TOKEN_SUFFIX`, `redactionToken(name)`).

Naming the rule is deliberate. A trace is evidence: `[REDACTED:aws-access-key-id]`
tells a reader that a value was there, that it was removed on purpose, and which
rule decided — none of which a bare `***` or a silently dropped field would say.
It also makes a redaction bug findable, because a token naming the wrong rule is
visible in the stored trace. The rule names are stable strings and do not change
once a trace has been written with them.

### 5. The default pattern set, and no entropy heuristic

Eleven rules ship: `private-key-block`, `aws-access-key-id`, `github-token`,
`slack-token`, `supabase-secret-key`, `supabase-access-token`,
`vercel-ai-gateway-key`, `api-key-sk-prefix`, `jwt`, `authorization-bearer` and
`authorization-basic`. Every one matches a format its issuer documents; the
Supabase and Vercel formats were verified against their current documentation
during this task and the citations are in the M2-T9 WORKLOG entry.

There is deliberately **no generic high-entropy heuristic** in the default set.
Every identifier the harness writes is high entropy on purpose — a UUIDv7 id, a
`sha256:` behavior fingerprint, an eve `callId` — so an entropy rule would redact
the trace's own structure, break `parentId` joins and make a run unreadable,
while catching nothing a prefix rule misses. If a domain ever needs one it can be
added as an opt-in `SecretPatternRule` through `createRedactionPolicy()`, and it
would have to carry an explicit allowlist of the harness's own identifier shapes
to be usable at all.

### 6. Scope inside an event, and the policy surface

`payload` and `error` are redacted. On a serialized error that means `message`,
`details`, `stack` and the whole `cause` chain, because ADR-0026 says `details`
is not a boundary; `name` and `code` pass through as discriminants.
`id`, `runId`, `attempt`, `sequence`, `timestamp`, `type`, `parentId`, `node`,
`version`, `behaviorFingerprint`, `usage` and `latencyMs` are never touched: they
are the trace's structure, and redacting any of them would destroy the record
while protecting nothing. `redactEvent` returns a **new frozen event** built from
new containers, and never mutates or freezes its input.

`DEFAULT_REDACTION_POLICY` is what a caller gets for writing nothing.
`createRedactionPolicy(overrides)` **concatenates** onto the defaults and never
substitutes for them, and there is no `strict: false` escape hatch: a flag that
disables redaction is the flag that will be set in the one environment where it
matters. A caller who genuinely wants less has to construct a `RedactionPolicy`
literal, which is visible in review.

## Consequences

### Positive

- "Redact before persistence" is structural. Every sink behind the writer
  inherits the guarantee, including M2-T5's Supabase sink, without implementing
  anything.
- The mechanism exists and is wired before M5 widens payloads, so widening is a
  payload change rather than a security project.
- A stored trace says what was removed and why, so redaction is auditable rather
  than invisible.
- The redactor is pure, so it is testable without a writer, a sink or a run, and
  a sink can re-apply it for belt and braces.

### Negative

- Redaction runs on events that have nothing to redact, which is every event the
  harness writes today. The cost is a walk over a small object per event.
- A field-path rule that matches `payload` or an error's `details` whole cannot
  put a string where the type requires an object, so the token is nested under
  `redacted`. That is a wart, and it is the honest one.
- The default field-path set is a list of field-name spellings, so a new spelling
  (`apiSecret`, say) is a rule someone has to add. The alternative, matching
  substrings of key names, would fire on `tokenCount` and `passwordPolicyId`.
- The `token` field-path rule is broad enough to redact a payload field called
  exactly `token` that was not a credential.

### Neutral

- Nothing in the trace written today changes: `pnpm example:run:mock` produces
  the same six events with the same payload keys and no redaction token.
- The `@internal/trace` package keeps its zero-third-party-dependency rule; the
  redactor uses only `@internal/core` types and the JavaScript standard library.

## Alternatives considered

- **Redact inside the `TraceRecorder`.** Rejected: the recorder is in
  `@internal/core`, which would put a storage policy in the package that owns the
  event contract, and it would make the recorder's returned event — which callers
  use for `parentId` and which an adapter reads back — a redacted one, conflating
  "what happened" with "what may be stored".
- **Redact inside each `TraceSink`.** Rejected: it is the one place the rule can
  be forgotten, once per sink, and an unredacted event would still have been
  buffered in memory and retried from there. The batch helper exists so a sink
  *may* re-apply, not so it must.
- **Allowlist-only payloads with no redactor at all.** This is attractive, and it
  is in fact the rule ADR-0031 already sets: payloads are identity-only. It was
  rejected as the *whole* answer because it cannot cover a serialized error's
  `message` and `details`, which are content by construction and which ADR-0026
  explicitly refuses to treat as a boundary, and because an allowlist has nothing
  to say about a domain's own tool output.
- **A third-party redaction library.** Rejected under "no silent dependency
  additions" and the dependency rule: `@internal/trace` has no third-party
  dependency and the surveyed libraries are log-line scrubbers keyed to a logging
  framework, not typed transforms over a JSON contract with a path language. The
  four mechanisms the build plan names are about 300 lines.
- **A generic high-entropy heuristic in the default set.** Rejected as above: it
  would redact the trace's own identifiers. Available as an opt-in rule.

## References

- `docs/milestones/build-plan.md` §M2-T9, §8 "Security tests" ("secret in tool
  output"), AD-010
- Related ADRs: ADR-0010, ADR-0026, ADR-0031
- Related code paths: `packages/trace/src/redaction.ts`,
  `packages/trace/src/secret-patterns.ts`,
  `packages/trace/src/redacting-trace-writer.ts`, `apps/example-agent/src/run.ts`
