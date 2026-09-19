---
status: active
owner: core
last_verified: 2026-09-19
related:
  - docs/milestones/build-plan.md
  - docs/decisions/0015-workflow-ir-references-a-typed-versioned-capability-registry.md
  - docs/decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md
  - docs/contracts/domain-definition.md
  - docs/contracts/job.md
  - docs/examples/README.md
implementation:
  - packages/core
  - apps/example-agent
---

# Capability registry

`CapabilityRegistry` and `CapabilityManifest` let a domain declare what it can
do under stable, versioned IDs. They are defined in
`packages/core/src/capabilities.ts` and were created by M1-T9.

```ts
const registry = createCapabilityRegistry();

registry.register("schema", {
  id: "vendor-triage.input",
  version: "1.0.0",
  module: "apps/example-agent/src/domain/schemas.ts",
  exportName: "vendorTriageInputSchema",
  value: vendorTriageInputSchema,
});

registry.resolve("schema", "vendor-triage.input@1.0.0");
const manifest = registry.toManifest();
```

## Why it exists

[ADR-0015](../decisions/0015-workflow-ir-references-a-typed-versioned-capability-registry.md):
workflow IR never embeds arbitrary imports, executable source or unregistered
prompt/tool definitions. A workflow node refers to a capability by
`{ id, version }`, validation resolves every reference before execution or
source generation, and a promoted workflow pins exact versions with no fuzzy or
"latest" resolution. The source generator reads the manifest to produce its
imports; it never asks the compiler model to invent an import path.

The split that makes that safe is the one build plan section 5 states: **the
runtime registry contains executable values, the serializable manifest contains
only metadata.**

## It lives in `@internal/core`, not `packages/registry`

`packages/registry` is the **workflow** registry, planned for M5: promoted
workflow versions, their lineage and their promotion records. The *capability*
registry is a core contract that `defineDomain()`, the harness and eventually
the compiler all depend on, and it has no dependency of its own, so it belongs
next to `Job` and `DomainDefinition`. `docs/architecture/system-map.md` records
the same split.

## Kinds

```ts
type CapabilityKind = "schema" | "agent" | "tool" | "handler" | "policy";
```

AD-015 lists seven kinds (`schemas`, `agents`, `tools`, `handlers`, `policies`,
`evaluators`, `artifacts`). Build plan section 5's `CapabilityManifestEntry`
fixes the five above, and M1-T9 requires exactly those five of the neutral
domain. `evaluator` and `artifact` are **left out rather than declared empty**:
M6 owns evaluators and M4 owns artifact nodes, and a kind nothing can register
yet would be a promise rather than a contract.

`CAPABILITY_KINDS` exports the five in manifest sort order.

## References

```ts
type CapabilityRef = DomainRef; // { id: string; version: string }
```

`CapabilityRef` is a deliberate **alias** of `DomainRef`, not a structural twin.
Build plan section 5 writes the identical shape for `Job.domain` and for
`CapabilityRef`, so one type means a domain reference can be handed to the
registry without a conversion and the two can never drift apart.

Two helpers convert to and from the string form a `Job` already carries in
`contracts`:

```ts
formatCapabilityRef({ id: "vendor-triage.input", version: "1.0.0" });
// "vendor-triage.input@1.0.0"

parseCapabilityRefString("vendor-triage.input@1.0.0");
// { id: "vendor-triage.input", version: "1.0.0" }
```

The grammar is unambiguous because the identifier rule forbids `@` inside an
identifier, so the single `@` is always the separator. `resolve` and `has`
accept either form, which is what lets `job.contracts.inputSchema` resolve
directly.

Identifiers and versions follow the same rules `defineDomain()` enforces, and
they are stated once in `packages/core/src/identifiers.ts`
(`isCapabilityIdentifier`, `isExactVersion`) so that the two boundaries cannot
drift.

## `CapabilityManifestEntry`

Exactly as build plan section 5 states it:

```ts
type CapabilityManifestEntry = {
  ref: CapabilityRef;
  kind: CapabilityKind;
  module: string;
  exportName: string;
  inputSchema?: CapabilityRef;
  outputSchema?: CapabilityRef;
  permissions: readonly string[];
  fingerprint: string;
};
```

Every field is a string, a string array or an `{ id, version }` pair. That is
not an accident of the current implementation: it is what makes "the manifest
contains no executable source or secrets" a property of the **type** rather
than of care at every call site.

`permissions` holds declaration strings. The M1 vocabulary is `ToolGrantMode`'s,
`read` and `write`. It is a string array rather than that union because AD-015
calls the field a "permission declaration" and M5 is expected to widen it
(scoped grants, approval requirements) without a breaking change to the
manifest shape. Empty means the capability declares that it needs none.

## `CapabilityManifest`

```ts
type CapabilityManifest = {
  version: 1;
  entries: readonly CapabilityManifestEntry[];
};
```

`version` is the manifest **format's** version, not a capability's. It is a
literal `1` so a future format change is a type error at every read site rather
than a silent misparse.

