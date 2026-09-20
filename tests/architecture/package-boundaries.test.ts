import { globSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  BOUNDARY_RULES,
  type BoundaryRules,
  findBoundaryViolations,
  formatViolations,
  matchesPattern,
  type WorkspacePackage,
} from "./boundaries.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface PackageJsonShape {
  readonly name?: string;
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

/** Read the workspace globs pnpm itself uses, so the test cannot drift. */
function readWorkspaceGlobs(): string[] {
  const raw = readFileSync(join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
  const parsed: unknown = parseYaml(raw);
  if (typeof parsed !== "object" || parsed === null || !("packages" in parsed)) {
    throw new Error("pnpm-workspace.yaml does not declare a `packages` key");
  }
  const { packages } = parsed as { packages: unknown };
  if (!Array.isArray(packages) || packages.some((entry) => typeof entry !== "string")) {
    throw new Error("pnpm-workspace.yaml `packages` must be a list of glob strings");
  }
  return packages as string[];
}

function loadWorkspacePackages(): WorkspacePackage[] {
  const packages: WorkspacePackage[] = [];

  for (const glob of readWorkspaceGlobs()) {
    for (const match of globSync(glob, { cwd: REPO_ROOT })) {
      const manifestPath = join(REPO_ROOT, match, "package.json");
      let contents: string;
      try {
        contents = readFileSync(manifestPath, "utf8");
      } catch {
        // A glob can match a directory that is not a package yet.
        continue;
      }
      const manifest = JSON.parse(contents) as PackageJsonShape;
      if (manifest.name === undefined) {
        throw new Error(`${manifestPath} has no "name"`);
      }
      packages.push({
        name: manifest.name,
        directory: relative(REPO_ROOT, join(REPO_ROOT, match)).replaceAll("\\", "/"),
        dependencies: [
          ...Object.keys(manifest.dependencies ?? {}),
          ...Object.keys(manifest.devDependencies ?? {}),
          ...Object.keys(manifest.peerDependencies ?? {}),
          ...Object.keys(manifest.optionalDependencies ?? {}),
        ],
      });
    }
  }

  return packages;
}

describe("workspace dependency boundaries", () => {
  const packages = loadWorkspacePackages();

  it("discovers every workspace package", () => {
    expect(packages.map((pkg) => pkg.name).sort()).toEqual([
      "@internal/config",
      "@internal/core",
      // The credential-free `mockModel` fixture `EveAgentRuntime`'s contract
      // tests run against (M1-T6). An eve app root must be its own package
      // declaring `eve`, so it cannot live inside `packages/runtime-eve`;
      // ADR-0028 records why that makes it an `apps/*` domain consumer.
      "@internal/eve-fixture-agent",
      "@internal/example-agent",
      // The local run inspector and the `harness` CLI (M2-T10). A non-adapter
      // reading the `Storage` port, so it carries core's bans; it reaches a
      // real database only by depending on `@internal/storage-supabase`, from
      // its `bin` entry point alone. ADR-0037.
      "@internal/observability",
      "@internal/runtime-ai-sdk",
      "@internal/runtime-eve",
      // The Supabase storage adapter (M2-T11). It holds only the generated
      // `database.types.ts` so far; the `Storage` port and the Supabase
      // `TraceSink` are M2-T5. It was already in `adapterPackages` before it
      // existed, so no rule needed adding when the package appeared.
      "@internal/storage-supabase",
      "@internal/testing",
      // The buffered trace writer and its local sinks (M2-T4). A harness
      // package, not an adapter: it carries the same bans `@internal/core`
      // does, and a storage medium reaches it through its own `TraceSink`.
      "@internal/trace",
    ]);
  });

  it("covers every workspace package with a rule or a deliberate absence", () => {
    // A package nobody added to the tables is a package the boundary test
    // silently ignores, which is the failure mode the M2 status file warns
    // about for `packages/trace`.
    const governed = new Set([
      ...BOUNDARY_RULES.adapterPackages,
      ...Object.keys(BOUNDARY_RULES.forbiddenByPackage),
    ]);

    expect(
      packages
        .filter((pkg) => pkg.directory.startsWith("packages/") && !governed.has(pkg.name))
        .map((pkg) => pkg.name)
        .sort(),
    ).toEqual([
      // `@internal/config` ships no runtime code at all: it is tsconfig bases.
      "@internal/config",
      // `@internal/testing` is test-only and depends on core alone. The
      // adapter-only rule already covers it; no extra ban is needed.
      "@internal/testing",
    ]);
  });

  it("has no boundary violations", () => {
    const violations = findBoundaryViolations(packages, BOUNDARY_RULES);

    expect(violations, `Dependency rule violations:\n${formatViolations(violations)}`).toEqual([]);
  });
});

describe("matchesPattern", () => {
  it("matches an exact package name", () => {
    expect(matchesPattern("eve", "eve")).toBe(true);
    expect(matchesPattern("eve-utils", "eve")).toBe(false);
  });

  it("matches a scope wildcard", () => {
    expect(matchesPattern("@ai-sdk/openai", "@ai-sdk/*")).toBe(true);
    expect(matchesPattern("@ai-sdk-other/openai", "@ai-sdk/*")).toBe(false);
  });
});

describe("findBoundaryViolations", () => {
  // A miniature fabricated workspace. It proves the engine itself works,
  // rather than only proving that today's three real packages happen to be
  // clean.
  const RULES: BoundaryRules = {
    adapterOnlyDependencies: ["eve", "@supabase/*"],
    adapterPackages: ["@internal/runtime-eve"],
    appPackagesMayDependOn: ["eve"],
    forbiddenByPackage: {
      "@internal/core": ["eve"],
    },
  };

  const clean: WorkspacePackage = {
    name: "@internal/core",
    directory: "packages/core",
    dependencies: ["@internal/config"],
  };

  it("returns no violations for a clean workspace", () => {
    expect(findBoundaryViolations([clean], RULES)).toEqual([]);
  });

  it("flags a non-adapter package that depends on an adapter-only surface", () => {
    const offender: WorkspacePackage = {
      name: "@internal/core",
      directory: "packages/core",
      dependencies: ["eve"],
    };

    const violations = findBoundaryViolations([offender], RULES);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.packageName).toBe("@internal/core");
    expect(violations[0]?.dependencyName).toBe("eve");
    expect(violations[0]?.reason).toContain("adapter-only");
  });

  it("flags a scoped adapter-only dependency", () => {
    const offender: WorkspacePackage = {
      name: "@internal/trace",
      directory: "packages/trace",
      dependencies: ["@supabase/supabase-js"],
    };

    expect(findBoundaryViolations([offender], RULES)).toHaveLength(1);
  });

  it("allows a declared adapter package to depend on its surface", () => {
    const adapter: WorkspacePackage = {
      name: "@internal/runtime-eve",
      directory: "packages/runtime-eve",
      dependencies: ["eve"],
    };

    expect(findBoundaryViolations([adapter], RULES)).toEqual([]);
  });

  it("flags a library package that depends on an application package", () => {
    const app: WorkspacePackage = {
      name: "@example/playground",
      directory: "apps/playground",
      dependencies: [],
    };
    const offender: WorkspacePackage = {
      name: "@internal/workflow",
      directory: "packages/workflow",
      dependencies: ["@example/playground"],
    };

    const violations = findBoundaryViolations([app, offender], RULES);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain("must not depend on the application package");
  });

  it("allows an application package to depend on a library package", () => {
    const app: WorkspacePackage = {
      name: "@example/playground",
      directory: "apps/playground",
      dependencies: ["@internal/core"],
    };

    expect(findBoundaryViolations([app, clean], RULES)).toEqual([]);
  });

  // ADR-0025: `apps/*` packages are domain consumers and author eve agents
  // directly. The allowance is an explicit allowlist, not a blanket exemption,
  // and it does not reach `packages/*`.
  it("allows an application package to depend on an allowlisted adapter-only surface", () => {
    const app: WorkspacePackage = {
      name: "@internal/example-agent",
      directory: "apps/example-agent",
      dependencies: ["eve"],
    };

    expect(findBoundaryViolations([app], RULES)).toEqual([]);
  });

  it("still flags an application package that depends on a non-allowlisted surface", () => {
    const app: WorkspacePackage = {
      name: "@internal/example-agent",
      directory: "apps/example-agent",
      dependencies: ["@supabase/supabase-js"],
    };

    const violations = findBoundaryViolations([app], RULES);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.dependencyName).toBe("@supabase/supabase-js");
    expect(violations[0]?.reason).toContain("adapter-only");
  });

  it("does not extend the app allowance to a library package", () => {
    const library: WorkspacePackage = {
      name: "@internal/trace",
      directory: "packages/trace",
      dependencies: ["eve"],
    };

    const violations = findBoundaryViolations([library], RULES);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.reason).toContain("adapter-only");
  });

  it("does not extend the app allowance to core", () => {
    const offender: WorkspacePackage = {
      name: "@internal/core",
      directory: "packages/core",
      dependencies: ["eve"],
    };

    const violations = findBoundaryViolations([offender], RULES);

    expect(violations).toHaveLength(1);
    expect(violations[0]?.packageName).toBe("@internal/core");
  });

  it("reports every violating dependency, not only the first", () => {
    const offender: WorkspacePackage = {
      name: "@internal/core",
      directory: "packages/core",
      dependencies: ["eve", "@supabase/supabase-js"],
    };

    expect(findBoundaryViolations([offender], RULES)).toHaveLength(2);
  });
});
