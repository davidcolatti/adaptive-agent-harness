import { describe, expect, expectTypeOf, it } from "vitest";
import {
  BEHAVIOR_COMPONENT_NAMES,
  BEHAVIOR_FINGERPRINT_ALGORITHM,
  BEHAVIOR_FINGERPRINT_SCHEME,
  type BehaviorComponentName,
  type BehaviorDescriptor,
  behaviorFingerprintPayload,
  behaviorFingerprintsMatch,
  createBehaviorFingerprint,
  diffBehaviorComponents,
  resolveBehaviorFingerprint,
} from "./behavior.js";
import { ValidationError } from "./errors.js";
import { FINGERPRINT_ALGORITHM_PREFIX, fingerprint } from "./fingerprint.js";

/**
 * A complete, realistic descriptor. Every test below is a single-field
 * variation on this one, so "what changed" is visible at the call site rather
 * than buried in a fixture.
 */
const DESCRIPTOR: BehaviorDescriptor = {
  instructions: "You triage vendors against a procurement SOP.\n\nCite every claim.\n",
  sop: "# Procurement SOP v1.0\n\n1. Security assurance.\n2. Data processing agreement.\n",
  skills: [
    { id: "triage-vendor", content: "# Triage a vendor\n\n1. Gather evidence.\n" },
    { id: "summarize", content: "Summarize in five bullets.\n" },
  ],
  tools: [
    { id: "lookup_vendor_evidence", version: "1.0.0", definitionFingerprint: "sha256:aa" },
    { id: "load_skill", version: "0.63.0" },
  ],
  model: { model: "openai/gpt-5.6-luna-fast", defaultTools: false },
  schemas: [
    { ref: "vendor-triage.input@1.0.0", fingerprint: "sha256:bb" },
    { ref: "vendor-triage.output@1.0.0", fingerprint: "sha256:cc" },
  ],
  workflowIr: null,
  policy: { "no-proceed-with-open-risk-flags": { maxOpenRiskFlagsForProceed: 0 } },
};

/** `DESCRIPTOR` with one field replaced. */
function withField<TKey extends keyof BehaviorDescriptor>(
  key: TKey,
  value: BehaviorDescriptor[TKey],
): BehaviorDescriptor {
  return { ...DESCRIPTOR, [key]: value };
}

/**
 * Which components differ between `DESCRIPTOR` and a variation of it, and
 * whether the composite moved. The pair is what the acceptance criterion is
 * actually about: the composite must change, and it must be attributable.
 */
function change(descriptor: BehaviorDescriptor): {
  readonly composite: boolean;
  readonly components: readonly BehaviorComponentName[];
} {
  const before = createBehaviorFingerprint(DESCRIPTOR);
  const after = createBehaviorFingerprint(descriptor);

  return {
    composite: before.fingerprint !== after.fingerprint,
    components: diffBehaviorComponents(before, after),
  };
}

describe("createBehaviorFingerprint", () => {
  it("is deterministic: the same descriptor twice gives the same fingerprint", () => {
    const first = createBehaviorFingerprint(DESCRIPTOR);
    const second = createBehaviorFingerprint({ ...DESCRIPTOR });

    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.components).toEqual(first.components);
  });

  it("produces a `sha256:` composite and one `sha256:` digest per component", () => {
    const behavior = createBehaviorFingerprint(DESCRIPTOR);

    expect(behavior.fingerprint.startsWith(FINGERPRINT_ALGORITHM_PREFIX)).toBe(true);
    expect(Object.keys(behavior.components).sort()).toEqual([...BEHAVIOR_COMPONENT_NAMES].sort());

    for (const name of BEHAVIOR_COMPONENT_NAMES) {
      expect(behavior.components[name]).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });

  it("reports the algorithm and the composition scheme", () => {
    const behavior = createBehaviorFingerprint(DESCRIPTOR);

    expect(behavior.algorithm).toBe(BEHAVIOR_FINGERPRINT_ALGORITHM);
    expect(behavior.scheme).toBe(BEHAVIOR_FINGERPRINT_SCHEME);
    // The reported algorithm and ADR-0029's mandatory prefix are one decision
    // written in two places, so they are asserted to agree.
    expect(`${BEHAVIOR_FINGERPRINT_ALGORITHM}:`).toBe(FINGERPRINT_ALGORITHM_PREFIX);
  });

  it("is a composite of the component digests and the scheme, not of the raw content", () => {
    const behavior = createBehaviorFingerprint(DESCRIPTOR);

    expect(behavior.fingerprint).toBe(
      fingerprint({
        scheme: BEHAVIOR_FINGERPRINT_SCHEME,
        components: { ...behavior.components },
      }),
    );
  });

  it("returns a frozen value, so a fingerprint cannot be edited after the fact", () => {
    const behavior = createBehaviorFingerprint(DESCRIPTOR);

    expect(Object.isFrozen(behavior)).toBe(true);
    expect(Object.isFrozen(behavior.components)).toBe(true);
  });
});

