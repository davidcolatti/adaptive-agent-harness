import {
  createNoopTraceWriter,
  createTraceRecorder,
  type JsonObject,
  newRunId,
  serializeError,
  ToolExecutionError,
  type TraceEvent,
  type TraceEventInput,
  ValidationError,
} from "@internal/core";
import { describe, expect, it } from "vitest";
import {
  createRedactionPolicy,
  createRedactor,
  DEFAULT_REDACTION_POLICY,
  redactEvents,
  redactionToken,
} from "./redaction.js";

/**
 * M2-T9's acceptance criterion is "seeded secrets never appear in stored trace
 * payloads", so this suite seeds secrets.
 *
 * **Every fake credential below is assembled at runtime from fragments**, so
 * that no string in this file looks like a credential to a scanner. The
 * repository's pre-commit hook runs `secretlint` over staged files; a test that
 * spelled a plausible AWS key out in full would block every commit that touched
 * it, and weakening the scanner's configuration to let a test pass would be
 * exactly the wrong trade. `pnpm exec secretlint --no-glob -- packages/trace/src/*.test.ts`
 * is part of this task's verification.
 *
 * The values are fake in substance as well as in form: the bodies are the words
 * `fake`, `FAKE` and runs of digits, never anything that could be a live
 * credential at any provider.
 */
function seed(...parts: readonly string[]): string {
  return parts.join("");
}

const FAKE = {
  /** `AKIA` plus 16 uppercase alphanumerics. */
  awsAccessKeyId: seed("AK", "IA", "FAKEFAKEFAKEFAK0"),
  /** An OpenAI-style unscoped key. */
  openaiKey: seed("sk", "-", "fakefakefakefakefake00"),
  /** An environment-scoped `sk_test_` key. */
  stripeTestKey: seed("sk", "_", "test", "_", "fakefakefake0000"),
  /** A GitHub personal access token: prefix plus 36 characters. */
  githubToken: seed("gh", "p", "_", "A".repeat(36)),
  /** A Slack bot token. */
  slackToken: seed("xo", "x", "b", "-", "111111111111-2222222222222-fakefakefakefakefake"),
  /** Three base64url segments, the header starting `eyJ`. */
  jwt: [
    seed("ey", "J", "hbGciOiJIUzI1NiJ9"),
    seed("ey", "J", "zdWIiOiJmYWtlLXVzZXIifQ"),
    "ZmFrZS1zaWduYXR1cmUtMDAw",
  ].join("."),
  /** A Supabase secret API key. */
  supabaseSecretKey: seed("sb", "_", "secret", "_", "fake0000fake0000"),
  /** A Supabase personal access token. */
  supabaseAccessToken: seed("sb", "p", "_", "fake0000fake0000fake"),
  /** A Vercel AI Gateway API key, the shape `AI_GATEWAY_API_KEY` carries. */
  vercelGatewayKey: seed("vck", "_", "fake0000fake0000fake"),
  /** A full `Authorization` value. */
  bearerHeader: seed("Bearer ", "fake-bearer-token-value-0000"),
  /** A full `Authorization` value, base64 of a fake `user:password`. */
  basicHeader: seed("Basic ", "ZmFrZTpmYWtl", "cGFzc3dvcmQ", "=="),
  /** A PEM private-key block. */
  privateKeyBlock: [
    seed("-----BEGIN", " RSA PRIVATE KEY-----"),
    "ZmFrZS1rZXktbWF0ZXJpYWw=",
    seed("-----END", " RSA PRIVATE KEY-----"),
  ].join("\n"),
} as const;

/** Every default pattern rule, with a seeded value that must trigger it. */
const PATTERN_CASES: readonly (readonly [rule: string, value: string])[] = [
  ["aws-access-key-id", FAKE.awsAccessKeyId],
  ["github-token", FAKE.githubToken],
  ["slack-token", FAKE.slackToken],
  ["supabase-secret-key", FAKE.supabaseSecretKey],
  ["supabase-access-token", FAKE.supabaseAccessToken],
  ["vercel-ai-gateway-key", FAKE.vercelGatewayKey],
  ["api-key-sk-prefix", FAKE.openaiKey],
  ["api-key-sk-prefix", FAKE.stripeTestKey],
  ["jwt", FAKE.jwt],
  ["private-key-block", FAKE.privateKeyBlock],
];

