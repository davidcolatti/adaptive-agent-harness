import { describe, expect, it } from "vitest";
import { createFakeClock } from "./clock.js";

const START = new Date("2026-01-02T03:04:05.000Z");

describe("createFakeClock", () => {
  it("starts at the requested instant", () => {
    const clock = createFakeClock({ start: START });

    expect(clock.now().toISOString()).toBe("2026-01-02T03:04:05.000Z");
    expect(clock.isoNow()).toBe("2026-01-02T03:04:05.000Z");
  });

  it("only moves when advanced", () => {
    const clock = createFakeClock({ start: START });
    const before = clock.isoNow();

    expect(clock.isoNow()).toBe(before);

    clock.advance(1500);

    expect(clock.isoNow()).toBe("2026-01-02T03:04:06.500Z");
  });

  it("accumulates successive advances", () => {
    const clock = createFakeClock({ start: START });

    clock.advance(1000);
    clock.advance(2000);

    expect(clock.now().getTime() - START.getTime()).toBe(3000);
  });

  it("returns a fresh Date so callers cannot mutate the clock", () => {
    const clock = createFakeClock({ start: START });
    const first = clock.now();
    first.setFullYear(1999);

    expect(clock.now().getUTCFullYear()).toBe(2026);
  });

  it("rejects an invalid start date", () => {
    expect(() => createFakeClock({ start: new Date("not a date") })).toThrow(RangeError);
  });

  it("rejects a negative or non-finite advance", () => {
    const clock = createFakeClock({ start: START });

    expect(() => clock.advance(-1)).toThrow(RangeError);
    expect(() => clock.advance(Number.NaN)).toThrow(RangeError);
    expect(clock.isoNow()).toBe("2026-01-02T03:04:05.000Z");
  });
});
