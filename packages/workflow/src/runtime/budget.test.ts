import { BudgetExceededError } from "@internal/core";
import { describe, expect, it } from "vitest";
import { createBudgetLedger, narrowBudget } from "./budget.js";

/**
 * The budget ledger (M4-T6's "enforce budget").
 *
 * The property worth pinning down is that a run's budget and an executing
 * node's are both in play at once, and that a node budget measures what that
 * node's execution consumed including anything nested inside it. That is what
 * makes a `map` node's `maxToolCalls` limit the whole fan-out rather than the
 * zero calls the `map` node itself makes.
 */

const START = 1_000;

describe("createBudgetLedger", () => {
  it("reports nothing consumed at the start, with cost absent rather than zero", () => {
    expect(createBudgetLedger({}, START).totals()).toEqual({
      modelCalls: 0,
      toolCalls: 0,
      costUsd: null,
    });
  });

  it("accumulates charges against the run", () => {
    const ledger = createBudgetLedger({}, START);

    ledger.chargeModelCalls(2);
    ledger.chargeToolCalls(3);
    ledger.chargeCost(0.25);

    expect(ledger.totals()).toEqual({ modelCalls: 2, toolCalls: 3, costUsd: 0.25 });
  });

  it("throws when a run limit is passed, naming the dimension", () => {
    const ledger = createBudgetLedger({ maxToolCalls: 2 }, START);

    ledger.chargeToolCalls(2);

    expect(() => ledger.chargeToolCalls(1)).toThrow(BudgetExceededError);

    try {
      createBudgetLedger({ maxModelCalls: 0 }, START).chargeModelCalls(1);
      expect.unreachable();
    } catch (cause) {
      expect(cause).toBeInstanceOf(BudgetExceededError);
      expect((cause as BudgetExceededError).dimension).toBe("maxModelCalls");
      expect((cause as BudgetExceededError).limit).toBe(0);
      expect((cause as BudgetExceededError).actual).toBe(1);
    }
  });

  it("charges every open scope, so a node budget can bite while the run's does not", () => {
    const ledger = createBudgetLedger({}, START);

    ledger.enter({ maxToolCalls: 1 }, START);
    ledger.chargeToolCalls(1);

    expect(() => ledger.chargeToolCalls(1)).toThrow(BudgetExceededError);

    ledger.exit();

    // The run scope kept both charges; only the node scope ran out.
    expect(ledger.totals().toolCalls).toBe(2);
    expect(() => ledger.chargeToolCalls(10)).not.toThrow();
  });

  it("nests scopes, so a container's budget covers what its children spend", () => {
    const ledger = createBudgetLedger({}, START);

    ledger.enter({ maxToolCalls: 3 }, START);
    ledger.enter({}, START);
    ledger.chargeToolCalls(3);
    ledger.exit();

    expect(() => ledger.chargeToolCalls(1)).toThrow(BudgetExceededError);
  });

  it("checks duration at a boundary rather than interrupting", () => {
    const ledger = createBudgetLedger({ maxDurationMs: 100 }, START);

    expect(() => ledger.checkDuration(START + 100)).not.toThrow();
    expect(() => ledger.checkDuration(START + 101)).toThrow(BudgetExceededError);
  });

  it("checks a node scope's duration from when that scope opened", () => {
    const ledger = createBudgetLedger({}, START);

    ledger.enter({ maxDurationMs: 10 }, START + 1_000);

    expect(() => ledger.checkDuration(START + 1_005)).not.toThrow();
    expect(() => ledger.checkDuration(START + 1_020)).toThrow(BudgetExceededError);
  });

  it("never pops the run scope, whatever a mismatched exit does", () => {
    const ledger = createBudgetLedger({ maxToolCalls: 1 }, START);

    ledger.exit();
    ledger.exit();
    ledger.chargeToolCalls(1);

    expect(() => ledger.chargeToolCalls(1)).toThrow(BudgetExceededError);
  });

  it("reports what is left of the run's budget, keeping an absent dimension absent", () => {
    const ledger = createBudgetLedger({ maxToolCalls: 5, maxDurationMs: 1_000 }, START);

    ledger.chargeToolCalls(2);

    expect(ledger.remaining(START + 400)).toEqual({ maxToolCalls: 3, maxDurationMs: 600 });
  });

  it("floors a remaining dimension at zero rather than reporting a negative budget", () => {
    const ledger = createBudgetLedger({ maxDurationMs: 100 }, START);

    expect(ledger.remaining(START + 500)).toEqual({ maxDurationMs: 0 });
  });
});

describe("narrowBudget", () => {
  it("takes the tighter of two limits, dimension by dimension", () => {
    expect(
      narrowBudget({ maxToolCalls: 10, maxCostUsd: 1 }, { maxToolCalls: 3, maxModelCalls: 2 }),
    ).toEqual({ maxCostUsd: 1, maxModelCalls: 2, maxToolCalls: 3 });
  });

  it("leaves a dimension neither side limits absent, because absent means unlimited", () => {
    expect(narrowBudget({}, {})).toEqual({});
  });

  it("takes the one limit that exists when only one side sets it", () => {
    expect(narrowBudget({ maxDurationMs: 50 }, {})).toEqual({ maxDurationMs: 50 });
    expect(narrowBudget({}, { maxDurationMs: 50 })).toEqual({ maxDurationMs: 50 });
  });
});