const BEHAVIOR_FINGERPRINT = `sha256:${"a".repeat(64)}`;

const recorder = createTraceRecorder({
  runId: newRunId(),
  writer: createNoopTraceWriter(),
  behaviorFingerprint: BEHAVIOR_FINGERPRINT,
});

/** A real event, stamped the way a run stamps one. */
async function event(input: TraceEventInput): Promise<TraceEvent> {
  return await recorder.record(input);
}

/** The redacted `payload` of an event built from `input`. */
async function redactPayload(payload: JsonObject): Promise<JsonObject> {
  const redacted = createRedactor().redactEvent(await event({ type: "agent.completed", payload }));

  return redacted.payload;
}

describe("field-path redaction", () => {
  it("matches any depth with `**` and exactly one segment with `*`", async () => {
    const redactor = createRedactor(
      createRedactionPolicy({
        fieldPaths: [
          { name: "deep", path: "payload.**.marker" },
          { name: "shallow", path: "payload.*.only" },
        ],
      }),
    );
    const source = await event({
      type: "agent.completed",
      payload: {
        marker: "a",
        nested: { marker: "b", only: "c" },
        deeper: { inner: { marker: "d", only: "e" } },
      },
    });

    expect(redactor.redactEvent(source).payload).toEqual({
      // `**` matches zero segments as well as many.
      marker: redactionToken("deep"),
      nested: { marker: redactionToken("deep"), only: redactionToken("shallow") },
      // `*` is exactly one segment, so `deeper.inner.only` is two too deep.
      deeper: { inner: { marker: redactionToken("deep"), only: "e" } },
    });
  });

  it("compares segments case-insensitively by default", async () => {
    expect(await redactPayload({ APIKEY: "x", ApiKey: "y", apikey: "z" })).toEqual({
      APIKEY: redactionToken("api-key"),
      ApiKey: redactionToken("api-key"),
      apikey: redactionToken("api-key"),
    });
  });

  it("compares segments case-sensitively when the rule asks", async () => {
    const redactor = createRedactor(
      createRedactionPolicy({
        fieldPaths: [{ name: "exact", path: "payload.Vendor", caseSensitive: true }],
      }),
    );
    const source = await event({
      type: "agent.completed",
      payload: { Vendor: "matched", vendor: "not matched" },
    });

    expect(redactor.redactEvent(source).payload).toEqual({
      Vendor: redactionToken("exact"),
      vendor: "not matched",
    });
  });

  it("addresses array elements by index", async () => {
    const redactor = createRedactor(
      createRedactionPolicy({
        fieldPaths: [
          { name: "second-code", path: "payload.items.1.code" },
          { name: "every-value", path: "payload.items.*.value" },
        ],
      }),
    );
    const source = await event({
      type: "agent.completed",
      payload: {
        items: [
          { code: "keep", value: "a" },
          { code: "drop", value: "b" },
        ],
      },
    });

    expect(redactor.redactEvent(source).payload).toEqual({
      items: [
        { code: "keep", value: redactionToken("every-value") },
        { code: redactionToken("second-code"), value: redactionToken("every-value") },
      ],
    });
  });

  it("leaves a payload no rule matches exactly as it was", async () => {
    const payload = {
      tool: "lookup_vendor_evidence",
      callId: "call-1",
      status: "completed",
      counts: { attempts: 2 },
      flags: [true, false, null],
    };

    expect(await redactPayload(payload)).toEqual(payload);
  });

  it("replaces a matched object whole, whatever its type", async () => {
    const redactor = createRedactor(
      createRedactionPolicy({ fieldPaths: [{ name: "vendor", path: "payload.vendor" }] }),
    );
    const source = await event({
      type: "agent.completed",
      payload: { vendor: { name: "Northwind Ledger", contacts: [{ email: "a@b.test" }] } },
    });

    expect(redactor.redactEvent(source).payload).toEqual({ vendor: redactionToken("vendor") });
  });
});

