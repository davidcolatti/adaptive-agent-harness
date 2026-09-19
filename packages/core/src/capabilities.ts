import type { DomainRef } from "./context.js";
import { ValidationError, type ValidationIssue } from "./errors.js";
import { fingerprint } from "./fingerprint.js";
import { collectRefIssues, throwIfIssues } from "./identifiers.js";
import type { JsonValue } from "./json.js";
import { isSchema } from "./schema.js";

/**
 * The domain capability registry (M1-T9) and the serializable manifest it
 * produces.
 *
 * AD-015 is the reason this exists: workflow IR never embeds arbitrary
 * imports, executable source or unregistered definitions. A consuming domain
 * registers what it can do under stable, versioned IDs, a workflow node refers
 * to one by `{ id, version }`, and validation resolves every reference before
 * execution or source generation. The source generator reads the manifest to
 * produce imports; it never asks a model to invent an import path.
 *
 * The split that makes that safe is the one build plan section 5 states: **the
 * runtime registry holds executable values, the serializable manifest holds
 * only metadata.** A manifest therefore contains module specifiers and export
 * names, never function bodies, closures or secrets, and
 * {@link CapabilityRegistry.toManifest} is typed so that it cannot contain
 * them: every field of a {@link CapabilityManifestEntry} is a string, a string
 * array or a `{ id, version }` pair.
 */

/**
 * A reference to a versioned capability.
 *
 * Deliberately an alias of {@link DomainRef} rather than a structural twin.
 * Build plan section 5 writes the identical `{ id, version }` shape for
 * `Job.domain` and for `CapabilityRef`, and `DomainRef`'s own documentation
 * anticipated this alias. One type means a domain reference can be handed to
 * the registry without a conversion, and it means the two can never drift into
 * two subtly different shapes.
 */
export type CapabilityRef = DomainRef;

/**
 * The kinds a capability can be.
 *
 * AD-015 lists seven (`schemas`, `agents`, `tools`, `handlers`, `policies`,
 * `evaluators`, `artifacts`); build plan section 5's `CapabilityManifestEntry`
 * fixes the five below, and M1-T9 requires exactly those five of the neutral
 * domain. `evaluator` and `artifact` are left out rather than declared empty:
 * M6 owns evaluators and M4 owns artifact nodes, and a kind nothing can
 * register yet would be a promise rather than a contract.
 */
export type CapabilityKind = "schema" | "agent" | "tool" | "handler" | "policy";

/** Every {@link CapabilityKind}, in the order a manifest sorts them. */
export const CAPABILITY_KINDS: readonly CapabilityKind[] = [
  "schema",
  "agent",
  "tool",
  "handler",
  "policy",
];

/**
 * One capability's serializable metadata, exactly as build plan section 5
 * states it.
 *
 * Every field is JSON-representable, which is the point: a manifest is stored,
 * diffed, replayed against and read by the source generator, so nothing in it
 * may be a live value.
 */
export interface CapabilityManifestEntry {
  /** The capability's stable reference. */
  readonly ref: CapabilityRef;
  /** What kind of capability it is. */
  readonly kind: CapabilityKind;
  /**
   * The module the capability is exported from.
   *
   * A specifier the consuming repository can resolve; the harness does not
   * interpret it in M1 beyond requiring a non-empty string. Deterministic
   * codegen (M8) turns it into an import, which is why it is recorded at
   * registration rather than inferred later.
   */
  readonly module: string;
  /** The export name within {@link CapabilityManifestEntry.module}, or `default`. */
  readonly exportName: string;
  /** The schema capability the input satisfies, when the capability has one. */
  readonly inputSchema?: CapabilityRef;
  /** The schema capability the output satisfies, when the capability has one. */
  readonly outputSchema?: CapabilityRef;
  /**
   * The permissions this capability declares it needs, as declaration strings.
   *
   * The M1 vocabulary is {@link ToolGrantMode}'s: `read` and `write`. It is a
   * string array rather than that union because AD-015 calls the field a
   * "permission declaration" and M5 is expected to widen it (scoped grants,
   * approval requirements) without a breaking change to the manifest shape.
   * Empty means the capability declares that it needs none.
   */
  readonly permissions: readonly string[];
  /** The behavior fingerprint, `sha256:<hex>`. See {@link capabilityFingerprint}. */
  readonly fingerprint: string;
}

/**
 * The serializable manifest: every registered capability's metadata, and
 * nothing else.
 *
 * `version` is the manifest format's own version, not a capability's. It is a
 * literal `1` so that a future format change is a type error at every read site
 * rather than a silent misparse.
 */
