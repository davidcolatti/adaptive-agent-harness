import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BehaviorDescriptor,
  BehaviorSchema,
  BehaviorSkill,
  BehaviorTool,
  JsonObject,
} from "@internal/core";
import { formatCapabilityRef } from "@internal/core";
import { EXAMPLE_AGENT_CONFIG } from "../agent/lib/agent-config.js";
import { vendorTriageManifest } from "./capabilities.js";
import { PROCUREMENT_SOP } from "./domain/procurement-sop.js";
import { NO_PROCEED_WITH_OPEN_RISK_FLAGS_THRESHOLDS } from "./policies/no-proceed-with-open-risk-flags.js";

/**
 * The vendor-triage domain's behavior descriptor (M2-T8, ADR-0034).
 *
 * This is the application's side of the behavior fingerprint. The harness
 * cannot gather these inputs itself: `EveAgentRuntime` is a URL-only client
 * that never reads an agent's files (ADR-0028), and the application is the
 * party that authored the eve agent in the first place (ADR-0025). So the
 * domain hands over a {@link BehaviorDescriptor} and `createHarness()` hashes
 * it, once per run, before the first trace event.
 *
 * Where each component comes from:
 *
 * | Component | Source |
 * | --- | --- |
 * | `instructions` | `agent/instructions.md`, read from disk |
 * | `sop` | `PROCUREMENT_SOP`, the content `Job.contracts.sop` names |
 * | `skills` | every skill under `agent/skills/`, read from disk |
 * | `tools` | the `tool` entries of the capability manifest, plus eve's `load_skill` |
 * | `model` | `EXAMPLE_AGENT_CONFIG`, the same constant `agent/agent.ts` passes to `defineAgent` |
 * | `schemas` | the `schema` entries of the capability manifest |
 * | `workflowIr` | `null`; this domain runs the full agent, and M4 owns the IR |
 * | `policy` | the domain's policy thresholds |
 *
 * **The files are read at run time, not at import time.** An `agent/` edit
 * between two runs of the same process must change the second run's
 * fingerprint, because it changed the agent; caching the read would report the
 * two runs as the same behavior when they were not.
 */

/**
 * The eve skill directory, relative to the app root, and the conventions eve
 * resolves names by (`eve/docs/reference/agent-files.md`,
 * `eve/docs/skills.mdx`):
 *
 * - a flat `agent/skills/<name>.md` is the skill `<name>`;
 * - a packaged `agent/skills/<name>/SKILL.md` is the skill `<name>`.
 *
 * Both are read, so adding the packaged form later does not silently fall out
 * of the fingerprint. A `defineSkill` module (`agent/skills/<name>.ts`) is
 * **not** read: its markdown is produced by evaluating the module, which this
 * loader deliberately does not do, and this app authors none. `loadSkills`
 * throws rather than skipping one if that changes.
 */
const SKILLS_DIRNAME = join("agent", "skills");
const PACKAGED_SKILL_FILENAME = "SKILL.md";
const INSTRUCTIONS_PATH = join("agent", "instructions.md");

/**
 * eve's framework-owned skill-loading tool, granted by the domain
 * (`src/domain/index.ts`) and present on every turn.
 *
 * It is not a registered capability — it is eve's, not this domain's — so it is
 * not in the manifest, but it is a tool the model can call and therefore part
 * of the behavior.
 *
 * Its version is the **installed eve version**, because eve is what defines the
 * tool: upgrading eve can change what `load_skill` does, and that is a behavior
 * change the fingerprint should show. It is read from eve's own manifest rather
 * than written here as a literal that would drift from the pin.
 * `eve/package.json` is a declared subpath of eve's export map, so this is a
 * public read; and it is a *read*, not an import, so nothing about eve's
 * runtime is loaded to get it.
 */
function loadSkillTool(): BehaviorTool {
  const manifestPath = createRequire(import.meta.url).resolve("eve/package.json");
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  const version =
    typeof manifest === "object" &&
    manifest !== null &&
    typeof (manifest as { version?: unknown }).version === "string"
      ? (manifest as { version: string }).version
      : "unknown";

  return { id: "load_skill", version };
}

/**
 * The app root: the nearest ancestor of this module holding a `package.json`.
 *
 * Found by walking up rather than by counting `..` segments, because this file
 * runs from `src/` under Vitest and from `dist/src/` after `tsc`, and a
 * hardcoded depth would be right in exactly one of those. The same reasoning,
 * and the same shape, as `findRepoRoot` in `run.ts`.
 *
 * @throws {Error} if no ancestor holds a `package.json`.
 */
function findAppRoot(from: string): string {
  let current = from;

  for (;;) {
    if (existsSync(join(current, "package.json"))) {
      return current;
    }

    const parent = dirname(current);

    if (parent === current || current === parse(current).root) {
      throw new Error(`no package root above ${from}`);
    }

    current = parent;
  }
}

