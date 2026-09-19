import { createFakeClock } from "@internal/testing";
import { describe, expect, it } from "vitest";

/**
 * The repository resolves workspace packages to their TypeScript sources
 * through a project-owned `"@internal/source"` export condition, so that
 * typechecking and tests never require a prior `pnpm build`. That contract is
 * spread across three files (each package's `exports` map, each typecheck
 * tsconfig's `customConditions`, and `vitest.config.ts`), so it is asserted
 * here rather than left to break silently in a later milestone.
 */
describe("@internal/source export condition", () => {
  it("resolves a workspace package to its TypeScript source, not to dist", () => {
    const resolved = import.meta.resolve("@internal/testing");

    expect(resolved).toMatch(/\/packages\/testing\/src\/index\.ts$/);
    expect(resolved).not.toContain("/dist/");
  });

  it("imports a working implementation across the package boundary", () => {
    const clock = createFakeClock({ start: new Date("2026-01-01T00:00:00.000Z") });
    clock.advance(1000);

    expect(clock.isoNow()).toBe("2026-01-01T00:00:01.000Z");
  });
});
