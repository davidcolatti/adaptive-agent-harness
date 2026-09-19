/**
 * Re-enables eve's framework `load_skill` tool after `agent/agent.ts` turned
 * every optional default off.
 *
 * `defaultTools: false` removes all eight optional defaults in one line
 * (`eve/docs/concepts/built-in-tools.md`, "Disable optional default tools"),
 * which is what this example wants for seven of them: `bash`, `read_file`,
 * `write_file`, `todo`, `ask_question`, `task_cancel` and `agent` are all
 * capability the vendor-triage fixture has no use for, and `agent` in
 * particular would let the model spawn a second full copy of this agent in its
 * own durable session, whose usage the harness's own accounting would never
 * see.
 *
 * `load_skill` is the exception, because `agent/skills/triage-vendor.md` is an
 * on-demand skill and this tool is how the model pulls it into a turn. It "adds
 * no execution surface by itself" (same page), so restoring it gives back
 * nothing but the ability to read instructions this repository wrote.
 *
 * The one-line re-export is the documented way to add a framework tool back at
 * its own slot.
 */
export { default } from "eve/tools/load_skill";
