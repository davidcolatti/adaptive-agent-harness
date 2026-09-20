import type {
  DomainRef,
  Job,
  JsonValue,
  RunId,
  RunRecord,
  RunStatus,
  RuntimeInfo,
  SerializedHarnessError,
  Storage,
  TraceEvent,
  TraceEventId,
  TraceEventType,
  TraceEventUsage,
  WorkflowVersionId,
} from "@internal/core";

/**
 * The local run inspector (M2-T10): everything the build plan asks a run to be
 * able to say about itself, gathered from durable evidence alone.
 *
 * **ADR-0037** records the design. The build plan's display list — job, route,
 * timeline, tool/model/Jev calls, errors, result, cost, fingerprints — is the
 * field list of {@link RunInspection}, in that order, and nothing here reads
 * anything but the `Storage` port or a JSONL trace file. That is the point of
 * the task rather than an implementation detail: Milestone 2's acceptance
 * criterion is "a trace reconstructs execution without application logs", and
 * an inspector that reached for a log, a stdout capture or a live runtime would
 * prove the opposite.
 *
 * Three properties shape it.
 *
 * 1. **The result is plain JSON.** `inspectRun()` returns data and
 *    `renderRunInspection()` turns data into text, so `--json` is the same
 *    inspection the human form shows rather than a second, thinner one. A
 *    future dashboard, a test and an agent all consume the same value.
 * 2. **Partial evidence is still evidence.** A run row with no trace, a trace
 *    with no run row, and a trace-only JSONL file are all inspectable, and each
 *    says in {@link RunInspection.notes} what is missing rather than rendering
 *    a confident blank. "A failed run remains inspectable" is a property of a
 *    crashed run leaving a `running` row and a partial trace (ADR-0036), which
 *    is exactly the case that must not throw.
 * 3. **Absent is not zero.** A token count nobody reported is `null`, not `0`,
 *    the same rule `TraceEventUsage` states. The inspector's whole job is to
 *    report measurements, and a fabricated zero is a wrong measurement.
 */

/**
 * A source that can supply a run's trace and nothing else.
 *
 * `createJsonlTraceSource()` is the one implementation: a `.jsonl` file written
 * by `@internal/trace`'s sinks. It exists so a run is inspectable on a machine
 * with no database and no credential, which is north-star invariant 15, and so
 * that a developer can inspect the trace of a run whose storage write is the
 * very thing that failed.
 */
export interface TraceOnlySource {
  /** The discriminant. A `Storage` has no such field. */
  readonly kind: "trace";
  /** Where the trace came from, for the inspection's notes. E.g. a file path. */
  readonly description: string;
  /** Every event of the given run, in `sequence` order. */
  readTrace(runId: RunId): Promise<readonly TraceEvent[]>;
}

/** What {@link inspectRun} reads from: the full port, or a trace alone. */
export type RunInspectionSource = Storage | TraceOnlySource;

/** Which kind of source produced an inspection. */
export type RunInspectionSourceKind = "storage" | "trace";

/** What the source was able to supply. */
export interface RunAvailability {
  /** Whether a ledger row was found. */
  readonly run: boolean;
  /** Whether the job was found. */
  readonly job: boolean;
  /** Whether any trace event was found. */
  readonly trace: boolean;
}