export interface CapabilityManifest {
  /** The manifest format version. */
  readonly version: 1;
  /** Every entry, sorted by kind, then id, then version. */
  readonly entries: readonly CapabilityManifestEntry[];
}

/**
 * What a domain supplies to register one capability: the manifest metadata
 * minus the fingerprint, which is computed, plus the executable value, which is
 * never serialized.
 */
export interface CapabilityRegistration<TValue> {
  /** The capability's stable ID, e.g. `vendor-triage.input`. */
  readonly id: string;
  /** The capability's exact `major.minor.patch` version. */
  readonly version: string;
  /** The module the capability is exported from. */
  readonly module: string;
  /** The export name, or `default`. */
  readonly exportName: string;
  /**
   * The schema capability the input satisfies.
   *
   * It MUST already be registered as a `schema` capability. That is what makes
   * a manifest **closed**: every reference inside it resolves within it, so
   * codegen and validation can trust it without a second lookup table.
   */
  readonly inputSchema?: CapabilityRef;
  /** The schema capability the output satisfies. Same closure rule. */
  readonly outputSchema?: CapabilityRef;
  /** The permission declarations. Defaults to `[]`. */
  readonly permissions?: readonly string[];
  /**
   * The executable value: a `Schema`, a function, an agent descriptor.
   *
   * It stays in the process. Nothing ever reads it into a manifest, a trace or
   * a stored record.
   */
  readonly value: TValue;
}

/** The runtime registry: executable values in, metadata out. */
export interface CapabilityRegistry {
  /**
   * Register one capability and return the manifest entry it produced.
   *
   * @throws {ValidationError} for a malformed id or version, a missing module
   * or export name, a duplicate `(kind, id, version)`, an id already registered
   * under a different kind, an unregistered `inputSchema`/`outputSchema`
   * reference, a missing `value`, or a `schema` capability whose value is not a
   * Standard Schema.
   */
  register<TValue>(
    kind: CapabilityKind,
    registration: CapabilityRegistration<TValue>,
  ): CapabilityManifestEntry;
  /**
   * Look up the executable value registered under `ref`.
   *
   * `ref` may be a {@link CapabilityRef} or the string form `id@version`, so
   * that the references a `Job` carries in `contracts` resolve directly.
   *
   * @throws {ValidationError} if nothing is registered under that kind and
   * reference.
   */
  resolve<TValue>(kind: CapabilityKind, ref: CapabilityRef | string): TValue;
  /** True when something is registered under that kind and reference. */
  has(kind: CapabilityKind, ref: CapabilityRef | string): boolean;
  /** Every manifest entry, sorted by kind, then id, then version. */
  entries(): readonly CapabilityManifestEntry[];
  /** The serializable manifest. */
  toManifest(): CapabilityManifest;
}

/**
 * Render a {@link CapabilityRef} as the string form `id@version`.
 *
 * This is the form `Job.contracts` already uses
 * (`vendor-triage.input@1.0.0`), written by hand in M1-T3 before anything
 * resolved it.
 */
export function formatCapabilityRef(ref: CapabilityRef): string {
  return `${ref.id}@${ref.version}`;
}

/**
 * Parse the string form `id@version` into a {@link CapabilityRef}.
 *
 * The grammar is unambiguous because the identifier rule in `identifiers.ts`
 * forbids `@` inside an identifier, so the single `@` is always the separator.
 *
 * @throws {ValidationError} if the string is not exactly one identifier, one
 * `@`, and one exact version.
 */
export function parseCapabilityRefString(value: string): CapabilityRef {
  const parts = typeof value === "string" ? value.split("@") : [];
  const [id, version, ...rest] = parts;

  if (parts.length !== 2 || rest.length > 0 || id === undefined || version === undefined) {
    throw new ValidationError(`\`${String(value)}\` is not a capability reference`, {
      issues: [
        { path: [], message: "expected the form `id@version`, e.g. `vendor-triage.input@1.0.0`" },
      ],
    });
  }

  throwIfIssues(`\`${value}\` is not a capability reference`, collectRefIssues(id, version));

  return { id, version };
}

/** Coerce either accepted reference form to a {@link CapabilityRef}. */
function toRef(ref: CapabilityRef | string): CapabilityRef {
  return typeof ref === "string" ? parseCapabilityRefString(ref) : ref;
}

/** The registry's internal key for one capability. */
function entryKey(kind: CapabilityKind, ref: CapabilityRef): string {
  return `${kind}:${formatCapabilityRef(ref)}`;
}

