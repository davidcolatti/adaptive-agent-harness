import { defineTool } from "eve/tools";
import { never } from "eve/tools/approval";
import { z } from "zod";
import { lookupVendorEvidence } from "../lib/vendor-evidence.js";

/**
 * The example domain's single read-only fixture tool.
 *
 * The tool's model-facing name is the filename slug, `lookup_vendor_evidence`;
 * authored definitions carry no `name` field because `eve` derives identity from
 * the path (`eve/docs/reference/agent-files.md`, "Naming from paths").
 *
 * **Read-only.** It reads frozen fixture data compiled into the agent and does
 * nothing else: no network call, no filesystem access, no environment read, no
 * mutation. `eve` 0.63.0 has no declarative "read-only" or side-effect flag on a
 * tool definition; the nearest documented mechanism is the per-tool approval
 * policy, so the property is declared here as `approval: never()` (from
 * `eve/tools/approval`, documented in `eve/docs/tools/overview.mdx`, "Gate a
 * tool on human approval") and enforced by keeping the implementation in a pure
 * module that `agent/lib/vendor-evidence.test.ts` exercises directly.
 */
export default defineTool({
  description:
    "Look up the frozen fixture evidence on file for one vendor: its stated offering, website, and captured evidence documents. Read-only and offline; it returns only what the fixture already contains. If the vendor is not on file it says so and lists the vendors that are, so you can report missing information instead of guessing.",
  inputSchema: z.object({
    vendorName: z
      .string()
      .min(1)
      .describe("The vendor's name, exactly as the request gave it. Matching ignores case."),
  }),
  execute({ vendorName }) {
    return lookupVendorEvidence(vendorName);
  },
  approval: never(),
  label: {
    start: ({ vendorName }) => `Look up evidence for ${vendorName}`,
  },
});
