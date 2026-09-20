import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createExecutionContext,
  isTraceEventType,
  type Job,
  newJobId,
  newRunId,
} from "@internal/core";
import { createRecordingTraceWriter } from "@internal/testing";
import { Client } from "eve/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { EveAgentRuntime, type EveClientLike, eveVersion } from "./eve-agent-runtime.js";
import {
  type EveDevServer,
  readRecordedDevServerUrl,
  startEveDevServer,
} from "./testing/dev-server.js";

/**
 * `EveAgentRuntime` against a real `eve` server, with **no credential**.
 *
 * The unit tests fake the transport; this file fakes nothing below the adapter.
 * One `eve dev --no-ui --port 0` process serves `apps/eve-fixture-agent`, whose
 * model is eve's own `mockModel`, so every turn here is a real durable session,
 * a real NDJSON stream and a real cancellable turn that reaches no model
 * provider. The research note verified the round trip offline before this was
 * written (§15), and the helper strips `AI_GATEWAY_API_KEY` and
 * `VERCEL_OIDC_TOKEN` from the child's environment so it stays true on a
 * machine where a developer is logged in.
 *
 * It runs inside `pnpm test:contract` and therefore inside `pnpm check`, so it
 * is kept to four cases and explicit timeouts. Starting the server is the
 * expensive part and happens once for the file.
 */

const REPO_ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const FIXTURE_APP_ROOT = join(REPO_ROOT, "apps", "eve-fixture-agent");

/** How long the fixture server gets to compile and answer `health()`. */
const BOOT_TIMEOUT_MS = 120_000;

/** How long one scripted turn gets. The spike measured 58-141ms per turn. */
const TURN_TIMEOUT_MS = 30_000;

const DOMAIN = { id: "fixture-contract", version: "1.0.0" } as const;

/** A small schema, so the fixture's generated value is easy to read in a failure. */
const outputSchema = z.object({
  verdict: z.enum(["proceed", "escalate"]),
  notes: z.array(z.string().min(1)).min(1),
});

type FixtureOutput = z.infer<typeof outputSchema>;

let server: EveDevServer | undefined;

function createJob(objective: string): Job<{ marker: string }, FixtureOutput> {
  return {
    id: newJobId(),
    domain: DOMAIN,
    jobType: "fixture-contract",
    objective,
    input: { marker: objective },
    contracts: {
      inputSchema: "fixture-contract.input@1.0.0",
      outputSchema: "fixture-contract.output@1.0.0",
      sop: "fixture-sop",
    },
    budget: {},
    permissions: [{ toolId: "echo_fixture", mode: "read" }],
    metadata: {},
  };
}

function createRuntime(): EveAgentRuntime {
  if (server === undefined) {
    throw new Error("the fixture server did not start");
  }

  return new EveAgentRuntime({
    host: server.host,
    domains: [{ id: DOMAIN.id, version: DOMAIN.version, outputSchema }],
  });
}

