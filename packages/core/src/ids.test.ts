import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { ValidationError } from "./errors.js";
import {
  ENTITY_ID_MESSAGE,
  ENTITY_ID_PATTERN,
  ENTITY_ID_SCHEME,
  ENTITY_KINDS,
  type EntityId,
  isEntityId,
  type JobId,
  newAttemptId,
  newCompilerRunId,
  newDecisionId,
  newEvalRunId,
  newJobId,
  newLearningRunId,
  newNodeExecutionId,
  newPromotionId,
  newRunId,
  newTraceEventId,
  newWorkflowId,
  newWorkflowVersionId,
  parseEntityId,
  type RunId,
} from "./ids.js";

/** Every generator, so the shared properties are asserted for all twelve. */
const GENERATORS = {
  job: newJobId,
  run: newRunId,
  attempt: newAttemptId,
  "trace-event": newTraceEventId,
  workflow: newWorkflowId,
  "workflow-version": newWorkflowVersionId,
  "node-execution": newNodeExecutionId,
  decision: newDecisionId,
  "eval-run": newEvalRunId,
  "learning-run": newLearningRunId,
  "compiler-run": newCompilerRunId,
  promotion: newPromotionId,
} as const;

/**
 * Assert that `ids` is **strictly** increasing lexicographically, not merely
 * non-decreasing. Strictness is the point: two ids that compare equal would
 * make "sorted by id" an unstable order over the run ledger.
 */
function expectStrictlyIncreasing(ids: readonly string[]): void {
  let previous = "";

  for (const id of ids) {
    expect(id > previous).toBe(true);
    previous = id;
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the scheme constant", () => {
  it("names the scheme, so a persisted record can say which one it used", () => {
    expect(ENTITY_ID_SCHEME).toBe("uuidv7");
  });

  it("lists exactly the twelve entity kinds M2-T1 names, and has a generator for each", () => {
    expect(ENTITY_KINDS).toHaveLength(12);
    expect([...ENTITY_KINDS].sort()).toEqual(Object.keys(GENERATORS).sort());
  });
});

describe("generated ids", () => {
  it("are RFC 9562 UUIDv7: 8-4-4-4-12 lowercase hex, version `7`, variant `10`", () => {
    for (const [kind, generate] of Object.entries(GENERATORS)) {
      const id = generate();

      expect(id, kind).toMatch(ENTITY_ID_PATTERN);
      // The version nibble is character 14, and the variant nibble is 19.
      expect(id[14], kind).toBe("7");
      expect(["8", "9", "a", "b"], kind).toContain(id[19]);
      expect(id, kind).toHaveLength(36);
      expect(id, kind).toBe(id.toLowerCase());
    }
  });

  it("carries the current time in its leading 48 bits", () => {
    const before = Date.now();
    const id = newRunId();
    const after = Date.now();

    const timestampMs = Number.parseInt(`${id.slice(0, 8)}${id.slice(9, 13)}`, 16);

    expect(timestampMs).toBeGreaterThanOrEqual(before);
    expect(timestampMs).toBeLessThanOrEqual(after);
  });

  it("are distinct, across repeated calls and across kinds", () => {
    const ids = new Set<string>();

    for (let round = 0; round < 500; round += 1) {
      for (const generate of Object.values(GENERATORS)) {
        ids.add(generate());
      }
    }

    expect(ids.size).toBe(500 * Object.keys(GENERATORS).length);
  });

  it("puts 62 random bits in `rand_b`, so an id is not guessable from its neighbour", () => {
    // The counter makes `rand_a` predictable on purpose; the entropy that makes
    // an id unguessable is the tail. Two ids minted back to back must differ
    // there, not only in the counter.
    const tails = new Set<string>();

    for (let index = 0; index < 1_000; index += 1) {
      tails.add(newJobId().slice(19));
    }

    expect(tails.size).toBe(1_000);
  });
});

