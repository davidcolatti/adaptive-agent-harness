---
status: accepted
date: 2026-09-19
deciders: orchestrator (Claude Fable 5.1) with repository owner constraints; recorded during M1-T9
related:
  - docs/contracts/capability-registry.md
  - docs/milestones/build-plan.md
  - docs/decisions/0015-workflow-ir-references-a-typed-versioned-capability-registry.md
  - docs/decisions/0016-internal-implementation-choices-ts-morph-as-v1-code-generator.md
supersedes: null
superseded_by: null
---

# ADR-0029: Canonical JSON (RFC 8785-style) and `sha256:`-prefixed behavior fingerprints

## Context

North-star invariant 4 is "every behavior-affecting version is fingerprinted".
AD-015 makes a **behavior fingerprint** one of the eight fields every capability
registry record carries, M2-T8 will hash agent instructions, SOPs, loaded
skills, tool definitions, model configuration, schemas, workflow IR and policy
thresholds, and M6's replay compares fingerprints to decide whether two runs are
comparable at all. `ReplayMismatchError` already exists and already carries two
fingerprints as opaque strings (M1-T8).

M1-T9 is the first task that has to produce one, so it is the first task that
has to say what a fingerprint *is*.

Two things force an explicit decision rather than a default.

- **`JSON.stringify` is not canonical.** It emits object properties in
  insertion order, so `{ id, version }` and `{ version, id }` describe the same
  capability and hash differently. It also coerces `NaN` and `Infinity` to
  `null`, which would make two different values share a fingerprint. A
  fingerprint that changes when nothing about the behavior changed, or that
  fails to change when something did, is worse than no fingerprint.
- **AD-016 names this exact choice.** Its list of unprescribed internal
  choices that must be recorded rather than implied opens with "canonical JSON
  encoding used for fingerprints". Nothing in `eve`, the AI SDK or the build
  plan prescribes one, so the no-assumption stop condition applies: the harness
  designs one explicitly.

`@internal/core` declares no third-party dependency and must keep none, so a
canonicalization library is not available to it.

## Decision

`packages/core/src/fingerprint.ts` owns both primitives, and they are the only
hashing surface in the harness.

- **`canonicalJson(value: JsonValue): string`** produces an RFC 8785-style
  canonical encoding over the harness's own `JsonValue` model:
  - object keys sorted by **UTF-16 code unit**, never by locale;
  - no insignificant whitespace;
  - array order preserved, because a list is data and not a set;
  - a property whose value is `undefined` dropped, faithfully to
    `JSON.stringify`, which is what lets a type with optional properties be
    fingerprinted at all;
  - `-0` normalized to `0`, because JSON cannot express the difference;
  - strings escaped as JSON escapes them.

  It MUST throw `ValidationError` for anything JSON cannot represent exactly: a
  non-finite number, a function, a `symbol`, a `bigint`, or `undefined` anywhere
  other than as a dropped object property. Coercion is forbidden; the issue path
  names where the offending value was.

- **`fingerprint(value: JsonValue): string`** returns
  `sha256:` + the lowercase hex SHA-256 of the canonical form's UTF-8 bytes,
  computed with the Node built-in `node:crypto` `createHash("sha256")`.

- **The `sha256:` prefix is mandatory** and is part of the value. It exists so
  the algorithm can change later without every stored fingerprint becoming
  ambiguous, and so a comparison across algorithms is obviously not a match
  rather than silently one.

- **`node:crypto` is permitted in `@internal/core`.** A Node built-in is not a
  third-party dependency: it adds nothing to `package.json`, nothing to the
  lockfile and nothing for `tests/architecture/boundaries.ts` to see. The
  zero-dependency rule is unchanged, and `@internal/core` still declares no
  `dependencies` at all.

- **What is hashed is the caller's decision and is governed separately.** The
  capability fingerprint (`capabilityFingerprint`, M1-T9) hashes an entry's
  behavior-affecting metadata: kind, id, version, module, export name, the two
  schema references and the permission declarations. It MUST NOT hash the
  registered executable value, and it MUST NOT hash anything time-dependent, per
  M2-T8's "do not hash timestamps or irrelevant metadata".