describe("what does not change a behavior fingerprint", () => {
  it("ignores the order skills, tools and schemas are declared in", () => {
    const reordered = createBehaviorFingerprint({
      ...DESCRIPTOR,
      skills: [...DESCRIPTOR.skills].reverse(),
      tools: [...DESCRIPTOR.tools].reverse(),
      schemas: [...DESCRIPTOR.schemas].reverse(),
    });

    expect(reordered.fingerprint).toBe(createBehaviorFingerprint(DESCRIPTOR).fingerprint);
  });

  it("ignores the order of keys inside `model` and `policy`", () => {
    const reordered = createBehaviorFingerprint({
      ...DESCRIPTOR,
      model: { defaultTools: false, model: "openai/gpt-5.6-luna-fast" },
    });

    expect(reordered.fingerprint).toBe(createBehaviorFingerprint(DESCRIPTOR).fingerprint);
  });

  it("ignores line endings: a CRLF checkout fingerprints as an LF one", () => {
    const toCrlf = (text: string): string => text.replace(/\n/g, "\r\n");

    const crlf = createBehaviorFingerprint({
      ...DESCRIPTOR,
      instructions: toCrlf(DESCRIPTOR.instructions),
      sop: toCrlf(DESCRIPTOR.sop),
      skills: DESCRIPTOR.skills.map((skill) => ({ ...skill, content: toCrlf(skill.content) })),
    });

    expect(crlf.fingerprint).toBe(createBehaviorFingerprint(DESCRIPTOR).fingerprint);
  });

  it("does not ignore whitespace, because whitespace in instructions is behavior", () => {
    const { composite, components } = change(
      withField("instructions", `  ${DESCRIPTOR.instructions}`),
    );

    expect(composite).toBe(true);
    expect(components).toEqual(["instructions"]);
  });
});

describe("what changes a behavior fingerprint", () => {
  // The M2 acceptance criterion, one bullet per named input: "Behavior
  // fingerprint changes when instructions/SOP/policy changes."
  it("changes when the instructions change by one character, and only there", () => {
    const { composite, components } = change(
      withField("instructions", `${DESCRIPTOR.instructions}.`),
    );

    expect(composite).toBe(true);
    expect(components).toEqual(["instructions"]);
  });

  it("changes when the SOP changes by one character, and only there", () => {
    const { composite, components } = change(withField("sop", `${DESCRIPTOR.sop}3. Residency.\n`));

    expect(composite).toBe(true);
    expect(components).toEqual(["sop"]);
  });

  it("changes when a policy threshold changes, and only there", () => {
    const { composite, components } = change(
      withField("policy", {
        "no-proceed-with-open-risk-flags": { maxOpenRiskFlagsForProceed: 1 },
      }),
    );

    expect(composite).toBe(true);
    expect(components).toEqual(["policy"]);
  });

  it("changes when a skill's content changes, and only there", () => {
    const { composite, components } = change(
      withField("skills", [
        { id: "triage-vendor", content: "# Triage a vendor\n\n1. Gather more evidence.\n" },
        ...DESCRIPTOR.skills.slice(1),
      ]),
    );

    expect(composite).toBe(true);
    expect(components).toEqual(["skills"]);
  });

  it("changes when a skill is added", () => {
    const { composite, components } = change(
      withField("skills", [...DESCRIPTOR.skills, { id: "escalate", content: "Escalate.\n" }]),
    );

    expect(composite).toBe(true);
    expect(components).toEqual(["skills"]);
  });

  it("changes when a tool is added", () => {
    const { composite, components } = change(
      withField("tools", [...DESCRIPTOR.tools, { id: "write_note", version: "1.0.0" }]),
    );

    expect(composite).toBe(true);
    expect(components).toEqual(["tools"]);
  });

  it("changes when a tool's version or definition fingerprint moves", () => {
    expect(
      change(
        withField("tools", [
          { id: "lookup_vendor_evidence", version: "1.1.0", definitionFingerprint: "sha256:aa" },
          ...DESCRIPTOR.tools.slice(1),
        ]),
      ).components,
    ).toEqual(["tools"]);

    expect(
      change(
        withField("tools", [
          { id: "lookup_vendor_evidence", version: "1.0.0", definitionFingerprint: "sha256:zz" },
          ...DESCRIPTOR.tools.slice(1),
        ]),
      ).components,
    ).toEqual(["tools"]);
  });

  it("distinguishes an unfingerprinted tool definition from a fingerprinted one", () => {
    const withoutDefinition = createBehaviorFingerprint(
      withField("tools", [
        { id: "lookup_vendor_evidence", version: "1.0.0" },
        ...DESCRIPTOR.tools.slice(1),
      ]),
    );

    expect(withoutDefinition.components.tools).not.toBe(
      createBehaviorFingerprint(DESCRIPTOR).components.tools,
    );
  });

  it("changes when the model configuration changes", () => {
    const { composite, components } = change(
      withField("model", { model: "anthropic/claude-opus-4.8", defaultTools: false }),
    );

    expect(composite).toBe(true);
    expect(components).toEqual(["model"]);
  });

  it("changes when a schema is repointed at another version", () => {
    const { composite, components } = change(
      withField("schemas", [
        { ref: "vendor-triage.input@2.0.0", fingerprint: "sha256:bb" },
        ...DESCRIPTOR.schemas.slice(1),
      ]),
    );

    expect(composite).toBe(true);
    expect(components).toEqual(["schemas"]);
  });

  it("changes when a workflow IR appears, which is how M4 will register", () => {
    const { composite, components } = change(withField("workflowIr", { nodes: [], version: 1 }));

    expect(composite).toBe(true);
    expect(components).toEqual(["workflowIr"]);
  });
});