/** One row of the run's timeline: one trace event, flattened for display. */
export interface TimelineEntry {
  /** The event's position in the run's total order. */
  readonly sequence: number;
  /** The event's own id, which is also its span id when it is a `*.started`. */
  readonly id: TraceEventId;
  /** When it happened, as an ISO 8601 string. */
  readonly timestamp: string;
  /**
   * Milliseconds since the run's first event, or `null` when that cannot be
   * computed.
   *
   * Measured from `run.started` when the trace has one and from the earliest
   * event otherwise, so a partial trace still reads as a relative timeline. A
   * clock that ran backwards yields a negative offset rather than a lie; the
   * renderer prints what it is given.
   */
  readonly offsetMs: number | null;
  /** What happened, from the closed taxonomy. */
  readonly type: TraceEventType;
  /** The enclosing span, or `null` for a root. */
  readonly parentId: TraceEventId | null;
  /** How long the work this event closes took, or `null`. */
  readonly latencyMs: number | null;
  /**
   * A one-line identity summary built from the payload.
   *
   * Scalar payload fields only, in key order, plus a failed event's error code.
   * Nested objects are skipped, because the only one a healthy trace carries is
   * the `run.started` behavior digests, which have their own section. The
   * payload is identity-only by rule (ADR-0031), so this cannot leak content
   * that was not already safe to store.
   */
  readonly summary: string;
}

/** One model, tool or decision call, paired from its `*.started` and terminal event. */
export interface CallRow {
  /** The sequence of the call's `*.started` event, or of the terminal one when it has no start. */
  readonly sequence: number;
  /** The model id, tool id or decision id the payload named, or `null`. */
  readonly id: string | null;
  /**
   * How the call ended.
   *
   * `open` means a `*.started` with no terminal event: the run died mid-call,
   * which is a finding rather than a gap to hide.
   */
  readonly status: "completed" | "failed" | "open";
  /** The terminal event's measured latency, or `null`. */
  readonly latencyMs: number | null;
  /** What the call consumed, or `null` when nothing was reported. */
  readonly usage: TraceEventUsage | null;
  /** The failing error's `code`, or `null`. */
  readonly errorCode: string | null;
}

/** An aggregate over one call kind. */
export interface CallGroup {
  /** How many calls of this kind the trace contains. */
  readonly count: number;
  /** The sum of the calls' latencies, or `null` when none reported one. */
  readonly totalLatencyMs: number | null;
  /** The calls, in `sequence` order. */
  readonly calls: readonly CallRow[];
}

/** The build plan's "tool/model/Jev calls" line, made concrete. */
export interface CallsInspection {
  /** `model.*` events. */
  readonly model: CallGroup;
  /** `tool.*` events. */
  readonly tool: CallGroup;
  /** `decision.*` events: Jev. Empty until M3. */
  readonly jev: CallGroup;
  /** How many Jev calls the ledger recorded, or `null` with no ledger row. */
  readonly jevCalls: number | null;
  /** Why the Jev count is zero, so a reader does not read it as a measurement failure. */
  readonly jevNote: string;
}

/** Which path the run took, and what executed it. */
export interface RouteInspection {
  /**
   * `full-agent`, or the id of the compiled workflow version that ran.
   *
   * A `null` `workflowVersionId` on the ledger row means the full agent ran,
   * which is every run until M4 compiles one.
   */
  readonly route: string;
  /** The compiled workflow version, or `null`. */
  readonly workflowVersionId: WorkflowVersionId | null;
  /** How many times the run fell back to the full agent. 0 until M5. */
  readonly fallbackCount: number;
  /** Whether the fallback count came from the ledger row or was counted in the trace. */
  readonly fallbackSource: "ledger" | "trace";
  /** Which application or agent executed, e.g. `@internal/eve-fixture-agent`. */
  readonly target: string | null;
  /** Which runtime adapter ran it. */
  readonly runtime: RuntimeInfo | null;
  /** The domain, from the ledger row or from the `run.started` payload. */
  readonly domain: DomainRef | null;
  /** The kind of job, from the ledger row or from the `run.started` payload. */
  readonly jobType: string | null;
}

/** One error the run recorded, wherever it was recorded. */
export interface InspectedError {
  /** `trace` for a `*.failed` event, `ledger` for the run row's `error`. */
  readonly source: "trace" | "ledger";
  /** The failing event's sequence, or `null` for the ledger's copy. */
  readonly sequence: number | null;
  /** The failing event's type, or `null` for the ledger's copy. */
  readonly type: TraceEventType | null;
  /** The error, in ADR-0026's trace-safe form. */
  readonly error: SerializedHarnessError;
}

