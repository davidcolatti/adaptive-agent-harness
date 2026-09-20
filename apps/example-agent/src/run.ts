import { existsSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type AgentRuntime,
  createHarness,
  type DomainDefinition,
  type HarnessRunResult,
  type JsonValue,
  type Storage,
  StorageError,
} from "@internal/core";
import { EveAgentRuntime } from "@internal/runtime-eve";
import { type EveDevServer, startEveDevServer } from "@internal/runtime-eve/testing";
import { createSupabaseStorage } from "@internal/storage-supabase";
import {
  createBufferedTraceWriter,
  createFanOutTraceSink,
  createJsonlDirectoryTraceSink,
  createRedactingTraceWriter,
  createStorageTraceSink,
  type TraceSink,
} from "@internal/trace";
import { createWorkflowRuntime } from "@internal/workflow";
import { createVendorTriageRegistry } from "./capabilities.js";
import {
  createVendorTriageDomain,
  PROCUREMENT_SOP,
  type VendorTriageInput,
  type VendorTriageOutput,
  vendorTriage,
} from "./domain/index.js";
import { createFixtureDecisionPort } from "./workflow/fixture-decision-port.js";
import { compileVendorTriageWorkflow } from "./workflow/vendor-triage-workflow.js";

/**
 * `pnpm example:run` and `pnpm example:run:mock`: Milestone 1's acceptance
 * demonstration.
 *
 * It is the whole harness path in one file, and the shape a consuming domain
 * repository would copy:
 *
 * 1. start an `eve` server for an authored agent;
 * 2. build an `EveAgentRuntime` pointed at it;
 * 3. `createHarness({ agentRuntime, trace, storage, target })`, where `trace` is
 *    the redacting writer (M2-T9) over one buffered writer (M2-T4) draining
 *    into every sink, and `storage` is the Supabase run ledger (M2-T5/M2-T7)
 *    when it is configured;
 * 4. `harness.run({ domain: vendorTriage, input })`;
 * 5. print the result, the trace path and where the run row went, then stop the
 *    server.
 *
 * ## Two modes of durability
 *
 * With `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` set, a run leaves a
 * ledger row and an ordered trace in Supabase **and** a JSONL file beside the
 * agent. With either missing it leaves the JSONL file and says so on stderr.
 * The credential-free path is not a degraded mode to be tolerated: it is what
 * makes the whole harness path demonstrable on a machine with no Docker, which
 * is north-star invariant 15.
 *
 * **Configured and unreachable is a third case, and it is a failure.** Once
 * `.env.local` holds the two variables, this command requires Supabase to be
 * running: it checks reachability before starting the eve server, prints one
 * line saying so, and exits 1. It does **not** fall back to JSONL, because
 * storage was asked for and a run storage never recorded is not a success
 * (Milestone 2: "storage failures cannot silently turn into successful runs").
 * `pnpm check` and CI have no `.env.local`, so they stay on the JSONL-only
 * path.
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
 *
 * ## Two execution paths
 *
 * `--workflow` (or `EXAMPLE_RUN_MODE=workflow`) runs the job through the
 * hand-authored compiled workflow (M4-T10) instead of straight through the full
 * agent. The workflow's one `agent` node is handed the **same**
 * `EveAgentRuntime` the agent path would have used, so `--mock --workflow`
 * still needs no credential, and the ledger row records
 * `<agent>+workflow` as its target.
 *
 * ```sh
 * pnpm example:run:mock -- --workflow                              # the `clear` route
 * pnpm example:run:mock -- --workflow --vendor "Tessellate Analytics"   # the `research` route
 * pnpm example:run:mock -- --workflow --vendor "Aurelia Freight"        # escalation
 * ```
 *
 * `--vendor <name>` exists because the workflow routes on the vendor's own
 * frozen evidence, so it is the only way to reach all three routes from the
 * command line. Without either flag nothing about this command has changed.
 *
 * The two `jev` nodes are answered by a deterministic placeholder until M3
 * lands a `DecisionEngine`; see `src/workflow/fixture-decision-port.ts`.
 */

