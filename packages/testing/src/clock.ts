/**
 * A deterministic, manually advanced time source.
 *
 * Trace events, run ledgers and replay fixtures are all timestamped, so tests
 * that assert on them need time they control rather than wall-clock time.
 */
export interface FakeClock {
  /** The current instant as a `Date`. A fresh object on every call. */
  now(): Date;
  /** Move the clock forward by `ms` milliseconds. Must not be negative. */
  advance(ms: number): void;
  /** The current instant as an ISO 8601 string, the trace timestamp format. */
  isoNow(): string;
}

export interface CreateFakeClockOptions {
  /** The instant the clock starts at. */
  start: Date;
}

/**
 * Create a {@link FakeClock} that starts at `start` and only moves when
 * {@link FakeClock.advance} is called.
 *
 * @throws RangeError if `start` is an invalid date, or if `advance` is called
 * with a value that is not a finite, non-negative number.
 */
export function createFakeClock({ start }: CreateFakeClockOptions): FakeClock {
  const startMs = start.getTime();
  if (Number.isNaN(startMs)) {
    throw new RangeError("createFakeClock: `start` must be a valid Date");
  }

  let currentMs = startMs;

  return {
    now(): Date {
      return new Date(currentMs);
    },
    advance(ms: number): void {
      if (!Number.isFinite(ms) || ms < 0) {
        throw new RangeError(
          `createFakeClock: advance() requires a finite, non-negative number of milliseconds, received ${ms}`,
        );
      }
      currentMs += ms;
    },
    isoNow(): string {
      return new Date(currentMs).toISOString();
    },
  };
}
