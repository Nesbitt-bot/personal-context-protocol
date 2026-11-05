/**
 * Pure helpers for pcp-session-import: read OpenCode session-manager records,
 * de-duplicate across devices, redact secrets and plan PCP uploads.
 *
 * No I/O except the explicit readers at the bottom; no dependencies.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** PCP agent ingestion limits (src/lib/agent-protocol.ts). */
export const MAX_MESSAGES_PER_REQUEST = 50;
export const MAX_CONTENT_CHARS = 100_000;
/** Keep each request body modest even when every message is large. */
export const MAX_BATCH_CHARS = 2_000_000;
export const MAX_TITLE_CHARS = 200;
export const MAX_EXTERNAL_KEY_CHARS = 200;

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * PCP's own wild-export patterns (src/lib/ingest-export.ts SECRET_PATTERNS)
 * plus conservative extras. Each replaces only the secret value and reports
 * the kind (never the value). Order matters: specific shapes before labels.
 */
export const SECRET_PATTERNS = [
  { kind: 'private_key', re: /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*?-----END[^-]*PRIVATE KEY-----/g, replace: () => '<REDACTED:private_key>' },
  // An unterminated private key (pasted or truncated): redact to the end of the text.
  { kind: 'private_key', re: /-----BEGIN[^-]*PRIVATE KEY-----[\s\S]*$/g, replace: () => '<REDACTED:private_key>' },
  { kind: 'github_token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/g, replace: () => '<REDACTED:github_token>' },
  { kind: 'github_token', re: /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g, replace: () => '<REDACTED:github_token>' },
  { kind: 'api_key', re: /\bsk-(?:ant-|proj-|svcacct-)?[A-Za-z0-9_-]{20,}/g, replace: () => '<REDACTED:api_key>' },
  { kind: 'api_key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, replace: () => '<REDACTED:api_key>' },
  { kind: 'slack_token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g, replace: () => '<REDACTED:slack_token>' },
  { kind: 'pcp_token', re: /\bpcps_[0-9a-f]{16,}\b/g, replace: () => '<REDACTED:pcp_token>' },
  { kind: 'jwt', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replace: () => '<REDACTED:jwt>' },
  { kind: 'aws_access_key', re: /\bAKIA[0-9A-Z]{16}\b/g, replace: () => '<REDACTED>' },
  { kind: 'cookie', re: /^(\s*(?:Cookie|Set-Cookie)\s*:\s*)\S.*$/gim, replace: (_m, label) => `${label}<REDACTED:cookie>` },
  { kind: 'basic_auth', re: /\b(Authorization\s*:\s*Basic\s+)[A-Za-z0-9+/=]{8,}/gi, replace: (_m, label) => `${label}<REDACTED>` },
  { kind: 'bearer_token', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, replace: () => 'Bearer <REDACTED>' },
  { kind: 'postgres_url', re: /\b(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+(@)/gi, replace: (_m, a, b) => `${a}<REDACTED>${b}` },
  { kind: 'url_credentials', re: /\b((?:https?|ftp|redis|mysql|mongodb(?:\+srv)?|amqp):\/\/[^:/\s@]+:)[^@\s/]+(@)/gi, replace: (_m, a, b) => `${a}<REDACTED>${b}` },
  // Long token-like values after a compound label (access_token=..., GITHUB_TOKEN: ...).
  { kind: 'labeled_secret', re: /\b([A-Za-z0-9_-]*(?:token|secret|api[_-]?key|password|passwd|credential|private[_-]?key)[A-Za-z0-9_-]*)(["']?\s*[:=]\s*["']?)([^\s"',<]{16,})/gi, replace: (_m, label, sep) => `${label}${sep}<REDACTED>` },
  // PCP's original labeled pattern.
  { kind: 'labeled_secret', re: /\b(api[_-]?key|secret|token|password|passwd|pwd)("?\s*[:=]\s*"?)([^\s"',<]{6,})/gi, replace: (_m, label, sep) => `${label}${sep}<REDACTED>` },
  // Unlabeled high-entropy strings (mixed case and digits, 40+ characters, not
  // part of a path or URL). Catches pasted keys; also hits public certificate
  // bodies and fingerprints, which is an acceptable loss.
  { kind: 'high_entropy', re: /(?<![A-Za-z0-9_\-/.+=])(?=[A-Za-z0-9_\-+/=]*[a-z])(?=[A-Za-z0-9_\-+/=]*[A-Z])(?=[A-Za-z0-9_\-+/=]*\d)(?![A-Za-z0-9_\-]*\/)[A-Za-z0-9_\-+/=]{40,}(?![A-Za-z0-9_\-/.])/g, replace: () => '<REDACTED:high_entropy>' },
  // Base64 runs with both '+' and '/' (key or certificate bodies; paths rarely contain '+').
  { kind: 'high_entropy', re: /(?<![A-Za-z0-9+/=])(?=[A-Za-z0-9+/]*\+)(?=[A-Za-z0-9+/]*\/)(?=[A-Za-z0-9+/]*\d)[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=])/g, replace: () => '<REDACTED:high_entropy>' },
];

/** Replace secret shapes; returns the text and one entry per redaction. */
export function redactSecrets(input) {
  let text = input;
  const redactions = [];
  for (const { kind, re, replace } of SECRET_PATTERNS) {
    text = text.replace(re, (...args) => {
      redactions.push(kind);
      return replace(...args);
    });
  }
  return { text, redactions };
}

// ---------------------------------------------------------------------------
// Session records
// ---------------------------------------------------------------------------

function parseJSON(value, fallback) {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const isWindowsPath = (dir) => typeof dir === 'string' && /^[A-Za-z]:[\\/]/.test(dir);
export const baseName = (dir) => (typeof dir === 'string' && dir ? dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : '') || 'unknown';

/**
 * Build one normalized session from OpenCode table rows (session, project,
 * messages, parts). Messages keep only non-synthetic text parts, in order, so
 * an imported session matches the turns the session-manager plugin pushes.
 */
export function normalizeSession({ session, project, messages, parts, device, origin }) {
  const metadata = parseJSON(session.metadata, {}) || {};
  const imported = metadata.imported || null;
  const textByMessage = new Map();
  for (const part of [...parts].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const data = parseJSON(part.data, {});
    if (data?.type !== 'text' || data.synthetic || typeof data.text !== 'string' || !data.text.trim()) continue;
    const list = textByMessage.get(part.message_id) || [];
    list.push(data.text);
    textByMessage.set(part.message_id, list);
  }
  const out = [];
  for (const message of [...messages].sort((a, b) => Number(a.time_created) - Number(b.time_created) || String(a.id).localeCompare(String(b.id)))) {
    const texts = textByMessage.get(message.id);
    if (!texts) continue;
    const data = parseJSON(message.data, {});
    const role = data?.role === 'assistant' ? 'assistant' : data?.role === 'user' ? 'user' : null;
    if (!role) continue;
    out.push({
      role,
      text: texts.join('\n\n'),
      time: Number(data?.time?.created ?? message.time_created) || null,
      model: data?.modelID || data?.model?.modelID || null,
    });
  }
  const model = parseJSON(session.model, {}) || {};
  return {
    sessionID: session.id,
    kind: imported?.source || 'opencode',
    nativeID: imported?.sourceID || session.id,
    importedDevice: imported?.device || null,
    device,
    origin,
    directory: imported?.directory || metadata.sessionManager?.originalDirectory || session.directory || '',
    // Every directory the records name, most specific first, for project
    // planning (organize-projects.mjs); placeholders are filtered there.
    directories: [imported?.directory, metadata.sessionManager?.originalDirectory, session.directory, project?.worktree].filter((d) => typeof d === 'string' && d),
    remote: typeof imported?.remote === 'string' ? imported.remote : null,
    branch: typeof imported?.branch === 'string' ? imported.branch : null,
    projectID: project?.id || session.project_id || null,
    project: project?.name || baseName(imported?.directory || session.directory),
    title: imported?.sourceTitle || session.title || '(untitled)',
    parentID: session.parent_id || null,
    updated: Number(session.time_updated) || 0,
    model: model.id || null,
    messages: out,
  };
}

/** Parse one shared-folder revision file (`<device>-<hash>.json`). */
export function sessionFromRevision(revision, origin) {
  const records = Array.isArray(revision?.records) ? revision.records : [];
  const rows = (table) => records.filter((r) => r.table === table).map((r) => r.row);
  const [session] = rows('session');
  if (!session) return null;
  const [project] = rows('project');
  return normalizeSession({ session, project, messages: rows('message'), parts: rows('part'), device: revision.device || null, origin });
}

/** Stable identity across devices: an imported transcript is its source id. */
export const identityOf = (s) => `${s.kind}:${s.nativeID}`;

/**
 * Pick the canonical copy per identity: most messages, then latest update,
 * then the live local database over a shared-folder revision.
 */
export function dedupe(candidates) {
  const byIdentity = new Map();
  const devicesSeen = new Map();
  for (const c of candidates) {
    const id = identityOf(c);
    if (!devicesSeen.has(id)) devicesSeen.set(id, new Set());
    if (c.device) devicesSeen.get(id).add(c.device);
    const current = byIdentity.get(id);
    const rank = (s) => [s.messages.length, s.updated, s.origin === 'local-db' ? 1 : 0];
    if (!current) byIdentity.set(id, c);
    else {
      const [a, b] = [rank(c), rank(current)];
      const better = a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] > b[2];
      if (better) byIdentity.set(id, c);
    }
  }
  return [...byIdentity.entries()].map(([id, s]) => ({ ...s, originDevice: originDevice(s, [...devicesSeen.get(id)]) }));
}

/**
 * The device a transcript was recorded on. Imported sessions say so; for a
 * native OpenCode session use the device whose platform matches its directory.
 */
export function originDevice(session, devices) {
  if (session.importedDevice) return session.importedDevice;
  const sorted = [...devices].sort();
  if (sorted.length <= 1) return sorted[0] || session.device || 'unknown';
  const wantWindows = isWindowsPath(session.directory);
  return sorted.find((d) => d.startsWith('win-') === wantWindows) || sorted[0];
}

export function externalKey(s) {
  const key = `${s.originDevice}:${s.kind}:${s.nativeID}`;
  if (key.length > MAX_EXTERNAL_KEY_CHARS) throw new Error(`external key too long for ${identityOf(s)}`);
  return key;
}

export const sourceLabel = (s) => `opencode:${s.originDevice}:${s.project}`;

export function sessionTitle(s) {
  const title = `${sourceLabel(s)} [${s.kind}] ${String(s.title).replace(/\s+/g, ' ').trim()}`;
  return title.length > MAX_TITLE_CHARS ? `${title.slice(0, MAX_TITLE_CHARS - 1)}…` : title;
}

/** Fit content to PCP's per-message limit, saying how much was cut. */
export function fitContent(text) {
  if (text.length <= MAX_CONTENT_CHARS) return text;
  const note = (n) => `\n\n[pcp-session-import: truncated, ${n} characters omitted]`;
  const keep = MAX_CONTENT_CHARS - note(text.length).length;
  return text.slice(0, keep) + note(text.length - keep);
}

/** Redacted, PCP-shaped messages for one session plus its redaction counts. */
export function prepareMessages(s) {
  const counts = {};
  const messages = s.messages.map((m) => {
    const { text, redactions } = redactSecrets(m.text);
    for (const kind of redactions) counts[kind] = (counts[kind] || 0) + 1;
    const out = { role: m.role, content: fitContent(text), provider: String(s.kind).slice(0, 100) };
    const model = m.model || s.model;
    if (model) out.base_model = String(model).slice(0, 100);
    if (m.time && Number.isFinite(m.time)) out.provider_timestamp = new Date(m.time).toISOString();
    return out;
  });
  return { messages, counts };
}

/** Split messages into request batches within the count and size limits. */
export function batches(messages) {
  const out = [];
  let current = [];
  let size = 0;
  for (const m of messages) {
    if (current.length && (current.length >= MAX_MESSAGES_PER_REQUEST || size + m.content.length > MAX_BATCH_CHARS)) {
      out.push(current);
      current = [];
      size = 0;
    }
    current.push(m);
    size += m.content.length;
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * What to do for one session given the remote cursor (`message_count`, or
 * null when PCP has no session for the key). Append-only: a remote that is
 * ahead of the local copy is reported, never rewritten.
 */
export function planUpload(localCount, remoteCount) {
  if (localCount === 0) return { action: 'skip-empty', from: 0 };
  if (remoteCount === null) return { action: 'create', from: 0 };
  if (remoteCount === localCount) return { action: 'up-to-date', from: localCount };
  if (remoteCount > localCount) return { action: 'remote-ahead', from: localCount };
  return { action: 'append', from: remoteCount };
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/** Every revision in a session-manager shared folder (`projects/*\/imported/*\/*.json`). */
export function* readSharedFolder(root, onError = () => {}) {
  const projects = path.join(root, 'projects');
  if (!fs.existsSync(projects)) return;
  for (const project of fs.readdirSync(projects)) {
    const imported = path.join(projects, project, 'imported');
    if (!fs.existsSync(imported)) continue;
    for (const sid of fs.readdirSync(imported)) {
      const dir = path.join(imported, sid);
      let files = [];
      try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
      } catch (error) {
        onError(dir, error);
        continue;
      }
      for (const file of files) {
        try {
          const session = sessionFromRevision(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')), 'shared');
          if (session) yield session;
        } catch (error) {
          onError(path.join(dir, file), error);
        }
      }
    }
  }
}

/** Sessions in a live OpenCode database, read-only through the sqlite3 CLI. */
export function readOpencodeDb(dbPath, device) {
  if (!dbPath || !fs.existsSync(dbPath)) return [];
  const query = (sql) => {
    const out = execFileSync('sqlite3', ['-readonly', '-json', dbPath, sql], { maxBuffer: 2 * 1024 ** 3, encoding: 'utf8' });
    return out.trim() ? JSON.parse(out) : [];
  };
  const sessions = query('SELECT id, project_id, parent_id, directory, title, metadata, model, time_updated FROM session');
  const projects = new Map(query('SELECT id, name, worktree FROM project').map((p) => [p.id, p]));
  const group = (rows) => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.session_id)) map.set(row.session_id, []);
      map.get(row.session_id).push(row);
    }
    return map;
  };
  const messages = group(query('SELECT id, session_id, time_created, data FROM message'));
  const parts = group(query("SELECT id, message_id, session_id, data FROM part WHERE json_extract(data, '$.type') = 'text'"));
  return sessions.map((session) =>
    normalizeSession({ session, project: projects.get(session.project_id), messages: messages.get(session.id) || [], parts: parts.get(session.id) || [], device, origin: 'local-db' }),
  );
}