/** The output the harness prints. Printed as JSON so it can be piped. */
interface RunSummary {
  readonly target: string;
  readonly agent: string;
  readonly host: string;
  /** Which execution path ran the job: the full agent, or the compiled workflow. */
  readonly mode: RunMode;
  /** The vendor this run triaged. */
  readonly vendorName: string;
  /**
   * The compiled workflow this run executed, or `null` when the full agent did.
   *
   * The fingerprint, not the IR: the whole IR would drown the summary, and it is
   * already in the behavior fingerprint's `workflowIr` component and readable
   * from the source.
   */
  readonly workflow: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: string;
  } | null;
  /** The JSONL file this run's ordered trace was written to (M2-T4). */
  readonly tracePath: string;
  /**
   * Where the durable run row and trace went (M2-T5), or `null` when the run
   * was JSONL-only.
   *
   * The Supabase **URL**, never a key: this value is printed and piped.
   */
  readonly storage: string | null;
  readonly result: HarnessRunResult<unknown>;
}

/**
 * The two variables that decide whether this run is recorded in Supabase.
 *
 * Both or neither. A URL with no key cannot authenticate and a key with no URL
 * has nowhere to go, so treating "one of them" as configured would produce a
 * failure at the first query rather than a clear statement up front.
 *
 * They are read from the environment, and `--env-file-if-exists=.env.local`
 * in this package's `start` script is what normally puts them there (Node 24).
 * `.env.local` is git-ignored and is what
 * `pnpm exec supabase status -o env …` writes; see
 * `docs/runbooks/supabase-local.md`. **No key value is ever printed**, here or
 * anywhere else.
 */
const SUPABASE_VARIABLES = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

/**
 * Where a run's trace lands: `<app root>/.harness/traces/<runId>.jsonl`.
 *
 * Beside the agent that produced it, so a run's evidence and the agent it
 * exercised are in one place, and under `.harness/`, which `.gitignore`
 * excludes. The run id is minted inside `harness.run()`, so the file cannot be
 * named up front; `createJsonlDirectoryTraceSink` names it from each event's
 * own `runId` instead. It is written whether or not Supabase is configured, so
 * there is always a local trace to read.
 */
const TRACES_DIRNAME = join(".harness", "traces");

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

/** The fixture request's default vendor. One of the three on file. */
const DEFAULT_VENDOR_NAME = "Northwind Ledger";

/** Which execution path runs the job. */
type RunMode = "agent" | "workflow";

function chooseTarget(argv: readonly string[]): TargetName {
  return argv.includes("--mock") || process.env.EXAMPLE_RUN_TARGET === "mock" ? "mock" : "live";
}

/**
 * Whether to run the job through the compiled vendor workflow (M4-T10) rather
 * than straight through the full agent.
 *
 * `--workflow`, or `EXAMPLE_RUN_MODE=workflow`, mirroring how `--mock` and
 * `EXAMPLE_RUN_TARGET=mock` choose the target. The two are independent: the
 * workflow runs against whichever agent the target names, because its `agent`
 * node is handed the same `EveAgentRuntime` the agent path would have used.
 */
function chooseMode(argv: readonly string[]): RunMode {
  return argv.includes("--workflow") || process.env.EXAMPLE_RUN_MODE === "workflow"
    ? "workflow"
    : "agent";
}

/**
 * Which vendor to triage: `--vendor <name>`, `EXAMPLE_RUN_VENDOR`, or the
 * default.
 *
 * It exists because the compiled workflow routes on the vendor's own evidence:
 * `Northwind Ledger` takes the deterministic `clear` route, `Tessellate
 * Analytics` and `Cobalt Harbor Logistics` take the `research` route through
 * the agent, and anything not on file escalates. Without this, only one of the
 * three routes could be demonstrated.
 */
