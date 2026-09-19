import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ADR-0024 requires every workspace package that declares a framework
 * dependency to carry a co-located test asserting that its pinned version and
 * the installed version agree, and that it declares no `^`/`~` range. This is
 * the same test `packages/runtime-eve/src/index.test.ts` runs; the example
 * agent needs its own because it declares `eve`, `ai` and `zod` itself.
 *
 * It declares them under ADR-0025: an `apps/*` package is a domain consumer,
 * not a harness library, so it may author agents with eve's public surface. It
 * is NOT an adapter, and it may not depend on `@supabase/*`, `@vercel/*` or
 * `workflow`. `tests/architecture/package-boundaries.test.ts` enforces that
 * half; this file enforces the version half.
 *
 * Neither version is written here as a literal, so the test verifies agreement
 * between the manifest and the lockfile rather than restating a constant.
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

/** Every declared dependency of this package, as `[name, range]` pairs. */
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
 *
 * Workspace packages are excluded: they are declared `workspace:*`, which is
 * not a version to pin and resolves to source rather than to a published
 * artefact. ADR-0024 is about third-party framework versions.
 */
const PINNED_DEPENDENCIES = Object.keys(manifest.dependencies ?? {}).filter(
  (name) => !name.startsWith("@internal/"),
);

describe("@internal/example-agent dependency pins", () => {
  it("declares the framework dependencies an authored eve project needs", () => {
    expect(PINNED_DEPENDENCIES.sort()).toEqual(["ai", "eve", "zod"]);
  });

  it("depends on the harness core, which is how the domain definition reaches it", () => {
    expect(manifest.dependencies?.["@internal/core"]).toBe("workspace:*");
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

  it("declares no adapter-only surface that stays adapter-only for apps", () => {
    const forbidden = declaredDependencies(manifest)
      .map(([name]) => name)
      .filter(
        (name) =>
          name === "workflow" || name.startsWith("@supabase/") || name.startsWith("@vercel/"),
      );

    expect(forbidden, "ADR-0025 keeps storage and hosted workflow behind adapters").toEqual([]);
  });
});
