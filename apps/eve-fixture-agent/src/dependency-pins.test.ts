import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ADR-0024 requires every workspace package that declares a framework
 * dependency to carry a co-located test asserting that its pinned version and
 * the installed version agree, and that it declares no `^`/`~` range. The
 * fixture agent declares `eve`, `ai` and `zod` itself, because an eve app root
 * only becomes a project once `eve` appears in its own manifest (research note
 * §15.1), so it needs the same test `apps/example-agent` has.
 *
 * It declares them under ADR-0025: an `apps/*` package is a domain consumer and
 * may author agents with eve's public surface. It is not an adapter, so
 * `@supabase/*`, `@vercel/*` and `workflow` stay out of reach.
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

const PINNED_DEPENDENCIES = Object.keys(manifest.dependencies ?? {}).filter(
  (name) => !name.startsWith("@internal/"),
);

describe("@internal/eve-fixture-agent dependency pins", () => {
  it("declares the framework dependencies an authored eve project needs", () => {
    expect(PINNED_DEPENDENCIES.sort()).toEqual(["ai", "eve", "zod"]);
  });

  it("does not depend on the harness, because a fixture agent is a domain, not a caller", () => {
    expect(Object.keys(manifest.dependencies ?? {})).not.toContain("@internal/core");
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