describe("secret-pattern redaction", () => {
  it.each(PATTERN_CASES)("redacts a seeded %s and names the rule", (rule, value) => {
    expect(createRedactor().redactValue(value)).toBe(redactionToken(rule));
  });

  it("keeps the `Bearer` scheme and redacts only the credential", () => {
    expect(createRedactor().redactValue(FAKE.bearerHeader)).toBe(
      `Bearer ${redactionToken("authorization-bearer")}`,
    );
  });

  it("keeps the `Basic` scheme and redacts only the credential", () => {
    expect(createRedactor().redactValue(FAKE.basicHeader)).toBe(
      `Basic ${redactionToken("authorization-basic")}`,
    );
  });

  it("replaces only the matched span, leaving the sentence around it", () => {
    const value = `the gateway rejected ${FAKE.vercelGatewayKey} at 12:04`;

    expect(createRedactor().redactValue(value)).toBe(
      `the gateway rejected ${redactionToken("vercel-ai-gateway-key")} at 12:04`,
    );
  });

  it("replaces two different secrets in one string", () => {
    const value = `key=${FAKE.awsAccessKeyId} token=${FAKE.githubToken}`;

    expect(createRedactor().redactValue(value)).toBe(
      `key=${redactionToken("aws-access-key-id")} token=${redactionToken("github-token")}`,
    );
  });

  it("replaces every occurrence of one rule, not just the first", () => {
    const value = `${FAKE.awsAccessKeyId} then ${FAKE.awsAccessKeyId}`;
    const token = redactionToken("aws-access-key-id");

    expect(createRedactor().redactValue(value)).toBe(`${token} then ${token}`);
  });

  it.each([
    ["a behavior fingerprint", BEHAVIOR_FINGERPRINT],
    ["a UUIDv7 run id", newRunId() as string],
    ["an ordinary sentence", "The vendor changed its payment details on 3 September."],
    ["prose after the word Basic", "Basic authenticationfailed for this endpoint."],
    ["prose after the word Bearer", "Bearer token missing from the request."],
    ["a tool id", "lookup_vendor_evidence"],
    ["an ISO timestamp", "2026-09-19T22:31:00.000Z"],
  ])("does not fire on %s", (_label, value) => {
    expect(createRedactor().redactValue(value)).toBe(value);
  });

  it("is idempotent: a second pass finds nothing left", () => {
    const redactor = createRedactor();
    const once = redactor.redactValue(`key=${FAKE.awsAccessKeyId}`);

    expect(redactor.redactValue(once)).toBe(once);
  });
});

describe("headers redaction", () => {
  it("redacts known header names inside a `headers` object at any depth", async () => {
    const payload = await redactPayload({
      request: {
        headers: {
          authorization: "anything at all",
          cookie: "session=1",
          "x-api-key": "k",
          "content-type": "application/json",
        },
      },
    });

    expect(payload).toEqual({
      request: {
        headers: {
          authorization: redactionToken("header"),
          cookie: redactionToken("header"),
          "x-api-key": redactionToken("header"),
          "content-type": "application/json",
        },
      },
    });
  });

  it("matches header names and the `headers` key case-insensitively", async () => {
    expect(
      await redactPayload({ Headers: { Authorization: "x", "X-Auth-Token": "y", Accept: "z" } }),
    ).toEqual({
      Headers: {
        Authorization: redactionToken("header"),
        "X-Auth-Token": redactionToken("header"),
        Accept: "z",
      },
    });
  });

  it("leaves a header-named key that is not under a `headers` object to the other rules", async () => {
    expect(await redactPayload({ cookie: "session=1", authorization: "Basic-ish" })).toEqual({
      cookie: "session=1",
      authorization: "Basic-ish",
    });
  });
});

