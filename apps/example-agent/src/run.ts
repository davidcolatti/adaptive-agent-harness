import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { createHarness, type HarnessRunResult } from "@internal/core";
import { EveAgentRuntime } from "@internal/runtime-eve";
import { type EveDevServer, startEveDevServer } from "@internal/runtime-eve/testing";
import { PROCUREMENT_SOP, type VendorTriageInput, vendorTriage } from "./domain/index.js";

/**
 * `pnpm example:run` and `pnpm example:run:mock`: Milestone 1's acceptance
 * demonstration.
 *
 * It is the whole harness path in one file, and the shape a consuming domain
 * repository would copy:
 *
 * 1. start an `eve` server for an authored agent;
 * 2. build an `EveAgentRuntime` pointed at it;
 * 3. `createHarness({ agentRuntime })`;
 * 4. `harness.run({ domain: vendorTriage, input })`;
 * 5. print the result and stop the server.
 *
 * **Nothing here touches the `eve` runtime directly.** The agent under
 * `agent/` is authored for eve and this file calls the harness API, which is
 * the boundary ADR-0025 draws and Milestone 1's acceptance criterion.
 *
 * ## Two targets
 *
 * | Command | Agent | Model | Credential |
 * | --- | --- | --- | --- |
 * | `pnpm example:run` | `apps/example-agent` | AI Gateway model id | **required** |
 * | `pnpm example:run:mock` | `apps/eve-fixture-agent` | eve's `mockModel` | none |
 *
 * The mock target exists so the harness path can be demonstrated, and kept
 * working, on a machine with no model credential at all. It runs the **real**
 * domain, the real adapter, a real eve server and a real durable session; only
 * the model is scripted. What it cannot show is whether a real model produces a
 * useful triage, which is the live target's job.
 */

/** The output the harness prints. Printed as JSON so it can be piped. */
interface RunSummary {
  readonly target: string;
  readonly agent: string;
  readonly host: string;
  readonly result: HarnessRunResult<unknown>;
}

/**
 * The repository root: the nearest ancestor holding `pnpm-workspace.yaml`.
 *
 * Found by walking up rather than by counting `..` segments, because this file
 * runs from `dist/src/` after `tsc` and sits in `src/` in the editor, and a
 * hardcoded depth would be right in exactly one of those.
 *
 * @throws {Error} if no ancestor is a pnpm workspace, which would mean the
 * script was copied somewhere it cannot find the sibling app roots.
 */
function findRepoRoot(from: string): string {
  let current = from;

  for (;;) {
    if (existsSync(join(current, "pnpm-workspace.yaml"))) {
      return current;
    }

    const parent = dirname(current);

    if (parent === current || current === parse(current).root) {
      throw new Error(`no pnpm workspace root above ${from}`);
    }

    current = parent;
  }
}

const REPO_ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));

const TARGETS = {
  live: {
    appRoot: join(REPO_ROOT, "apps", "example-agent"),
    agent: "@internal/example-agent",
    requiresCredential: true,
  },
  mock: {
    appRoot: join(REPO_ROOT, "apps", "eve-fixture-agent"),
    agent: "@internal/eve-fixture-agent",
    requiresCredential: false,
  },
} as const;

type TargetName = keyof typeof TARGETS;

/** The credentials the AI Gateway accepts, either of which is enough. */
const GATEWAY_CREDENTIALS = ["AI_GATEWAY_API_KEY", "VERCEL_OIDC_TOKEN"] as const;

/** The fixture request. `Northwind Ledger` is one of the three vendors on file. */
const INPUT: VendorTriageInput = {
  vendorName: "Northwind Ledger",
  procurementSop: PROCUREMENT_SOP,
};

function chooseTarget(argv: readonly string[]): TargetName {
  return argv.includes("--mock") || process.env.EXAMPLE_RUN_TARGET === "mock" ? "mock" : "live";
}

/**
 * The credential names that are actually set.
 *
 * Only the **names** are ever read out of the environment here, never the
 * values, and only the names are forwarded to the child. A value is copied
 * exactly once, into the child's environment, and is never logged or printed.
 */
function presentCredentials(): readonly string[] {
  return GATEWAY_CREDENTIALS.filter((name) => (process.env[name] ?? "") !== "");
}

function credentialEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const name of presentCredentials()) {
    env[name] = process.env[name] ?? "";
  }

  return env;
}

async function main(): Promise<number> {
  const name = chooseTarget(process.argv.slice(2));
  const target = TARGETS[name];

  if (target.requiresCredential && presentCredentials().length === 0) {
    process.stderr.write(
      [
        `pnpm example:run needs an AI Gateway credential, because ${target.agent} uses a`,
        "Gateway model id. Set AI_GATEWAY_API_KEY or VERCEL_OIDC_TOKEN; both are described",
        "in `.env.example`, and `eve link` writes one into `.env.local` for you.",
        "",
        "To see the same harness path with no credential at all, run:",
        "",
        "    pnpm example:run:mock",
        "",
      ].join("\n"),
    );

    return 1;
  }

  process.stderr.write(`Starting an eve dev server for ${target.agent}...\n`);

  let server: EveDevServer | undefined;

  try {
    server = await startEveDevServer({ appRoot: target.appRoot, env: credentialEnv() });

    const harness = createHarness({
      agentRuntime: new EveAgentRuntime({
        host: server.host,
        // M1-T9's capability registry will resolve a job's contract references
        // to schemas; until it does, the runtime is handed the domains it may
        // request structured output for.
        domains: [vendorTriage],
      }),
    });

    const result = await harness.run({ domain: vendorTriage, input: INPUT });
    const summary: RunSummary = {
      target: name,
      agent: target.agent,
      host: server.host,
      result,
    };

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

    // A failed or aborted run is a non-zero exit, so the command can gate CI.
    return result.status === "completed" ? 0 : 1;
  } finally {
    // Always: a leaked `eve dev` holds its port for the rest of the session.
    await server?.stop();
  }
}

process.exitCode = await main();