## Consequences

### Positive

- A fingerprint is reproducible across processes, machines and property
  orders, which is what makes replay lineage and "has this behavior changed?"
  answerable at all.
- Failing loudly on `NaN`, `Infinity` and non-JSON values means a fingerprint
  never silently conflates two different inputs.
- `@internal/core` keeps zero third-party dependencies, so the primitive is
  available to every package without an adapter.
- M2-T8 extends *what* is hashed without changing *how*, because the content
  fingerprints it introduces are further `fingerprint()` calls over further
  canonical JSON.

### Negative

- The harness owns a canonicalization implementation it must keep correct.
  The mitigation is that it is about sixty lines over a closed value model, and
  the unit tests pin a fixed expected hex for a fixed input, so the scheme
  cannot drift silently.
- It is RFC 8785-*style*, not a certified implementation. It does not attempt
  the full specification: no Unicode normalization of keys, and number
  formatting relies on ECMAScript's own algorithm rather than restating the
  specification's. Every value the harness fingerprints originates in this
  repository's own types, so the gap is not reachable today, but a future
  fingerprint over externally supplied JSON should revisit it.
- SHA-256 hex makes a fingerprint 71 characters. That is a storage and
  readability cost M2 pays in every trace event and run record.

### Neutral

- The algorithm is not required to stay SHA-256. The prefix is the mechanism
  for changing it, and changing it supersedes this ADR rather than editing it.
- `canonicalJson` is exported as well as `fingerprint`. A caller that needs
  stable bytes for a diff, a cache key or a golden file should not have to hash
  them first.

## Alternatives considered

- **`JSON.stringify` directly.** Rejected for the two reasons in Context:
  property order and silent coercion. It is the default precisely because it is
  convenient, which is why the choice had to be recorded rather than drifted
  into.
- **A canonicalization dependency (`canonicalize`, `json-stringify-
  deterministic`, `fast-json-stable-stringify`).** Rejected: `@internal/core`
  declares no dependency and must keep none (build plan section 4, enforced by
  `tests/architecture/boundaries.ts`). Putting the primitive behind an adapter
  package so that a dependency could live there would mean `core` could not
  compute a fingerprint, which is where fingerprints are needed.
- **`globalThis.crypto.subtle.digest("SHA-256", …)`.** Rejected: it is
  asynchronous, so every fingerprint site and everything that builds a manifest
  entry would become async for no benefit. `node:crypto` is synchronous and is
  already the runtime the repository pins.
- **Hashing the executable value's source (`Function.prototype.toString`).**
  Rejected: source text is not stable across a formatter, a bundler, a
  minifier or a TypeScript version, so the fingerprint would change when
  nothing about the behavior did. It would also be the one way a manifest could
  come to contain executable source, which M1-T9 forbids outright.
- **A shorter digest (truncated SHA-256, or a non-cryptographic hash such as
  xxHash).** Rejected for now: promotion decisions and replay comparisons rest
  on these values, and collision resistance is worth 71 characters. The prefix
  leaves the door open.

## References

- `docs/milestones/build-plan.md` §AD-015 (capability registry record fields,
  including "behavior fingerprint"), §AD-016 (internal implementation choices
  are recorded, and "canonical JSON encoding used for fingerprints" is its
  first example), §5 (Capability registry), M2-T8 (behavior fingerprint)
- RFC 8785, JSON Canonicalization Scheme: <https://www.rfc-editor.org/rfc/rfc8785>
- Node 24 `crypto.createHash`, as typed by the installed `@types/node@24.13.6`
  (`node_modules/@types/node/crypto.d.ts`)
- Related ADRs: ADR-0015, ADR-0016, ADR-0026, ADR-0027
- Related code paths: `packages/core/src/fingerprint.ts`,
  `packages/core/src/capabilities.ts`
