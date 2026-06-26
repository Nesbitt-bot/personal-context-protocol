/**
 * Pure builders that turn already-recorded session data into PCP fallback JSON
 * for the admin Import/Export panel. Used by the UI and unit tests.
 *
 * - Strict export reproduces stored message text exactly (it may contain secrets
 *   if the stored session does — the UI warns about this).
 * - Wild export runs a conservative redaction pass and records what was redacted.
 *
 * Tokens are credentials for transport only and are NEVER part of message
 * content, so they never appear in an export.
 */

import { INGEST_SCHEMA_VERSION } from './agent-schema';

export interface ExportMessage {
  role: string;
  content: string;
  provider?: string | null;
  base_model?: string | null;
  BaseModel?: string | null;
  observed_at?: string | null;
  observedAt?: string | null;
}

export interface ExportCompaction {
  summary: string;
  timeline?: unknown;
  decisions?: unknown;
  requirements?: unknown;
  open_questions?: unknown;
  artifacts?: unknown;
  warnings?: unknown;
  provider?: string | null;
  base_model?: string | null;
}

// High-precision secret patterns. Each replaces only the sensitive value with a
// placeholder and reports the kind of redaction (never the value).
const SECRET_PATTERNS: Array<{ kind: string; re: RegExp; replace: (m: string, ...g: string[]) => string }> = [
  { kind: 'bearer_token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, replace: () => 'Bearer <REDACTED>' },
  { kind: 'postgres_url', re: /\b(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+(@)/gi, replace: (_m, a, b) => `${a}<REDACTED>${b}` },
  { kind: 'private_key', re: /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g, replace: () => '<REDACTED:private_key>' },
  { kind: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/g, replace: () => '<REDACTED>' },
  { kind: 'labeled_secret', re: /\b(api[_-]?key|secret|token|password|passwd|pwd)("?\s*[:=]\s*"?)([^\s"',]{6,})/gi, replace: (_m, label, sep) => `${label}${sep}<REDACTED>` },
];

export interface RedactionResult {
  text: string;
  redactions: string[];
}

/** Conservatively replace common secret shapes with placeholders. */
export function redactSecrets(input: string): RedactionResult {
  let text = input;
  const redactions: string[] = [];
  for (const { kind, re, replace } of SECRET_PATTERNS) {
    text = text.replace(re, (...args) => {
      redactions.push(kind);
      // The matched string is the first arg; cast the variadic for the replacer.
      return (replace as (...a: unknown[]) => string)(...args);
    });
  }
  return { text, redactions };
}

const observedOf = (m: ExportMessage) => m.observed_at ?? m.observedAt ?? null;
const modelOf = (m: ExportMessage) => m.base_model ?? m.BaseModel ?? 'unknown';

export interface IngestExportOptions {
  sessionId: string;
  mode: 'wild' | 'strict';
  suggestedTitle?: string | null;
}

/** Build a `pcp_ingest` JSON object from recorded messages. */
export function buildIngestExport(messages: ExportMessage[], options: IngestExportOptions) {
  const warnings: string[] = [];
  let anyRedacted = false;

  const outMessages = messages.map((message) => {
    const redactions: string[] = [];
    let content = message.content;
    if (options.mode === 'wild') {
      const r = redactSecrets(message.content);
      content = r.text;
      redactions.push(...r.redactions);
      if (r.redactions.length) anyRedacted = true;
    }
    return {
      role: message.role,
      content,
      content_type: 'text/markdown',
      created_at: null as string | null,
      observed_at: observedOf(message),
      provider: message.provider ?? 'unknown',
      base_model: modelOf(message),
      source: { recorded_by: 'pcp_export', confidence: 'exact' },
      metadata: { sensitive_redactions: redactions },
    };
  });

  if (options.mode === 'strict') {
    warnings.push('Strict export reproduces stored text exactly and may contain secrets if the session does.');
  } else if (anyRedacted) {
    warnings.push('Wild export: some values matching secret patterns were replaced with <REDACTED>.');
  }

  return {
    schema_version: INGEST_SCHEMA_VERSION,
    session_id: options.sessionId,
    mode: options.mode,
    suggested_session_title: options.suggestedTitle ?? null,
    messages: outMessages,
    compaction: null,
    warnings,
  };
}

/** Build a `pcp_compact` JSON object from a stored compaction. */
export function buildCompactExport(compaction: ExportCompaction, options: { sessionId: string; mode: 'wild' | 'strict'; suggestedTitle?: string | null }) {
  const summary = options.mode === 'wild' ? redactSecrets(compaction.summary).text : compaction.summary;
  return {
    schema_version: INGEST_SCHEMA_VERSION,
    session_id: options.sessionId,
    mode: options.mode,
    suggested_session_title: options.suggestedTitle ?? null,
    summary,
    timeline: compaction.timeline ?? [],
    decisions: compaction.decisions ?? [],
    requirements: compaction.requirements ?? [],
    open_questions: compaction.open_questions ?? [],
    artifacts: compaction.artifacts ?? [],
    warnings: [] as string[],
  };
}