/** Where the run got to. */
export interface ResultInspection {
  /** The run's state, or `null` when neither source could say. */
  readonly status: RunStatus | null;
  /** Whether the status came from the ledger row or was derived from the trace. */
  readonly statusSource: "ledger" | "trace" | null;
  /** Whether the run achieved what it was for. `null` while running or aborted. */
  readonly success: boolean | null;
  /** When it started, as an ISO 8601 string. */
  readonly startedAt: string | null;
  /** When it reached a terminal state, or `null` while running. */
  readonly finishedAt: string | null;
  /** Wall-clock duration in milliseconds, or `null`. */
  readonly latencyMs: number | null;
  /**
   * **Always `null` in Milestone 2.** See {@link ResultInspection.outputNote}.
   */
  readonly output: null;
  /** Why the output is absent, and where it will come from. */
  readonly outputNote: string;
}

/** Token totals summed across the run's `model.*` events. */
export interface TokenTotals {
  /** Prompt tokens sent, or `null` when no event reported any. */
  readonly inputTokens: number | null;
  /** Completion tokens received, or `null`. */
  readonly outputTokens: number | null;
  /** Prompt tokens served from the provider's cache, or `null`. */
  readonly cacheReadTokens: number | null;
  /** Prompt tokens written to the provider's cache, or `null`. */
  readonly cacheWriteTokens: number | null;
  /** Input plus output, or `null` when neither was reported. */
  readonly totalTokens: number | null;
}

/** What the run spent. */
export interface CostInspection {
  /** The ledger's figure, or `null`. */
  readonly costUsd: number | null;
  /**
   * The same figure summed from the trace's own `usage`, or `null`.
   *
   * Summed over the run's **non-`run.*`** events only. `TraceEventUsage` states
   * that usage is per event except on a `run.*` event, which carries the run's
   * totals, so adding those in would double every figure. Two independent
   * routes to one number is what makes a stored trace auditable: if this and
   * {@link CostInspection.costUsd} disagree, one of them is wrong, and an
   * inspector that only printed the ledger would never show it.
   */
  readonly tracedCostUsd: number | null;
  /** Model calls, from the ledger row. */
  readonly modelCalls: number | null;
  /** Tool calls, from the ledger row. */
  readonly toolCalls: number | null;
  /** Jev calls, from the ledger row. 0 until M3. */
  readonly jevCalls: number | null;
  /** Token totals summed from the trace. */
  readonly tokens: TokenTotals;
}

/** Which behavior produced the run, and whether every record agrees. */
export interface FingerprintInspection {
  /** The ledger row's composite `sha256:` fingerprint, or `null`. */
  readonly run: string | null;
  /** The ledger row's `agentVersion`, which today holds the same composite. */
  readonly agentVersion: string | null;
  /** The composite every trace event carries, or `null`. */
  readonly trace: string | null;
  /** The fingerprint scheme number from the `run.started` payload, or `null`. */
  readonly scheme: number | null;
  /** The digest algorithm from the `run.started` payload, or `null`. */
  readonly algorithm: string | null;
  /**
   * The per-component digests from the `run.started` payload, or `null`.
   *
   * This is what lets a trace on its own answer *which* part of the behavior
   * changed between two runs rather than only that something did (ADR-0034).
   */
  readonly components: Readonly<Record<string, string>> | null;
  /** Whether every event's fingerprint equals the run's. */
  readonly consistent: boolean;
  /** The sequences of the events that disagree, in order. */
  readonly inconsistentSequences: readonly number[];
}

