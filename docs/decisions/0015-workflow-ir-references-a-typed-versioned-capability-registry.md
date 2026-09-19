---
status: accepted
date: 2026-09-19
deciders: project owner (build plan); recorded during M0
related: [0007, 0009, 0013]
supersedes: null
superseded_by: null
---

# ADR-0015: Workflow IR references a typed, versioned capability registry; promoted workflows pin exact versions

## Context

AD-015 states: "Workflow IR never embeds arbitrary imports, executable source, or unregistered
prompt/tool definitions. A consuming domain registers capabilities under stable, versioned IDs":
schemas, agents, tools, handlers, policies, evaluators, artifacts. The harness exposes a
`CapabilityRegistry` with the conceptual contract:

```ts
type CapabilityRef = {
  id: string;
  version: string;
};

interface CapabilityRegistry {
  schemas: Registry<SchemaCapability>;
  agents: Registry<AgentCapability>;
  tools: Registry<ToolCapability>;
  handlers: Registry<CodeHandlerCapability>;
  policies: Registry<PolicyCapability>;
}
```

A workflow node references capabilities by ID/version (e.g. `{"agent": {"id":
"vendor-researcher", "version": "1.0.0"}}`). "Validation resolves every reference before
execution or source generation. No fuzzy/latest resolution is allowed for promoted workflows. A
promoted workflow pins exact capability versions." The registry record includes enough source
metadata for deterministic codegen (capability ID, version, kind, package/module specifier,
export name, input/output schema ID/version, permission declaration, behavior fingerprint), and
"the source generator uses this manifest to produce imports. It never asks the compiler LLM to
invent an import path." Build plan §5 gives the matching `CapabilityManifestEntry` shape used for
validation, fingerprints, replay lineage, and deterministic source imports.

## Decision

Workflow IR nodes MUST reference capabilities exclusively by stable `{id, version}` pairs
resolved against the `CapabilityRegistry`; IR MUST NOT embed arbitrary import paths, inline
executable source, or unregistered prompt/tool definitions. Every domain that wants to use a
capability in a workflow MUST first register it under the registry's `schemas`, `agents`,
`tools`, `handlers`, or `policies` collection with a versioned `CapabilityManifestEntry`
containing kind, module/export specifier, input/output schema references, permission
declaration, and behavior fingerprint. IR validation (per ADR-0007/M4-T9) MUST resolve every
capability reference before execution or source generation, and a workflow referencing a missing
capability MUST fail validation before any node executes. Promoted (`active`) workflows MUST pin
exact capability versions; fuzzy or "latest" resolution is forbidden for promoted workflows. The
deterministic code generator (ADR-0016) MUST derive its static imports from the registry
manifest's module/export metadata; it MUST NOT ask the compiler or any LLM to invent an import
path.

## Consequences

### Positive

- Makes every workflow's dependency surface fully enumerable and auditable ahead of execution:
  no workflow can reach code, a tool, or a schema that was not deliberately registered.
- Enables deterministic, LLM-free code generation (the generator reads manifest metadata, it does
  not guess imports), and gives replay/promotion a stable, versioned notion of "what this
  workflow depends on" independent of what happens to be latest at execution time.

### Negative

- Adds a registration step for every schema, agent, tool, handler, and policy a domain wants to
  use in a compiled workflow; nothing can be referenced ad hoc.
- Exact-version pinning for promoted workflows means capability upgrades require an explicit
  workflow re-validation/re-promotion cycle rather than picking up a new version automatically.

### Neutral

- Constrains Milestone 1 (`CapabilityRegistry`/`CapabilityManifest` first implemented and
  populated by the neutral domain, M1-T9), Milestone 4 (IR canonicalization and capability
  resolution, M4-T9), and Milestone 8 (the code generator's reliance on the manifest for static
  imports, M8-T4).
- Constrains `packages/registry` and `packages/codegen`, and the Bridge Audit Checklist's `IR ->
  runtime: schema validation + capability resolution` and `IR -> source: deterministic codegen`
  rows.

## Alternatives considered

- **Allow workflow IR to embed raw import paths or inline handler source directly**: rejected;
  AD-015 explicitly forbids IR from embedding "arbitrary imports, executable source, or
  unregistered prompt/tool definitions," and AD-013 separately forbids the compiler from
  inventing arbitrary executable handler code.
- **Resolve capability references to "latest" at execution time for promoted workflows**:
  rejected; AD-015 states "no fuzzy/latest resolution is allowed for promoted workflows. A
  promoted workflow pins exact capability versions."

## References

- `docs/milestones/build-plan.md` §1 AD-015, §5 Core Contracts (`CapabilityRef`,
  `CapabilityManifestEntry`), Milestone 1 (M1-T9), Milestone 4 (M4-T9), Milestone 8 (M8-T4),
  Appendix Bridge Audit Checklist
- Related ADRs: 0007, 0009, 0013
- Related code paths: `packages/registry`, `packages/codegen`
