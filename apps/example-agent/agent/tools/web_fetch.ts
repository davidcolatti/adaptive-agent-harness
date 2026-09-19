import { disableTool } from "eve/tools";

/**
 * Disabled for the same reason as `web_search.ts`: the fixture domain must run
 * on deterministic local evidence, and `web_fetch` is an optional default tool
 * that would otherwise let the agent read a live URL mid-triage.
 *
 * `agent/instructions.md` tells the agent it has no web access. This file is
 * what makes that true rather than merely requested; an instruction is not an
 * enforcement mechanism.
 */
export default disableTool();