/** Everything the inspector could learn about one run. */
export interface RunInspection {
  /** The run that was asked for. */
  readonly runId: RunId;
  /** Which kind of source answered. */
  readonly source: RunInspectionSourceKind;
  /** Where the source read from, for the header line. */
  readonly sourceDescription: string;
  /**
   * Whether the run exists at all.
   *
   * `false` when neither a ledger row nor a single trace event was found, which
   * is the CLI's "not found" exit. Anything less than that is partial evidence,
   * not absence.
   */
  readonly found: boolean;
  /** What the source was able to supply. */
  readonly availability: RunAvailability;
  /** What is missing, in plain words. Empty when everything was found. */
  readonly notes: readonly string[];
  /** The job, or `null`. */
  readonly job: Job<unknown, unknown> | null;
  /** The ledger row, or `null`. */
  readonly run: RunRecord | null;
  /** Which path the run took. */
  readonly route: RouteInspection;
  /** Every event, in order. */
  readonly timeline: readonly TimelineEntry[];
  /** Model, tool and Jev calls, aggregated. */
  readonly calls: CallsInspection;
  /** Every error, from the trace and from the ledger. */
  readonly errors: readonly InspectedError[];
  /** Where the run got to. */
  readonly result: ResultInspection;
  /** What it spent. */
  readonly cost: CostInspection;
  /** Which behavior produced it. */
  readonly fingerprints: FingerprintInspection;
}

/** Why the output value is not here, stated once. */
const OUTPUT_NOTE =
  "not persisted in Milestone 2: `HarnessRunResult.output` is returned in process, and a trace " +
  "payload is identity-only by rule (ADR-0031), so no durable record of it exists. The " +
  "`artifacts` table is where a durable output goes; M5 is what fills it.";

/** Why the Jev count is zero, stated once. */
const JEV_NOTE =
  "0 is a real measurement, not a gap: the `decision.*` taxonomy exists and nothing produces one " +
  "until M3 adds the Jev decision engine.";

/** The payload keys a `run.started` carries the behavior digests under. */
const BEHAVIOR_KEY = "behavior";

/** True when the source is the full `Storage` port rather than a trace alone. */
function isStorage(source: RunInspectionSource): source is Storage {
  return typeof (source as Partial<Storage>).getRun === "function";
}

/** Read an entire trace through the port, following the keyset cursor to the end. */
async function readWholeTrace(storage: Storage, runId: RunId): Promise<readonly TraceEvent[]> {
  const events: TraceEvent[] = [];
  let after: number | undefined;

  for (;;) {
    const page: { readonly events: readonly TraceEvent[]; readonly nextCursor: number | null } =
      await storage.getTrace(runId, after === undefined ? undefined : { after });

    events.push(...page.events);

    if (page.nextCursor === null) {
      break;
    }

    after = page.nextCursor;
  }

  return events;
}

/** A scalar payload value rendered for the one-line summary, or `null` to skip it. */
function scalar(value: JsonValue): string | null {
  if (value === null || typeof value === "object") {
    return null;
  }

  return String(value);
}

function summarize(event: TraceEvent): string {
  const parts = Object.keys(event.payload)
    .sort()
    .filter((key) => key !== BEHAVIOR_KEY)
    .map((key) => {
      const rendered = scalar(event.payload[key] as JsonValue);

      return rendered === null ? null : `${key}=${rendered}`;
    })
    .filter((part): part is string => part !== null);

  if (event.error !== null) {
    parts.push(`error=${event.error.code}`);
  }

  return parts.join(" ");
}

/** The instant a timeline is measured from: `run.started`, or the earliest event. */
function originMs(events: readonly TraceEvent[]): number | null {
  const start = events.find((event) => event.type === "run.started") ?? events[0];

  if (start === undefined) {
    return null;
  }

  const parsed = Date.parse(start.timestamp);

  return Number.isFinite(parsed) ? parsed : null;
}

function buildTimeline(events: readonly TraceEvent[]): readonly TimelineEntry[] {
  const origin = originMs(events);

  return events.map((event) => {
    const at = Date.parse(event.timestamp);

    return {
      sequence: event.sequence,
      id: event.id,
      timestamp: event.timestamp,
      offsetMs: origin === null || !Number.isFinite(at) ? null : at - origin,
      type: event.type,
      parentId: event.parentId,
      latencyMs: event.latencyMs,
      summary: summarize(event),
    };
  });
}

