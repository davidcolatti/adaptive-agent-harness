---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/milestones/build-plan.md
  - docs/contracts/trace-event.md
  - docs/contracts/errors.md
  - docs/architecture/system-map.md
  - docs/decisions/0026-harness-errors-serialize-to-a-whitelisted-trace-safe-shape.md
  - docs/decisions/0031-trace-event-taxonomy-recorder-owned-sequencing-and-the-buffered-writer.md
  - docs/decisions/0035-redaction-is-a-trace-writer-decorator-placed-before-buffering.md
implementation:
  - packages/trace
---

# Redaction

What is removed from a trace event before anything buffers or stores it, and how
a domain extends it. Defined by M2-T9 and recorded in
[ADR-0035](../decisions/0035-redaction-is-a-trace-writer-decorator-placed-before-buffering.md).

## The rule this backs up, and why it is not the boundary

The boundary is stated in [`trace-event.md`](./trace-event.md): **a trace payload
is identity-only.** Ids, names, counts, statuses, codes, model ids, tool ids;
never message text, tool arguments, tool results, model output or anything read
out of a job's input. Every adapter obeys it by construction today, and
`pnpm example:run:mock` writes a trace containing nothing for this layer to
remove.

Redaction exists anyway, for three reasons that are leak paths rather than
hypotheticals:

1. **A serialized error is content.** `details` is whatever the thrower chose to
   publish and [ADR-0026](../decisions/0026-harness-errors-serialize-to-a-whitelisted-trace-safe-shape.md)
   is explicit that it is **not** a redaction boundary; `message` is a
   framework's own string. Both reach `run.failed` today.
2. **M5 widens payloads.** The mechanism has to exist and be wired before then,
   not be retrofitted onto a trace table that has been filling for two
   milestones.
3. **A domain owns its tools.** Only the domain can know that one particular tool
   returns an object with a credential in it.

## Where it runs

```text
TraceRecorder  ->  redacting writer  ->  buffered writer  ->  TraceSink
```

`createRedactingTraceWriter({ writer, policy? })` is a `TraceWriter` decorator.
It sits **above the buffer**, so an unredacted event is never held in memory, is
never retried from the buffer after a sink rejection, and is never written by a
sink added later that forgot to redact. It sits **below the recorder**, because
the recorder owns identity and order and its event is the truth; this is the
projection of it that is safe to keep.

`flush()` is delegated unchanged, and whatever the inner writer rejects with
reaches the caller untouched, so a `StorageError` still leaves `harness.run()`.

`redactEvents(events, policy?)` is a batch helper a sink may re-apply
defensively. Redaction is idempotent for the default rules, so the only cost is
CPU.

## The four mechanisms

| Mechanism | Replaces | Keyed by |
| --- | --- | --- |
| Field path | the whole value | where it sits in the tree |
| Secret pattern | only the matched span of a string | what the string looks like |
| Headers | the whole value | a known header name under a `headers` object |
| Tool sanitizer | whatever the hook returns | `payload.tool` on a `tool.*` event |

### Field paths

A glob over the JSON tree, segments separated by `.`:

| Segment | Matches |
| --- | --- |
| `apiKey` | exactly that key, or that array index written as a number |
| `*` | exactly one segment, whatever it is |
| `**` | any number of segments, including none |

`payload.**.apiKey` matches `payload.apiKey` and `payload.vendor.contact.apiKey`.
`payload.headers.*` matches every direct child of `payload.headers` and nothing
deeper. `payload.items.0.token` matches one array element's field. The root
segment is the event field, so a pattern is written against `payload.…` or
`error.…`.

Literal segments are compared **case-insensitively by default**, because
`apiKey`, `apikey` and `APIKEY` are one field; `caseSensitive: true` turns that
off per rule. A match replaces the value whatever its type — an object, an array
and a number all become the token.

The shipped defaults cover both the camel and snake spelling of each name:
`api-key`, `access-token`, `refresh-token`, `session-token`, `client-secret`,
`private-key`, `service-role-key`, `password`, `secret`, `credentials` and
`token`, each at any depth.

### Secret patterns

Regular expressions applied to every string leaf, replacing only what they
matched. Each one must carry the `g` flag; a policy containing one that does not
is rejected with a `ValidationError` at construction.

