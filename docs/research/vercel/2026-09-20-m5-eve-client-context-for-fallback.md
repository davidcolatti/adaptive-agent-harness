# eve `clientContext` as the fallback envelope's runtime boundary (M5-T6)

**Date:** 2026-09-20
**Task:** M5-T6, fallback context handoff.
**Package and version:** `eve` 0.63.0, the version `packages/runtime-eve/package.json` pins,
resolved at
`node_modules/.pnpm/eve@0.63.0_ai@7.0.107_zod@4.6.5_/node_modules/eve/package.json`.
**Question:** M5-T6 requires that "the full-agent adapter receives the fallback envelope through
its documented runtime boundary". Which documented eve surface carries it, and what does the
agent actually see?

## Answer

**The turn's `clientContext`, as an object, under a harness-owned `harness.fallback` key.** The
agent sees it as an ordinary user-role context message that is present on every model call of
that turn and then discarded.

`EveAgentRuntime` already sends a `clientContext` object with each `sessions.create()`, built by
the private `jobClientContext()` helper (the job id, the domain, the job type and the job's
input). The envelope joins it there rather than travelling by any new mechanism.

## What the installed docs establish

From `eve/docs/guides/client/messages.mdx`, under "Send a full turn payload":

> `clientContext` is ephemeral context for the current turn. Strings become user-role context
> messages, arrays of strings become multiple context messages, and objects are JSON-serialized
> into one context message. The context remains available to every model call in the turn, then
> disappears before the next turn. It isn't persisted to durable session history and doesn't
> dispatch a turn by itself.

Four facts follow, and all four are what a fallback handoff needs:

1. **The model sees it.** It becomes a context message, not adapter metadata.
2. **An object is fine.** It is JSON-serialized into one message, so a nested envelope needs no
   flattening and no prose rendering.
3. **It lasts exactly one turn.** A fallback is a one-shot escalation, so the lifetime matches,
   and nothing leaks into a later turn of the same session.
4. **It is not persisted to durable session history.** The harness's own trace and ledger are the
   durable record; eve does not become a second place the envelope lives.

`eve/docs/guides/client/output-schema.mdx` (line 91) shows `clientContext` and `outputSchema` on
the same turn, which is exactly what the adapter sends: the envelope beside the structured-output
request.

`eve/docs/concepts/sessions-runs-and-streaming.md` adds one constraint: "Message-free creation
supports conversation mode only and does not accept turn-scoped `clientContext`, `outputSchema`,
callbacks, or activity observers." The adapter always creates a session **with** a message (the
job's objective), so the constraint is satisfied by the shape the adapter already has.

`eve/docs/concepts/context-control.md` gives the layout rule this follows: put information in the
narrowest surface that needs it. Permanent rules go in instructions; per-request data does not.
A fallback envelope is per-request data, so it belongs on the turn rather than in
`instructions.md`. What *does* go in `instructions.md` is the standing rule for what to do when
one is present, which is why `apps/example-agent/agent/instructions.md` gained a paragraph and
not a template.

## Public types inspected

- `eve/dist/src/protocol/message.d.ts`, `HandleMessageRequestBody`:

  ```ts
  readonly clientContext?: string | readonly string[] | JsonObject;
  ```

  with the doc comment "`clientContext` is turn-scoped client/page context; the channel converts
  it into internal model context for every model call in that turn." A nested object is a
  `JsonObject`, so the envelope's shape is accepted by the wire type.

- `eve/dist/src/client/types.d.ts` line 102: the same type on the client's send-turn input, which
  is what `EveClientContext` in the adapter is derived from.

- `eve/dist/src/harness/turn-client-context.d.ts`: `TurnClientContextState` carries
  `insertionIndex`, `messages` and `turnId` — the ephemeral per-turn context messages and where
  they sit in each model request. This is the mechanism behind the prose above.

**No size limit is documented for `clientContext` in 0.63.0**, in the docs or in the types. None
is assumed. The envelope is bounded in practice because it carries references and counts rather
than content: node ids, `node:<id>` output references, trust flags, artifact ids and the
remaining budget.

## What is harness-owned

eve documents the **transport** and imposes no schema on what a `clientContext` object contains.
Therefore:

- the key `harness.fallback` is the harness's own contract, namespaced under `harness` so a
  domain that one day puts its own data in `clientContext` cannot collide with it;
- the fields under it are `FallbackContext`'s, converted field by field in
  `fallbackClientContext()` so that a field added to the envelope does not silently start
  reaching a model.

Both are recorded in ADR-0044 and in `docs/architecture/runtime.md`.

## Alternatives considered and rejected

- **The message text.** `message` is the instruction the model must act on and `clientContext` is
  the data it acts on; that split is the one `jobClientContext()` already makes. A prose rendering
  of a structured envelope would also be a second format to keep in sync with the type.
- **User-role `instructions.ts`.** `eve/docs/concepts/context-control.md` says user-role
  instructions "become ordinary durable history". A fallback envelope is attempt-scoped and must
  not survive into a later turn.
- **The sandbox workspace.** `context-control.md` recommends it for files and working datasets.
  The envelope is small and must be read before the first model call, not fetched by a tool.
- **Session `state`.** `eve/docs/concepts/state.md` describes state as session-scoped and durable,
  which is the wrong lifetime again, and the adapter creates one session per run anyway.

## Verification

`packages/runtime-eve/src/eve-agent-runtime.contract.test.ts`, "sends a fallback envelope as
turn-scoped clientContext a real server accepts (M5-T6)": the real `eve/client` `Client` is
wrapped in the adapter's existing `EveClientLike` seam so the exact `sessions.create()` input can
be read back, a real `eve dev` server serving `apps/eve-fixture-agent` accepts the turn, and the
turn completes. eve exposes no way to ask a running server what a turn's `clientContext` was — it
is ephemeral by design and never persisted — so the request is the observable and the server's
acceptance is the other half of the proof. Unit coverage for the shape is in
`eve-agent-runtime.test.ts`.
