import { describe, expect, expectTypeOf, it } from "vitest";
import {
  AgentExecutionError,
  BudgetExceededError,
  DecisionError,
  HarnessError,
  type HarnessErrorCode,
  isHarnessError,
  MAX_SERIALIZED_CAUSE_DEPTH,
  PermissionDeniedError,
  ReplayMismatchError,
  type SerializedHarnessError,
  StorageError,
  serializeError,
  ToolExecutionError,
  ValidationError,
  WorkflowError,
} from "./errors.js";
import type { JsonObject } from "./json.js";

/** Every class in the taxonomy, with the name and code it must report. */
const TAXONOMY: readonly {
  readonly label: string;
  readonly code: HarnessErrorCode;
  readonly create: () => HarnessError;
}[] = [
  {
    label: "ValidationError",
    code: "VALIDATION",
    create: () =>
      new ValidationError("invalid", { issues: [{ path: ["a"], message: "required" }] }),
  },
  {
    label: "BudgetExceededError",
    code: "BUDGET_EXCEEDED",
    create: () =>
      new BudgetExceededError("out of calls", { dimension: "maxModelCalls", limit: 4, actual: 5 }),
  },
  {
    label: "PermissionDeniedError",
    code: "PERMISSION_DENIED",
    create: () =>
      new PermissionDeniedError("denied", { toolId: "github.push", requested: "write" }),
  },
  {
    label: "ToolExecutionError",
    code: "TOOL_EXECUTION",
    create: () => new ToolExecutionError("tool blew up", { toolId: "fixture.read" }),
  },
  {
    label: "AgentExecutionError",
    code: "AGENT_EXECUTION",
    create: () => new AgentExecutionError("agent blew up"),
  },
  { label: "DecisionError", code: "DECISION", create: () => new DecisionError("no judgment") },
  { label: "WorkflowError", code: "WORKFLOW", create: () => new WorkflowError("bad IR") },
  { label: "StorageError", code: "STORAGE", create: () => new StorageError("write failed") },
  {
    label: "ReplayMismatchError",
    code: "REPLAY_MISMATCH",
    create: () =>
      new ReplayMismatchError("drift", { nodeId: "n1", expected: "fp-a", actual: "fp-b" }),
  },
];

describe("the error taxonomy", () => {
  it("covers exactly the nine classes M1-T8 names", () => {
    expect(TAXONOMY.map((entry) => entry.label)).toEqual([
      "ValidationError",
      "BudgetExceededError",
      "PermissionDeniedError",
      "ToolExecutionError",
      "AgentExecutionError",
      "DecisionError",
      "WorkflowError",
      "StorageError",
      "ReplayMismatchError",
    ]);
  });

  it("assigns every class a distinct code", () => {
    const codes = TAXONOMY.map((entry) => entry.code);

    expect(new Set(codes).size).toBe(codes.length);
  });

  it.each(TAXONOMY)("$label is an Error, a HarnessError and itself", ({ create }) => {
    const error = create();

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(HarnessError);
    expect(isHarnessError(error)).toBe(true);
  });

  it.each(TAXONOMY)("$label reports its own name and code", ({ label, code, create }) => {
    const error = create();

    expect(error.name).toBe(label);
    expect(error.code).toBe(code);
  });

  it.each(TAXONOMY)("$label keeps the message it was given", ({ create }) => {
    expect(create().message).not.toBe("");
  });

  it("accepts a cause through the standard ErrorOptions field", () => {
    const cause = new Error("underlying");
    const error = new AgentExecutionError("wrapped", { cause });

    expect(error.cause).toBe(cause);
  });
});

describe("typed fields", () => {
  it("ValidationError carries every issue", () => {
    const issues = [
      { path: ["input", "vendor", 0], message: "expected string" },
      { path: [], message: "object required" },
    ];
    const error = new ValidationError("invalid input", { issues });

    expect(error.issues).toEqual(issues);
  });

  it("BudgetExceededError names a real budget dimension", () => {
    const error = new BudgetExceededError("too costly", {
      dimension: "maxCostUsd",
      limit: 1,
      actual: 2.5,
    });

    expect(error.dimension).toBe("maxCostUsd");
    expect(error.limit).toBe(1);
    expect(error.actual).toBe(2.5);
  });

  it("PermissionDeniedError records what was asked for", () => {
    const error = new PermissionDeniedError("nope", { toolId: "github.push", requested: "write" });

    expect(error.toolId).toBe("github.push");
    expect(error.requested).toBe("write");
  });

  it("ReplayMismatchError records both fingerprints as opaque strings", () => {
    const error = new ReplayMismatchError("drift", {
      nodeId: "node-3",
      expected: "fp-a",
      actual: "fp-b",
    });

    expect(error.nodeId).toBe("node-3");
    expect(error.expected).toBe("fp-a");
    expect(error.actual).toBe("fp-b");
  });
});

describe("details", () => {
  it("is undefined when the thrower published nothing", () => {
    expect(new WorkflowError("bad IR").details).toBeUndefined();
  });

  it("keeps what the thrower published", () => {
    const error = new StorageError("write failed", { details: { table: "trace_events" } });

    expect(error.details).toEqual({ table: "trace_events" });
  });

  it("merges the class's own typed fields in, so a trace keeps them", () => {
    const error = new BudgetExceededError("out of calls", {
      dimension: "maxToolCalls",
      limit: 2,
      actual: 3,
      details: { nodeId: "n1" },
    });

    expect(error.details).toEqual({
      nodeId: "n1",
      dimension: "maxToolCalls",
      limit: 2,
      actual: 3,
    });
  });
});

