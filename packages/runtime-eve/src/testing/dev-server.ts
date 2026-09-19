import { type ChildProcess, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { AgentExecutionError } from "@internal/core";
import { Client } from "eve/client";

/**
 * Starting an `eve` server for a test or a demo.
 *
 * **This is deliberately not part of `EveAgentRuntime`.** `eve` 0.63.0 has no
 * in-process run API, so somebody has to own a server process; ADR-0028 puts
 * that somewhere a caller opts into rather than inside a runtime adapter, so
 * the adapter stays a client and `createHarness()` never acquires a process
 * lifecycle.
 *
 * The invocation is eve's own. `eve/dist/src/public/next/server.js` spawns
 * `process.execPath` with `[<eve binary>, "dev", "--no-ui", "--port", "0"]`,
 * and `eve/dist/src/public/{nuxt,sveltekit}/dev-server.js` are the same code.
 * `eve/docs/reference/cli.md` documents `--no-ui` ("Start the server without an
 * interactive UI") and `--port` (`$PORT`, then 2000); `0` asks the OS for a free
 * port, which is what makes concurrent servers safe.
 */

const requireFromHere = createRequire(import.meta.url);

/** How long to wait for the server to print a URL and answer `health()`. */
const DEFAULT_TIMEOUT_MS = 90_000;

/** How long `stop()` waits for a graceful exit before sending `SIGKILL`. */
const KILL_GRACE_MS = 5_000;

/** How often `health()` is retried while the server boots. */
const HEALTH_POLL_MS = 150;

/** How long a single liveness probe may take. Matches eve's own 1s readiness probe. */
const PROBE_TIMEOUT_MS = 1_000;

/** How often the shutdown check re-probes. */
const SHUTDOWN_POLL_MS = 100;

/** How long `stop()` waits for the port to stop answering after the child exits. */
const SHUTDOWN_VERIFY_MS = 10_000;

/** The options {@link startEveDevServer} accepts. */
export interface StartEveDevServerOptions {
  /**
   * The eve application root: the directory holding `package.json` and
   * `agent/`. An `agent/` directory that is not itself a package root is
   * invisible to eve, and eve only recognizes the project once `eve` appears in
   * that manifest's dependencies (research note §15.1).
   */
  readonly appRoot: string;
  /**
   * Extra environment for the child. The parent environment is inherited
   * except for the names in {@link STRIPPED_ENV}, which are removed unless
   * given here.
   */
  readonly env?: Readonly<Record<string, string>>;
  /** How long to wait for readiness. Defaults to 90s. */
  readonly timeoutMs?: number;
}

/** A running `eve dev` server. */
export interface EveDevServer {
  /** The base URL to hand to {@link EveAgentRuntime}, e.g. `http://127.0.0.1:51234`. */
  readonly host: string;
  /** Everything the child wrote, for a failure message. */
  readonly logs: () => string;
  /** Stop the server. Safe to call more than once; always kills. */
  stop(): Promise<void>;
}

/**
 * Environment the child never inherits unless a caller passes it back.
 *
 * Two credentials, so a fixture agent cannot quietly reach a model provider
 * because the developer happened to be logged in.
 *
 * And two switches that would silently replace the authored model, which is the
 * subtler of the two hazards and is **documented nowhere**. Found by execution
 * on 2026-09-19: `eve/dist/src/runtime/agent/mock-model-adapter.js` declares
 *
 * ```js
 * function shouldMockAuthoredRuntimeModels() {
 *   return process.env.NODE_ENV === "test" || process.env.EVE_MOCK_AUTHORED_MODELS === "1";
 * }
 * ```
 *
 * and, when it is true, swaps every authored model for eve's own runtime mock.
 * That mock answers a turn's `outputSchema` from
 * `runtime/agent/mock-structured-output.js` — every string becomes
 * `"structured-output"` — and **never calls the authored `respond` callback at
 * all**.
 *
 * Vitest sets `NODE_ENV=test` in the process that spawns this server, so
 * without this list the fixture agent's scripted responder is silently ignored
 * inside `pnpm test:contract` and only inside it. It cost an hour to find,
 * because the symptom is a turn that succeeds with plausible data while every
 * scripted branch is unreachable.
 */
const STRIPPED_ENV = [
  "AI_GATEWAY_API_KEY",
  "VERCEL_OIDC_TOKEN",
  "NODE_ENV",
  "EVE_MOCK_AUTHORED_MODELS",
] as const;

/**
 * The path to eve's CLI entrypoint.
 *
 * Resolved from the package manifest rather than with
 * `require.resolve("eve/bin/eve.js")`, because `bin/eve.js` is not a declared
 * subpath of eve's export map and resolving it directly fails with
 * `ERR_PACKAGE_PATH_NOT_EXPORTED`. `eve/package.json` **is** a declared subpath,
 * and its `bin` field names the entrypoint, so this stays inside the public
 * surface (`{"eve": "./bin/eve.js"}`, verified against eve 0.63.0).
 */
function resolveEveBinary(): string {
  const manifestPath = requireFromHere.resolve("eve/package.json");
  const manifest: unknown = requireFromHere("eve/package.json");
  const bin: unknown =
    typeof manifest === "object" && manifest !== null
      ? (manifest as { readonly bin?: unknown }).bin
      : undefined;
  const entry: unknown =
    typeof bin === "object" && bin !== null ? (bin as { readonly eve?: unknown }).eve : bin;

  if (typeof entry !== "string") {
    throw new AgentExecutionError("startEveDevServer: eve's package manifest names no `bin.eve`");
  }

  return join(dirname(manifestPath), entry);
}

/**
 * The listening URL in a chunk of server output.
 *
 * `eve dev --no-ui` prints `[DEV] server listening at http://127.0.0.1:<port>/`
 * (observed in the research note's §15.4 spike). The "listening at" form is
 * matched first so a URL that happens to appear in a banner or a warning cannot
 * be mistaken for the server's own address; a bare URL is the fallback for a
 * future wording change.
 */
function findUrl(output: string): string | undefined {
  const labelled = /listening at\s+(https?:\/\/[^\s'"]+)/iu.exec(output);
  const bare = /https?:\/\/[^\s'"]+/u.exec(output);
  const found = labelled?.[1] ?? bare?.[0];

  // The dev server prints a trailing slash. `Client` joins paths onto `host`,
  // so the slash is removed here rather than producing `//eve/v1/health`.
  return found === undefined ? undefined : found.replace(/\/+$/u, "");
}

function childEnv(options: StartEveDevServerOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };

  for (const name of STRIPPED_ENV) {
    delete env[name];
  }

  return { ...env, ...options.env };
}

async function waitForHealth(
  host: string,
  deadline: number,
  assertAlive: () => void,
  startupFailure: (summary: string) => AgentExecutionError,
): Promise<void> {
  const client = new Client({ host });

  for (;;) {
    assertAlive();

    try {
      await client.health();
      return;
    } catch {
      if (Date.now() >= deadline) {
        throw startupFailure(`${host} did not become healthy before the timeout`);
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, HEALTH_POLL_MS);
      });
    }
  }
}

function killChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    LIVE_CHILDREN.delete(child);
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const forceTimer = setTimeout(() => {
      child.kill("SIGKILL");
    }, KILL_GRACE_MS);
    forceTimer.unref?.();

    child.once("exit", () => {
      clearTimeout(forceTimer);
      LIVE_CHILDREN.delete(child);
      resolve();
    });

    // SIGTERM rather than SIGKILL, because a clean exit is what makes a restart
    // possible: eve removes its `.eve/dev-server-state.v1.json` record when the
    // listening server stops (`DevelopmentServerState.remove()`, "Clears the
    // record after the listening server has stopped"). SIGKILL leaves the
    // record and, worse, leaves the port bound. The escalation below exists
    // only for a child that ignores SIGTERM.
    child.kill("SIGTERM");
  });
}

