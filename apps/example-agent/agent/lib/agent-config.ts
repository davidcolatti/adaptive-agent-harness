/**
 * The vendor-triage agent's runtime configuration, as one plain constant.
 *
 * **Why it is not written inline in `agent/agent.ts`.** M2-T8's behavior
 * fingerprint has to hash the model configuration, and the harness cannot read
 * it: `EveAgentRuntime` is a URL-only client that never sees an agent's files
 * (ADR-0028), so `src/behavior.ts` has to state it. If it stated it separately
 * the two would drift, and a drifted fingerprint is worse than no fingerprint
 * — it would keep reporting the old model after someone changed the real one.
 * So there is one constant, `agent/agent.ts` passes it to `defineAgent`, and
 * `src/behavior.ts` hashes it.
 *
 * `agent/lib/` is the documented slot for exactly this: eve's
 * `docs/reference/agent-files.md` lists it as "Shared authored helper code …
 * Import-only; not copied into the sandbox", and `agent/lib/vendor-evidence.ts`
 * is already imported from `src/` the same way.
 *
 * **Everything here is a JSON value**, because it is hashed as one. A
 * credential is not, and never appears: the AI Gateway authenticates from the
 * environment (`AI_GATEWAY_API_KEY` or OIDC), and nothing about a credential
 * changes behavior.
 *
 * The model id is read from `EXAMPLE_AGENT_MODEL` so a developer can point the
 * example at whichever model their credentials cover, without editing source.
 * That means the behavior fingerprint moves when the environment variable
 * moves, which is correct: a different model is different behavior, and a run
 * that used one must not compare equal to a run that used the other.
 */
export const EXAMPLE_AGENT_CONFIG = {
  /**
   * Remove all eight optional default tools in one line
   * (`eve/docs/concepts/built-in-tools.md`, "Disable optional default tools").
   * `agent/tools/load_skill.ts` adds back the only one this agent uses.
   */
  defaultTools: false,
  /**
   * An AI Gateway model id string, the minimal documented configuration
   * (`eve/docs/agent-config.md`, "Set the model"). The fallback is eve's own
   * default for a scaffolded project.
   */
  model: process.env.EXAMPLE_AGENT_MODEL ?? "openai/gpt-5.6-luna-fast",
} as const;
