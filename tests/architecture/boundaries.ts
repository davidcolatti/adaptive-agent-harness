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
   * Adapter-only surfaces that an application package (`apps/*`) may
   * nevertheless depend on, as an explicit allowlist.
   *
   * ADR-0025: an `apps/*` package is a domain consumer, not a harness library.
   * The build plan's dependency diagram puts `apps/* / consuming domains` above
   * `core`, and a real domain repository is an `eve` project, so an example
   * domain must be able to author agents with `eve`'s public surface. Anything
   * in {@link BoundaryRules.adapterOnlyDependencies} that is NOT listed here
   * stays adapter-only for app packages too: storage and hosted workflow are
   * reached through harness adapters by everyone.
   *
   * This does not relax the rule for any `packages/*` package.
   */
  readonly appPackagesMayDependOn: readonly DependencyPattern[];
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
  // Adapter packages. `@internal/runtime-eve` and `@internal/runtime-ai-sdk`
  // exist as of M1-T1, which installed `eve` and `ai` behind them. The
  // remaining four are still planned: `@internal/decision-jev` (M3),
  // `@internal/storage-supabase` (M2), and the two Vercel ones (M11). All were
  // listed ahead of time so an adapter milestone edits this table deliberately
  // rather than in a hurry.
  adapterPackages: [
    "@internal/runtime-eve",
    "@internal/decision-jev",
    "@internal/storage-supabase",
    "@internal/runtime-ai-sdk",
    "@internal/workflow-vercel",
    "@internal/sandbox-vercel",
  ],
  // ADR-0025: application packages author eve agents directly, so `eve` and the
  // AI SDK authoring surface it exposes are allowed under `apps/*`. `@supabase/*`,
  // `@vercel/*` and `workflow` are deliberately absent: they remain adapter-only
  // for apps as well. Execution still goes through the harness API rather than
  // the `eve` runtime, which M1-T4 enforces once `createHarness()` exists.
  appPackagesMayDependOn: ["eve", "ai", "@ai-sdk/*"],
  forbiddenByPackage: {
    // "core cannot import domain code / eve / Supabase" (build plan section 4).
    // The adapter rule already bans these for every non-adapter package; the
    // entry is kept explicit because core is the boundary the plan names.
    "@internal/core": ["eve", "@supabase/*", "ai", "@ai-sdk/*", "workflow", "@vercel/*"],
    // `@internal/trace` (M2-T4) sits directly under `core` in the dependency
    // diagram, beside the runtime adapters and above storage. It is **not** an
    // adapter: it owns buffering and ordering, and the storage medium lives
    // behind its own `TraceSink`, so the same bans core carries apply here.
    // When M2-T5 adds a Supabase sink, that sink belongs in
    // `@internal/storage-supabase`, which is already a declared adapter.
    "@internal/trace": ["eve", "@supabase/*", "ai", "@ai-sdk/*", "workflow", "@vercel/*"],
    // `@internal/observability` (M2-T10) is the run inspector and the CLI that
    // fronts it. It is **not** an adapter: `inspectRun()` reads the `Storage`
    // port, so it carries the same bans core does. It does depend on
    // `@internal/storage-supabase`, which is a workspace package rather than an
    // adapter-only third-party surface, and only from its `bin` entry point —
    // that is how the CLI reaches a real database without becoming the second
    // place in the repository that talks to one. ADR-0037 records it.
    "@internal/observability": ["eve", "@supabase/*", "ai", "@ai-sdk/*", "workflow", "@vercel/*"],
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

      // Rule 2: adapter-only third-party surfaces. A declared adapter may
      // depend on all of them; an application package may depend on the
      // explicitly allowlisted subset (ADR-0025); every other package may
      // depend on none of them.
      const adapterOnly = rules.adapterOnlyDependencies.find((pattern) =>
        matchesPattern(dependency, pattern),
      );
      const allowedForApp =
        isAppPackage(pkg) &&
        rules.appPackagesMayDependOn.some((pattern) => matchesPattern(dependency, pattern));
      if (adapterOnly !== undefined && !allowedForApp && !adapterPackages.has(pkg.name)) {
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
