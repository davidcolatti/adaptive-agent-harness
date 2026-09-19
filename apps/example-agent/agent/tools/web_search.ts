import { disableTool } from "eve/tools";

/**
 * Milestone 1 says of this fixture domain: "Use deterministic local fixture
 * tools before adding live web research" (`docs/milestones/build-plan.md`,
 * Milestone 1, Neutral Reference Job). `web_search` is one of eve's optional
 * default tools and is enabled unless an authored file at the same slot
 * replaces it, so leaving it in place would give the example agent live web
 * research by default and make its runs non-reproducible.
 *
 * `disableTool()` at the tool's own slot is the documented way to remove one
 * default without disturbing the rest (`eve/docs/concepts/built-in-tools.md`,
 * "Disable optional default tools"). The blunt alternative,
 * `defineAgent({ defaultTools: false })`, would also remove `load_skill`, which
 * this agent's skill needs.
 *
 * Reverse this by deleting the file when a later milestone deliberately adds
 * live research and has somewhere to record the non-determinism.
 */
export default disableTool();