const APP_ROOT = findAppRoot(dirname(fileURLToPath(import.meta.url)));

/**
 * Read every skill under `agent/skills/`, in no particular order.
 *
 * Order does not matter: `createBehaviorFingerprint` sorts by id before
 * hashing, so the order the filesystem happens to return entries in is not
 * behavior.
 */
async function loadSkills(): Promise<readonly BehaviorSkill[]> {
  const directory = join(APP_ROOT, SKILLS_DIRNAME);
  const entries = await readdir(directory, { withFileTypes: true });
  const skills: BehaviorSkill[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      skills.push({
        id: entry.name,
        content: await readFile(join(directory, entry.name, PACKAGED_SKILL_FILENAME), "utf8"),
      });
      continue;
    }

    if (extname(entry.name) === ".md") {
      skills.push({
        id: parse(entry.name).name,
        content: await readFile(join(directory, entry.name), "utf8"),
      });
      continue;
    }

    // Anything else under `agent/skills/` is a skill this loader cannot read
    // without evaluating it (a `defineSkill` module), and a skill left out of
    // the fingerprint is a behavior change the fingerprint would miss. Failing
    // is the safe direction: a run refuses to start rather than being recorded
    // under a fingerprint that does not describe it.
    throw new Error(
      `${join(SKILLS_DIRNAME, entry.name)} is not a readable skill file; the behavior fingerprint cannot cover it. Author the skill as markdown, or extend \`loadSkills\` in src/behavior.ts.`,
    );
  }

  return skills;
}

/** The tools the behavior may call: the manifest's, plus eve's `load_skill`. */
function loadTools(): readonly BehaviorTool[] {
  const registered = vendorTriageManifest.entries
    .filter((entry) => entry.kind === "tool")
    .map(
      (entry): BehaviorTool => ({
        id: entry.ref.id,
        version: entry.ref.version,
        // The capability fingerprint is the tool's *declared definition*: its
        // id, version, module, export name, schema references and permission
        // declarations (ADR-0029). Never its executable body.
        definitionFingerprint: entry.fingerprint,
      }),
    );

  return [...registered, loadSkillTool()];
}

/** The schemas the behavior is bound by, from the same manifest. */
function loadSchemas(): readonly BehaviorSchema[] {
  return vendorTriageManifest.entries
    .filter((entry) => entry.kind === "schema")
    .map(
      (entry): BehaviorSchema => ({
        ref: formatCapabilityRef(entry.ref),
        fingerprint: entry.fingerprint,
      }),
    );
}

/**
 * The domain's policy thresholds, keyed by policy capability id.
 *
 * Keyed rather than flattened so a second policy is an added key rather than a
 * rename, and so a reader of two fingerprints can see which policy moved.
 *
 * The job's **budget** is deliberately absent. A budget belongs to the `Job`,
 * a caller may override it per run (`harness.run({ budget })`), and folding an
 * override into the behavior fingerprint would report two runs of the same
 * behavior as different behaviors. The job is recorded in its own right.
 */
function loadPolicy(): JsonObject {
  return {
    "no-proceed-with-open-risk-flags": { ...NO_PROCEED_WITH_OPEN_RISK_FLAGS_THRESHOLDS },
  };
}

/**
 * Gather everything that decides how a vendor-triage run behaves.
 *
 * ```ts
 * export const vendorTriage = defineDomain({
 *   // ...
 *   behavior: loadVendorTriageBehavior,
 * });
 * ```
 *
 * @throws if `agent/instructions.md` or a skill file cannot be read. A
 * descriptor that cannot be gathered means the run's behavior is unknown, and
 * `createHarness()` lets that out rather than recording a run with a `null`
 * fingerprint (ADR-0034).
 */
export async function loadVendorTriageBehavior(): Promise<BehaviorDescriptor> {
  const [instructions, skills] = await Promise.all([
    readFile(join(APP_ROOT, INSTRUCTIONS_PATH), "utf8"),
    loadSkills(),
  ]);

  return {
    instructions,
    // Content, not a reference. `Job.contracts.sop` is the bare identifier
    // `procurement-sop` (ADR-0032); this is the revision of it that ran.
    sop: PROCUREMENT_SOP,
    skills,
    tools: loadTools(),
    // The whole authored agent configuration, not just the model id: this
    // constant is what `agent/agent.ts` passes to `defineAgent`, so anything
    // behavior-affecting that is added to it (reasoning effort, compaction,
    // limits) is fingerprinted the moment it is set, with no second edit here.
    model: { ...EXAMPLE_AGENT_CONFIG },
    schemas: loadSchemas(),
    // M4 owns the workflow IR. Until one exists, this domain runs the full
    // agent, and `null` says so.
    workflowIr: null,
    policy: loadPolicy(),
  };
}
