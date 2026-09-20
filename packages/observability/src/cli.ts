import { parseArgs } from "node:util";
import {
  ENTITY_ID_MESSAGE,
  isEntityId,
  type RunId,
  type Storage,
  StorageError,
} from "@internal/core";
import { createSupabaseStorage } from "@internal/storage-supabase";
import { inspectRun, type RunInspectionSource } from "./inspect-run.js";
import { createJsonlTraceSource } from "./jsonl-trace-source.js";
import { renderRunInspection } from "./render.js";

/**
 * The `harness` CLI (M2-T10), and the first command of the control plane the
 * build plan's section 10 describes.
 *
 * **ADR-0037** records the two choices worth recording. The framework is Node's
 * built-in `node:util` `parseArgs` rather than commander, yargs or oclif: the
 * surface is one command with three flags, `parseArgs` is in the runtime the
 * repository already pins, and AGENTS.md's "no silent dependency additions"
 * makes a dependency something to justify rather than something to reach for.
 * And the entry point lives in `@internal/observability` rather than in a
 * `packages/cli`, because the build plan's section 4 layout has no such package
 * and its section 10 says to build the CLI incrementally; a later ADR can split
 * it when there is more than one command to split.
 *
 * **Only the `bin` reaches an adapter.** `@internal/observability`'s library
 * surface (`index.ts`) is `inspectRun`, its renderer and the JSONL source, none
 * of which know that Supabase exists: they take the `Storage` port. This
 * module, which nothing but `bin/harness.ts` and its test import, is the one
 * place that turns two environment variables into a concrete store, through
 * `createSupabaseStorage()` — so the database is still reached only through the
 * declared adapter, which is what AGENTS.md's "no direct database access
 * outside `packages/storage-supabase`" requires.
 *
 * ## Exit codes
 *
 * | Code | Meaning |
 * | --- | --- |
 * | 0 | The inspection was printed. |
 * | 1 | The run was not found, or a configured store was unreachable. |
 * | 2 | A usage error: an unknown subcommand, a missing run id, a malformed run id, or no source. |
 *
 * 2 for usage and 1 for a real failure is the convention a shell script can
 * branch on: "you typed it wrong" and "the thing you asked about is not there"
 * are different answers and a caller may want to retry only one of them.
 */

/** What the CLI needs from the world, so a test can supply all of it. */
export interface HarnessCliContext {
  /** The arguments after the program name, i.e. `process.argv.slice(2)`. */
  readonly argv: readonly string[];
  /** The environment. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are read. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Where the inspection goes. */
  write(text: string): void;
  /** Where errors and notes go. */
  writeError(text: string): void;
  /** Whether stdout is a terminal, which is what decides colour. Defaults to `false`. */
  readonly isTty?: boolean;
  /**
   * How a configured Supabase store is built. Defaults to
   * `createSupabaseStorage`; a test overrides it to avoid a network client.
   */
  readonly createStorage?: (url: string, serviceRoleKey: string) => Storage;
}

/** A parsed `run show <run-id>` invocation. */
export interface RunShowCommand {
  readonly kind: "run-show";
  /** The run to inspect. Already checked against the entity-id scheme. */
  readonly runId: RunId;
  /** Print the `RunInspection` as JSON instead of text. */
  readonly json: boolean;
  /** Read this JSONL trace file instead of the configured store. */
  readonly jsonl: string | null;
  /** Force ANSI colour on or off; `null` means "decide from the terminal". */
  readonly color: boolean | null;
}

/** A parsed invocation that cannot run, and why. */
export interface HarnessCliUsageError {
  readonly kind: "usage";
  /** The one-line reason, printed before the usage text. */
  readonly message: string;
  /** Whether to print the full section-10 target list rather than the short usage. */
  readonly listTargets: boolean;
}

/** What {@link parseHarnessCommand} returns. */
export type HarnessCommand = RunShowCommand | HarnessCliUsageError;