/**
 * Every child this module has started and not yet reaped.
 *
 * The orphan it defends against is the one that actually bites: a parent that
 * dies without running `stop()` leaves `eve dev` holding its port **and** its
 * healthy `.eve/dev-server-state.v1.json` record, and the next start then hits
 * eve's documented refusal instead of booting. An uncaught exception, a failed
 * test teardown or a `process.exit()` all reach the `exit` event, so this turns
 * "the next run is broken until someone finds the stray process" into nothing
 * at all.
 *
 * A Ctrl-C needs no handler here: the shell signals the whole foreground
 * process group, and the child is in it because this module never detaches.
 */
const LIVE_CHILDREN = new Set<ChildProcess>();

let exitGuardInstalled = false;

function installExitGuard(): void {
  if (exitGuardInstalled) {
    return;
  }

  exitGuardInstalled = true;

  // `exit` handlers must be synchronous, so this is the one place SIGKILL is
  // right: there is no opportunity left for a graceful shutdown.
  process.on("exit", () => {
    for (const child of LIVE_CHILDREN) {
      child.kill("SIGKILL");
    }
    LIVE_CHILDREN.clear();
  });
}

/**
 * The URL `eve dev` recorded for this app root, if it recorded one.
 *
 * Documented in `eve/docs/reference/cli.md`: "Local dev records the last ready
 * URL per resolved app root in `.eve/dev-server-state.v1.json`." The shape is
 * `{ url: string }` (`eve/dist/src/internal/nitro/host/dev-server-state.js`,
 * a strict zod object).
 *
 * **Read only, never written and never deleted.** The same page states that "a
 * stale or malformed record is replaced when eve starts a new server", so a
 * record left behind by a dead server needs no cleanup from the harness, and
 * removing one would be reaching into eve's own state for no reason.
 */