/** The identity keys each call kind names its subject with, in priority order. */
const IDENTITY_KEYS: Readonly<Record<"model" | "tool" | "decision", readonly string[]>> = {
  model: ["modelId", "model"],
  tool: ["tool", "toolId", "name"],
  decision: ["decision", "decisionId", "name"],
};

function identityOf(event: TraceEvent, kind: "model" | "tool" | "decision"): string | null {
  for (const key of IDENTITY_KEYS[kind]) {
    const value = event.payload[key];

    if (typeof value === "string" && value !== "") {
      return value;
    }
  }

  return null;
}

/**
 * Pair every `<kind>.started` with its terminal event and aggregate.
 *
 * Pairing is by `parentId`, because "a `*.completed` or `*.failed` event points
 * at its own `*.started` event" is the trace's own rule (ADR-0031) rather than
 * an assumption this file makes. A terminal event whose parent is missing from
 * the trace still becomes a row: a truncated trace is exactly when a reader
 * needs the rows it does have.
 */
function groupCalls(events: readonly TraceEvent[], kind: "model" | "tool" | "decision"): CallGroup {
  const started = events.filter((event) => event.type === `${kind}.started`);
  const terminals = events.filter(
    (event) => event.type === `${kind}.completed` || event.type === `${kind}.failed`,
  );
  const startedIds = new Set(started.map((event) => event.id));
  const byParent = new Map<TraceEventId, TraceEvent>();
  const unpaired: TraceEvent[] = [];

  for (const terminal of terminals) {
    const { parentId } = terminal;

    if (parentId !== null && startedIds.has(parentId) && !byParent.has(parentId)) {
      byParent.set(parentId, terminal);
    } else {
      unpaired.push(terminal);
    }
  }

  const calls: CallRow[] = started.map((start) => {
    const terminal = byParent.get(start.id);

    if (terminal === undefined) {
      return {
        sequence: start.sequence,
        id: identityOf(start, kind),
        status: "open" as const,
        latencyMs: null,
        usage: start.usage,
        errorCode: null,
      };
    }

    return {
      sequence: start.sequence,
      id: identityOf(start, kind) ?? identityOf(terminal, kind),
      status: terminal.type.endsWith(".failed") ? ("failed" as const) : ("completed" as const),
      latencyMs: terminal.latencyMs,
      usage: terminal.usage ?? start.usage,
      errorCode: terminal.error?.code ?? null,
    };
  });

  for (const terminal of unpaired) {
    calls.push({
      sequence: terminal.sequence,
      id: identityOf(terminal, kind),
      status: terminal.type.endsWith(".failed") ? "failed" : "completed",
      latencyMs: terminal.latencyMs,
      usage: terminal.usage,
      errorCode: terminal.error?.code ?? null,
    });
  }

  const latencies = calls
    .map((call) => call.latencyMs)
    .filter((latency): latency is number => latency !== null);

  return {
    count: calls.length,
    totalLatencyMs: latencies.length === 0 ? null : latencies.reduce((sum, ms) => sum + ms, 0),
    calls: calls.toSorted((left, right) => left.sequence - right.sequence),
  };
}

/** Sum one usage field across events, or `null` when no event reported it. */
function sumUsage(events: readonly TraceEvent[], field: keyof TraceEventUsage): number | null {
  const values = events
    .map((event) => event.usage?.[field])
    .filter((value): value is number => typeof value === "number");

  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
}

/** Add two possibly-absent totals, keeping `null` when both are absent. */
function addTotals(left: number | null, right: number | null): number | null {
  if (left === null && right === null) {
    return null;
  }

  return (left ?? 0) + (right ?? 0);
}

/** The run status a trace implies, when there is no ledger row to ask. */
function statusFromTrace(events: readonly TraceEvent[]): RunStatus | null {
  const terminal = events.findLast((event) => event.type.startsWith("run."));

  switch (terminal?.type) {
    case "run.completed":
      return "completed";
    case "run.failed":
      return "failed";
    case "run.aborted":
      return "aborted";
    case "run.started":
      return "running";
    default:
      return null;
  }
}