/**
 * The behavior fingerprint of one manifest entry.
 *
 * It hashes the entry's **behavior-affecting metadata** and nothing else:
 * kind, id, version, module, export name, the two schema references and the
 * permission declarations. It deliberately does not hash:
 *
 * - the `value`, because a function's source is not stable across a formatter,
 *   a bundler or a TypeScript version, and hashing it would make a fingerprint
 *   change when nothing about the behavior did;
 * - anything time-dependent, per M2-T8's "do not hash timestamps or irrelevant
 *   metadata".
 *
 * **M2-T8 extends behavior fingerprints** to agent instructions, SOPs, loaded
 * skills, tool definition versions, model configuration, schema content,
 * workflow IR and policy thresholds. Those are *content* fingerprints and this
 * is a *reference* fingerprint; when M2-T8 lands, an entry is expected to fold
 * its content fingerprint into this input rather than to replace the scheme.
 * The `sha256:` prefix exists so the algorithm can change (ADR-0029).
 */
export function capabilityFingerprint(entry: Omit<CapabilityManifestEntry, "fingerprint">): string {
  const input: JsonValue = {
    kind: entry.kind,
    id: entry.ref.id,
    version: entry.ref.version,
    module: entry.module,
    exportName: entry.exportName,
    inputSchema: entry.inputSchema ? formatCapabilityRef(entry.inputSchema) : null,
    outputSchema: entry.outputSchema ? formatCapabilityRef(entry.outputSchema) : null,
    permissions: [...entry.permissions],
  };

  return fingerprint(input);
}

function compareEntries(left: CapabilityManifestEntry, right: CapabilityManifestEntry): number {
  const byKind = CAPABILITY_KINDS.indexOf(left.kind) - CAPABILITY_KINDS.indexOf(right.kind);
  if (byKind !== 0) {
    return byKind;
  }
  if (left.ref.id !== right.ref.id) {
    return left.ref.id < right.ref.id ? -1 : 1;
  }
  if (left.ref.version === right.ref.version) {
    return 0;
  }
  return left.ref.version < right.ref.version ? -1 : 1;
}

function requireNonEmptyString(
  value: unknown,
  path: readonly (string | number)[],
): ValidationIssue | undefined {
  if (typeof value !== "string" || value.trim() === "") {
    return { path, message: "expected a non-empty string" };
  }
  return undefined;
}

