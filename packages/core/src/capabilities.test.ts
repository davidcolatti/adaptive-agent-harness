import { describe, expect, it } from "vitest";
import {
  CAPABILITY_KINDS,
  type CapabilityManifestEntry,
  type CapabilityRegistry,
  capabilityFingerprint,
  createCapabilityRegistry,
  formatCapabilityRef,
  parseCapabilityRefString,
} from "./capabilities.js";
import { ValidationError } from "./errors.js";
import type { Schema } from "./schema.js";

/**
 * A minimal Standard Schema, written by hand so that this file tests the
 * registry rather than a schema library. `apps/example-agent` exercises the
 * registry against real `zod` schemas.
 */
function fakeSchema<T>(): Schema<T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value: value as T }),
    },
  };
}

function registerSchema(registry: CapabilityRegistry, id: string, version = "1.0.0"): void {
  registry.register("schema", {
    id,
    version,
    module: "src/schemas.ts",
    exportName: id,
    value: fakeSchema<unknown>(),
  });
}

describe("capability references", () => {
  it("round-trips between the object and string forms", () => {
    const ref = { id: "vendor-triage.input", version: "1.0.0" };
    expect(formatCapabilityRef(ref)).toBe("vendor-triage.input@1.0.0");
    expect(parseCapabilityRefString("vendor-triage.input@1.0.0")).toEqual(ref);
  });

  it("rejects a string that is not exactly `id@version`", () => {
    for (const bad of ["", "no-version", "a@b@c", "a@1.0", "a@^1.0.0", "@1.0.0", "a@"]) {
      expect(() => parseCapabilityRefString(bad)).toThrow(ValidationError);
    }
  });
});

