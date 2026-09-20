import { isPlainObject } from "./json.js";

/**
 * Deep immutability for the harness's contract values (M2-T2, ADR-0032).
 *
 * M2-T2 states the rule as "jobs are immutable after execution begins", and
 * M1 implemented it with `Object.freeze`. `Object.freeze` is **one level
 * deep**: it stops `job.budget = {}` and does nothing at all about
 * `job.budget.maxCostUsd = 1e9`, `job.permissions[0].mode = "write"` or
 * `job.metadata.approved = true`. Those are precisely the mutations that
 * matter, because every one of them silently widens what an execution is
 * allowed to do while the run record still shows the original job.
 *
 * This module is the fix, and it is deliberately the whole of the harness's
 * freezing surface so there is one rule rather than a `freeze` call per field.
 */

/**
 * Freeze `value` and everything JSON-shaped it can reach, returning it.
 *
 * It recurses into **arrays and plain objects only**. Anything else that is an
 * object — a `Date`, a `Map`, a `Set`, a class instance, a typed array, a
 * function — is left exactly as it was found: neither frozen nor walked.
 *
 * That boundary is a decision, not an oversight (ADR-0032). Two reasons:
 *
 * - **Freezing an exotic object mostly does not work.** `Object.freeze(date)`
 *   does not stop `date.setTime()`, and a frozen `Map` still accepts `set()`,
 *   because their state lives in internal slots rather than in properties. The
 *   protection would be advertised and absent.
 * - **Freezing an exotic object can break it.** A class instance that
 *   memoizes into a field, or any object with a lazy getter that caches, stops
 *   working when frozen, and it would stop working at a distance from the code
 *   that froze it.
 *
 * The practical consequence is worth stating plainly: **a job is deeply
 * immutable exactly as far as it is JSON-representable**, which is exactly as
 * far as it is persistable, traceable and replayable. A domain whose input
 * carries a `Date` keeps whatever mutability that `Date` had, and that is one
 * more reason `Job.input` is documented as something JSON should be able to
 * represent.
 *
 * Symbol-keyed properties are not walked. The only one in the harness is
 * `Job`'s phantom output marker, which is `declare`d and never exists at
 * runtime.
 *
 * Freezing is **in place**: the argument is returned, not a copy. A caller that
 * still intends to mutate the value it passed should pass a copy instead.
 *
 * ```ts
 * const job = deepFreeze({ budget: { maxCostUsd: 1 } });
 * job.budget.maxCostUsd = 1e9; // TypeError: every module here is strict
 * ```
 */
export function deepFreeze<T>(value: T): T {
  freezeReachable(value, new WeakSet<object>());

  return value;
}

/**
 * The recursion behind {@link deepFreeze}.
 *
 * `seen` is a cycle guard rather than an optimization. `Object.isFrozen` would
 * be the cheaper test, but it is wrong: an already-frozen object can still hold
 * an unfrozen child, so skipping on it would leave part of the tree mutable.
 */
function freezeReachable(value: unknown, seen: WeakSet<object>): void {
  if (typeof value !== "object" || value === null) {
    return;
  }

  const isArray = Array.isArray(value);

  if (!isArray && !isPlainObject(value)) {
    return;
  }

  if (seen.has(value)) {
    return;
  }

  seen.add(value);
  Object.freeze(value);

  if (isArray) {
    for (const item of value as readonly unknown[]) {
      freezeReachable(item, seen);
    }

    return;
  }

  const record = value as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    freezeReachable(record[key], seen);
  }
}
