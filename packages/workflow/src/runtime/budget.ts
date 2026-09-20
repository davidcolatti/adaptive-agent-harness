import type { Budget, BudgetDimension } from "@internal/core";
import { BudgetExceededError } from "@internal/core";

/**
 * Budget enforcement for a workflow run (M4-T6, "enforce budget").
 *
 * A run has **two** budgets in play at once and both must hold: the run's own
 * (`ExecutionContext.budget`, which came from the job) and the executing node's
 * (`WorkflowNodeBase.budget`, which "may be `{}`, meaning no node-level limit"
 * and "can only narrow" the run's — `docs/contracts/workflow-ir.md`). A node
 * inside a `chain`, a `map` body or a `loop` body has its container's budget in
 * play as well, which is why this is a **stack** of scopes rather than a pair of
 * counters.
 *
 * Every charge is applied to every open scope and then checked against every
 * open scope, so a node budget measures what that node's execution consumed
 * *including* anything nested inside it. That is the reading that makes a
 * container's budget mean something: a `map` with `maxToolCalls: 10` limits the
 * whole fan-out, not the zero calls the `map` node itself makes.
 *
 * Duration is the one dimension that is checked rather than interrupted. The
 * hard, interrupting deadline on a node is its `timeoutMs` (M4-T6 lists
 * "enforce timeout" separately), and `maxDurationMs` is checked at every node
 * boundary and at every charge. A workflow whose budget expires mid-node
 * therefore stops at the end of that node rather than halfway through it, which
 * is the honest behaviour for a runtime that cannot interrupt a handler it did
 * not write. ADR-0040 records this.
 */

/** One level of the budget stack: the run, or an executing node. */
interface BudgetScope {
  /** What this level limits. An absent dimension is unlimited. */
  readonly budget: Budget;
  /** When this level started, for `maxDurationMs`. */
  readonly startedAtMs: number;
  /** Model calls charged to this level so far. */
  modelCalls: number;
  /** Tool calls charged to this level so far. */
  toolCalls: number;
  /** Spend charged to this level so far, in US dollars. */
  costUsd: number;
}

/** What a run has consumed, in the four dimensions {@link Budget} limits. */
export interface BudgetTotals {
  /** Model calls made so far. */
  readonly modelCalls: number;
  /** Tool calls made so far. */
  readonly toolCalls: number;
  /**
   * Spend so far, or `null` when nothing reported any.
   *
   * `null` rather than `0`, for the reason `AgentExecutionUsage.costUsd` is
   * optional: a local handler and a mock model genuinely have no cost, and
   * reporting `0` would turn "unknown" into a measurement.
   */
  readonly costUsd: number | null;
}

/** The budget ledger for one run. */
export interface BudgetLedger {
  /** What the run has consumed so far, across every scope. */
  totals(): BudgetTotals;
  /** Charge `count` model calls to every open scope. */
  chargeModelCalls(count: number): void;
  /** Charge `count` tool calls to every open scope. */
  chargeToolCalls(count: number): void;
  /** Charge `usd` of spend to every open scope. */
  chargeCost(usd: number): void;
  /** Check every open scope's `maxDurationMs` against `nowMs`. */
  checkDuration(nowMs: number): void;
  /** Open a nested scope for a node's budget. Always paired with {@link exit}. */
  enter(budget: Budget, nowMs: number): void;
  /** Close the innermost scope opened by {@link enter}. */
  exit(): void;
  /** What is left of the **run's** budget, for a fallback envelope or a derived context. */
  remaining(nowMs: number): Budget;
}

/** Throw the one error a budget failure is ever reported as. */
function exceeded(dimension: BudgetDimension, limit: number, actual: number): never {
  throw new BudgetExceededError(
    `workflow: the run exceeded its \`${dimension}\` budget of ${limit} (reached ${actual})`,
    { dimension, limit, actual },
  );
}

/**
 * Create a {@link BudgetLedger} for one run.
 *
 * `runBudget` is the run's own limit, normally `ExecutionContext.budget`. The
 * run scope is never popped; {@link BudgetLedger.enter} and
 * {@link BudgetLedger.exit} manage node scopes above it.
 */