describe("createCapabilityRegistry: registration", () => {
  it("registers a capability and returns its manifest entry", () => {
    const registry = createCapabilityRegistry();

    const entry = registry.register("schema", {
      id: "vendor-triage.input",
      version: "1.0.0",
      module: "src/domain/schemas.ts",
      exportName: "vendorTriageInputSchema",
      value: fakeSchema<{ vendorName: string }>(),
    });

    expect(entry.ref).toEqual({ id: "vendor-triage.input", version: "1.0.0" });
    expect(entry.kind).toBe("schema");
    expect(entry.module).toBe("src/domain/schemas.ts");
    expect(entry.exportName).toBe("vendorTriageInputSchema");
    expect(entry.permissions).toEqual([]);
    expect(entry.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("resolves the executable value back out, by object or string reference", () => {
    const registry = createCapabilityRegistry();
    const handler = (n: number): number => n + 1;

    registry.register("handler", {
      id: "increment",
      version: "1.0.0",
      module: "src/handlers/increment.ts",
      exportName: "increment",
      value: handler,
    });

    expect(registry.resolve("handler", { id: "increment", version: "1.0.0" })).toBe(handler);
    expect(registry.resolve<typeof handler>("handler", "increment@1.0.0")(1)).toBe(2);
    expect(registry.has("handler", "increment@1.0.0")).toBe(true);
    expect(registry.has("handler", "increment@2.0.0")).toBe(false);
    expect(registry.has("tool", "increment@1.0.0")).toBe(false);
  });

  it("throws a ValidationError for an unknown reference", () => {
    const registry = createCapabilityRegistry();

    try {
      registry.resolve("tool", "missing@1.0.0");
      expect.unreachable("expected a ValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).issues[0]?.path).toEqual(["tool", "missing", "1.0.0"]);
    }
  });

  it("rejects a duplicate kind/id/version", () => {
    const registry = createCapabilityRegistry();
    registerSchema(registry, "vendor-triage.input");

    expect(() => registerSchema(registry, "vendor-triage.input")).toThrow(ValidationError);
    // A different version of the same id is fine.
    expect(() => registerSchema(registry, "vendor-triage.input", "1.0.1")).not.toThrow();
  });

  it("rejects the same id registered under a second kind", () => {
    const registry = createCapabilityRegistry();
    registerSchema(registry, "ambiguous");

    try {
      registry.register("tool", {
        id: "ambiguous",
        version: "2.0.0",
        module: "src/tools/ambiguous.ts",
        exportName: "default",
        value: () => undefined,
      });
      expect.unreachable("expected a ValidationError");
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).message).toContain("already registered as a `schema`");
    }
  });

  it("rejects a malformed id or version", () => {
    const registry = createCapabilityRegistry();

    expect(() => registerSchema(registry, "has space")).toThrow(ValidationError);
    expect(() => registerSchema(registry, "has@at")).toThrow(ValidationError);
    expect(() => registerSchema(registry, "-leading-dash")).toThrow(ValidationError);
    expect(() => registerSchema(registry, "fine", "1.0")).toThrow(ValidationError);
    expect(() => registerSchema(registry, "fine", "^1.0.0")).toThrow(ValidationError);
    expect(() => registerSchema(registry, "fine", "1.0.0-beta.1")).toThrow(ValidationError);
  });

  it("rejects an empty module or export name", () => {
    const registry = createCapabilityRegistry();

    expect(() =>
      registry.register("policy", {
        id: "p",
        version: "1.0.0",
        module: "   ",
        exportName: "p",
        value: () => true,
      }),
    ).toThrow(ValidationError);

    expect(() =>
      registry.register("policy", {
        id: "p",
        version: "1.0.0",
        module: "src/p.ts",
        exportName: "",
        value: () => true,
      }),
    ).toThrow(ValidationError);
  });

  it("rejects a missing value, and a `schema` value that is not a Standard Schema", () => {
    const registry = createCapabilityRegistry();

    expect(() =>
      registry.register("handler", {
        id: "h",
        version: "1.0.0",
        module: "src/h.ts",
        exportName: "h",
        value: undefined,
      }),
    ).toThrow(ValidationError);

    expect(() =>
      registry.register("schema", {
        id: "not-a-schema",
        version: "1.0.0",
        module: "src/s.ts",
        exportName: "s",
        value: { parse: () => undefined },
      }),
    ).toThrow(ValidationError);
  });

  it("rejects a non-string permission declaration", () => {
    const registry = createCapabilityRegistry();

    expect(() =>
      registry.register("tool", {
        id: "t",
        version: "1.0.0",
        module: "src/t.ts",
        exportName: "default",
        permissions: ["read", ""] as readonly string[],
        value: () => undefined,
      }),
    ).toThrow(ValidationError);
  });

  it("requires a referenced schema to already be registered, so a manifest is closed", () => {
    const registry = createCapabilityRegistry();

    expect(() =>
      registry.register("agent", {
        id: "researcher",
        version: "1.0.0",
        module: "agent/agent.ts",
        exportName: "default",
        inputSchema: { id: "not-registered", version: "1.0.0" },
        value: { kind: "agent" },
      }),
    ).toThrow(ValidationError);

    registerSchema(registry, "researcher.input");

    expect(() =>
      registry.register("agent", {
        id: "researcher",
        version: "1.0.0",
        module: "agent/agent.ts",
        exportName: "default",
        inputSchema: { id: "researcher.input", version: "1.0.0" },
        value: { kind: "agent" },
      }),
    ).not.toThrow();
  });
});

describe("createCapabilityRegistry: the manifest", () => {
  function populated(): CapabilityRegistry {
    const registry = createCapabilityRegistry();

    registerSchema(registry, "z.input");
    registerSchema(registry, "a.input");
    registry.register("tool", {
      id: "lookup",
      version: "1.0.0",
      module: "agent/tools/lookup.ts",
      exportName: "default",
      permissions: ["read"],
      value: () => undefined,
    });
    registry.register("policy", {
      id: "gate",
      version: "1.0.0",
      module: "src/policies/gate.ts",
      exportName: "gate",
      value: () => ({ allowed: true }),
    });

    return registry;
  }

  it("sorts entries by kind, then id, then version", () => {
    const registry = populated();
    registerSchema(registry, "a.input", "0.9.0");

    expect(
      registry.entries().map((entry) => `${entry.kind}:${formatCapabilityRef(entry.ref)}`),
    ).toEqual([
      "schema:a.input@0.9.0",
      "schema:a.input@1.0.0",
      "schema:z.input@1.0.0",
      "tool:lookup@1.0.0",
      "policy:gate@1.0.0",
    ]);
  });

  it("round-trips through JSON unchanged", () => {
    const manifest = populated().toManifest();
    const roundTripped: unknown = JSON.parse(JSON.stringify(manifest));

    expect(roundTripped).toEqual(manifest);
    expect(manifest.version).toBe(1);
    expect(manifest.entries).toHaveLength(4);
  });

  it("contains no executable source and no secret from a registered value", () => {
    const registry = createCapabilityRegistry();

    registry.register("handler", {
      id: "leaky",
      version: "1.0.0",
      module: "src/handlers/leaky.ts",
      exportName: "leaky",
      // Both of these are exactly what a manifest must not carry: a live
      // function, and a credential a careless domain put next to one.
      value: (input: string): string => `${input} sk-secret-fixture`,
    });

    registry.register("agent", {
      id: "configured",
      version: "1.0.0",
      module: "agent/agent.ts",
      exportName: "default",
      value: { apiKey: "sk-secret-fixture", call: (): number => 1 },
    });

    const serialized = JSON.stringify(registry.toManifest());

    expect(serialized).not.toContain("sk-secret-fixture");
    expect(serialized).not.toContain("=>");
    expect(serialized).not.toContain("function");
    expect(serialized).not.toContain("apiKey");
  });
});

describe("capabilityFingerprint", () => {
  const metadata: Omit<CapabilityManifestEntry, "fingerprint"> = {
    ref: { id: "lookup", version: "1.0.0" },
    kind: "tool",
    module: "agent/tools/lookup.ts",
    exportName: "default",
    permissions: ["read"],
  };

  it("is stable for identical metadata", () => {
    expect(capabilityFingerprint(metadata)).toBe(capabilityFingerprint({ ...metadata }));
  });

  it("changes when any behavior-affecting field changes", () => {
    const base = capabilityFingerprint(metadata);

    expect(capabilityFingerprint({ ...metadata, module: "agent/tools/other.ts" })).not.toBe(base);
    expect(capabilityFingerprint({ ...metadata, exportName: "lookup" })).not.toBe(base);
    expect(capabilityFingerprint({ ...metadata, permissions: ["write"] })).not.toBe(base);
    expect(capabilityFingerprint({ ...metadata, kind: "handler" })).not.toBe(base);
    expect(
      capabilityFingerprint({ ...metadata, ref: { id: "lookup", version: "1.0.1" } }),
    ).not.toBe(base);
    expect(
      capabilityFingerprint({ ...metadata, inputSchema: { id: "s", version: "1.0.0" } }),
    ).not.toBe(base);
  });

  it("does not depend on the registered value", () => {
    const registry = createCapabilityRegistry();
    const first = registry.register("handler", {
      id: "h",
      version: "1.0.0",
      module: "src/h.ts",
      exportName: "h",
      value: (): number => 1,
    });

    const other = createCapabilityRegistry();
    const second = other.register("handler", {
      id: "h",
      version: "1.0.0",
      module: "src/h.ts",
      exportName: "h",
      value: (): number => 2,
    });

    expect(first.fingerprint).toBe(second.fingerprint);
  });
});

describe("CAPABILITY_KINDS", () => {
  it("is the five kinds build plan section 5 fixes", () => {
    expect(CAPABILITY_KINDS).toEqual(["schema", "agent", "tool", "handler", "policy"]);
  });
});