`entries` is sorted deterministically by kind (in `CAPABILITY_KINDS` order),
then id, then version, so two registries built from the same registrations
serialize byte-identically whatever order they were registered in.

## Registration

`register(kind, registration)` returns the manifest entry it produced and
throws `ValidationError` for any of:

| Rejected | Why |
| --- | --- |
| A malformed `id` | It could not be written into a reference string. |
| A version that is not exactly `major.minor.patch` | A range makes "which version produced this" unanswerable. |
| An empty `module` or `exportName` | Codegen would have nothing to import. |
| A duplicate `(kind, id, version)` | Milestone 1's "duplicate capability ID/version registration fails". |
| The same `id` under a second kind | See below. |
| A non-string permission declaration | The manifest must stay serializable and comparable. |
| A missing `value` | A registry with no executable value is a manifest, not a registry. |
| A `schema` whose `value` is not a Standard Schema | Otherwise the failure surfaces at the first validation instead. |
| An `inputSchema`/`outputSchema` naming an unregistered schema | See "closure" below. |

### An id's kind is fixed across its versions

Registering `vendor-triage.input@2.0.0` as a `tool` when `1.0.0` is a `schema`
is rejected. This is the "incompatible version metadata" M1-T9 requires
registration to catch: every existing reference to that id elsewhere would
silently come to mean something else.

### Closure

A capability that names an `inputSchema` or `outputSchema` is rejected unless
that schema is **already registered** as a `schema` capability. That makes a
manifest closed: every reference inside it resolves within it, so codegen and
validation can trust it without a second lookup table. The practical
consequence is ordering: register schemas first.

## Fingerprints

Every entry carries a `sha256:`-prefixed behavior fingerprint, computed by
`capabilityFingerprint()` from `canonicalJson()` and `fingerprint()`.
[ADR-0029](../decisions/0029-canonical-json-and-sha-256-behavior-fingerprints.md)
records the encoding and the algorithm.

What it hashes: `kind`, `id`, `version`, `module`, `exportName`, the two schema
references and the permission declarations.

What it does **not** hash, and why:

- **The registered `value`.** A function's source is not stable across a
  formatter, a bundler or a TypeScript version, so hashing it would make a
  fingerprint change when nothing about the behavior did. It would also be the
  one way a manifest could come to contain executable source.
- **Anything time-dependent.** M2-T8: "do not hash timestamps or irrelevant
  metadata."

**M2-T8 extends behavior fingerprints** to agent instructions, SOPs, loaded
skills, tool definition versions, model configuration, schema content, workflow
IR and policy thresholds. Those are *content* fingerprints; this is a
*reference* fingerprint. An entry is expected to fold its content fingerprint
into this input rather than to replace the scheme, and the `sha256:` prefix
exists so the algorithm itself can change.

## The worked example

`apps/example-agent/src/capabilities.ts` registers the five kinds M1-T9
requires of the neutral domain:

| Kind | Reference | Value |
| --- | --- | --- |
| `schema` | `vendor-triage.input@1.0.0` | the `zod` input schema |
| `schema` | `vendor-triage.output@1.0.0` | the `zod` output schema |
| `agent` | `vendor-triage-agent@1.0.0` | a plain descriptor naming the authored `eve` files |
| `tool` | `lookup_vendor_evidence@1.0.0` | the pure `lookupVendorEvidence` function |
| `handler` | `detect-payment-detail-change@1.0.0` | a pure risk-flag detector over the fixture evidence |
| `policy` | `no-proceed-with-open-risk-flags@1.0.0` | a pure threshold over a `VendorTriageOutput` |

Module specifiers are **repository-relative paths**. `apps/example-agent`
publishes no subpath exports, and two of the capabilities live under `agent/`,
which `eve` compiles and the package does not export at all. A path is the one
form that names every capability consistently, and it is what a consuming
repository would write for its own files.

The `agent` entry's value is a descriptor rather than the `eve` definition
itself. Importing `agent/agent.ts` here would drag `eve` into the
harness-facing half of the package for no benefit: the registry needs to know
*where the agent is*, not *what eve makes of it*. The descriptor is also the
natural input for M2-T8's content fingerprint over instructions, SOP and
skills.

`procurement-sop`, which `Job.contracts.sop` names, is deliberately **not**
registered. A SOP is content, not an executable capability, and putting a wrong
kind on a permanent ID is not reversible. SOP-as-capability is M2-T8 and M5
territory.

## Open for later milestones

- **M4** resolves capability references while validating workflow IR, which is
  where `resolve`'s return type becomes checkable against a node's declared
  schemas instead of named by the caller.
- **M5** widens permission declarations and owns the separate workflow
  registry in `packages/registry`.
- **M6** adds the `evaluator` kind; **M4** adds `artifact`.
- **Persistence.** A registry is per-domain and in-process, and nothing writes
  it anywhere. `toManifest()` is the shape M2 will store.