/** The build plan's section 10 target list, with what is built today marked. */
const CLI_TARGETS: readonly (readonly [string, string])[] = [
  ["harness run <fixture>", "not yet implemented"],
  ["harness run show <run-id>", "available now"],
  ["harness workflow list", "not yet implemented (M4)"],
  ["harness workflow inspect <version>", "not yet implemented (M4)"],
  ["harness workflow validate <path>", "not yet implemented (M4)"],
  ["harness workflow replay <version>", "not yet implemented (M6)"],
  ["harness workflow promote <version>", "not yet implemented (M9)"],
  ["harness workflow rollback <version>", "not yet implemented (M9)"],
  ["harness eval run <version>", "not yet implemented (M6)"],
  ["harness eval show <eval-id>", "not yet implemented (M6)"],
  ["harness learn run --domain ...", "not yet implemented (M7)"],
  ["harness learn review <learning-id>", "not yet implemented (M7)"],
  ["harness compile <learning-id>", "not yet implemented (M8)"],
  ["harness compile show <compiler-id>", "not yet implemented (M8)"],
];

const SHORT_USAGE = [
  "usage: pnpm harness run show <run-id> [--json] [--jsonl <path>] [--color|--no-color]",
  "",
  "  --json          print the RunInspection as JSON instead of text",
  "  --jsonl <path>  read a local JSONL trace file instead of the configured store",
  "  --color         force ANSI colour on; --no-color forces it off",
  "",
  "A run is read from Supabase when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set,",
  "and from --jsonl otherwise. See docs/runbooks/inspecting-a-run.md.",
].join("\n");

function targetList(): string {
  const width = Math.max(...CLI_TARGETS.map(([target]) => target.length));

  return [
    "The CLI surface the build plan (section 10) targets, built incrementally:",
    "",
    ...CLI_TARGETS.map(([target, status]) => `  ${target.padEnd(width)}  ${status}`),
  ].join("\n");
}

/**
 * Parse an argument vector into a command, or into the reason it is not one.
 *
 * Separated from execution so the argument handling is testable without a
 * store, a file or a process. `parseArgs` runs in strict mode with
 * `allowPositionals: true`, so an unknown flag is rejected by Node rather than
 * silently ignored; its `TypeError` becomes a usage error here.
 */
export function parseHarnessCommand(argv: readonly string[]): HarnessCommand {
  let values: { json?: boolean; jsonl?: string; color?: boolean; "no-color"?: boolean };
  let positionals: string[];

  try {
    ({ values, positionals } = parseArgs({
      args: [...argv],
      options: {
        json: { type: "boolean" },
        jsonl: { type: "string" },
        "trace-file": { type: "string" },
        color: { type: "boolean" },
        "no-color": { type: "boolean" },
      },
      allowPositionals: true,
      strict: true,
    }) as {
      values: {
        json?: boolean;
        jsonl?: string;
        "trace-file"?: string;
        color?: boolean;
        "no-color"?: boolean;
      };
      positionals: string[];
    });
  } catch (error) {
    return {
      kind: "usage",
      message: error instanceof Error ? error.message : "could not parse the arguments",
      listTargets: false,
    };
  }

  const options = values as {
    json?: boolean;
    jsonl?: string;
    "trace-file"?: string;
    color?: boolean;
    "no-color"?: boolean;
  };
  const [group, subcommand, ...rest] = positionals;

  if (group === undefined) {
    return { kind: "usage", message: "no command given", listTargets: true };
  }

  if (group !== "run" || subcommand !== "show") {
    return {
      kind: "usage",
      message: `\`harness ${positionals.join(" ")}\` is not implemented`,
      listTargets: true,
    };
  }

  const [runId, ...extra] = rest;

  if (runId === undefined) {
    return { kind: "usage", message: "`harness run show` needs a run id", listTargets: false };
  }

  if (extra.length > 0) {
    return {
      kind: "usage",
      message: `\`harness run show\` takes one run id, received ${rest.length}`,
      listTargets: false,
    };
  }

  if (!isEntityId<"run">(runId)) {
    return {
      kind: "usage",
      message: `\`${runId}\` is not a run id: ${ENTITY_ID_MESSAGE}`,
      listTargets: false,
    };
  }

  const jsonl = options.jsonl ?? options["trace-file"] ?? null;

  return {
    kind: "run-show",
    runId,
    json: options.json === true,
    jsonl,
    color: options.color === true ? true : options["no-color"] === true ? false : null,
  };
}