describe("serializeError", () => {
  it("produces the whitelisted fields for a harness error", () => {
    const error = new ToolExecutionError("tool blew up", {
      toolId: "fixture.read",
      details: { attempt: 2 },
    });

    expect(serializeError(error)).toEqual({
      name: "ToolExecutionError",
      code: "TOOL_EXECUTION",
      message: "tool blew up",
      details: { attempt: 2, toolId: "fixture.read" },
    });
  });

  it("survives a JSON round trip unchanged", () => {
    const error = new ReplayMismatchError("drift", {
      nodeId: "node-3",
      expected: "fp-a",
      actual: "fp-b",
      cause: new StorageError("read failed"),
    });
    const serialized = serializeError(error);

    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized);
  });

  it("is assignable to a trace payload", () => {
    expectTypeOf<SerializedHarnessError>().toExtend<JsonObject>();
  });

  it("omits the stack by default", () => {
    const serialized = serializeError(new WorkflowError("bad IR"));

    expect(serialized).not.toHaveProperty("stack");
  });

  it("includes the stack only when asked", () => {
    const serialized = serializeError(new WorkflowError("bad IR"), { includeStack: true });

    expect(typeof serialized.stack).toBe("string");
  });

  it("does not leak an error's other properties", () => {
    const error = Object.assign(new StorageError("write failed"), {
      apiKey: "sk-live-do-not-log",
      connectionString: "postgres://user:password@host/db",
    });

    const serialized = serializeError(error);

    expect(serialized).not.toHaveProperty("apiKey");
    expect(serialized).not.toHaveProperty("connectionString");
    expect(JSON.stringify(serialized)).not.toContain("sk-live");
    expect(JSON.stringify(serialized)).not.toContain("password");
  });

  it("serializes a plain Error as an unknown-coded failure", () => {
    const serialized = serializeError(new TypeError("not a function"));

    expect(serialized).toEqual({
      name: "TypeError",
      code: "UNKNOWN",
      message: "not a function",
    });
  });

  it("reads no property of a plain Error beyond name, message and cause", () => {
    const error = Object.assign(new Error("boom"), { token: "secret-token" });

    expect(JSON.stringify(serializeError(error))).not.toContain("secret-token");
  });

  it.each([
    ["a thrown string", "just a string", "just a string"],
    ["a thrown number", 42, "42"],
    ["a thrown null", null, "null"],
    ["a thrown undefined", undefined, "undefined"],
  ])("serializes %s as a NonError", (_label, thrown, message) => {
    expect(serializeError(thrown)).toEqual({ name: "NonError", code: "UNKNOWN", message });
  });

  it("does not read the properties of a thrown plain object", () => {
    const serialized = serializeError({ message: "looks like an error", apiKey: "sk-live-leak" });

    expect(serialized).toEqual({
      name: "NonError",
      code: "UNKNOWN",
      message: "[object Object]",
    });
  });

  it("survives a value that cannot be stringified", () => {
    const serialized = serializeError(Object.create(null));

    expect(serialized.name).toBe("NonError");
    expect(serialized.code).toBe("UNKNOWN");
    expect(serialized.message).toBe("[unstringifiable object]");
  });
});

describe("cause chains", () => {
  it("serializes each level", () => {
    const root = new Error("socket closed");
    const storage = new StorageError("write failed", { cause: root });
    const top = new AgentExecutionError("run failed", { cause: storage });

    expect(serializeError(top)).toEqual({
      name: "AgentExecutionError",
      code: "AGENT_EXECUTION",
      message: "run failed",
      cause: {
        name: "StorageError",
        code: "STORAGE",
        message: "write failed",
        cause: { name: "Error", code: "UNKNOWN", message: "socket closed" },
      },
    });
  });

  it("truncates below the depth cap instead of recursing forever", () => {
    let error: Error = new WorkflowError("level 0");
    for (let level = 1; level <= MAX_SERIALIZED_CAUSE_DEPTH + 4; level += 1) {
      error = new WorkflowError(`level ${level}`, { cause: error });
    }

    let serialized: SerializedHarnessError | undefined = serializeError(error);
    let depth = 0;
    while (serialized?.cause !== undefined) {
      serialized = serialized.cause;
      depth += 1;
    }

    expect(depth).toBe(MAX_SERIALIZED_CAUSE_DEPTH + 1);
    expect(serialized?.name).toBe("TruncatedCause");
    expect(serialized?.code).toBe("UNKNOWN");
  });

  it("terminates on a cause cycle", () => {
    const first = new WorkflowError("first");
    const second = new WorkflowError("second", { cause: first });
    Object.assign(first, { cause: second });

    expect(() => JSON.stringify(serializeError(first))).not.toThrow();
  });
});

describe("toJSON", () => {
  it("makes JSON.stringify safe by default", () => {
    const error = new PermissionDeniedError("denied", {
      toolId: "github.push",
      requested: "write",
    });

    expect(JSON.parse(JSON.stringify(error))).toEqual({
      name: "PermissionDeniedError",
      code: "PERMISSION_DENIED",
      message: "denied",
      details: { toolId: "github.push", requested: "write" },
    });
  });

  it("agrees with serializeError", () => {
    const error = new DecisionError("no judgment", { details: { questionId: "q1" } });

    expect(error.toJSON()).toEqual(serializeError(error));
  });

  it("excludes the stack, so a stringified error never leaks a filesystem path", () => {
    const error = new AgentExecutionError("agent blew up");

    expect(JSON.stringify(error)).not.toContain("errors.test.ts");
  });
});

describe("isHarnessError", () => {
  it.each([
    ["a plain Error", new Error("boom")],
    ["a TypeError", new TypeError("boom")],
    ["a string", "boom"],
    ["null", null],
    ["a lookalike object", { code: "VALIDATION", message: "boom" }],
  ])("rejects %s", (_label, value) => {
    expect(isHarnessError(value)).toBe(false);
  });
});