export function readRecordedDevServerUrl(appRoot: string): string | undefined {
  let raw: string;

  try {
    raw = readFileSync(join(appRoot, ".eve", "dev-server-state.v1.json"), "utf8");
  } catch {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    const url: unknown =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { readonly url?: unknown }).url
        : undefined;

    return typeof url === "string" && url !== "" ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Whether something is answering eve's health route at `url`. */
async function isAnswering(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch(new URL("/eve/v1/health", url), {
      signal: AbortSignal.timeout(timeoutMs),
    });

    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Wait until `url` stops answering, so an immediate restart cannot race a
 * socket that is still closing.
 *
 * This is the "verify the registration is gone" half of `stop()`. Without it,
 * `stop()` could resolve on the child's `exit` event a moment before the
 * listening socket is actually released, and a caller that restarts at once
 * would meet eve's refusal for a server that is already on its way out.
 */
async function waitUntilUnreachable(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (await isAnswering(url, PROBE_TIMEOUT_MS)) {
    if (Date.now() >= deadline) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, SHUTDOWN_POLL_MS);
    });
  }
}

/**
 * Start `eve dev --no-ui --port 0` for `appRoot` and wait until it is healthy.
 *
 * ```ts
 * const server = await startEveDevServer({ appRoot });
 * try {
 *   const runtime = new EveAgentRuntime({ host: server.host, domains: [vendorTriage] });
 *   // ...
 * } finally {
 *   await server.stop();
 * }
 * ```
 *
 * Readiness is `client.health()` answering `{ ok: true, status: "ready" }`,
 * which is the documented probe (`eve/docs/guides/client/overview.mdx`) and the
 * one `eve eval` uses. The child is killed on every failure path, so a timeout
 * or a crash never leaves a server behind.
 *
 * @throws {AgentExecutionError} if the child exits, prints no URL, or does not
 * become healthy within `timeoutMs`.
 */
