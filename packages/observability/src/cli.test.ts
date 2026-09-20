import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { newRunId, type Storage, StorageError } from "@internal/core";
import { createInMemoryStorage } from "@internal/testing";
import { createJsonlDirectoryTraceSink } from "@internal/trace";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type HarnessCliContext, parseHarnessCommand, runHarnessCli } from "./cli.js";
import { recordFixtureRun } from "./fixtures.js";

/**
 * The `harness` CLI (M2-T10): argument parsing, source resolution and exit
 * codes.
 *
 * Every case runs the real `runHarnessCli()` with its argv, environment,
 * output sinks and store supplied as arguments, so the whole command is under
 * test with no subprocess, no database and (except where a file is the point)
 * no disk. `bin/harness.ts` is the only uncovered line, and it does nothing but
 * hand `process` in.
 */

const SUPABASE_ENV = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "fixture-key",
} as const;

interface CliRun {
  readonly code: number;
  readonly out: string;
  readonly err: string;
}

async function run(
  argv: readonly string[],
  overrides: Partial<HarnessCliContext> = {},
): Promise<CliRun> {
  let out = "";
  let err = "";
  const code = await runHarnessCli({
    argv,
    env: {},
    write: (text) => {
      out += text;
    },
    writeError: (text) => {
      err += text;
    },
    ...overrides,
  });

  return { code, out, err };
}

/** A context whose configured store is the given one, with no network client. */
function withStorage(storage: Storage): Partial<HarnessCliContext> {
  return { env: SUPABASE_ENV, createStorage: () => storage };
}

describe("parseHarnessCommand", () => {
  it("parses `run show <id>`", () => {
    const runId = newRunId();

    expect(parseHarnessCommand(["run", "show", runId])).toEqual({
      kind: "run-show",
      runId,
      json: false,
      jsonl: null,
      color: null,
    });
  });

  it("parses --json, --jsonl and --color in any position", () => {
    const runId = newRunId();

    expect(
      parseHarnessCommand(["run", "--json", "show", runId, "--jsonl", "t.jsonl", "--color"]),
    ).toEqual({ kind: "run-show", runId, json: true, jsonl: "t.jsonl", color: true });
  });

  it("accepts --trace-file as a spelling of --jsonl", () => {
    const runId = newRunId();

    expect(parseHarnessCommand(["run", "show", runId, "--trace-file", "t.jsonl"])).toMatchObject({
      jsonl: "t.jsonl",
    });
  });

  it("reads --no-color as colour off", () => {
    const runId = newRunId();

    expect(parseHarnessCommand(["run", "show", runId, "--no-color"])).toMatchObject({
      color: false,
    });
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    expect(parseHarnessCommand(["run", "show", newRunId(), "--verbose"])).toMatchObject({
      kind: "usage",
    });
  });

  it("rejects a missing run id, a second run id and a malformed one", () => {
    expect(parseHarnessCommand(["run", "show"])).toMatchObject({ kind: "usage" });
    expect(parseHarnessCommand(["run", "show", newRunId(), newRunId()])).toMatchObject({
      kind: "usage",
    });
    expect(parseHarnessCommand(["run", "show", "not-a-uuid"])).toMatchObject({ kind: "usage" });
  });

  it("treats an unknown subcommand as a usage error that lists the targets", () => {
    expect(parseHarnessCommand(["workflow", "list"])).toEqual({
      kind: "usage",
      message: "`harness workflow list` is not implemented",
      listTargets: true,
    });
    expect(parseHarnessCommand([])).toMatchObject({ kind: "usage", listTargets: true });
  });
});

