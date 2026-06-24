/**
 * Forgiving ingestion parser for the agent `ingest_any` route.
 *
 * Accepts whatever an AI agent can most easily produce and normalizes it into
 * either append-able messages or a compaction record:
 *
 *   - { "messages": [ ... ] }
 *   - <PCP_APPEND> ... </PCP_APPEND>     (JSON: array or { messages })
 *   - <PCP_COMPACT> ... </PCP_COMPACT>   (JSON object, or plain summary text)
 *   - simple ChatML-like arrays:  [ { role, content }, ... ]
 *   - raw markdown / text transcript ("User: ...\nAssistant: ...")
 *
 * Pure and self-contained so it can be unit-tested. Returns a discriminated
 * result; the route turns `{ kind: 'error' }` into structured retry guidance.
 */

import { MAX_MESSAGES_PER_REQUEST } from './agent-protocol';

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool' | 'correction';

export interface NormalizedMessage {
  role: MessageRole;
  content: string;
  provider?: string;
  base_model?: string;
}

export interface NormalizedCompact {
  summary: string;
  timeline?: unknown;
  decisions?: unknown;
  requirements?: unknown;
  open_questions?: unknown;
  artifacts?: unknown;
  warnings?: unknown;
  provider?: string;
  base_model?: string;
  metadata?: Record<string, unknown>;
}

export type IngestResult =
  | { kind: 'messages'; messages: NormalizedMessage[] }
  | { kind: 'compact'; compact: NormalizedCompact }
  | { kind: 'error'; reason: string };

const ROLE_LINE = /^\s*(user|assistant|system|tool|human|ai|bot|function|correction)\s*:\s*/i;

/** Map a free-text or ChatML role onto a stored message role. */
export function normalizeRole(raw: unknown): MessageRole {
  const value = String(raw || '').trim().toLowerCase();
  switch (value) {
    case 'assistant':
    case 'ai':
    case 'bot':
    case 'model':
      return 'assistant';
    case 'system':
    case 'developer':
      return 'system';
    case 'tool':
    case 'function':
      return 'tool';
    case 'correction':
      return 'correction';
    case 'user':
    case 'human':
    default:
      return 'user';
  }
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return JSON.stringify(value);
}

/** Coerce an array or { messages } object into normalized messages. */
function coerceMessages(value: unknown): NormalizedMessage[] | null {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { messages?: unknown }).messages)
      ? (value as { messages: unknown[] }).messages
      : null;

  if (!list) return null;

  const messages: NormalizedMessage[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') {
      const content = asString(item);
      if (content.trim()) messages.push({ role: 'user', content });
      continue;
    }
    const record = item as Record<string, unknown>;
    const content = asString(record.content ?? record.text ?? record.message);
    if (!content.trim()) continue;
    const message: NormalizedMessage = { role: normalizeRole(record.role), content };
    if (typeof record.provider === 'string') message.provider = record.provider;
    const baseModel = record.base_model ?? record.model;
    if (typeof baseModel === 'string') message.base_model = baseModel;
    messages.push(message);
  }

  return messages.length ? messages : null;
}

const COMPACT_KEYS = [
  'summary',
  'timeline',
  'decisions',
  'requirements',
  'open_questions',
  'artifacts',
  'warnings',
] as const;

function looksLikeCompact(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return COMPACT_KEYS.some((key) => key in record);
}

/** Coerce a value into a normalized compaction record. */
function coerceCompact(value: unknown): NormalizedCompact | null {
  if (typeof value === 'string') {
    const summary = value.trim();
    return summary ? { summary } : null;
  }
  if (!looksLikeCompact(value)) return null;
  const record = value as Record<string, unknown>;
  const summary = asString(record.summary).trim();
  const compact: NormalizedCompact = { summary };
  if (record.timeline !== undefined) compact.timeline = record.timeline;
  if (record.decisions !== undefined) compact.decisions = record.decisions;
  if (record.requirements !== undefined) compact.requirements = record.requirements;
  if (record.open_questions !== undefined) compact.open_questions = record.open_questions;
  if (record.artifacts !== undefined) compact.artifacts = record.artifacts;
  if (record.warnings !== undefined) compact.warnings = record.warnings;
  if (typeof record.provider === 'string') compact.provider = record.provider;
  const baseModel = record.base_model ?? record.model;
  if (typeof baseModel === 'string') compact.base_model = baseModel;
  return compact;
}

/** Best-effort transcript parse: split on `Role:` line markers. */
export function parseTranscript(text: string): NormalizedMessage[] {
  const lines = text.split(/\r?\n/);
  const messages: NormalizedMessage[] = [];
  let current: NormalizedMessage | null = null;

  for (const line of lines) {
    const match = line.match(ROLE_LINE);
    if (match) {
      if (current && current.content.trim()) messages.push(current);
      current = { role: normalizeRole(match[1]), content: line.slice(match[0].length) };
    } else if (current) {
      current.content += `\n${line}`;
    } else if (line.trim()) {
      current = { role: 'user', content: line };
    }
  }
  if (current && current.content.trim()) messages.push(current);

  return messages.map((message) => ({ ...message, content: message.content.trim() }));
}

function extractTag(text: string, tag: string): string | null {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const start = text.indexOf(open);
  const end = text.indexOf(close);
  if (start === -1 || end === -1 || end < start) return null;
  return text.slice(start + open.length, end).trim();
}

function tryJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Parse a raw request body (already read as text) into a normalized ingest
 * result. The order matters: explicit PCP tags win, then structured JSON, then
 * a best-effort transcript fallback. Only a genuinely empty body is an error.
 */
export function parseIngestPayload(rawBody: string): IngestResult {
  const text = (rawBody || '').trim();
  if (!text) {
    return { kind: 'error', reason: 'empty request body' };
  }

  // 1. Explicit compact tag.
  const compactTag = extractTag(text, 'PCP_COMPACT');
  if (compactTag !== null) {
    const compact = coerceCompact(tryJson(compactTag) ?? compactTag);
    if (compact) return { kind: 'compact', compact };
    return { kind: 'error', reason: 'PCP_COMPACT block had no summary or recognizable fields' };
  }

  // 2. Explicit append tag.
  const appendTag = extractTag(text, 'PCP_APPEND');
  if (appendTag !== null) {
    const messages = coerceMessages(tryJson(appendTag));
    if (messages) return { kind: 'messages', messages: messages.slice(0, MAX_MESSAGES_PER_REQUEST) };
    const transcript = parseTranscript(appendTag);
    if (transcript.length) return { kind: 'messages', messages: transcript.slice(0, MAX_MESSAGES_PER_REQUEST) };
    return { kind: 'error', reason: 'PCP_APPEND block contained no messages' };
  }

  // 3. Structured JSON body.
  const json = tryJson(text);
  if (json !== undefined) {
    const messages = coerceMessages(json);
    if (messages) return { kind: 'messages', messages: messages.slice(0, MAX_MESSAGES_PER_REQUEST) };
    const compact = coerceCompact(json);
    if (compact && compact.summary) return { kind: 'compact', compact };
  }

  // 4. Raw transcript / markdown fallback.
  const transcript = parseTranscript(text);
  if (transcript.length) {
    return { kind: 'messages', messages: transcript.slice(0, MAX_MESSAGES_PER_REQUEST) };
  }

  return { kind: 'error', reason: 'body did not match any supported format' };
}
