/**
 * Conservative secret redaction before anything leaves OpenClaw for PCP (and
 * before it is written to the on-disk retry queue).
 *
 * Starts from PCP's own wild-export patterns (src/lib/ingest-export.ts) and
 * adds well-known token shapes. Replaces only the sensitive value and reports
 * the kind, never the value.
 */

const PATTERNS = [
  { kind: "private_key", re: /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g, replace: () => "<REDACTED:private_key>" },
  { kind: "bearer_token", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, replace: () => "Bearer <REDACTED>" },
  { kind: "basic_auth_url", re: /\b([a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)[^@\s/]+(@)/gi, replace: (_m, a, b) => `${a}<REDACTED>${b}` },
  { kind: "pcp_token", re: /\bpcps_[0-9a-f]{16,}\b/g, replace: () => "<REDACTED>" },
  { kind: "github_token", re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, replace: () => "<REDACTED>" },
  { kind: "api_key", re: /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g, replace: () => "<REDACTED>" },
  { kind: "slack_token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, replace: () => "<REDACTED>" },
  { kind: "google_api_key", re: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: () => "<REDACTED>" },
  { kind: "aws_access_key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, replace: () => "<REDACTED>" },
  { kind: "telegram_bot_token", re: /\b\d{8,10}:AA[A-Za-z0-9_-]{30,}\b/g, replace: () => "<REDACTED>" },
  { kind: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, replace: () => "<REDACTED:jwt>" },
  { kind: "cookie", re: /\b((?:set-)?cookie\s*:\s*)[^\r\n]+/gi, replace: (_m, label) => `${label}<REDACTED>` },
  {
    kind: "labeled_secret",
    re: /\b(api[_-]?key|access[_-]?key|secret(?:[_-]?key)?|client[_-]?secret|token|access[_-]?token|refresh[_-]?token|auth[_-]?token|password|passwd|pwd|passphrase)("?\s*[:=]\s*"?)([^\s"',]{6,})/gi,
    replace: (_m, label, sep) => `${label}${sep}<REDACTED>`,
  },
];

/** @returns {{ text: string, redactions: string[] }} */
export function redactSecrets(input) {
  let text = typeof input === "string" ? input : String(input ?? "");
  const redactions = [];
  for (const { kind, re, replace } of PATTERNS) {
    text = text.replace(re, (...args) => {
      // Already-redacted placeholders are left alone (idempotent).
      if (/^[^<]*<REDACTED/.test(args[0]) && !/[A-Za-z0-9]{12,}$/.test(args[0])) return args[0];
      redactions.push(kind);
      return replace(...args);
    });
  }
  return { text, redactions };
}
