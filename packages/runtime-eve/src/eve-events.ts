import type { JsonObject, TraceEventUsage } from "@internal/core";
import type {
  ActionResultStreamEvent,
  ActionsRequestedStreamEvent,
  MessageStreamEvent,
} from "eve/client";

/**
 * Reading `eve`'s stream events without letting their types escape this package.
 *
 * Every type named here is either derived from a type `eve/client` exports or
 * declared locally. `MessageStreamEvent` and the rest stop at this package's
 * boundary; what leaves is a `TraceEvent` payload of plain JSON
 * (M1-T6's stated constraint, and ADR-0003's).
 */

/** One entry of `actions.requested`, derived from the exported event type. */
type EveActionRequest = ActionsRequestedStreamEvent["data"]["actions"][number];

/** One `action.result` payload, derived from the exported event type. */
type EveActionResult = ActionResultStreamEvent["data"]["result"];

/**
 * The tool id the harness uses for eve's `load_skill` action.
 *
 * A `load-skill` action request carries no name of its own
 * (`eve/dist/src/shared/action-types.d.ts`: `{ callId, input, kind }`), but it
 * is the model calling the framework's `load_skill` tool, which `eve info`
 * reports under exactly that name. Naming it here keeps the permission check
 * total: an action the harness cannot name would otherwise have to be silently
 * allowed.
 */
export const LOAD_SKILL_TOOL_ID = "load_skill";

/**
 * The tool name one requested action is about.
 *
 * `RuntimeActionRequest` is a five-member union and each member names its
 * target differently, so this is a total mapping rather than a property read.
 */
export function actionRequestToolName(action: EveActionRequest): string {
  switch (action.kind) {
    case "tool-call":
    case "workflow-tool-call":
      return action.toolName;
    case "subagent-call":
      return action.subagentName;
    case "remote-agent-call":
      return action.remoteAgentName;
    case "load-skill":
      return LOAD_SKILL_TOOL_ID;
  }
}

/** The tool name one action result is about, when the result names one. */
export function actionResultToolName(result: EveActionResult): string | undefined {
  switch (result.kind) {
    case "tool-result":
      return result.toolName;
    case "subagent-result":
      return result.kind === "subagent-result" ? result.subagentName : undefined;
    case "load-skill-result":
      return result.name ?? LOAD_SKILL_TOOL_ID;
  }
}

/** The `turnId` an event carries, when it carries one. */
export function eventTurnId(event: MessageStreamEvent): string | undefined {
  if (!("data" in event)) {
    return undefined;
  }

  const turnId: unknown = (event.data as { readonly turnId?: unknown }).turnId;

  return typeof turnId === "string" ? turnId : undefined;
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** The usage `step.completed` reports, with every field optional. */
export interface EveStepUsage {
  readonly costUsd?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

/**
 * The usage block of a `step.completed` event.
 *
 * `usage` is optional on the event and every field inside it is optional again
 * (`eve/dist/src/protocol/message.d.ts`), because a direct-provider or mock
 * model reports no cost and eve estimates token counts. Reading it defensively
 * keeps "absent" distinguishable from "zero".
 */
export function stepUsage(event: MessageStreamEvent): EveStepUsage | undefined {
  if (event.type !== "step.completed") {
    return undefined;
  }

  const usage = event.data.usage;

  if (usage === undefined) {
    return undefined;
  }

  return {
    ...(usage.costUsd === undefined ? {} : { costUsd: usage.costUsd }),
    ...(usage.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
    ...(usage.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
    ...(usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: usage.cacheReadTokens }),
    ...(usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens }),
  };
}

/** The `{ code, message }` an `isTurnFailureEvent` event carries. */
export interface EveFailureDetail {
  readonly code: string;
  readonly message: string;
}

/** Read the failure code and message off a turn-failure event. */
export function failureDetail(event: MessageStreamEvent): EveFailureDetail {
  const data: unknown = "data" in event ? event.data : undefined;
  const record = typeof data === "object" && data !== null ? data : {};
  const code: unknown = (record as { readonly code?: unknown }).code;
  const message: unknown = (record as { readonly message?: unknown }).message;

  return {
    code: typeof code === "string" ? code : "UNKNOWN",
    message: typeof message === "string" ? message : `eve emitted ${event.type}`,
  };
}

/**
 * The usage one completed model call reports, in the harness's own shape.
 *
 * eve's four token counters and its optional `costUsd` map one-for-one onto
 * {@link TraceEventUsage}. `modelCalls: 1` is always present, because one
 * completed step *is* one model call and that is true whether or not eve
 * costed it; the token and cost fields appear only when eve reported them,
 * because a mock or direct-provider model reports none and writing `0` would
 * turn "unknown" into a measurement.
 */
export function stepTraceUsage(event: MessageStreamEvent): TraceEventUsage {
  return { modelCalls: 1, ...stepUsage(event) };
}

/**
 * The identity and coordinates of one eve stream event, as a trace payload.
 *
 * **A whitelist, never a dump**, for the same reason `serializeError` is one
 * (ADR-0026): the payload is persisted, and copying an event wholesale would
 * put model output, tool arguments and tool results into a trace nothing has
 * redacted yet. M2-T9 owns redaction; the rule this package keeps is that the
 * trace carries the shape of the run and none of its content.
 *
 * What is kept here is the cross-reference a reader needs to line a harness
 * trace up against eve's own durable stream: the event's `meta.id`, its turn,
 * and its step index. Each caller in `EveAgentRuntime` adds the few typed
 * fields its taxonomy member needs on top — a model id, a tool name, a status,
 * a failure code. What is never added: assistant text, reasoning, tool inputs,
 * tool outputs, the structured result, or the text of an input request.
 */
export function eveEventIdentity(event: MessageStreamEvent): JsonObject {
  const turnId = eventTurnId(event);
  const stepIndex = stepIndexOf(event);

  return {
    eveEventId: event.meta.id,
    ...(turnId === undefined ? {} : { turnId }),
    ...(stepIndex === undefined ? {} : { stepIndex }),
  };
}

/** The `callId` one action result settles, which is what binds it to its request. */
export function actionResultCallId(result: EveActionResult): string {
  return result.callId;
}

function stepIndexOf(event: MessageStreamEvent): number | undefined {
  if (!("data" in event)) {
    return undefined;
  }

  return numberOrUndefined((event.data as { readonly stepIndex?: unknown }).stepIndex);
}

/** The `code` of an `action.result` error, or `"UNKNOWN"` when it carries none. */
export function readErrorCode(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "UNKNOWN";
  }

  const code: unknown = (error as { readonly code?: unknown }).code;

  return typeof code === "string" ? code : "UNKNOWN";
}