describe("tool-specific sanitizer hooks", () => {
  const policy = createRedactionPolicy({
    toolSanitizers: [
      {
        toolId: "lookup_vendor_evidence",
        sanitize: (payload) => ({ ...payload, evidence: "[omitted by the domain]" }),
      },
    ],
  });

  it("replaces a field on the tool it is keyed to", async () => {
    const source = await event({
      type: "tool.completed",
      payload: { tool: "lookup_vendor_evidence", callId: "call-1", evidence: "vendor dossier" },
    });

    expect(createRedactor(policy).redactEvent(source).payload).toEqual({
      tool: "lookup_vendor_evidence",
      callId: "call-1",
      evidence: "[omitted by the domain]",
    });
  });

  it("puts a hook's own output through the generic rules", async () => {
    const leaky = createRedactionPolicy({
      toolSanitizers: [
        {
          toolId: "lookup_vendor_evidence",
          sanitize: () => ({
            tool: "lookup_vendor_evidence",
            note: `re-authenticated with ${FAKE.githubToken}`,
            apiKey: "kept only because the hook put it back",
          }),
        },
      ],
    });
    const source = await event({
      type: "tool.completed",
      payload: { tool: "lookup_vendor_evidence" },
    });

    expect(createRedactor(leaky).redactEvent(source).payload).toEqual({
      tool: "lookup_vendor_evidence",
      note: `re-authenticated with ${redactionToken("github-token")}`,
      apiKey: redactionToken("api-key"),
    });
  });

  it("does not fire for a different tool", async () => {
    const source = await event({
      type: "tool.completed",
      payload: { tool: "echo_fixture", evidence: "vendor dossier" },
    });

    expect(createRedactor(policy).redactEvent(source).payload).toEqual({
      tool: "echo_fixture",
      evidence: "vendor dossier",
    });
  });

  it("does not fire on a non-tool event that happens to name a tool", async () => {
    const source = await event({
      type: "agent.completed",
      payload: { tool: "lookup_vendor_evidence", evidence: "vendor dossier" },
    });

    expect(createRedactor(policy).redactEvent(source).payload).toEqual({
      tool: "lookup_vendor_evidence",
      evidence: "vendor dossier",
    });
  });

  it("rejects a hook that returns something JSON cannot represent", async () => {
    const broken = createRedactionPolicy({
      toolSanitizers: [
        {
          toolId: "lookup_vendor_evidence",
          // The cast is the point of the test: a JavaScript caller can return
          // this, and the redactor has to refuse it rather than write it.
          sanitize: () => ({ at: new Date() }) as unknown as JsonObject,
        },
      ],
    });
    const source = await event({
      type: "tool.completed",
      payload: { tool: "lookup_vendor_evidence" },
    });

    expect(() => createRedactor(broken).redactEvent(source)).toThrow(ValidationError);
  });
});

