import { defineAgent } from "eve";

/**
 * Runtime configuration for the vendor-triage example agent.
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
 * Nothing executes this agent yet. `createHarness()` is M1-T4, and Milestone 1's
 * acceptance criterion is that the example calls the harness API rather than the
 * `eve` runtime directly (ADR-0025).
 */
export default defineAgent({
  model: process.env.EXAMPLE_AGENT_MODEL ?? "openai/gpt-5.6-luna-fast",
});