function collectPermissionIssues(permissions: readonly string[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  permissions.forEach((permission, index) => {
    const issue = requireNonEmptyString(permission, ["permissions", index]);
    if (issue !== undefined) {
      issues.push(issue);
    }
  });

  return issues;
}

/**
 * Create an empty {@link CapabilityRegistry}.
 *
 * ```ts
 * const registry = createCapabilityRegistry();
 *
 * registry.register("schema", {
 *   id: "vendor-triage.input",
 *   version: "1.0.0",
 *   module: "apps/example-agent/src/domain/schemas.ts",
 *   exportName: "vendorTriageInputSchema",
 *   value: vendorTriageInputSchema,
 * });
 *
 * registry.resolve("schema", "vendor-triage.input@1.0.0");
 * ```
 *
 * A registry is per-domain and in-process. Persisting one is M2's problem and
 * `toManifest()` is the shape that will be persisted; nothing here writes
 * anywhere.
 */
export function createCapabilityRegistry(): CapabilityRegistry {
  const entries = new Map<string, CapabilityManifestEntry>();
  const values = new Map<string, unknown>();
  /** Which kind each id was first registered under. An id's kind is fixed. */
  const kindById = new Map<string, CapabilityKind>();
  /** Every `(kind, id, version)` registered as a `schema`, for closure checks. */
  const schemaKeys = new Set<string>();

  function validateSchemaReference(
    ref: CapabilityRef | undefined,
    field: "inputSchema" | "outputSchema",
  ): ValidationIssue[] {
    if (ref === undefined) {
      return [];
    }

    const refIssues = collectRefIssues(ref.id, ref.version, [field]);
    if (refIssues.length > 0) {
      return refIssues;
    }

    if (!schemaKeys.has(entryKey("schema", ref))) {
      return [
        {
          path: [field],
          message: `no \`schema\` capability \`${formatCapabilityRef(ref)}\` is registered; register the schema before the capability that references it`,
        },
      ];
    }

    return [];
  }

  function register<TValue>(
    kind: CapabilityKind,
    registration: CapabilityRegistration<TValue>,
  ): CapabilityManifestEntry {
    const issues: ValidationIssue[] = [];

    if (!CAPABILITY_KINDS.includes(kind)) {
      issues.push({
        path: ["kind"],
        message: `expected one of ${CAPABILITY_KINDS.map((value) => `\`${value}\``).join(", ")}`,
      });
    }

    issues.push(...collectRefIssues(registration?.id, registration?.version));

    for (const field of ["module", "exportName"] as const) {
      const issue = requireNonEmptyString(registration?.[field], [field]);
      if (issue !== undefined) {
        issues.push(issue);
      }
    }

    const permissions = registration?.permissions ?? [];
    if (!Array.isArray(permissions)) {
      issues.push({ path: ["permissions"], message: "expected an array of strings" });
    } else {
      issues.push(...collectPermissionIssues(permissions));
    }

    if (registration?.value === undefined || registration.value === null) {
      issues.push({
        path: ["value"],
        message: "expected the executable value the capability registers",
      });
    } else if (kind === "schema" && !isSchema(registration.value)) {
      issues.push({
        path: ["value"],
        message:
          "a `schema` capability's value must be a Standard Schema (https://standardschema.dev)",
      });
    }

    throwIfIssues("createCapabilityRegistry: invalid capability registration", issues);

    const ref: CapabilityRef = { id: registration.id, version: registration.version };
    const key = entryKey(kind, ref);

    if (entries.has(key)) {
      throw new ValidationError(
        `capability \`${formatCapabilityRef(ref)}\` is already registered as a \`${kind}\``,
        {
          issues: [
            {
              path: [kind, ref.id, ref.version],
              message: "a capability may be registered exactly once per kind, id and version",
            },
          ],
        },
      );
    }

    // An id's kind is fixed across its versions. Registering
    // `vendor-triage.input@2.0.0` as a `tool` when `1.0.0` is a `schema` is the
    // "incompatible version metadata" M1-T9 requires registration to reject:
    // every reference to that id elsewhere would silently mean something else.
    const existingKind = kindById.get(ref.id);
    if (existingKind !== undefined && existingKind !== kind) {
      throw new ValidationError(
        `capability id \`${ref.id}\` is already registered as a \`${existingKind}\`, not a \`${kind}\``,
        {
          issues: [
            {
              path: [kind, ref.id, ref.version],
              message: `an id's kind is fixed across its versions; \`${ref.id}\` is a \`${existingKind}\``,
            },
          ],
        },
      );
    }

    throwIfIssues(`capability \`${formatCapabilityRef(ref)}\`: unresolved schema reference`, [
      ...validateSchemaReference(registration.inputSchema, "inputSchema"),
      ...validateSchemaReference(registration.outputSchema, "outputSchema"),
    ]);

    const metadata: Omit<CapabilityManifestEntry, "fingerprint"> = {
      ref: Object.freeze({ ...ref }),
      kind,
      module: registration.module,
      exportName: registration.exportName,
      ...(registration.inputSchema === undefined
        ? {}
        : { inputSchema: Object.freeze({ ...registration.inputSchema }) }),
      ...(registration.outputSchema === undefined
        ? {}
        : { outputSchema: Object.freeze({ ...registration.outputSchema }) }),
      permissions: Object.freeze([...permissions]),
    };

    const entry: CapabilityManifestEntry = Object.freeze({
      ...metadata,
      fingerprint: capabilityFingerprint(metadata),
    });

    entries.set(key, entry);
    values.set(key, registration.value);
    kindById.set(ref.id, kind);
    if (kind === "schema") {
      schemaKeys.add(key);
    }

    return entry;
  }

  function sortedEntries(): CapabilityManifestEntry[] {
    return [...entries.values()].sort(compareEntries);
  }

  return {
    register,
    resolve<TValue>(kind: CapabilityKind, ref: CapabilityRef | string): TValue {
      const resolved = toRef(ref);
      const key = entryKey(kind, resolved);

      if (!values.has(key)) {
        throw new ValidationError(
          `no \`${kind}\` capability \`${formatCapabilityRef(resolved)}\` is registered`,
          {
            issues: [
              {
                path: [kind, resolved.id, resolved.version],
                message: "unknown capability reference",
              },
            ],
          },
        );
      }

      // The registry stores values as `unknown` because its five kinds hold
      // five unrelated types. The caller names the type it expects, exactly as
      // it would for a value read out of JSON; the registration site is where
      // the type was actually known. M4, which resolves references while
      // validating workflow IR, is where this becomes checkable against a
      // node's declared schemas.
      return values.get(key) as TValue;
    },
    has(kind: CapabilityKind, ref: CapabilityRef | string): boolean {
      return entries.has(entryKey(kind, toRef(ref)));
    },
    entries: sortedEntries,
    toManifest(): CapabilityManifest {
      return Object.freeze({ version: 1, entries: Object.freeze(sortedEntries()) });
    },
  };
}
