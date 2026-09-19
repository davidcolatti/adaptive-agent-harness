import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";
import { z } from "zod";

/**
 * The fixture's ordinary, granted tool.
 *
 * It echoes its input and optionally sleeps first. Echoing is what makes the
 * tool-call round trip observable from the harness side: the call shows up as
 * `actions.requested` and its return as `action.result`, which is what
 * `EveAgentRuntime`'s `toolCalls` count and its permission check both read.
 * Sleeping is what makes a turn genuinely in flight, so a cancellation test has
 * something to interrupt; the research note's spike found that cancelling a turn
 * an instant mock model has already finished reports `"accepted"` and then
 * completes normally, so a `turn.cancelled` assertion needs a slow tool.
 *
 * The tool's model-facing name is its filename, `echo_fixture`; authored
 * definitions carry no `name` because eve derives identity from the path.
 */
export default defineTool({
  description:
    "Echo a token back, optionally after a delay. Deterministic fixture tool with no side effects.",
  inputSchema: z.object({
    token: z.string().describe("Any string. It is returned unchanged."),
    delayMs: z
      .number()
      .optional()
      .describe("Milliseconds to wait before returning. Used to keep a turn in flight."),
  }),
  async execute({ token, delayMs }) {
    if (delayMs !== undefined && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    return { echoed: token, at: "eve-fixture-agent" };
  },
  approval: never(),
});