describe("EveAgentRuntime against a real eve server", () => {
  // Scoped to this block rather than the file, so the restart suite below can
  // own its own servers. Only one `eve dev` may run per app root: eve records
  // the last ready URL in `.eve/dev-server-state.v1.json` and refuses a second
  // start while it is healthy (`eve/docs/reference/cli.md`), and vitest runs a
  // file's describe blocks in order, so this one is stopped before that one
  // starts.
  beforeAll(async () => {
    server = await startEveDevServer({ appRoot: FIXTURE_APP_ROOT, timeoutMs: BOOT_TIMEOUT_MS });
  }, BOOT_TIMEOUT_MS);

  afterAll(async () => {
    // Always, on every path: a leaked `eve dev` holds a port and a workflow
    // directory open for the rest of the machine's life.
    await server?.stop();
    server = undefined;
  });

  it("satisfies its own client interface with eve's real Client", () => {
    // A compile-time check that `EveClientLike` is a subset of `Client` rather
    // than a parallel invention. It would fail typecheck, not this assertion.
    const client: EveClientLike = new Client({ host: server?.host ?? "" });

    expect(typeof client.health).toBe("function");
  });

  it(
    "returns the structured output the domain schema asked for",
    async () => {
      const trace = createRecordingTraceWriter();
      const context = createExecutionContext({
        runId: newRunId(),
        jobId: newJobId(),
        domain: DOMAIN,
        permissions: [{ toolId: "echo_fixture", mode: "read" }],
        trace,
      });

      const execution = await createRuntime().run(createJob("Produce a fixture verdict."), context);

      expect(execution.status === "failed" ? execution.error : execution.status).toBe("completed");

      if (execution.status !== "completed") {
        return;
      }

      // The server is authoritative for validation, so a `completed` turn means
      // eve already accepted this value against the lowered schema. Parsing it
      // again here is the harness's own check that the lowering was faithful.
      const parsed = outputSchema.safeParse(execution.output);

      expect(parsed.error?.issues ?? []).toEqual([]);
      expect(execution.usage.modelCalls).toBeGreaterThanOrEqual(1);
      expect(execution.runtime.name).toBe("eve");
      expect(execution.runtime.version).toBe(eveVersion());
      expect(typeof execution.runtime.metadata.sessionId).toBe("string");
      expect(typeof execution.runtime.metadata.turnId).toBe("string");

      // Real events, in order, on the closed taxonomy, carrying eve's own
      // durable ids for cross-reference against its stream.
      expect(trace.events.length).toBeGreaterThan(3);
      expect(trace.events.map((event) => event.sequence)).toEqual(
        trace.events.map((_event, index) => index),
      );
      expect(trace.events.every((event) => isTraceEventType(event.type))).toBe(true);
      expect(trace.types()).toContain("agent.started");
      expect(trace.types()).toContain("model.started");
      expect(trace.types()).toContain("model.completed");
      expect(trace.types()).toContain("agent.completed");
      expect(
        trace.events.every((event) => String(event.payload.eveEventId).startsWith("evt_")),
      ).toBe(true);
      // Identity and order are stamped by the recorder, not by the adapter.
      expect(trace.events.every((event) => event.runId === context.runId)).toBe(true);
      expect(trace.events.every((event) => event.version === 1)).toBe(true);
      expect(new Set(trace.events.map((event) => event.id)).size).toBe(trace.events.length);
    },
    TURN_TIMEOUT_MS,
  );

  it(
    "sends a fallback envelope as turn-scoped clientContext a real server accepts (M5-T6)",
    async () => {
      if (server === undefined) {
        throw new Error("the fixture server did not start");
      }

      // The real `Client`, wrapped in the seam the adapter already takes, so
      // the exact `sessions.create()` input that crossed the wire can be read
      // back. eve exposes no way to ask a running server what a turn's
      // `clientContext` was — it is ephemeral by design and never persisted to
      // durable session history — so the request is the observable, and the
      // server accepting the turn is the other half of the proof.
      const real = new Client({ host: server.host });
      const created: { readonly clientContext?: unknown }[] = [];
      const recording: EveClientLike = {
        health: () => real.health(),
        sessions: {
          create: async (input) => {
            created.push(input);

            return await real.sessions.create(input);
          },
        },
      };

      const execution = await new EveAgentRuntime({
        client: recording,
        domains: [{ id: DOMAIN.id, version: DOMAIN.version, outputSchema }],
      }).run(
        createJob("Produce a fixture verdict."),
        createExecutionContext({
          runId: newRunId(),
          jobId: newJobId(),
          domain: DOMAIN,
          permissions: [{ toolId: "echo_fixture", mode: "read" }],
          fallback: {
            reason: "unsupported_case",
            detail: "the compiled path has no route it can justify",
            nodeId: "full-agent",
            workflow: { id: "fixture-workflow", version: "1.0.0", fingerprint: "sha256:abc" },
            completedNodes: [
              {
                nodeId: "classify",
                outputRef: "node:classify",
                trusted: true,
                output: { category: "logistics", confidence: 0.91 },
              },
            ],
            evidenceRefs: [],
            remainingBudget: { maxModelCalls: 4 },
          },
        }),
      );

      // The envelope travelled on the documented surface, beside the job.
      expect(created).toHaveLength(1);
      expect(created[0]?.clientContext).toMatchObject({
        jobType: "fixture-contract",
        harness: {
          fallback: {
            reason: "unsupported_case",
            nodeId: "full-agent",
            completedNodes: [
              {
                nodeId: "classify",
                outputRef: "node:classify",
                trusted: true,
                // The evidence itself crossed the wire, not only its
                // reference: a model cannot dereference `node:classify`.
                output: { category: "logistics", confidence: 0.91 },
              },
            ],
          },
        },
      });
      // And a real eve server accepted the turn with it: `clientContext` is
      // typed `string | readonly string[] | JsonObject`
      // (`eve/dist/src/protocol/message.d.ts`), and a nested object is a
      // `JsonObject`.
      expect(execution.status === "failed" ? execution.error : execution.status).toBe("completed");
    },
    TURN_TIMEOUT_MS,
  );

  it(
    "counts a real tool-call round trip and still produces structured output",
    async () => {
      const context = createExecutionContext({
        runId: newRunId(),
        jobId: newJobId(),
        domain: DOMAIN,
        permissions: [{ toolId: "echo_fixture", mode: "read" }],
      });

      const execution = await createRuntime().run(
        createJob("FIXTURE_TOOLCALL Produce a fixture verdict."),
        context,
      );

      expect(execution.status === "failed" ? execution.error : execution.status).toBe("completed");
      // `actions.requested` then `action.result`, over HTTP, for an authored
      // tool this job granted.
      expect(execution.usage.toolCalls).toBe(1);
      expect(execution.usage.modelCalls).toBeGreaterThanOrEqual(2);
      // A mock model is not served by the AI Gateway, so it reports no cost.
      expect(execution.usage).not.toHaveProperty("costUsd");
    },
    TURN_TIMEOUT_MS,
  );

  it(
    "denies a tool the job does not grant, and stops the run",
    async () => {
      const context = createExecutionContext({
        runId: newRunId(),
        jobId: newJobId(),
        domain: DOMAIN,
        // `forbidden_tool` is deliberately absent.
        permissions: [{ toolId: "echo_fixture", mode: "read" }],
      });

      const execution = await createRuntime().run(
        createJob("FIXTURE_FORBIDDEN Produce a fixture verdict."),
        context,
      );

      expect(execution.status).toBe("failed");

      if (execution.status !== "failed") {
        return;
      }

      expect(execution.error.code).toBe("PERMISSION_DENIED");
      expect(execution.error.details).toMatchObject({
        toolId: "forbidden_tool",
        requested: "read",
      });
    },
    TURN_TIMEOUT_MS,
  );

  it(
    "cancels a genuinely in-flight turn when the signal fires",
    async () => {
      const controller = new AbortController();
      const trace = createRecordingTraceWriter();
      const context = createExecutionContext({
        runId: newRunId(),
        jobId: newJobId(),
        domain: DOMAIN,
        permissions: [{ toolId: "echo_fixture", mode: "read" }],
        trace,
        signal: controller.signal,
      });

      // The fixture's slow path sleeps for 30s inside the tool, so there is
      // genuinely something to interrupt. Cancelling a turn an instant mock
      // model has already finished reports `accepted` and then completes
      // normally, which would make this assertion meaningless.
      const pending = createRuntime().run(
        createJob("FIXTURE_SLOW Produce a fixture verdict."),
        context,
      );

      // Abort once the tool call is on the stream, as the streaming guide
      // requires: cancellation waits for the stream to identify the turn.
      await expect
        .poll(() => trace.events.some((event) => event.type === "tool.started"), {
          timeout: 10_000,
        })
        .toBe(true);

      const abortedAt = Date.now();
      controller.abort();

      const execution = await pending;

      expect(execution.status).toBe("aborted");
      // Cancellation is cooperative but fast: the spike measured 44ms from
      // request to `turn.cancelled` against a tool that would have run 8s.
      // Anything near the tool's own 30s would mean the adapter waited it out.
      expect(Date.now() - abortedAt).toBeLessThan(15_000);
      expect(execution.usage.durationMs).toBeGreaterThan(0);
    },
    TURN_TIMEOUT_MS,
  );
});