| Rule | Format it claims |
| --- | --- |
| `private-key-block` | a PEM `BEGIN … PRIVATE KEY` block through its `END` line |
| `aws-access-key-id` | `AKIA` plus 16 uppercase alphanumerics |
| `github-token` | `ghp_`, `gho_`, `ghu_`, `ghs_` or `ghr_` plus 36 characters |
| `slack-token` | `xoxa-`, `xoxb-`, `xoxp-` or `xoxr-` |
| `supabase-secret-key` | `sb_secret_…`, Supabase's replacement for the `service_role` key |
| `supabase-access-token` | `sbp_…`, a Supabase personal access token |
| `vercel-ai-gateway-key` | `vck_…`, the shape `AI_GATEWAY_API_KEY` carries |
| `api-key-sk-prefix` | `sk-…`, and the scoped `sk_live_` / `sk_test_` / `sk_proj_` forms |
| `jwt` | three base64url segments, the header starting `eyJ`; this is what catches a legacy Supabase `anon` or `service_role` key |
| `authorization-bearer` | the credential after `Bearer`, keeping the scheme |
| `authorization-basic` | the credential after `Basic`, keeping the scheme |

There is deliberately **no generic high-entropy rule**. Every identifier the
harness writes is high entropy on purpose — a UUIDv7 id, a `sha256:` fingerprint,
an eve `callId` — so such a rule would redact the trace's own structure and make
a run unreadable. ADR-0035 says what an opt-in one would have to look like.

### Headers

A known header name is replaced wherever it is a key of an object whose own key
is `headers`, at any depth. Both the `headers` key and the header names are
matched case-insensitively, and inside a `headers` object this rule wins over a
field-path rule, so a redacted header always reports itself as one
(`[REDACTED:header]`).

Defaults: `authorization`, `proxy-authorization`, `cookie`, `set-cookie`,
`x-api-key`, `x-auth-token`, `x-supabase-auth`, `apikey`.

### Tool sanitizer hooks

```ts
interface ToolSanitizer {
  readonly toolId: string;
  sanitize(payload: JsonObject, event: TraceEvent): JsonObject;
}
```

Applied to a `tool.*` event whose `payload.tool` matches — the field
`EveAgentRuntime` writes the tool name into. A hook runs **before** the generic
rules and its output is still put through them, so a hook is a way to know more
than the harness does, never a way to opt out of what the harness enforces. A
hook that returns something JSON cannot represent is rejected with a
`ValidationError`.

## The token

```text
[REDACTED:<rule-name>]
```

The token **names the rule that fired**, on purpose. A trace is evidence, and
`[REDACTED:aws-access-key-id]` tells a reader that a value was there, that it was
removed deliberately, and which rule decided — none of which a bare `***` or a
silently dropped field would say. It also makes a redaction bug findable, since a
token naming the wrong rule is visible in the stored trace. Rule names are stable
and do not change once a trace has been written with them.
`redactionToken(name)`, `REDACTION_TOKEN_PREFIX` and `REDACTION_TOKEN_SUFFIX` are
exported so nothing has to reconstruct the format by hand.

## What is redacted, and what never is

| Field | Treatment |
| --- | --- |
| `payload` | walked in full |
| `error.message`, `error.details`, `error.stack`, `error.cause` (recursively) | walked in full |
| `error.name`, `error.code` | untouched; they are ADR-0026's discriminants |
| `id`, `runId`, `attempt`, `sequence`, `timestamp`, `type`, `parentId`, `node`, `version`, `behaviorFingerprint` | untouched |
| `usage`, `latencyMs` | untouched; numbers |

`redactEvent` returns a **new frozen event** built from new containers, and never
mutates or freezes its input.

A field-path rule that matches `payload` or an error's `details` whole cannot put
a string where the type requires an object, so the token is nested under the key
`redacted` (`REDACTED_VALUE_KEY`).

## Extending the policy

```ts
const policy = createRedactionPolicy({
  fieldPaths: [{ name: "vendor-contact", path: "payload.vendor.contact" }],
  headers: ["x-vendor-signature"],
  toolSanitizers: [
    {
      toolId: "lookup_vendor_evidence",
      sanitize: (payload) => ({ ...payload, evidence: "[omitted]" }),
    },
  ],
});
```

Arrays are **concatenated onto the defaults, never substituted for them**.
Overriding by replacement is how a policy silently loses the AWS rule on the day
someone adds a domain-specific one, so the API does not offer it. There is no
`strict: false`: a flag that disables redaction is the flag that will be set in
the one environment where it matters. A caller who genuinely wants less has to
construct a `RedactionPolicy` literal, which is visible in review.

## Verified

M2's acceptance criterion is "seeded secrets never appear in stored trace
payloads". `packages/trace/src/redacting-trace-writer.test.ts` runs a real
`createHarness()` job whose input carries seeded fake credentials, against a
runtime that deliberately echoes that input into a `tool.completed` payload, into
an `agent.completed` payload and into a thrown failure's `details`, and asserts
that no seeded value appears anywhere in the events the sink received or in the
JSONL file written to disk. Every fake credential in those tests is assembled at
runtime from fragments so that no literal in the source looks like a credential
to `secretlint`, which the pre-commit hook runs over staged files.