describe("redactEvent: scope inside an event", () => {
  async function failedEvent(): Promise<TraceEvent> {
    const cause = new Error(`upstream rejected ${FAKE.bearerHeader}`);
    const failure = new ToolExecutionError(`lookup failed for ${FAKE.awsAccessKeyId}`, {
      toolId: "lookup_vendor_evidence",
      cause,
      details: { apiKey: FAKE.openaiKey, note: `signed with ${FAKE.jwt}` },
    });

    return await event({
      type: "tool.failed",
      payload: { tool: "lookup_vendor_evidence", status: "failed" },
      error: serializeError(failure),
    });
  }

  it("redacts an error's message, its `details`, and its `cause` chain", async () => {
    const redacted = createRedactor().redactEvent(await failedEvent());

    expect(redacted.error?.message).toBe(
      `lookup failed for ${redactionToken("aws-access-key-id")}`,
    );
    // ADR-0026 is explicit that `details` is not itself a redaction boundary.
    expect(redacted.error?.details).toEqual({
      toolId: "lookup_vendor_evidence",
      apiKey: redactionToken("api-key"),
      note: `signed with ${redactionToken("jwt")}`,
    });
    expect(redacted.error?.cause?.message).toBe(
      `upstream rejected Bearer ${redactionToken("authorization-bearer")}`,
    );
  });

  it("leaves an error's `name` and `code` alone, because they are discriminants", async () => {
    const source = await failedEvent();
    const redacted = createRedactor().redactEvent(source);

    expect(redacted.error?.name).toBe("ToolExecutionError");
    expect(redacted.error?.code).toBe("TOOL_EXECUTION");
  });

  it("never touches identity, ordering or fingerprint fields", async () => {
    const source = await event({
      type: "model.completed",
      payload: { model: "openai/gpt-5.6-luna-fast" },
      usage: { modelCalls: 1, inputTokens: 12, costUsd: 0.0004 },
      latencyMs: 31,
    });
    const redacted = createRedactor().redactEvent(source);

    expect(redacted.id).toBe(source.id);
    expect(redacted.runId).toBe(source.runId);
    expect(redacted.attempt).toBe(source.attempt);
    expect(redacted.sequence).toBe(source.sequence);
    expect(redacted.timestamp).toBe(source.timestamp);
    expect(redacted.type).toBe(source.type);
    expect(redacted.parentId).toBe(source.parentId);
    expect(redacted.node).toBe(source.node);
    expect(redacted.version).toBe(source.version);
    expect(redacted.behaviorFingerprint).toBe(BEHAVIOR_FINGERPRINT);
    expect(redacted.usage).toEqual(source.usage);
    expect(redacted.latencyMs).toBe(31);
  });

  it("returns a frozen event and leaves the input untouched", async () => {
    const source = await event({
      type: "agent.completed",
      payload: { apiKey: FAKE.openaiKey, nested: { token: FAKE.githubToken } },
    });
    const before = structuredClone(source) as unknown as TraceEvent;
    const redacted = createRedactor().redactEvent(source);

    expect(Object.isFrozen(redacted)).toBe(true);
    expect(source).toEqual(before);
    expect(redacted).not.toBe(source);
    expect(redacted.payload).not.toBe(source.payload);
  });

  it("keeps a whole-payload match as an object, so the event is still storable", async () => {
    const redactor = createRedactor(
      createRedactionPolicy({ fieldPaths: [{ name: "everything", path: "payload" }] }),
    );
    const source = await event({ type: "agent.completed", payload: { a: 1 } });

    expect(redactor.redactEvent(source).payload).toEqual({
      redacted: redactionToken("everything"),
    });
  });
});

describe("createRedactionPolicy", () => {
  it("appends to the defaults rather than replacing them", () => {
    const policy = createRedactionPolicy({
      fieldPaths: [{ name: "extra", path: "payload.extra" }],
      headers: ["x-vendor-signature"],
    });

    expect(policy.fieldPaths).toEqual([
      ...DEFAULT_REDACTION_POLICY.fieldPaths,
      { name: "extra", path: "payload.extra" },
    ]);
    expect(policy.headers).toEqual([...DEFAULT_REDACTION_POLICY.headers, "x-vendor-signature"]);
    expect(policy.patterns).toEqual(DEFAULT_REDACTION_POLICY.patterns);
  });

  it("rejects a pattern that is not global, which would redact only the first match", () => {
    expect(() =>
      createRedactionPolicy({ patterns: [{ name: "once", pattern: /secret-\d+/ }] }),
    ).toThrow(ValidationError);
  });
});

describe("redactEvents", () => {
  it("redacts a batch in order", async () => {
    const events = [
      await event({ type: "agent.started", payload: { apiKey: FAKE.openaiKey } }),
      await event({ type: "agent.completed", payload: { note: `used ${FAKE.jwt}` } }),
    ];
    const redacted = redactEvents(events);

    expect(redacted.map((one) => one.type)).toEqual(["agent.started", "agent.completed"]);
    expect(redacted[0]?.payload).toEqual({ apiKey: redactionToken("api-key") });
    expect(redacted[1]?.payload).toEqual({ note: `used ${redactionToken("jwt")}` });
  });
});