describe("startEveDevServer lifecycle", () => {
  it(
    "starts, serves a turn, stops, and does it all again",
    async () => {
      // The regression this exists for: `pnpm example:run:mock` failed on a
      // second consecutive run. `eve dev` records its URL in
      // `.eve/dev-server-state.v1.json` and refuses to start while that URL is
      // healthy, and because this helper passes `--port 0`, eve's documented
      // "skips reconnection and reports a healthy recorded server" path turns
      // that refusal into an opaque exit code 1. A `stop()` that returned
      // before the port was actually released left the next start racing it.
      //
      // Two full cycles, each with a real turn, is what proves the demo is
      // repeatable. One cycle proves nothing: the first start has no previous
      // server to collide with.
      const hosts: string[] = [];

      for (let cycle = 0; cycle < 2; cycle += 1) {
        const started = await startEveDevServer({
          appRoot: FIXTURE_APP_ROOT,
          timeoutMs: BOOT_TIMEOUT_MS,
        });

        try {
          hosts.push(started.host);

          const runtime = new EveAgentRuntime({
            host: started.host,
            domains: [{ id: DOMAIN.id, version: DOMAIN.version, outputSchema }],
          });
          const context = createExecutionContext({
            runId: newRunId(),
            jobId: newJobId(),
            domain: DOMAIN,
            permissions: [{ toolId: "echo_fixture", mode: "read" }],
          });

          const execution = await runtime.run(
            createJob(`Produce a fixture verdict, cycle ${String(cycle)}.`),
            context,
          );

          expect(
            execution.status === "failed" ? execution.error : execution.status,
            `cycle ${String(cycle)} did not complete`,
          ).toBe("completed");
        } finally {
          await started.stop();
        }

        // `stop()` promises the address is free, not merely that the process
        // exited. If that were untrue, the next iteration would fail to start,
        // which is exactly the bug.
        const response = await fetch(new URL("/eve/v1/health", started.host), {
          signal: AbortSignal.timeout(2_000),
        }).catch(() => undefined);

        expect(response, `cycle ${String(cycle)} left a server answering`).toBeUndefined();
      }

      // Each cycle got its own port, which is what `--port 0` is for and what
      // makes a leftover record from the previous cycle harmless.
      expect(new Set(hosts).size).toBe(2);
    },
    BOOT_TIMEOUT_MS,
  );

  it("reads back the URL eve recorded, and tolerates an app root that has none", () => {
    // The recorded URL is the signal the start path checks before spawning.
    // After the cycles above, the fixture's record is either absent (eve
    // removes it on a clean stop) or stale; both are fine, and neither may
    // throw.
    const recorded = readRecordedDevServerUrl(FIXTURE_APP_ROOT);

    expect(recorded === undefined || recorded.startsWith("http://")).toBe(true);
    expect(readRecordedDevServerUrl(join(REPO_ROOT, "packages"))).toBeUndefined();
  });
});
