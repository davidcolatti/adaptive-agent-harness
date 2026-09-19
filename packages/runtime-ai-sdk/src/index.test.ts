import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ADR-0024 makes exact version pins the rule for framework dependencies and
 * names these tests as the enforcement mechanism. The pinned string and the
 * version actually resolved from `node_modules` are both read from disk, so a
 * drifting lockfile or a hand-loosened range fails here rather than silently
 * changing which framework version the adapter is written against.
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

/** The third-party dependencies whose installed version this package pins. */
const PINNED_DEPENDENCIES = Object.keys(manifest.dependencies ?? {});

describe("@internal/runtime-ai-sdk dependency pins", () => {
  it("declares the framework dependencies the adapter is built on", () => {
    expect(PINNED_DEPENDENCIES.sort()).toEqual(["ai", "zod"]);
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