/** Read the `run.started` payload's `behavior` object, or `null`. */
function behaviorPayload(events: readonly TraceEvent[]): {
  readonly scheme: number | null;
  readonly algorithm: string | null;
  readonly components: Readonly<Record<string, string>> | null;
} {
  const started = events.find((event) => event.type === "run.started");
  const behavior = started?.payload[BEHAVIOR_KEY];

  if (behavior === undefined || behavior === null || typeof behavior !== "object") {
    return { scheme: null, algorithm: null, components: null };
  }

  const record = behavior as { readonly [key: string]: unknown };
  const components = record.components;
  const readable: Record<string, string> = {};

  if (components !== null && typeof components === "object" && !Array.isArray(components)) {
    for (const [name, digest] of Object.entries(
      components as { readonly [key: string]: unknown },
    )) {
      if (typeof digest === "string") {
        readable[name] = digest;
      }
    }
  }

  return {
    scheme: typeof record.scheme === "number" ? record.scheme : null,
    algorithm: typeof record.algorithm === "string" ? record.algorithm : null,
    components: Object.keys(readable).length === 0 ? null : readable,
  };
}

function buildFingerprints(
  run: RunRecord | null,
  events: readonly TraceEvent[],
): FingerprintInspection {
  const behavior = behaviorPayload(events);
  const traced = events[0]?.behaviorFingerprint ?? null;
  // The ledger's value is the reference when there is one, because the row is
  // the run's claim about itself; the trace's is the reference otherwise. An
  // event that disagrees with either is the finding.
  const reference = run === null ? traced : run.behaviorFingerprint;
  const inconsistentSequences = events
    .filter((event) => event.behaviorFingerprint !== reference)
    .map((event) => event.sequence);

  return {
    run: run?.behaviorFingerprint ?? null,
    agentVersion: run?.agentVersion ?? null,
    trace: traced,
    scheme: behavior.scheme,
    algorithm: behavior.algorithm,
    components: behavior.components,
    consistent: inconsistentSequences.length === 0,
    inconsistentSequences,
  };
}

function buildRoute(run: RunRecord | null, events: readonly TraceEvent[]): RouteInspection {
  const started = events.find((event) => event.type === "run.started");
  const payloadDomain = started?.payload.domain;
  const payloadVersion = started?.payload.domainVersion;
  const payloadJobType = started?.payload.jobType;
  const tracedFallbacks = events.filter((event) => event.type === "fallback.started").length;

  return {
    route: run?.workflowVersionId ?? "full-agent",
    workflowVersionId: run?.workflowVersionId ?? null,
    fallbackCount: run?.fallbackCount ?? tracedFallbacks,
    fallbackSource: run === null ? "trace" : "ledger",
    target: run?.target ?? null,
    runtime: run?.runtime ?? null,
    domain:
      run?.domain ??
      (typeof payloadDomain === "string" && typeof payloadVersion === "string"
        ? { id: payloadDomain, version: payloadVersion }
        : null),
    jobType: run?.jobType ?? (typeof payloadJobType === "string" ? payloadJobType : null),
  };
}

/** What {@link inspectRun} accepts beyond the source and the run id. */
export interface InspectRunOptions {
  /**
   * How the source is described in the inspection's header, overriding the
   * default (`"the Storage port"` or the trace source's own description).
   */
  readonly sourceDescription?: string;
}

/**
 * Gather everything durable evidence can say about one run.
 *
 * ```ts
 * const inspection = await inspectRun(storage, runId);
 * process.stdout.write(renderRunInspection(inspection));
 * ```
 *
 * It never throws for a run that is merely absent or partial: a missing run is
 * `found: false`, and a missing half is a note. It does propagate a
 * `StorageError` from an unreachable store and a `ValidationError` from a row
 * or a line that is not what it claims to be, because both mean the evidence
 * itself is untrustworthy and reporting a confident inspection over it would be
 * worse than failing.
 */
