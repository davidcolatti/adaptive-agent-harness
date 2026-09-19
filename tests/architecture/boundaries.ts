/**
 * Data-driven dependency-boundary rules for the workspace.
 *
 * The build plan (section 4, "Dependency rule") states the boundaries in prose.
 * This module encodes them as data and provides the pure function the
 * architecture test runs against the real workspace. Milestone 1+ extends the
 * tables below as packages appear; the engine itself does not change.
 *
 * M0-T3 requires that rules Biome should not own live in tests, not in the
 * linter, which is why this is a test fixture rather than a Biome plugin.
 */

/** A workspace package as the test reads it off disk. */
export interface WorkspacePackage {
  /** The `name` field of the package.json. */
  readonly name: string;
  /** Workspace-relative directory, e.g. `packages/core` or `apps/playground`. */
  readonly directory: string;
  /**
   * Every dependency name the package declares, across `dependencies`,
   * `devDependencies`, `peerDependencies` and `optionalDependencies`.
   */
  readonly dependencies: readonly string[];
}

export interface BoundaryViolation {
  /** The package that declares the forbidden dependency. */
  readonly packageName: string;
  /** The dependency that is not allowed. */
  readonly dependencyName: string;
  /** Human-readable explanation, used directly in the assertion message. */
  readonly reason: string;
}

/**
 * A dependency name pattern. A bare name matches exactly; a name ending in
 * `/*` matches that npm scope, e.g. `@ai-sdk/*` matches `@ai-sdk/openai`.
 */
export type DependencyPattern = string;

export interface BoundaryRules {
  /**
   * External packages that only a declared adapter may depend on. Every other
   * workspace package is forbidden from importing them, which is how
   * "Vercel-specific behavior lives behind adapter packages" is enforced.
   */
  readonly adapterOnlyDependencies: readonly DependencyPattern[];
  /**
   * The only workspace packages allowed to depend on
   * {@link BoundaryRules.adapterOnlyDependencies}.
   */
  readonly adapterPackages: readonly string[];
  /**
   * Extra per-package bans, keyed by workspace package name. Used for rules
   * that are narrower than the adapter rule, such as `core` not depending on
   * any adapter-facing package at all.
   */
  readonly forbiddenByPackage: Readonly<Record<string, readonly DependencyPattern[]>>;
}

/**
 * The single source of truth for the dependency rule. Extend this constant
 * when a milestone introduces a package; do not add bespoke assertions to the
 * test file.
 */
export const BOUNDARY_RULES: BoundaryRules = {
  // Third-party surfaces that must stay behind an adapter package.
  adapterOnlyDependencies: ["eve", "@supabase/*", "ai", "@ai-sdk/*", "@vercel/*", "workflow"],
  // Adapter packages. None of these exist in Milestone 0: the first four are
  // planned by the build plan for Milestones 1-3, and the two Vercel ones for
  // Milestone 11. All are listed now so an adapter milestone edits this table
  // deliberately rather than in a hurry.
  adapterPackages: [
    "@internal/runtime-eve",
    "@internal/decision-jev",
    "@internal/storage-supabase",
    "@internal/runtime-ai-sdk",
    "@internal/workflow-vercel",
    "@internal/sandbox-vercel",
  ],
  forbiddenByPackage: {
    // "core cannot import domain code / eve / Supabase" (build plan section 4).
    // The adapter rule already bans these for every non-adapter package; the
    // entry is kept explicit because core is the boundary the plan names.
    "@internal/core": ["eve", "@supabase/*", "ai", "@ai-sdk/*", "workflow", "@vercel/*"],
  },
};

/** True when `dependency` matches `pattern` (exact name, or `@scope/*`). */
export function matchesPattern(dependency: string, pattern: DependencyPattern): boolean {
  if (pattern.endsWith("/*")) {
    return dependency.startsWith(pattern.slice(0, -1));
  }
  return dependency === pattern;
}

function isAppPackage(pkg: WorkspacePackage): boolean {
  return pkg.directory === "apps" || pkg.directory.startsWith("apps/");
}

function isLibraryPackage(pkg: WorkspacePackage): boolean {
  return pkg.directory === "packages" || pkg.directory.startsWith("packages/");
}

/**
 * Check every package against every rule and return all violations.
 *
 * Pure: it takes the workspace as data, so the rule engine can be tested with
 * fabricated packages rather than by breaking the real repository.
 */
export function findBoundaryViolations(
  packages: readonly WorkspacePackage[],
  rules: BoundaryRules,
): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  const adapterPackages = new Set(rules.adapterPackages);
  const appPackageNames = new Set(packages.filter(isAppPackage).map((pkg) => pkg.name));

  for (const pkg of packages) {
    for (const dependency of pkg.dependencies) {
      // Rule 1: no packages/* package may depend on an apps/* package.
      if (isLibraryPackage(pkg) && appPackageNames.has(dependency)) {
        violations.push({
          packageName: pkg.name,
          dependencyName: dependency,
          reason: `${pkg.name} is a library package and must not depend on the application package ${dependency}`,
        });
        continue;
      }

      // Rule 2: adapter-only third-party surfaces.
      const adapterOnly = rules.adapterOnlyDependencies.find((pattern) =>
        matchesPattern(dependency, pattern),
      );
      if (adapterOnly !== undefined && !adapterPackages.has(pkg.name)) {
        violations.push({
          packageName: pkg.name,
          dependencyName: dependency,
          reason: `${dependency} matches the adapter-only pattern "${adapterOnly}"; only an adapter package (${rules.adapterPackages.join(", ")}) may depend on it`,
        });
        continue;
      }

      // Rule 3: explicit per-package bans.
      const forbidden = rules.forbiddenByPackage[pkg.name];
      const banned = forbidden?.find((pattern) => matchesPattern(dependency, pattern));
      if (banned !== undefined) {
        violations.push({
          packageName: pkg.name,
          dependencyName: dependency,
          reason: `${pkg.name} is explicitly forbidden from depending on "${banned}"`,
        });
      }
    }
  }

  return violations;
}

/** Render violations as a readable assertion message. */
export function formatViolations(violations: readonly BoundaryViolation[]): string {
  return violations.map((v) => `  - ${v.reason}`).join("\n");
}
