import type { ValidationIssue } from "./errors.js";
import { fingerprint } from "./fingerprint.js";
import { throwIfIssues } from "./identifiers.js";
import { isJsonObject, isJsonValue, type JsonObject, type JsonValue } from "./json.js";

/**
 * The behavior fingerprint (M2-T8). **ADR-0034** records the design.
 *
 * North-star invariant 4 is "every behavior-affecting version is
 * fingerprinted". M1-T9 fingerprinted one capability's *reference* metadata
 * (`capabilityFingerprint`, ADR-0029); this module fingerprints the *content*
 * that actually decides how a run behaves, which is the list M2-T8 states:
 * agent instructions, the SOP, loaded skills, tool definitions and version ids,
 * model configuration, schemas, workflow IR and policy thresholds. It hashes
 * nothing else, and above all nothing time-dependent: a fingerprint that
 * changes when nothing about the behavior changed cannot be used to decide that
 * two runs are comparable, which is the one question M6's replay asks it.
 *
 * Three properties are worth stating up front, because the rest of the file is
 * their implementation.
 *
 * 1. **It is component-wise.** {@link createBehaviorFingerprint} returns one
 *    fingerprint per component as well as the composite, so a reader comparing
 *    two runs can say *which* component changed rather than only *that*
 *    something did. M6 needs that to explain a replay mismatch, and M7's
 *    learning batch selector needs it to group runs that differ only in a part
 *    it does not care about.
 * 2. **It hashes content, never executable source.** A skill's markdown and an
 *    instruction file's text are content; a tool is represented by its id, its
 *    version and the fingerprint of its *declared definition*, never by its
 *    function body. ADR-0029 already rejected `Function.prototype.toString` as a
 *    fingerprint input: source text moves with a formatter, a bundler or a
 *    TypeScript version while behavior stands still.
 * 3. **The harness does not gather the inputs; the domain supplies them.**
 *    ADR-0028 makes the eve adapter a URL-only client that never sees an
 *    agent's files, and ADR-0025 makes the application the author of its eve
 *    agent. The application is therefore the only party that can read its own
 *    instructions, skills and model configuration, so
 *    {@link BehaviorDescriptor} is what it hands over and
 *    `DomainDefinition.behavior` is where it hands it over.
 */

/**
 * One loaded skill: its id and its full text.
 *
 * The id is the name the framework resolves a skill by, so that two runs can be
 * compared skill by skill. In `eve` that is the path-derived name
 * (`agent/skills/triage-vendor.md` is the skill `triage-vendor`, and a packaged
 * `agent/skills/research/SKILL.md` is the skill `research`), per the installed
 * `eve/docs/reference/agent-files.md` naming table.
 */
export interface BehaviorSkill {
  /** The skill's id, unique within a descriptor. */
  readonly id: string;
  /** The skill's full text. Hashed as content; see {@link createBehaviorFingerprint}. */
  readonly content: string;
}

/**
 * One tool the behavior may call.
 *
 * `definitionFingerprint` is where a tool's *declared shape* enters the hash:
 * the `sha256:` fingerprint of its schema and metadata, which for a registered
 * capability is exactly `CapabilityManifestEntry.fingerprint`. It is optional
 * because a tool the harness only knows by name and version (a framework tool
 * such as eve's `load_skill`, or a connection-provided one) still belongs in
 * the list; omitting it hashes as `null` rather than as an absent tool.
 *
 * A tool's executable body is deliberately not representable here. See
 * ADR-0029's rejection of hashing source.
 */
export interface BehaviorTool {
  /** The tool's id as the model sees it, e.g. `lookup_vendor_evidence`. */
  readonly id: string;
  /** The tool's exact version. */
  readonly version: string;
  /** The `sha256:` fingerprint of the tool's declared definition, when one is known. */
  readonly definitionFingerprint?: string;
}

/**
 * One schema the behavior is bound by, as a reference plus the fingerprint of
 * the schema itself.
 *
 * The reference is hashed as well as the fingerprint because repointing a
 * contract at a different schema version is a behavior change even when the two
 * versions happen to have identical content.
 */