export function createBudgetLedger(runBudget: Budget, startedAtMs: number): BudgetLedger {
  const root: BudgetScope = {
    budget: runBudget,
    startedAtMs,
    modelCalls: 0,
    toolCalls: 0,
    costUsd: 0,
  };
  const scopes: BudgetScope[] = [root];
  let costReported = false;

  const check = (scope: BudgetScope): void => {
    const { budget } = scope;

    if (budget.maxModelCalls !== undefined && scope.modelCalls > budget.maxModelCalls) {
      exceeded("maxModelCalls", budget.maxModelCalls, scope.modelCalls);
    }

    if (budget.maxToolCalls !== undefined && scope.toolCalls > budget.maxToolCalls) {
      exceeded("maxToolCalls", budget.maxToolCalls, scope.toolCalls);
    }

    if (budget.maxCostUsd !== undefined && scope.costUsd > budget.maxCostUsd) {
      exceeded("maxCostUsd", budget.maxCostUsd, scope.costUsd);
    }
  };

  const charge = (apply: (scope: BudgetScope) => void): void => {
    for (const scope of scopes) {
      apply(scope);
    }

    // Applied to every scope before any is checked, so that a failure leaves
    // the ledger consistent: the call *did* happen, and every level has to
    // account for it whichever level ran out first.
    for (const scope of scopes) {
      check(scope);
    }
  };

  return {
    totals(): BudgetTotals {
      return {
        modelCalls: root.modelCalls,
        toolCalls: root.toolCalls,
        costUsd: costReported ? root.costUsd : null,
      };
    },

    chargeModelCalls(count: number): void {
      charge((scope) => {
        scope.modelCalls += count;
      });
    },

    chargeToolCalls(count: number): void {
      charge((scope) => {
        scope.toolCalls += count;
      });
    },

    chargeCost(usd: number): void {
      costReported = true;
      charge((scope) => {
        scope.costUsd += usd;
      });
    },

    checkDuration(nowMs: number): void {
      for (const scope of scopes) {
        const limit = scope.budget.maxDurationMs;

        if (limit === undefined) {
          continue;
        }

        const elapsed = nowMs - scope.startedAtMs;

        if (elapsed > limit) {
          exceeded("maxDurationMs", limit, elapsed);
        }
      }
    },

    enter(budget: Budget, nowMs: number): void {
      scopes.push({ budget, startedAtMs: nowMs, modelCalls: 0, toolCalls: 0, costUsd: 0 });
    },

    exit(): void {
      // The run scope is the floor: a mismatched `exit()` must not leave the
      // ledger with nothing to charge against.
      if (scopes.length > 1) {
        scopes.pop();
      }
    },

    remaining(nowMs: number): Budget {
      const { budget } = root;
      const left = (limit: number | undefined, used: number): number | undefined =>
        limit === undefined ? undefined : Math.max(0, limit - used);

      const maxCostUsd = left(budget.maxCostUsd, root.costUsd);
      const maxDurationMs = left(budget.maxDurationMs, nowMs - root.startedAtMs);
      const maxModelCalls = left(budget.maxModelCalls, root.modelCalls);
      const maxToolCalls = left(budget.maxToolCalls, root.toolCalls);

      // An absent dimension stays absent, because absent means unlimited and
      // writing a number there would invent a limit the job never set.
      return {
        ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
        ...(maxDurationMs === undefined ? {} : { maxDurationMs }),
        ...(maxModelCalls === undefined ? {} : { maxModelCalls }),
        ...(maxToolCalls === undefined ? {} : { maxToolCalls }),
      };
    },
  };
}

/**
 * The tighter of two budgets, dimension by dimension.
 *
 * Used to build an `agent` node's derived context: the node's budget "can only
 * narrow" the run's, so what the sub-agent is given is the minimum of what the
 * node declared and what the run has left. A dimension neither side limits stays
 * absent.
 */
export function narrowBudget(outer: Budget, inner: Budget): Budget {
  const tighter = (a: number | undefined, b: number | undefined): number | undefined => {
    if (a === undefined) {
      return b;
    }

    return b === undefined ? a : Math.min(a, b);
  };

  const maxCostUsd = tighter(outer.maxCostUsd, inner.maxCostUsd);
  const maxDurationMs = tighter(outer.maxDurationMs, inner.maxDurationMs);
  const maxModelCalls = tighter(outer.maxModelCalls, inner.maxModelCalls);
  const maxToolCalls = tighter(outer.maxToolCalls, inner.maxToolCalls);

  return {
    ...(maxCostUsd === undefined ? {} : { maxCostUsd }),
    ...(maxDurationMs === undefined ? {} : { maxDurationMs }),
    ...(maxModelCalls === undefined ? {} : { maxModelCalls }),
    ...(maxToolCalls === undefined ? {} : { maxToolCalls }),
  };
}