describe("runHarnessCli: run show", () => {
  it("prints the rendered inspection and exits 0", async () => {
    const { storage, result } = await recordFixtureRun();

    const { code, out, err } = await run(["run", "show", result.runId], withStorage(storage));

    expect(code).toBe(0);
    expect(err).toBe("");
    expect(out).toContain(`run ${result.runId}`);
    expect(out).toContain("Timeline");
    expect(out).toContain("Fingerprints");
  });

  it("prints the RunInspection as JSON with --json", async () => {
    const { storage, result } = await recordFixtureRun();

    const { code, out } = await run(["run", "show", result.runId, "--json"], withStorage(storage));

    expect(code).toBe(0);

    const parsed = JSON.parse(out) as { runId: string; timeline: unknown[] };

    expect(parsed.runId).toBe(result.runId);
    expect(parsed.timeline).toHaveLength(8);
  });

  it("emits no ANSI when stdout is not a terminal, and some when it is", async () => {
    const { storage, result } = await recordFixtureRun();
    // biome-ignore lint/suspicious/noControlCharactersInRegex: matching ANSI escapes is the point.
    const ansi = /\u001B\[/;

    const piped = await run(["run", "show", result.runId], withStorage(storage));
    const tty = await run(["run", "show", result.runId], {
      ...withStorage(storage),
      isTty: true,
    });

    expect(ansi.test(piped.out)).toBe(false);
    expect(ansi.test(tty.out)).toBe(true);
  });

  it("exits 1 with `run <id> not found` for an unknown run", async () => {
    const runId = newRunId();

    const { code, out, err } = await run(
      ["run", "show", runId],
      withStorage(createInMemoryStorage()),
    );

    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toBe(`run ${runId} not found\n`);
  });

  it("reports a configured store that is unreachable as one line, and exits 1", async () => {
    const unreachable: Partial<Storage> = {
      getRun: () => Promise.reject(new StorageError("fetch failed")),
    };

    const { code, err } = await run(["run", "show", newRunId()], {
      env: SUPABASE_ENV,
      createStorage: () => unreachable as Storage,
    });

    expect(code).toBe(1);
    expect(err).toContain("Supabase storage is configured (SUPABASE_URL=http://127.0.0.1:54321)");
    expect(err).toContain("but unreachable: fetch failed");
    expect(err).toContain("`pnpm supabase:start`");
    expect(err).toContain("--jsonl");
    expect(err).not.toContain("fixture-key");
    expect(err).not.toContain("at Object");
  });
});

describe("runHarnessCli: usage errors", () => {
  it("exits 2 and lists the section-10 targets for an unknown subcommand", async () => {
    const { code, out, err } = await run(
      ["workflow", "list"],
      withStorage(createInMemoryStorage()),
    );

    expect(code).toBe(2);
    expect(out).toBe("");
    expect(err).toContain("`harness workflow list` is not implemented");
    expect(err).toContain("harness run show <run-id>");
    expect(err).toContain("harness workflow promote <version>");
    expect(err).toContain("harness compile show <compiler-id>");
    expect(err).toContain("not yet implemented");
  });

  it("exits 2 naming both options when there is no source at all", async () => {
    const { code, err } = await run(["run", "show", newRunId()]);

    expect(code).toBe(2);
    expect(err).toContain("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set");
    expect(err).toContain("--jsonl");
    expect(err).toContain("docs/runbooks/supabase-local.md");
  });

  it("exits 2 for a malformed run id", async () => {
    const { code, err } = await run(["run", "show", "nope"], withStorage(createInMemoryStorage()));

    expect(code).toBe(2);
    expect(err).toContain("`nope` is not a run id");
  });
});

describe("runHarnessCli: --jsonl", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "harness-cli-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("reads a local trace file with no Supabase variables set at all", async () => {
    const sink = createJsonlDirectoryTraceSink(directory);
    const { result } = await recordFixtureRun({ sinks: [sink] });

    const { code, out } = await run([
      "run",
      "show",
      result.runId,
      "--jsonl",
      sink.pathFor(result.runId),
    ]);

    expect(code).toBe(0);
    expect(out).toContain("note: job and ledger row unavailable (trace-only source)");
    expect(out).toContain("model.completed");
  });

  it("prefers the file over a configured store", async () => {
    const sink = createJsonlDirectoryTraceSink(directory);
    const { result } = await recordFixtureRun({ sinks: [sink] });

    const { code, out } = await run(
      ["run", "show", result.runId, "--jsonl", sink.pathFor(result.runId)],
      {
        env: SUPABASE_ENV,
        createStorage: () => {
          throw new Error("the store must not be built when --jsonl is given");
        },
      },
    );

    expect(code).toBe(0);
    expect(out).toContain("read from the JSONL trace");
  });

  it("exits 1 when the file does not exist, without the Supabase advice", async () => {
    const { code, err } = await run([
      "run",
      "show",
      newRunId(),
      "--jsonl",
      join(directory, "absent.jsonl"),
    ]);

    expect(code).toBe(1);
    expect(err).toContain("cannot read");
    expect(err).not.toContain("pnpm supabase:start");
  });
});
