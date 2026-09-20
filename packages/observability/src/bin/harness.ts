#!/usr/bin/env node
import { runHarnessCli } from "../cli.js";

/**
 * The `harness` executable (M2-T10).
 *
 * Deliberately three lines of substance: every decision the CLI makes lives in
 * `../cli.ts`, which takes its argv, environment and output sinks as arguments
 * so the whole command is unit-testable without a subprocess. This file is the
 * only part that touches `process`, and it is therefore the only part no test
 * covers.
 *
 * Invoked through the root `pnpm harness` script, which builds this package and
 * then runs the compiled file with `--env-file-if-exists=.env.local` so a local
 * Supabase's URL and key are in the environment exactly as they are for
 * `pnpm example:run`. pnpm forwards the positional arguments to the last
 * command of the script's `&&` chain, so `pnpm harness run show <id> --json`
 * arrives here intact and needs no `--` separator.
 */
process.exitCode = await runHarnessCli({
  argv: process.argv.slice(2),
  env: process.env,
  write: (text) => process.stdout.write(text),
  writeError: (text) => process.stderr.write(text),
  isTty: process.stdout.isTTY === true,
});
