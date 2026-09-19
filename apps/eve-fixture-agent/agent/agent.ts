import { defineAgent } from "eve";
import { mockModel } from "eve/evals";
import { type FixtureJsonValue, valueForJsonSchema } from "./lib/json-schema-value.js";

/**
 * The harness's credential-free `eve` fixture agent.
 *
 * It exists so `EveAgentRuntime` can be exercised end to end, over a real HTTP
 * surface, with a real durable session, and **no model provider**. `mockModel`
 * is eve's own documented test double for exactly this
 * (`eve/docs/evals/overview.mdx`, "Deterministic fixture models"): it returns an
 * AI SDK `LanguageModel`, so it slots straight into `defineAgent({ model })`,
 * and "because the model is part of the agent definition, use it for a
 * dedicated fixture agent" — which is why this is its own app root rather than
 * a mode of `apps/example-agent`.
 *
 * Two things the installed docs do not state, both found by execution and
 * recorded in `docs/research/vercel/2026-09-19-m1-eve-programmatic-execution.md`:
 *
 * - **An app root needs its own `package.json` declaring `eve`** (§15.1). An
 *   `agent/` directory that is not a package root is invisible to eve.
 * - **`modelContextWindowTokens` is required with a mock model** (§15.2). eve
 *   resolves a context window from the AI Gateway catalog to compile
 *   compaction, a mock is not in the catalog, and the documented one-line
 *   `defineAgent({ model: mockModel(...) })` therefore fails to compile with
 *   `does not have known AI Gateway context window metadata`. The field exists
 *   on `PublicAgentDefinition` (`eve/dist/src/shared/agent-definition.d.ts`)
 *   but is absent from `agent-config.md`'s field table.
 *
 * ## The script
 *
 * The responder is keyed on markers anywhere in the prompt, so a caller picks a
 * path by putting one in `job.objective`. Every path is deterministic.
 *
 * | Marker in the prompt | What the model does |
 * | --- | --- |
 * | `FIXTURE_TOOLCALL` | calls `echo_fixture` once, then continues |
 * | `FIXTURE_FORBIDDEN` | calls `forbidden_tool` once, to exercise permission denial |
 * | `FIXTURE_SLOW` | calls `echo_fixture` with a long delay, to exercise cancellation and budgets |
 *
 * Then, whatever the marker was:
 *
 * - if the turn requested an `outputSchema`, it calls the structured-output
 *   tool with a value built from that schema;
 * - otherwise it replies with plain text.
 *
 * **The marker paths run first, and the structured branch last.**
 * `EveAgentRuntime` always sends an `outputSchema`, so a structured-first
 * responder would settle every turn before any tool was called and no
 * tool-call, permission or cancellation path would ever be reachable.
 *
 * Markers are matched against the whole prompt rather than only
 * `lastUserMessage`, so a caller can put one in the objective or in the
 * `clientContext` the harness sends alongside it.
 *
 * ## Why the structured tool is found by elimination
 *
 * A turn with an `outputSchema` is served by a synthetic tool eve adds to the
 * model's tool list, whose `inputSchema` is the lowered JSON Schema. Its name is
 * an eve internal: it appears in no document and no declaration file, so the
 * source-of-truth protocol §2 forbids depending on it. The fixture therefore
 * finds it by eliminating its own authored tools, which needs no internal name
 * and keeps working if eve renames it.
 */

/** The tools this fixture authors. Anything else offered is framework-owned. */
const AUTHORED_TOOLS = new Set(["echo_fixture", "forbidden_tool"]);

/** How long the `FIXTURE_SLOW` path asks `echo_fixture` to sleep. */
const SLOW_TOOL_DELAY_MS = 30_000;

export default defineAgent({
  // Removes all eight optional defaults in one line, including `bash`,
  // `write_file` and the subagent-spawning `agent`
  // (`eve/docs/concepts/built-in-tools.md`). This fixture needs a sandbox, file
  // access, a human question and delegation exactly never.
  defaultTools: false,
  modelContextWindowTokens: 128_000,
  model: mockModel({
    modelId: "harness-fixture",
    provider: "adaptive-agent-harness",
    respond: (request) => {
      const prompt = request.messages.map((message) => message.text).join("\n");
      const called = new Set(request.toolResults.map((result) => result.name));

      if (prompt.includes("FIXTURE_FORBIDDEN") && !called.has("forbidden_tool")) {
        return { toolCalls: [{ name: "forbidden_tool", input: { reason: "fixture" } }] };
      }

      if (prompt.includes("FIXTURE_SLOW") && !called.has("echo_fixture")) {
        return {
          toolCalls: [
            { name: "echo_fixture", input: { token: "slow", delayMs: SLOW_TOOL_DELAY_MS } },
          ],
        };
      }

      if (prompt.includes("FIXTURE_TOOLCALL") && !called.has("echo_fixture")) {
        return { toolCalls: [{ name: "echo_fixture", input: { token: "fixture-42" } }] };
      }

      const structured = request.tools.find((tool) => !AUTHORED_TOOLS.has(tool.name));

      if (structured !== undefined && !called.has(structured.name)) {
        const value: FixtureJsonValue = valueForJsonSchema(structured.inputSchema);
        return { toolCalls: [{ name: structured.name, input: value }] };
      }

      return "Hello from the eve fixture agent.";
    },
  }),
});