describe("sortability, the property M2-T1 exists to buy", () => {
  it("sorts lexicographically in creation order, for a few thousand ids", () => {
    const ids: string[] = [];

    for (let index = 0; index < 5_000; index += 1) {
      ids.push(newRunId());
    }

    // The strong form: strictly increasing, not merely non-decreasing. Sorting
    // a shuffled copy must reproduce creation order exactly.
    expectStrictlyIncreasing(ids);

    expect([...ids].reverse().sort()).toEqual(ids);
  });

  it("stays strictly increasing inside a single frozen millisecond, past counter rollover", () => {
    // `rand_a` is 12 bits, so it holds 4096 counter values. Minting more than
    // that inside one millisecond exercises the rollover branch, which borrows
    // the timestamp forward rather than repeating or regressing an id.
    vi.spyOn(Date, "now").mockReturnValue(1_800_000_000_000);

    const ids: string[] = [];

    for (let index = 0; index < 10_000; index += 1) {
      ids.push(newJobId());
    }

    expectStrictlyIncreasing(ids);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stays strictly increasing when the system clock steps backwards", () => {
    // NTP and a resumed virtual machine both move `Date.now()` down. An id that
    // went down with it would silently corrupt every ordering built on it.
    let clock = 1_800_000_100_000;
    vi.spyOn(Date, "now").mockImplementation(() => {
      clock -= 1_000;
      return clock;
    });

    const ids: string[] = [];

    for (let index = 0; index < 200; index += 1) {
      ids.push(newRunId());
    }

    expectStrictlyIncreasing(ids);
  });
});

describe("isEntityId", () => {
  it("accepts a generated id", () => {
    expect(isEntityId(newJobId())).toBe(true);
  });

  it("rejects a version 4 UUID, which is the unsortable scheme M2-T1 replaces", () => {
    expect(isEntityId("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(false);
    expect(isEntityId(globalThis.crypto.randomUUID())).toBe(false);
  });

  it("rejects an uppercase UUIDv7 rather than normalizing it", () => {
    const id = newJobId();

    expect(isEntityId(id.toUpperCase())).toBe(false);
    expect(isEntityId(id)).toBe(true);
  });

  it("rejects a wrong variant nibble", () => {
    // `c` has high bits `11`, which RFC 9562 reserves for a different variant.
    expect(isEntityId("01a0bc70-c781-7e42-c01d-04ec7e8d85ee")).toBe(false);
    expect(isEntityId("01a0bc70-c781-7e42-a01d-04ec7e8d85ee")).toBe(true);
  });

  it("rejects malformed and non-string values", () => {
    for (const value of [
      "",
      "not-a-uuid",
      "01a0bc70c7817e42a01d04ec7e8d85ee",
      "01a0bc70-c781-7e42-a01d-04ec7e8d85e",
      "01a0bc70-c781-7e42-a01d-04ec7e8d85eee",
      " 01a0bc70-c781-7e42-a01d-04ec7e8d85ee",
      undefined,
      null,
      42,
      {},
    ]) {
      expect(isEntityId(value), String(value)).toBe(false);
    }
  });
});

describe("parseEntityId", () => {
  it("returns the branded id when the value is well formed", () => {
    const id = newRunId();

    expect(parseEntityId("run", String(id))).toBe(id);
  });

  it("throws a ValidationError naming the kind and the scheme", () => {
    expect(() => parseEntityId("trace-event", "nope")).toThrow(ValidationError);
    expect(() => parseEntityId("trace-event", "nope")).toThrow(
      "expected a trace-event id in the `uuidv7` scheme",
    );
  });

  it("reports the issue at the caller's path, matching `collectRefIssues`", () => {
    try {
      parseEntityId("job", "nope", ["job", "id"]);
      expect.unreachable("parseEntityId should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues).toEqual([
        { path: ["job", "id"], message: ENTITY_ID_MESSAGE },
      ]);
    }
  });

  it("defaults the path to the empty root path", () => {
    try {
      parseEntityId("job", "nope");
      expect.unreachable("parseEntityId should have thrown");
    } catch (error) {
      expect((error as ValidationError).issues).toEqual([{ path: [], message: ENTITY_ID_MESSAGE }]);
    }
  });
});

describe("the brands", () => {
  it("keeps the twelve id types mutually incompatible", () => {
    expectTypeOf<JobId>().not.toEqualTypeOf<RunId>();
    expectTypeOf<JobId>().not.toEqualTypeOf<string>();
    expectTypeOf(newJobId()).toEqualTypeOf<JobId>();
    expectTypeOf(newRunId()).toEqualTypeOf<RunId>();
    expectTypeOf(parseEntityId("run", newRunId())).toEqualTypeOf<RunId>();
    expectTypeOf<JobId>().toEqualTypeOf<EntityId<"job">>();
  });

  it("still assigns to `string`, so an id needs no unwrapping to serialize", () => {
    expectTypeOf<JobId>().toExtend<string>();

    const id = newJobId();
    const payload: Record<string, string> = { jobId: id };

    expect(JSON.parse(JSON.stringify(payload))).toEqual({ jobId: String(id) });
  });
});