export interface BehaviorSchema {
  /** The schema capability reference, in the `id@version` string form. */
  readonly ref: string;
  /** The `sha256:` fingerprint of the schema itself. */
  readonly fingerprint: string;
}

/**
 * Everything that decides how a run behaves, and nothing else.
 *
 * One field per component of the build plan's M2-T8 list, in its order. The
 * type is closed: there is no index signature and no `metadata` escape hatch,
 * so a timestamp, a run id, a hostname or a "last edited by" cannot be put in a
 * descriptor at all. That is the enforcement of "do not hash timestamps or
 * irrelevant metadata" — a rule the type makes unstatable rather than a rule a
 * reviewer has to catch.
 */
export interface BehaviorDescriptor {
  /** The agent's base instructions, as text. Must be non-empty. */
  readonly instructions: string;
  /**
   * The standard operating procedure the job is run under, as text.
   *
   * Content, not a reference. `Job.contracts.sop` names the SOP with a bare,
   * unversioned identifier (ADR-0032), and hashing the content here is what
   * makes that reference sufficient: the identifier says *which* SOP and the
   * fingerprint says *which revision of it*. May be empty for a domain that has
   * no SOP.
   */
  readonly sop: string;
  /** Every skill the behavior can load. Order is irrelevant; ids must be unique. */
  readonly skills: readonly BehaviorSkill[];
  /** Every tool the behavior may call. Order is irrelevant; ids must be unique. */
  readonly tools: readonly BehaviorTool[];
  /**
   * The behavior-affecting model configuration: the model id and the settings
   * that change what the model does.
   *
   * A `JsonObject` rather than a fixed shape, because what is
   * behavior-affecting is the framework's decision and not the harness's: eve
   * 0.63 has `model`, `reasoning`, `compaction` and `limits`
   * (`eve/docs/agent-config.md`), the AI SDK has a different set, and a
   * harness-owned struct would either omit one of them or invent fields no
   * framework has. What the application declares is what is hashed.
   *
   * A credential never belongs here. It does not change behavior, and a
   * fingerprint input is written into `run.started` as component digests and
   * read by everything downstream.
   */
  readonly model: JsonObject;
  /** Every schema the behavior is bound by. Order is irrelevant; refs must be unique. */
  readonly schemas: readonly BehaviorSchema[];
  /**
   * The compiled workflow IR this behavior executes, or `null` for a full-agent
   * run.
   *
   * **`null` until M4**, which is the milestone that has an IR. It is typed and
   * hashed now so that the component set, and therefore every composite
   * fingerprint, does not change on the day M4 fills it.
   */
  readonly workflowIr: JsonValue | null;
  /**
   * The policy thresholds the domain applies, keyed however the domain keys
   * them (by policy capability id is the obvious choice).
   *
   * ADR-0009 separates judgment from policy: a model decides how worrying
   * something is, a threshold decides what the organization does about it.
   * Changing a threshold changes behavior without changing a prompt, which is
   * exactly the case a fingerprint over instructions alone would miss, and it
   * is one of the three the M2 acceptance criterion names.
   *
   * A **per-run** budget is deliberately not here: it belongs to the `Job`,
   * which is recorded and persisted separately, and folding a caller's override
   * into the behavior fingerprint would make two runs of the same behavior
   * report different behavior.
   */
  readonly policy: JsonObject;
}

/**
 * The component names, in the build plan's order.
 *
 * Exported as a runtime constant so an inspector, a diff and a database
 * constraint can share one list. `behavior.test.ts` asserts that it is exactly
 * `keyof BehaviorDescriptor`, so a field cannot be added to the descriptor
 * without appearing here.
 */
export const BEHAVIOR_COMPONENT_NAMES = [
  "instructions",
  "sop",
  "skills",
  "tools",
  "model",
  "schemas",
  "workflowIr",
  "policy",
] as const;

/** One of {@link BEHAVIOR_COMPONENT_NAMES}. */
export type BehaviorComponentName = (typeof BEHAVIOR_COMPONENT_NAMES)[number];

