import { defineAgent } from "eve";
import { EXAMPLE_AGENT_CONFIG } from "./lib/agent-config.js";

/**
 * Runtime configuration for the vendor-triage example agent.
 *
 * **The configuration itself lives in `agent/lib/agent-config.ts`** (M2-T8).
 * It is one constant so that this file and `src/behavior.ts`, which hashes the
 * model configuration into the run's behavior fingerprint, cannot disagree
 * about what the agent is configured with. `agent/lib/` is eve's documented
 * import-only slot for shared authored code
 * (`eve/docs/reference/agent-files.md`). Everything below still describes what
 * that constant sets and why.
 *
 * `agent.ts` is optional in `eve`, but `model` is required once the file exists
 * (`eve/docs/agent-config.md`, "Set the model"). `model` accepts an AI Gateway
 * model id string or a provider-authored `LanguageModel`
 * (`eve/dist/src/shared/agent-definition.d.ts`: `PublicAgentStaticModelDefinition
 * = string | LanguageModel`). A Gateway id string is the minimal documented
 * configuration and needs no provider package, because `@ai-sdk/gateway` is
 * already a dependency of `ai`.
 *
 * The id is read from `EXAMPLE_AGENT_MODEL` so a developer can point the example
 * at whichever model their credentials cover, without editing source. The
 * fallback is eve's own documented default for a scaffolded project. No
 * credential is read here and none is committed: the Gateway authenticates with
 * OIDC or `AI_GATEWAY_API_KEY` from the environment. See `.env.example`.
 *
 * Note for anyone running `eve set --model`: that command cannot rewrite a model
 * defined with an environment expression (`eve/docs/reference/cli.md`, "Set
 * model settings"). Change the environment variable, or edit the fallback here.
 *
 * `pnpm example:run` executes this agent through the harness API, never through
 * the `eve` runtime directly (ADR-0025). It needs an AI Gateway credential; the
 * credential-free demonstration is `pnpm example:run:mock`, which runs the same
 * script against `apps/eve-fixture-agent`.
 *
 * ## Why `defaultTools: false`
 *
 * M1-T6 shrank this agent to exactly the capability it needs.
 * `defaultTools: false` removes all eight optional default tools in one line
 * (`eve/docs/concepts/built-in-tools.md`, "Disable optional default tools"),
 * and `agent/tools/load_skill.ts` adds back the only one this agent uses. What
 * that removes, beyond the `web_search` and `web_fetch` M1-T2 had already
 * disabled by file: `bash`, `read_file`, `write_file`, `todo`, `ask_question`,
 * `task_cancel`, and `agent`.
 *
 * `agent` is the one worth naming. It is root-only and enabled by default even
 * with no subagent declared, and the model calling it spawns a second full copy
 * of this agent in its own durable session with its own sandbox and its own
 * model spend (`eve/docs/subagents/index.mdx`). That child's events are on a
 * different stream, so `EveAgentRuntime` would neither count its usage nor
 * police its tool calls. Removing it is what makes the harness's accounting
 * true rather than approximate.
 */
export default defineAgent(EXAMPLE_AGENT_CONFIG);
