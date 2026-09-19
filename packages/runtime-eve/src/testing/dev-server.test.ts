import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRecordedDevServerUrl } from "./dev-server.js";

/**
 * Unit tests for the piece of `startEveDevServer()` that can be tested without
 * a process: how it reads the record `eve dev` leaves behind.
 *
 * That record is why a second `pnpm example:run:mock` could fail.
 * `eve/docs/reference/cli.md` documents both halves of the rule:
 *
 * > Local dev records the last ready URL per resolved app root in
 * > `.eve/dev-server-state.v1.json`. … A stale or malformed record is replaced
 * > when eve starts a new server. Passing `--host`, `--port`, or a `PORT`
 * > environment value skips reconnection and reports a healthy recorded server
 * > instead.
 *
 * So a record alone is harmless, and only a record whose server still answers
 * blocks a start. The reader below must therefore be **total**: every
 * unreadable, absent or malformed case has to come back `undefined` so the
 * helper starts a server rather than refusing on a file it failed to parse.
 */

const roots: string[] = [];

function createAppRoot(record?: string): string {
  const root = mkdtempSync(join(tmpdir(), "eve-dev-state-"));
  roots.push(root);

  if (record !== undefined) {
    mkdirSync(join(root, ".eve"), { recursive: true });
    writeFileSync(join(root, ".eve", "dev-server-state.v1.json"), record, "utf8");
  }

  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("readRecordedDevServerUrl", () => {
  it("reads the URL eve recorded", () => {
    const root = createAppRoot('{"url":"http://127.0.0.1:49895/"}\n');

    expect(readRecordedDevServerUrl(root)).toBe("http://127.0.0.1:49895/");
  });

  it("returns undefined when no server has ever run for the app root", () => {
    expect(readRecordedDevServerUrl(createAppRoot())).toBeUndefined();
  });

  it("returns undefined for a malformed record rather than throwing", () => {
    // eve's own wording is "stale or malformed", and its documented response to
    // both is to start a new server. Throwing here would turn a corrupt file
    // into a permanently broken app root.
    expect(readRecordedDevServerUrl(createAppRoot("not json at all"))).toBeUndefined();
    expect(readRecordedDevServerUrl(createAppRoot("{}"))).toBeUndefined();
    expect(readRecordedDevServerUrl(createAppRoot('{"url":null}'))).toBeUndefined();
    expect(readRecordedDevServerUrl(createAppRoot('{"url":""}'))).toBeUndefined();
    expect(readRecordedDevServerUrl(createAppRoot('["http://127.0.0.1:1/"]'))).toBeUndefined();
  });

  it("returns undefined for a path that is not an app root at all", () => {
    expect(readRecordedDevServerUrl(join(tmpdir(), "definitely-not-here-12345"))).toBeUndefined();
  });

  it("never writes or deletes the record", () => {
    // The harness reads eve's state and never manages it: eve replaces a stale
    // record itself, and removing one would be reaching into another tool's
    // internals for no benefit.
    const root = createAppRoot('{"url":"http://127.0.0.1:49895/"}');

    readRecordedDevServerUrl(root);
    readRecordedDevServerUrl(root);

    expect(readRecordedDevServerUrl(root)).toBe("http://127.0.0.1:49895/");
  });
});
