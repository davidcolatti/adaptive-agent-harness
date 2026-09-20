/**
 * The default secret-pattern set (M2-T9), and what each rule claims.
 *
 * A pattern rule is applied to **every string leaf** a trace event carries and
 * replaces only the span it matched, so a sentence that happens to contain a
 * credential keeps its sentence. That is the opposite of field-path redaction,
 * which replaces a whole value because of *where* it sits.
 *
 * Two rules govern what may be in this list.
 *
 * 1. **Every entry matches a token format an issuer documents.** A guess would
 *    produce either a rule that never fires or one that fires on ordinary text,
 *    and both are worse than no rule. The format each entry claims is cited
 *    below, and the citations are repeated in the WORKLOG entry for M2-T9.
 * 2. **No generic high-entropy heuristic.** Every identifier this harness
 *    writes is high entropy on purpose — a UUIDv7 id, a `sha256:` behavior
 *    fingerprint, an eve `callId` — so an entropy rule would redact the trace's
 *    own structure and make a run unreadable while catching nothing a prefix
 *    rule misses. ADR-0035 records it, and says what an opt-in entropy rule
 *    would have to look like if a domain ever wants one.
 *
 * Each rule's `name` appears in the token it leaves behind
 * (`[REDACTED:aws-access-key-id]`), so a reader of a stored trace can tell what
 * was removed and why without access to this file.
 */

/** One regular expression applied to every string in a trace event. */
export interface SecretPatternRule {
  /**
   * The stable name that appears in the redaction token. Kebab-case, and it
   * never changes once a trace has been written with it, because a stored
   * trace is read long after this file changes.
   */
  readonly name: string;
  /**
   * The pattern. **Must carry the `g` flag**, because redaction replaces every
   * occurrence in a string rather than the first;
   * `createRedactionPolicy()` rejects one that does not.
   *
   * It must also be unable to match the empty string, or replacement would not
   * terminate usefully. Every rule below is anchored by a literal prefix or a
   * minimum length.
   */
  readonly pattern: RegExp;
}

/**
 * The shipped default rules, in application order.
 *
 * Order matters only where two rules can match the same span: the PEM block
 * runs first because it is multi-line and would otherwise be partly consumed,
 * and the two `Authorization` value rules run last so that a token whose own
 * format is recognized (a JWT, a GitHub token) names itself in the token rather
 * than being reported as an opaque bearer credential.
 */
export const DEFAULT_SECRET_PATTERN_RULES: readonly SecretPatternRule[] = Object.freeze([
  {
    // A PEM block of any private-key flavour (`RSA`, `EC`, `OPENSSH`, or the
    // unlabelled PKCS#8 form). Non-greedy to the matching END line, so two
    // concatenated keys are two matches rather than one span swallowing the
    // text between them.
    name: "private-key-block",
    pattern:
      /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z]+ )?PRIVATE KEY-----/g,
  },
  {
    // AWS access key id: the literal `AKIA` followed by 16 uppercase
    // alphanumerics, the format AWS documents for a long-lived access key.
    name: "aws-access-key-id",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    // GitHub's prefixed tokens: personal (`ghp_`), OAuth (`gho_`), user-to-server
    // (`ghu_`), server-to-server (`ghs_`) and refresh (`ghr_`), each followed by
    // 36 characters.
    name: "github-token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g,
  },
  {
    // Slack's `xox`-prefixed tokens: app (`xoxa`), bot (`xoxb`), user (`xoxp`)
    // and refresh (`xoxr`).
    name: "slack-token",
    pattern: /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    // Supabase secret API key. Supabase's "API keys" guide documents the
    // `sb_secret_…` form as the replacement for the legacy `service_role` key
    // (which is a JWT, and is caught by the `jwt` rule below).
    name: "supabase-secret-key",
    pattern: /\bsb_secret_[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    // Supabase personal access token. Supabase's "Personal Access Tokens" guide
    // documents the `sbp_` prefix; it is what `SUPABASE_ACCESS_TOKEN` and the
    // CLI's stored credential carry, which M2-T11 brings into this repository.
    name: "supabase-access-token",
    pattern: /\bsbp_[A-Za-z0-9]{16,}\b/g,
  },
  {
    // Vercel AI Gateway API key. Vercel's AI Gateway "API Keys" page documents
    // the `vck_` prefix, and `AI_GATEWAY_API_KEY` — the one credential
    // `pnpm example:run` needs — carries it.
    name: "vercel-ai-gateway-key",
    pattern: /\bvck_[A-Za-z0-9]{16,}\b/g,
  },
  {
    // The `sk-` family: OpenAI-style `sk-…` keys and the `sk_live_` / `sk_test_`
    // / `sk_proj_` environment-scoped variants several providers use. The
    // unscoped form demands 20 characters so that prose containing `sk-` cannot
    // reach it.
    name: "api-key-sk-prefix",
    pattern: /\bsk[-_](?:live|test|proj)[-_][A-Za-z0-9]{12,}\b|\bsk-[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    // A JSON Web Token: three base64url segments, the first being the
    // `{"alg":…` header, which always base64url-encodes to a leading `eyJ`.
    // This is what catches a Supabase legacy `anon`/`service_role` key.
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  {
    // The credential half of an `Authorization: Bearer …` value. The lookbehind
    // keeps the `Bearer` scheme in the output, so a reader still sees *what kind
    // of* header was there. 16 characters minimum, so "Bearer token missing" in
    // an error message is left alone.
    name: "authorization-bearer",
    pattern: /(?<=\bBearer\s+)[A-Za-z0-9\-._~+/]{16,}=*/gi,
  },
  {
    // The credential half of an `Authorization: Basic …` value. The two
    // lookaheads require the mixed case real base64 of `user:password` has, so
    // that prose such as "Basic authentication required" does not match.
    name: "authorization-basic",
    pattern:
      /(?<=\bBasic\s+)(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])[A-Za-z0-9+/]{16,}={0,2}/g,
  },
]);
