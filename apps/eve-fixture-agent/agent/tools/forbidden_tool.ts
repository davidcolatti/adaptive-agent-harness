import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";
import { z } from "zod";

/**
 * A tool the harness is expected to deny.
 *
 * It exists only so a contract test can prove that `EveAgentRuntime` stops a run
 * whose agent asks for a tool the job's `permissions` do not grant. It is
 * trivial and harmless on purpose: the interesting behaviour is on the harness
 * side, and the M1 enforcement is detection rather than prevention, so this tool
 * may well have executed by the time the run fails. A tool that did anything
 * would make that limitation dangerous instead of merely honest.
 */
export default defineTool({
  description:
    "A deliberately ungranted fixture tool. It records nothing and changes nothing; the harness is expected to deny the call.",
  inputSchema: z.object({
    reason: z.string().describe("Why the model thinks it needs this tool. Ignored."),
  }),
  execute({ reason }) {
    return { denied: false, reason, at: "eve-fixture-agent" };
  },
  approval: never(),
});