describe("createBehaviorFingerprint validation", () => {
  it("rejects empty instructions", () => {
    expect(() => createBehaviorFingerprint(withField("instructions", "   "))).toThrow(
      ValidationError,
    );
  });

  it("accepts an empty SOP, which is how a domain says it has none", () => {
    expect(() => createBehaviorFingerprint(withField("sop", ""))).not.toThrow();
  });

  it("rejects a duplicate skill id, rather than silently keeping one of them", () => {
    let caught: unknown;

    try {
      createBehaviorFingerprint(
        withField("skills", [
          { id: "triage-vendor", content: "a" },
          { id: "triage-vendor", content: "b" },
        ]),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).issues).toEqual([
      { path: ["skills", 1, "id"], message: expect.stringContaining("duplicate id") },
    ]);
  });

  it("rejects a duplicate tool id and a duplicate schema ref", () => {
    expect(() =>
      createBehaviorFingerprint(
        withField("tools", [
          { id: "t", version: "1.0.0" },
          { id: "t", version: "2.0.0" },
        ]),
      ),
    ).toThrow(ValidationError);

    expect(() =>
      createBehaviorFingerprint(
        withField("schemas", [
          { ref: "a@1.0.0", fingerprint: "sha256:1" },
          { ref: "a@1.0.0", fingerprint: "sha256:2" },
        ]),
      ),
    ).toThrow(ValidationError);
  });

  it("reports every problem at once, each at its own path", () => {
    let caught: unknown;

    try {
      createBehaviorFingerprint({
        ...DESCRIPTOR,
        instructions: "",
        skills: [{ id: "", content: "x" }],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).issues.map((issue) => issue.path)).toEqual([
      ["instructions"],
      ["skills", 0, "id"],
    ]);
  });

  it("rejects a `model` or `policy` that is not a JSON object", () => {
    for (const key of ["model", "policy"] as const) {
      expect(() =>
        // The cast is the point: this is the shape an untyped caller, or a
        // descriptor assembled from JSON, can actually arrive with.
        createBehaviorFingerprint({
          ...DESCRIPTOR,
          [key]: "nope",
        } as unknown as BehaviorDescriptor),
      ).toThrow(ValidationError);
    }
  });

  it("rejects a non-array skills/tools/schemas rather than throwing a TypeError", () => {
    expect(() =>
      createBehaviorFingerprint({ ...DESCRIPTOR, skills: "none" } as unknown as BehaviorDescriptor),
    ).toThrow(ValidationError);
  });
});

describe("BehaviorDescriptor, as a type", () => {
  it("has exactly one field per component, so nothing else can be hashed", () => {
    expectTypeOf<keyof BehaviorDescriptor>().toEqualTypeOf<BehaviorComponentName>();
  });

  it("has no field a timestamp or other irrelevant metadata could occupy", () => {
    // M2-T8: "do not hash timestamps or irrelevant metadata". The rule is
    // enforced by the type rather than by review: there is nowhere to put one.
    expectTypeOf<BehaviorDescriptor>().not.toHaveProperty("createdAt");
    expectTypeOf<BehaviorDescriptor>().not.toHaveProperty("timestamp");
    expectTypeOf<BehaviorDescriptor>().not.toHaveProperty("recordedAt");
    expectTypeOf<BehaviorDescriptor>().not.toHaveProperty("runId");
    expectTypeOf<BehaviorDescriptor>().not.toHaveProperty("metadata");
  });
});

describe("resolveBehaviorFingerprint", () => {
  it("returns null for a domain that declares no behavior", async () => {
    await expect(resolveBehaviorFingerprint(undefined)).resolves.toBeNull();
  });

  it("accepts a descriptor directly", async () => {
    const behavior = await resolveBehaviorFingerprint(DESCRIPTOR);

    expect(behavior?.fingerprint).toBe(createBehaviorFingerprint(DESCRIPTOR).fingerprint);
  });

  it("accepts a synchronous and an asynchronous loader", async () => {
    const expected = createBehaviorFingerprint(DESCRIPTOR).fingerprint;

    await expect(resolveBehaviorFingerprint(() => DESCRIPTOR)).resolves.toMatchObject({
      fingerprint: expected,
    });
    await expect(
      resolveBehaviorFingerprint(async () => await Promise.resolve(DESCRIPTOR)),
    ).resolves.toMatchObject({ fingerprint: expected });
  });

  it("lets a loader's failure out rather than recording an unfingerprinted run", async () => {
    await expect(
      resolveBehaviorFingerprint(() => {
        throw new Error("agent/instructions.md is missing");
      }),
    ).rejects.toThrow("agent/instructions.md is missing");
  });
});

describe("behaviorFingerprintPayload", () => {
  it("carries only digests, so it is safe in an identity-only trace payload", () => {
    const behavior = createBehaviorFingerprint(DESCRIPTOR);
    const payload = behaviorFingerprintPayload(behavior);

    expect(payload).toEqual({
      scheme: BEHAVIOR_FINGERPRINT_SCHEME,
      algorithm: BEHAVIOR_FINGERPRINT_ALGORITHM,
      components: { ...behavior.components },
    });

    // No content from the descriptor reaches it.
    expect(JSON.stringify(payload)).not.toContain("procurement");
    expect(JSON.stringify(payload)).not.toContain("gpt-5.6");
  });
});

describe("behaviorFingerprintsMatch", () => {
  const behavior = createBehaviorFingerprint(DESCRIPTOR);
  const other = createBehaviorFingerprint(withField("sop", "different"));

  it("compares composites, in either the object or the string form", () => {
    expect(behaviorFingerprintsMatch(behavior, behavior.fingerprint)).toBe(true);
    expect(behaviorFingerprintsMatch(behavior.fingerprint, behavior)).toBe(true);
    expect(behaviorFingerprintsMatch(behavior, other)).toBe(false);
  });

  it("never matches a null: an unfingerprinted run is not known to match anything", () => {
    expect(behaviorFingerprintsMatch(null, null)).toBe(false);
    expect(behaviorFingerprintsMatch(behavior, null)).toBe(false);
  });
});

describe("diffBehaviorComponents", () => {
  it("returns nothing for two identical behaviors", () => {
    expect(
      diffBehaviorComponents(
        createBehaviorFingerprint(DESCRIPTOR),
        createBehaviorFingerprint(DESCRIPTOR),
      ),
    ).toEqual([]);
  });

  it("names every component that moved, in BEHAVIOR_COMPONENT_NAMES order", () => {
    const changed = createBehaviorFingerprint({
      ...DESCRIPTOR,
      instructions: "different",
      policy: {},
    });

    expect(diffBehaviorComponents(createBehaviorFingerprint(DESCRIPTOR), changed)).toEqual([
      "instructions",
      "policy",
    ]);
  });
});