export async function startEveDevServer(options: StartEveDevServerOptions): Promise<EveDevServer> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  // Refuse before spawning when a server for this app root is already up.
  //
  // `eve/docs/reference/cli.md`: "Passing `--host`, `--port`, or a `PORT`
  // environment value skips reconnection and reports a healthy recorded server
  // instead." This helper always passes `--port 0`, so eve would refuse anyway
  // — but it refuses by exiting 1, which reaches a caller as an opaque
  // `code=1`. Checking first turns that into a message naming the URL.
  //
  // A recorded URL that does **not** answer is left alone and started over, as
  // the same page documents: "A stale or malformed record is replaced when eve
  // starts a new server."
  const recorded = readRecordedDevServerUrl(options.appRoot);

  if (recorded !== undefined && (await isAnswering(recorded, PROBE_TIMEOUT_MS))) {
    throw new AgentExecutionError(
      [
        `startEveDevServer: an eve dev server is already running for ${options.appRoot}`,
        `at ${recorded}, so a second one cannot start.`,
        "",
        "Stop it and run again, or point EveAgentRuntime at it directly with",
        `new EveAgentRuntime({ host: "${recorded.replace(/\/+$/u, "")}", domains: [...] }).`,
        "",
        "This helper deliberately does not reuse it: a server started earlier may be",
        "serving different code, and a test passing against the wrong agent is worse",
        "than one that refuses to start.",
      ].join("\n"),
      { details: { appRoot: options.appRoot, existingUrl: recorded } },
    );
  }

  installExitGuard();

  const child = spawn(process.execPath, [resolveEveBinary(), "dev", "--no-ui", "--port", "0"], {
    cwd: options.appRoot,
    env: childEnv(options),
    stdio: ["ignore", "pipe", "pipe"],
  });

  LIVE_CHILDREN.add(child);

  let output = "";
  let exited = false;
  let exitDescription = "";

  const record = (chunk: Buffer | string): void => {
    output += String(chunk);
  };
  child.stdout?.on("data", record);
  child.stderr?.on("data", record);
  child.once("exit", (code, signal) => {
    exited = true;
    exitDescription = `code=${String(code)} signal=${String(signal)}`;
  });
  child.once("error", (error) => {
    exited = true;
    exitDescription = error.message;
  });

  const logs = (): string => output;

  /**
   * A startup failure, with the child's own output **in the message**.
   *
   * `details` is where structured error context belongs, but a test runner
   * prints an error's message and not its `details`, so a boot failure that put
   * the output only in `details` reported that the server "exited before it was
   * ready" and nothing about why. That is the difference between a two-minute
   * diagnosis and an hour of bisecting, and it matters most here because this
   * runs on someone else's machine, in CI, or in a `pnpm check` nobody is
   * watching.
   */
  const startupFailure = (summary: string): AgentExecutionError => {
    const tail = output.slice(-2000);

    return new AgentExecutionError(
      `startEveDevServer: ${summary}\nappRoot: ${options.appRoot}\n--- eve dev output (last 2000 chars) ---\n${tail === "" ? "(the server wrote nothing)" : tail}`,
      { details: { appRoot: options.appRoot, output: tail } },
    );
  };

  const assertAlive = (): void => {
    if (exited) {
      throw startupFailure(`the eve dev server exited before it was ready (${exitDescription})`);
    }
  };

  try {
    let host: string | undefined;

    while (host === undefined) {
      assertAlive();
      host = findUrl(output);

      if (host === undefined) {
        if (Date.now() >= deadline) {
          throw startupFailure("the eve dev server printed no listening URL before the timeout");
        }
        await new Promise<void>((resolve) => {
          setTimeout(resolve, HEALTH_POLL_MS);
        });
      }
    }

    await waitForHealth(host, deadline, assertAlive, startupFailure);

    return {
      host,
      logs,
      stop: async () => {
        await killChild(child);
        // Not just "the process is gone" but "the address is free", so a caller
        // that restarts immediately cannot race a closing socket.
        await waitUntilUnreachable(host, SHUTDOWN_VERIFY_MS);
      },
    };
  } catch (cause) {
    await killChild(child);
    throw cause;
  }
}
