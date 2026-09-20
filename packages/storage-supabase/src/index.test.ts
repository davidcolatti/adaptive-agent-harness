import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ADR-0024 makes exact version pins the rule for framework dependencies and
 * names these tests as the enforcement mechanism. `@supabase/supabase-js` is
 * the framework dependency of this adapter, added by M2-T5, and it is pinned
 * here rather than at the root because it is a library this package imports
 * rather than a tool the repository drives — the same distinction ADR-0033
 * draws for the Supabase **CLI**, which is pinned at the root and is a
 * different package that merely shares a version series.
 *
 * Neither the pinned string nor the installed version is a literal here: both
 * are read from disk, so the test proves the manifest and the lockfile agree
 * rather than restating a constant that would need editing on every upgrade.
 */

interface PackageManifest {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);

function readManifest(path: string): PackageManifest & { readonly version?: string } {
  return JSON.parse(readFileSync(path, "utf8")) as PackageManifest & { version?: string };
}

const manifest = readManifest(join(PACKAGE_ROOT, "package.json"));

function declaredDependencies(pkg: PackageManifest): [string, string][] {
  return Object.entries({
    ...pkg.dependencies,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
    ...pkg.optionalDependencies,
  });
}

/**
 * The third-party dependencies whose installed version this package pins.
 * Workspace packages are excluded: `workspace:*` is not a version to pin.
 */
const PINNED_DEPENDENCIES = Object.keys(manifest.dependencies ?? {}).filter(
  (name) => !name.startsWith("@internal/"),
);

describe("@internal/storage-supabase dependency pins", () => {
  it("declares the one framework dependency the adapter is built on", () => {
    expect(PINNED_DEPENDENCIES.sort()).toEqual(["@supabase/supabase-js"]);
  });

  it("depends on the harness core, which is the port the adapter implements", () => {
    expect(manifest.dependencies?.["@internal/core"]).toBe("workspace:*");
  });

  it("depends on @internal/trace, which is where redaction lives", () => {
    // The dependency rule (build plan section 4) puts storage under trace, so
    // this direction is the one the diagram draws. The adapter needs it because
    // it is the last code before persistence and redacts what it writes,
    // including the run row's error, which no writer chain reaches.
    expect(manifest.dependencies?.["@internal/trace"]).toBe("workspace:*");
  });

  it.each(PINNED_DEPENDENCIES)("installs exactly the pinned version of %s", (name) => {
    const pinned = manifest.dependencies?.[name];
    const installed = readManifest(require.resolve(`${name}/package.json`)).version;

    expect(installed).toBe(pinned);
  });

  it("declares no caret or tilde ranges", () => {
    const ranged = declaredDependencies(manifest).filter(
      ([, range]) => range.startsWith("^") || range.startsWith("~"),
    );

    expect(ranged, `Ranged dependencies must be exact pins: ${JSON.stringify(ranged)}`).toEqual([]);
  });
});