export async function inspectRun(
  source: RunInspectionSource,
  runId: RunId,
  options: InspectRunOptions = {},
): Promise<RunInspection> {
  const storage = isStorage(source) ? source : null;
  const run = storage === null ? null : await storage.getRun(runId);
  const events =
    storage === null
      ? await (source as TraceOnlySource).readTrace(runId)
      : await readWholeTrace(storage, runId);
  const job = storage === null || run === null ? null : await storage.getJob(run.jobId);

  const notes: string[] = [];

  if (storage === null) {
    notes.push("job and ledger row unavailable (trace-only source)");
  } else {
    if (run === null) {
      notes.push("no ledger row for this run; the trace is the only record of it");
    }

    if (run !== null && job === null) {
      notes.push(`no job row for \`${run.jobId}\`, which the ledger row references`);
    }
  }

  if (events.length === 0) {
    notes.push("no trace events for this run");
  }

  const model = groupCalls(events, "model");
  const tool = groupCalls(events, "tool");
  const jev = groupCalls(events, "decision");
  const modelEvents = events.filter((event) => event.type.startsWith("model."));
  // Everything but the run's own events. A `run.*` event carries the run's
  // totals rather than its own usage (`TraceEventUsage`), so summing those
  // alongside the per-span figures would count every call twice.
  const spanEvents = events.filter((event) => !event.type.startsWith("run."));
  const inputTokens = sumUsage(modelEvents, "inputTokens");
  const outputTokens = sumUsage(modelEvents, "outputTokens");
  const tracedStatus = statusFromTrace(events);

  const errors: InspectedError[] = events
    .filter(
      (event): event is TraceEvent & { readonly error: SerializedHarnessError } =>
        event.error !== null,
    )
    .map((event) => ({
      source: "trace" as const,
      sequence: event.sequence,
      type: event.type,
      error: event.error,
    }));

  if (run?.error != null) {
    errors.push({ source: "ledger", sequence: null, type: null, error: run.error });
  }

  return {
    runId,
    source: storage === null ? "trace" : "storage",
    sourceDescription:
      options.sourceDescription ??
      (storage === null ? (source as TraceOnlySource).description : "the Storage port"),
    found: run !== null || events.length > 0,
    availability: { run: run !== null, job: job !== null, trace: events.length > 0 },
    notes,
    job,
    run,
    route: buildRoute(run, events),
    timeline: buildTimeline(events),
    calls: {
      model,
      tool,
      jev,
      jevCalls: run?.jevCalls ?? null,
      jevNote: JEV_NOTE,
    },
    errors,
    result: {
      status: run?.status ?? tracedStatus,
      statusSource: run !== null ? "ledger" : tracedStatus === null ? null : "trace",
      success: run?.success ?? null,
      startedAt: run?.startedAt ?? events[0]?.timestamp ?? null,
      finishedAt: run?.finishedAt ?? null,
      latencyMs:
        run?.latencyMs ??
        events.findLast((event) => event.type.startsWith("run."))?.latencyMs ??
        null,
      output: null,
      outputNote: OUTPUT_NOTE,
    },
    cost: {
      costUsd: run?.costUsd ?? null,
      tracedCostUsd: sumUsage(spanEvents, "costUsd"),
      modelCalls: run?.modelCalls ?? null,
      toolCalls: run?.toolCalls ?? null,
      jevCalls: run?.jevCalls ?? null,
      tokens: {
        inputTokens,
        outputTokens,
        cacheReadTokens: sumUsage(modelEvents, "cacheReadTokens"),
        cacheWriteTokens: sumUsage(modelEvents, "cacheWriteTokens"),
        totalTokens: addTotals(inputTokens, outputTokens),
      },
    },
    fingerprints: buildFingerprints(run, events),
  };
}