/**
 * The composition scheme's own version.
 *
 * It is hashed into the composite, so that adding, removing or redefining a
 * component is a deliberate, visible change rather than a silent one: every
 * composite fingerprint moves at once, and the scheme number says why. The
 * `sha256:` prefix (ADR-0029) versions the *algorithm* and cannot carry this,
 * because the algorithm is unchanged.
 *
 * Component fingerprints are unaffected by a scheme bump, which is part of why
 * they exist: a comparison of two runs across a scheme change can still be made
 * component by component.
 */
export const BEHAVIOR_FINGERPRINT_SCHEME = 1;

/** The type of {@link BEHAVIOR_FINGERPRINT_SCHEME}. */
export type BehaviorFingerprintScheme = typeof BEHAVIOR_FINGERPRINT_SCHEME;

/**
 * The digest algorithm, without ADR-0029's trailing colon.
 *
 * Reported on every {@link BehaviorFingerprint} so a stored one is
 * self-describing even when read apart from the `sha256:`-prefixed string.
 */
export const BEHAVIOR_FINGERPRINT_ALGORITHM = "sha256";

/** The type of {@link BEHAVIOR_FINGERPRINT_ALGORITHM}. */
export type BehaviorFingerprintAlgorithm = typeof BEHAVIOR_FINGERPRINT_ALGORITHM;

/**
 * What {@link createBehaviorFingerprint} produces: the composite, the component
 * digests it was built from, and what produced them.
 *
 * Every field is JSON-representable, because this value is written into a run
 * result, a `run.started` payload and (from M2-T5) a database row.
 */
export interface BehaviorFingerprint {
  /**
   * The composite `sha256:` digest. This is what
   * `TraceEvent.behaviorFingerprint` carries.
   */
  readonly fingerprint: string;
  /**
   * One `sha256:` digest per component, so a reader can tell which component
   * changed between two runs.
   */
  readonly components: Readonly<Record<BehaviorComponentName, string>>;
  /** The digest algorithm. Always {@link BEHAVIOR_FINGERPRINT_ALGORITHM}. */
  readonly algorithm: BehaviorFingerprintAlgorithm;
  /** The composition scheme. Always {@link BEHAVIOR_FINGERPRINT_SCHEME}. */
  readonly scheme: BehaviorFingerprintScheme;
}

/**
 * How a domain supplies its descriptor: the value itself, or a function that
 * produces it.
 *
 * The function form is the normal one for an application, because gathering a
 * descriptor means reading files. It is resolved **once per run**, before
 * `run.started`, so every event of a run carries the same fingerprint and an
 * edit made while a run is in flight cannot split it.
 */
export type BehaviorSource =
  | BehaviorDescriptor
  | (() => BehaviorDescriptor | Promise<BehaviorDescriptor>);

/**
 * Normalize line endings to `\n`, and change nothing else.
 *
 * A CRLF checkout of the same repository must not produce a different
 * behavior fingerprint: nothing about the agent's behavior depends on whether
 * git handed the file back with `\r\n`, and a fingerprint that moved on clone
 * would make every cross-machine comparison useless.
 *
 * Nothing else is normalized. In particular whitespace is **not** trimmed and
 * blank lines are **not** collapsed: indentation, blank lines and trailing
 * spaces are part of an instruction file's text, the model reads them, and a
 * fingerprint that ignored them would fail to change when the behavior did.
 * That is the worse of the two errors.
 */
function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