function chooseVendorName(argv: readonly string[]): string {
  const index = argv.indexOf("--vendor");
  const stated = index === -1 ? undefined : argv[index + 1];

  return stated ?? process.env.EXAMPLE_RUN_VENDOR ?? DEFAULT_VENDOR_NAME;
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

/**
 * The Supabase storage for this run, or `null` when it is not configured.
 *
 * **Credential-free stays the default.** `pnpm example:run:mock` must exit 0
 * with no database at all (north-star invariant 15, and it is what makes the
 * harness path demonstrable on any machine), so an absent variable is a mode,
 * not an error. What it must never be is silent: the run says on stderr which
 * mode it is in, so "where did my run row go?" is answered by the output rather
 * than by reading this file.
 */
function resolveStorage(): Storage | null {
  const url = process.env.SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (url === "" || serviceRoleKey === "") {
    const missing = SUPABASE_VARIABLES.filter((name) => (process.env[name] ?? "") === "");

    process.stderr.write(
      [
        `No Supabase storage: ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set.`,
        "This run's only durable record is its JSONL trace. To record it in Supabase,",
        "see docs/runbooks/supabase-local.md.",
        "",
      ].join("\n"),
    );

    return null;
  }

  return createSupabaseStorage({ url, serviceRoleKey });
}

/**
 * Report a storage failure as one readable line, and never as a stack trace.
 *
 * A stack here is noise: the interesting fact is not which frame threw, it is
 * that storage was **configured and unreachable**, and the two ways out are a
 * one-line instruction each. The stack still exists on the error for a caller
 * that wants it; this is the presentation layer deciding not to print it.
 *
 * The `SUPABASE_URL` is included because "which database?" is the first
 * question a reader asks and a machine can have more than one local stack. The
 * key never is.
 */
function reportStorageFailure(error: StorageError): void {
  const url = process.env.SUPABASE_URL ?? "(unset)";

  process.stderr.write(
    [
      "",
      `Supabase storage is configured (SUPABASE_URL=${url}) but unreachable: ${error.message}`,
      "",
      "Start it with `pnpm supabase:start`, or remove SUPABASE_URL and",
      "SUPABASE_SERVICE_ROLE_KEY (or `.env.local`) to run JSONL-only.",
      "",
      "This run is **not** falling back to a JSONL-only trace. Storage was asked for, so a",
      "run that storage never recorded is not a run to report as anything but a failure",
      "(Milestone 2: storage failures cannot silently turn into successful runs).",
      "",
      "See docs/runbooks/supabase-local.md.",
      "",
    ].join("\n"),
  );
}

/**
 * Check that configured storage is actually reachable, before anything
 * expensive happens.
 *
 * It runs **before** the eve dev server starts, because compiling and booting
 * an agent takes seconds and then throwing it away over a database that was
 * never up is a bad trade. It is one request: `listRuns` with a limit of 1,
 * which is a real call through the port rather than a bespoke health check, so
 * it exercises the same URL, the same key and the same PostgREST surface the
 * run itself will use. A URL that answers but rejects the key fails here too,
 * which is the point.
 *
 * It returns the `StorageError` rather than printing, so the one place that
 * formats a storage failure is {@link reportStorageFailure}.
 */
async function checkStorageReachable(storage: Storage): Promise<StorageError | null> {
  try {
    await storage.listRuns({}, { limit: 1 });

    return null;
  } catch (error) {
    return error instanceof StorageError
      ? error
      : new StorageError("the storage preflight failed", { cause: error });
  }
}

function credentialEnv(): Record<string, string> {
  const env: Record<string, string> = {};

  for (const name of presentCredentials()) {
    env[name] = process.env[name] ?? "";
  }

  return env;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const name = chooseTarget(argv);
  const mode = chooseMode(argv);
  const vendorName = chooseVendorName(argv);
  const target = TARGETS[name];
  const input: VendorTriageInput = { vendorName, procurementSop: PROCUREMENT_SOP };

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

  // Storage first, and its reachability before the eve server. Construction
  // itself can throw a `ValidationError` for a malformed URL or key; a
  // `StorageError` from the preflight means configured-but-unreachable, which
  // is a failure and not a reason to quietly write JSONL instead.
  let storage: Storage | null;

  try {
    storage = resolveStorage();
  } catch (error) {
    if (error instanceof StorageError) {
      reportStorageFailure(error);

      return 1;
    }

    throw error;
  }

  if (storage !== null) {
    const unreachable = await checkStorageReachable(storage);

    if (unreachable !== null) {
      reportStorageFailure(unreachable);

      return 1;
    }
  }

  process.stderr.write(`Starting an eve dev server for ${target.agent}...\n`);

  let server: EveDevServer | undefined;

  try {
    server = await startEveDevServer({ appRoot: target.appRoot, env: credentialEnv() });

    // The local durable trace (M2-T4): events are buffered in append order and
    // drained to one JSONL file per run. `createHarness()` flushes before it
    // returns, and lets a storage failure out rather than reporting a run whose
    // trace was never written as `completed`.
    const traces = createJsonlDirectoryTraceSink(join(target.appRoot, TRACES_DIRNAME));

    // One buffered, order-preserving writer over every sink (M2-T5). The JSONL
    // file stays even when Supabase is configured, so the local trace is always
    // there to read, and both sinks see the same events in the same order
    // because they are behind one writer rather than two.
    const sinks: TraceSink[] = [traces];

    if (storage !== null) {
      sinks.push(createStorageTraceSink({ storage }));
    }

    // The eve adapter for whichever target was chosen. In workflow mode it is
    // not the harness's runtime: it is what the workflow's one `agent` node
    // runs, under that node's own grants and budget rather than the job's.
    const eveRuntime = new EveAgentRuntime({
      host: server.host,
      // M1-T9's capability registry will resolve a job's contract references
      // to schemas; until it does, the runtime is handed the domains it may
      // request structured output for.
      domains: [vendorTriage],
    });

    // M4-T10. In `workflow` mode the harness drives the local deterministic
    // runtime over the compiled vendor workflow, and the eve adapter above
    // becomes one node inside it. `asAgentRuntime()` is what makes that
    // invisible to `createHarness()`, so trace, storage, the run ledger and
    // `pnpm harness run show` keep working with no router (M5 adds one).
    let domain: DomainDefinition<VendorTriageInput, VendorTriageOutput> = vendorTriage;
    let agentRuntime: AgentRuntime = eveRuntime;
    let workflow: RunSummary["workflow"] = null;

    if (mode === "workflow") {
      const registry = createVendorTriageRegistry();
      const compiled = compileVendorTriageWorkflow(registry);

      agentRuntime = createWorkflowRuntime({
        registry,
        agentRuntime: eveRuntime,
        // A placeholder until M3 lands a `DecisionEngine`; see
        // `src/workflow/fixture-decision-port.ts`.
        decisionEngine: createFixtureDecisionPort(),
      }).asAgentRuntime(compiled);
      // The behavior fingerprint's `workflowIr` component (ADR-0034): a run
      // through the compiled path is a different behavior from a run through
      // the full agent, and this is what makes the two fingerprints differ.
      domain = createVendorTriageDomain({
        workflowIr: JSON.parse(compiled.canonicalJson) as JsonValue,
      });
      workflow = {
        id: compiled.definition.id,
        version: compiled.definition.version,
        fingerprint: compiled.fingerprint,
      };
    }

    const harness = createHarness({
      agentRuntime,
      // Redaction (M2-T9) wraps the buffered writer rather than the sink, so an
      // unredacted event never reaches the buffer, let alone the file. The default
      // policy applies; adapter payloads are identity-only today, so a healthy run
      // produces a trace with no redaction token in it at all.
      trace: createRedactingTraceWriter({
        writer: createBufferedTraceWriter({ sink: createFanOutTraceSink(sinks) }),
      }),
      // The run ledger (M2-T7). Absent when Supabase is not configured, which
      // leaves the harness behaving exactly as it did before M2-T5.
      ...(storage === null ? {} : { storage }),
      // Which agent actually ran, recorded on the run row. A behavior
      // fingerprint describes the *domain*, and this file runs one domain
      // against two different agents, so without this the ledger could not tell
      // a mock run from a live one (ADR-0034's open question). In workflow mode
      // it additionally says *how*: the same agent behind a compiled workflow is
      // a different execution path, and the ledger has to be able to tell them
      // apart before M5 can ask whether the workflow carried its weight.
      target: mode === "workflow" ? `${target.agent}+workflow` : target.agent,
    });

    // A storage failure during the run reaches here as a `StorageError`
    // (M2-T5/M2-T7). It is reported as one line and a non-zero exit, **not**
    // downgraded to a JSONL-only success: storage was configured, so a run it
    // never recorded is a failed run. Every other error keeps its previous
    // behaviour and propagates with its stack, because an unexpected defect is
    // exactly the case where a stack is worth having.
    let result: HarnessRunResult<unknown>;

    try {
      result = await harness.run({ domain, input });
    } catch (error) {
      if (error instanceof StorageError) {
        reportStorageFailure(error);

        return 1;
      }

      throw error;
    }

    const summary: RunSummary = {
      target: name,
      agent: target.agent,
      host: server.host,
      mode,
      vendorName,
      workflow,
      tracePath: traces.pathFor(result.runId),
      // The URL only. The service-role key is never printed.
      storage: storage === null ? null : (process.env.SUPABASE_URL ?? null),
      result,
    };

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    process.stderr.write(`Trace written to ${summary.tracePath}\n`);

    if (summary.storage !== null) {
      process.stderr.write(
        `Run row written to ${summary.storage} as runs.id = ${result.runId}\n` +
          `Trace also written to ${summary.storage} as trace_events where run_id = ${result.runId}\n`,
      );
    }

    // A failed or aborted run is a non-zero exit, so the command can gate CI.
    return result.status === "completed" ? 0 : 1;
  } finally {
    // Always: a leaked `eve dev` holds its port for the rest of the session.
    await server?.stop();
  }
}

process.exitCode = await main();
