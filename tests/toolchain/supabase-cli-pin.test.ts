import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * ADR-0024 makes exact version pins the rule for framework dependencies and
 * names installed-version assertion tests as the enforcement mechanism.
 * ADR-0033 adds the Supabase CLI to that set: it is installed as a root dev
 * dependency rather than globally, precisely so the version every contributor
 * and CI run uses is the one this repository states.
 *
 * The CLI is declared at the workspace root rather than inside
 * `packages/storage-supabase`, because it is a tool the whole repository drives
 * through `pnpm supabase:*`, not a library that package imports. That is why
 * this test lives here alongside the other root-level toolchain assertions,
 * instead of being co-located the way the two adapter pin tests are.
 *
 * Neither the pinned string nor the installed version is written here as a
 * literal: both are read from disk, so the test proves the manifest and the
 * lockfile agree rather than restating a constant that would need editing on
 * every upgrade.
 */

interface PackageManifest {
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly optionalDependencies?: Record<string, string>;
}

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const require = createRequire(import.meta.url);

function readManifest(path: string): PackageManifest & { readonly version?: string } {
  return JSON.parse(readFileSync(path, "utf8")) as PackageManifest & { version?: string };
}

const rootManifest = readManifest(join(REPO_ROOT, "package.json"));

describe("supabase CLI pin", () => {
  it("is declared as a root dev dependency, not expected on the global PATH", () => {
    expect(Object.keys(rootManifest.devDependencies ?? {})).toContain("supabase");
  });

  it("installs exactly the pinned version", () => {
    const pinned = rootManifest.devDependencies?.supabase;
    const installed = readManifest(require.resolve("supabase/package.json")).version;

    expect(installed).toBe(pinned);
  });

  it("pins the CLI exactly, with no range operator", () => {
    const pinned = rootManifest.devDependencies?.supabase ?? "";

    expect(pinned, `supabase must be an exact pin, got "${pinned}"`).toMatch(
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
    );
  });

  it("declares the four lifecycle scripts the build plan names, wrapping the CLI verbatim", () => {
    const scripts = (
      JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
        scripts?: Record<string, string>;
      }
    ).scripts;

    expect(scripts?.["supabase:start"]).toBe("supabase start");
    expect(scripts?.["supabase:stop"]).toBe("supabase stop");
    expect(scripts?.["supabase:reset"]).toBe("supabase db reset");
    expect(scripts?.["supabase:types"]).toBe(
      "supabase gen types --lang typescript --local > packages/storage-supabase/src/database.types.ts",
    );
  });
});