/** Order two ids by UTF-16 code unit, as `canonicalJson` orders object keys. */
function compareCodeUnits(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function requireString(
  value: unknown,
  path: readonly (string | number)[],
  { allowEmpty }: { allowEmpty: boolean },
): ValidationIssue | undefined {
  if (typeof value !== "string") {
    return { path, message: "expected a string" };
  }
  if (!allowEmpty && value.trim() === "") {
    return { path, message: "expected a non-empty string" };
  }
  return undefined;
}

function requireArray(value: unknown, path: readonly (string | number)[]): ValidationIssue[] {
  if (!Array.isArray(value)) {
    return [{ path, message: "expected an array" }];
  }
  return [];
}

function requireJsonObject(value: unknown, path: readonly (string | number)[]): ValidationIssue[] {
  if (!isJsonObject(value)) {
    return [{ path, message: "expected a JSON object" }];
  }
  return [];
}

/**
 * Collect duplicate-key issues for a component whose entries are keyed by id.
 *
 * A duplicate is rejected rather than deduplicated, because two entries with
 * one id and two different bodies have no defensible reading: silently keeping
 * either would make the fingerprint depend on declaration order, which is the
 * exact property sorting exists to remove.
 */
function collectDuplicateIssues(
  keys: readonly string[],
  path: string,
  keyName: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();

  keys.forEach((key, index) => {
    if (seen.has(key)) {
      issues.push({
        path: [path, index, keyName],
        message: `duplicate ${keyName} \`${key}\`; each entry must appear once`,
      });
      return;
    }
    seen.add(key);
  });

  return issues;
}

function collectSkillIssues(skills: readonly BehaviorSkill[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  skills.forEach((skill, index) => {
    const idIssue = requireString(skill?.id, ["skills", index, "id"], { allowEmpty: false });
    if (idIssue !== undefined) {
      issues.push(idIssue);
    }
    // A skill's content may legitimately be empty (an authored file someone has
    // emptied), and hashing "" is a true statement about it. Only the type is
    // required.
    const contentIssue = requireString(skill?.content, ["skills", index, "content"], {
      allowEmpty: true,
    });
    if (contentIssue !== undefined) {
      issues.push(contentIssue);
    }
  });

  return [
    ...issues,
    ...collectDuplicateIssues(
      skills.map((skill) => (typeof skill?.id === "string" ? skill.id : "")),
      "skills",
      "id",
    ),
  ];
}

function collectToolIssues(tools: readonly BehaviorTool[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  tools.forEach((tool, index) => {
    for (const field of ["id", "version"] as const) {
      const issue = requireString(tool?.[field], ["tools", index, field], { allowEmpty: false });
      if (issue !== undefined) {
        issues.push(issue);
      }
    }

    if (tool?.definitionFingerprint !== undefined) {
      const issue = requireString(
        tool.definitionFingerprint,
        ["tools", index, "definitionFingerprint"],
        { allowEmpty: false },
      );
      if (issue !== undefined) {
        issues.push(issue);
      }
    }
  });

  return [
    ...issues,
    ...collectDuplicateIssues(
      tools.map((tool) => (typeof tool?.id === "string" ? tool.id : "")),
      "tools",
      "id",
    ),
  ];
}

function collectSchemaIssues(schemas: readonly BehaviorSchema[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  schemas.forEach((schema, index) => {
    for (const field of ["ref", "fingerprint"] as const) {
      const issue = requireString(schema?.[field], ["schemas", index, field], {
        allowEmpty: false,
      });
      if (issue !== undefined) {
        issues.push(issue);
      }
    }
  });

  return [
    ...issues,
    ...collectDuplicateIssues(
      schemas.map((schema) => (typeof schema?.ref === "string" ? schema.ref : "")),
      "schemas",
      "ref",
    ),
  ];
}

/**
 * Validate a descriptor and return every problem at once, each at the path of
 * the field that caused it.
 *
 * The `collectRefIssues` style the rest of `@internal/core` uses: a caller
 * fixing a descriptor sees all of it, not the first line of it.
 */
function collectDescriptorIssues(descriptor: BehaviorDescriptor): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const instructionsIssue = requireString(descriptor?.instructions, ["instructions"], {
    allowEmpty: false,
  });
  if (instructionsIssue !== undefined) {
    issues.push(instructionsIssue);
  }

  // A domain with no SOP states that as `""`. What it may not do is omit the
  // field, because then "no SOP" and "the descriptor forgot the SOP" would hash
  // the same.
  const sopIssue = requireString(descriptor?.sop, ["sop"], { allowEmpty: true });
  if (sopIssue !== undefined) {
    issues.push(sopIssue);
  }

  const skillsIssues = requireArray(descriptor?.skills, ["skills"]);
  issues.push(...skillsIssues);
  if (skillsIssues.length === 0) {
    issues.push(...collectSkillIssues(descriptor.skills));
  }

  const toolsIssues = requireArray(descriptor?.tools, ["tools"]);
  issues.push(...toolsIssues);
  if (toolsIssues.length === 0) {
    issues.push(...collectToolIssues(descriptor.tools));
  }

  const schemasIssues = requireArray(descriptor?.schemas, ["schemas"]);
  issues.push(...schemasIssues);
  if (schemasIssues.length === 0) {
    issues.push(...collectSchemaIssues(descriptor.schemas));
  }

  issues.push(...requireJsonObject(descriptor?.model, ["model"]));
  issues.push(...requireJsonObject(descriptor?.policy, ["policy"]));

  if (descriptor?.workflowIr === undefined || !isJsonValue(descriptor.workflowIr)) {
    issues.push({
      path: ["workflowIr"],
      message: "expected a JSON value, or `null` until a compiled workflow exists (M4)",
    });
  }

  return issues;
}

/**
 * Fingerprint every behavior-affecting input, component by component.
 *
 * ```ts
 * const behavior = createBehaviorFingerprint({
 *   instructions: await readFile("agent/instructions.md", "utf8"),
 *   sop: PROCUREMENT_SOP,
 *   skills: [{ id: "triage-vendor", content: skillMarkdown }],
 *   tools: [{ id: "lookup_vendor_evidence", version: "1.0.0", definitionFingerprint }],
 *   model: { model: "openai/gpt-5.6-luna-fast", defaultTools: false },
 *   schemas: [{ ref: "vendor-triage.input@1.0.0", fingerprint: schemaFingerprint }],
 *   workflowIr: null,
 *   policy: { "no-proceed-with-open-risk-flags": { maxOpenRiskFlagsForProceed: 0 } },
 * });
 *
 * behavior.fingerprint;              // "sha256:…"  the composite
 * behavior.components.instructions;  // "sha256:…"  which part changed
 * ```
 *
 * What it guarantees:
 *
 * - **Order-independence.** `skills`, `tools` and `schemas` are sorted by id or
 *   ref before hashing, so the order a domain happens to declare them in is not
 *   behavior. Order *within* a text — the sequence of steps in a skill — is
 *   content and is preserved, because it is inside the string.
 * - **Line-ending independence.** Every text is normalized to `\n`. See
 *   {@link normalizeText} for what is deliberately not normalized.
 * - **Component isolation.** Each component is hashed on its own, and the
 *   composite hashes the record of those digests together with
 *   {@link BEHAVIOR_FINGERPRINT_SCHEME}. Changing one component moves the
 *   composite and exactly one component digest.
 * - **Nothing time-dependent.** {@link BehaviorDescriptor} is a closed type
 *   with no field a timestamp could occupy.
 *
 * @throws {ValidationError} listing every problem with the descriptor, each at
 * its field's path: a missing or empty `instructions`, a non-array component, a
 * duplicate skill/tool id or schema ref, a `model` or `policy` that is not a
 * JSON object, or a `workflowIr` that is not a JSON value.
 */
export function createBehaviorFingerprint(descriptor: BehaviorDescriptor): BehaviorFingerprint {
  throwIfIssues(
    "createBehaviorFingerprint: invalid behavior descriptor",
    collectDescriptorIssues(descriptor),
  );

  const skills: JsonValue = [...descriptor.skills]
    .sort((left, right) => compareCodeUnits(left.id, right.id))
    .map((skill) => ({ id: skill.id, content: normalizeText(skill.content) }));

  const tools: JsonValue = [...descriptor.tools]
    .sort((left, right) => compareCodeUnits(left.id, right.id))
    .map((tool) => ({
      id: tool.id,
      version: tool.version,
      // `null` rather than an omitted property, so "this tool's definition is
      // not fingerprinted" is a recorded fact rather than an absence that
      // canonical JSON would drop.
      definitionFingerprint: tool.definitionFingerprint ?? null,
    }));

  const schemas: JsonValue = [...descriptor.schemas]
    .sort((left, right) => compareCodeUnits(left.ref, right.ref))
    .map((schema) => ({ ref: schema.ref, fingerprint: schema.fingerprint }));

  const components: Record<BehaviorComponentName, string> = {
    instructions: fingerprint(normalizeText(descriptor.instructions)),
    sop: fingerprint(normalizeText(descriptor.sop)),
    skills: fingerprint(skills),
    tools: fingerprint(tools),
    model: fingerprint(descriptor.model),
    schemas: fingerprint(schemas),
    workflowIr: fingerprint(descriptor.workflowIr),
    policy: fingerprint(descriptor.policy),
  };

  return Object.freeze({
    fingerprint: fingerprint({ scheme: BEHAVIOR_FINGERPRINT_SCHEME, components }),
    components: Object.freeze({ ...components }),
    algorithm: BEHAVIOR_FINGERPRINT_ALGORITHM,
    scheme: BEHAVIOR_FINGERPRINT_SCHEME,
  });
}

/**
 * Resolve a {@link BehaviorSource} and fingerprint what it produced.
 *
 * `undefined` yields `null`, which is what a domain that declares no behavior
 * gets. `null` is recorded as-is on every event; it is never replaced by a
 * placeholder digest, because a fingerprint that does not track behavior is
 * worse than an absent one (ADR-0031, and the same rule M2-T3 applied when it
 * left the field `null`).
 *
 * @throws whatever the source threw. A descriptor that cannot be gathered means
 * the run's behavior is unknown, and a run whose behavior is unknown cannot be
 * compared, replayed or learned from; recording it as `null` would silently
 * produce exactly the unfingerprinted run north-star invariant 4 forbids.
 */
export async function resolveBehaviorFingerprint(
  source: BehaviorSource | undefined,
): Promise<BehaviorFingerprint | null> {
  if (source === undefined) {
    return null;
  }

  const descriptor = typeof source === "function" ? await source() : source;

  return createBehaviorFingerprint(descriptor);
}

/**
 * The component digests as a JSON object, for a trace payload or a stored row.
 *
 * Every value is a `sha256:` string, so this is identity data and not content:
 * it is safe in a `TraceEvent.payload`, which is identity-only by rule
 * (ADR-0031), and it is what lets a trace alone answer "which component
 * changed" without the descriptor that produced it.
 */
export function behaviorFingerprintPayload(behavior: BehaviorFingerprint): JsonObject {
  return {
    scheme: behavior.scheme,
    algorithm: behavior.algorithm,
    components: { ...behavior.components },
  };
}

/**
 * True when two fingerprints describe the same behavior.
 *
 * A thin wrapper over `===` that exists to be the named, greppable comparison
 * M6's replay and M7's batch selector make, and to make an accidental
 * comparison of a composite against a component digest read wrongly at the call
 * site. `null` is never equal to anything, including another `null`: two runs
 * whose behavior was not fingerprinted are not known to share a behavior.
 */
export function behaviorFingerprintsMatch(
  left: BehaviorFingerprint | string | null,
  right: BehaviorFingerprint | string | null,
): boolean {
  const leftValue = typeof left === "string" ? left : left?.fingerprint;
  const rightValue = typeof right === "string" ? right : right?.fingerprint;

  if (leftValue === undefined || rightValue === undefined) {
    return false;
  }

  return leftValue === rightValue;
}

/**
 * Which components differ between two fingerprints, in
 * {@link BEHAVIOR_COMPONENT_NAMES} order.
 *
 * This is the reason the composite is built out of named parts rather than one
 * flat hash. "The behavior changed" is not an actionable finding; "the SOP
 * changed and nothing else did" is, and it is the difference between a replay
 * mismatch a human can triage and one they cannot.
 */
export function diffBehaviorComponents(
  left: BehaviorFingerprint,
  right: BehaviorFingerprint,
): readonly BehaviorComponentName[] {
  return BEHAVIOR_COMPONENT_NAMES.filter(
    (name) => left.components[name] !== right.components[name],
  );
}