/** The two variables that decide whether a run can be read from Supabase. */
const SUPABASE_VARIABLES = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

/**
 * Report a configured-but-unreachable store as one readable line, never a stack.
 *
 * The wording is `apps/example-agent/src/run.ts`'s, deliberately: a developer
 * who has met that message once should recognize this one, and the two commands
 * fail for exactly the same reason. It differs only in the second way out,
 * because this command has a local alternative that the example run does not.
 * The URL is included and the key never is.
 */
function reportStorageFailure(context: HarnessCliContext, error: StorageError, url: string): void {
  context.writeError(
    [
      "",
      `Supabase storage is configured (SUPABASE_URL=${url}) but unreachable: ${error.message}`,
      "",
      "Start it with `pnpm supabase:start`, or inspect the run's local JSONL trace with",
      "`pnpm harness run show <run-id> --jsonl <path>` instead.",
      "",
      "See docs/runbooks/supabase-local.md.",
      "",
    ].join("\n"),
  );
}

/** Build the source the inspection reads from, or explain why there is none. */
function resolveSource(
  context: HarnessCliContext,
  command: RunShowCommand,
): { readonly source: RunInspectionSource } | { readonly usage: string } {
  if (command.jsonl !== null) {
    return { source: createJsonlTraceSource(command.jsonl) };
  }

  const url = context.env.SUPABASE_URL ?? "";
  const serviceRoleKey = context.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  if (url === "" || serviceRoleKey === "") {
    const missing = SUPABASE_VARIABLES.filter((name) => (context.env[name] ?? "") === "");

    return {
      usage: [
        `no run source: ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not set,`,
        "and no --jsonl <path> was given. Either set both Supabase variables (see",
        "docs/runbooks/supabase-local.md, or `.env.local`), or pass",
        "`--jsonl .harness/traces/<run-id>.jsonl` to read the run's local trace.",
      ].join("\n"),
    };
  }

  const build = context.createStorage ?? defaultCreateStorage;

  return { source: build(url, serviceRoleKey) };
}

function defaultCreateStorage(url: string, serviceRoleKey: string): Storage {
  return createSupabaseStorage({ url, serviceRoleKey });
}

/**
 * Run the CLI and return the process exit code.
 *
 * Takes its argv, environment and output sinks rather than reaching for
 * `process`, so the whole command is exercised by a unit test with no
 * subprocess, no database and no file. `bin/harness.ts` is the thin shell that
 * supplies the real ones.
 */
export async function runHarnessCli(context: HarnessCliContext): Promise<number> {
  const command = parseHarnessCommand(context.argv);

  if (command.kind === "usage") {
    context.writeError(
      `${command.message}\n\n${command.listTargets ? targetList() : SHORT_USAGE}\n`,
    );

    return 2;
  }

  const resolved = resolveSource(context, command);

  if ("usage" in resolved) {
    context.writeError(`${resolved.usage}\n\n${SHORT_USAGE}\n`);

    return 2;
  }

  let inspection: Awaited<ReturnType<typeof inspectRun>>;

  try {
    inspection = await inspectRun(resolved.source, command.runId);
  } catch (error) {
    if (error instanceof StorageError && command.jsonl === null) {
      reportStorageFailure(context, error, context.env.SUPABASE_URL ?? "(unset)");

      return 1;
    }

    if (error instanceof StorageError) {
      context.writeError(`${error.message}\n`);

      return 1;
    }

    throw error;
  }

  if (!inspection.found) {
    context.writeError(`run ${command.runId} not found\n`);

    return 1;
  }

  if (command.json) {
    context.write(`${JSON.stringify(inspection, null, 2)}\n`);

    return 0;
  }

  context.write(
    renderRunInspection(inspection, { color: command.color ?? context.isTty === true }),
  );

  return 0;
}
