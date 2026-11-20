import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Shared helpers for the Claude Code ↔ PCP plugin.
 *
 * A session is identified by a stable external key `<device>:claude:<sessionId>`;
 * the working directory where the session was created never changes, so the key
 * is stable across resyncs even when a session is later opened from OpenCode.
 */

const CONFIG_PATH = path.join(os.homedir(), '.config', 'pcp', 'claude-code.json');
const STATE_PATH = path.join(os.homedir(), '.local', 'state', 'pcp', 'claude-code-sync.json');

export function readConfig() {
  let file = {};
  try { file = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch { /* defaults below */ }
  return {
    baseUrl: process.env.PCP_BASE_URL || file.baseUrl || 'https://pcp.trance-0.com',
    tokenFile: process.env.PCP_TOKEN_FILE || file.tokenFile || path.join(os.homedir(), '.config', 'pcp-operator', 'session-import.token'),
    deviceId: process.env.PCP_DEVICE_ID || file.deviceId || 'linux-1048b0a6',
  };
}

export function readToken(tokenFile) {
  try { return fs.readFileSync(tokenFile, 'utf8').trim(); } catch { return ''; }
}

export function sessionKey(config, sessionId) {
  return `${config.deviceId}:claude:${sessionId}`;
}

/** Last-known sync state, keyed by session id. Written after every successful sync. */
export function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}

export function writeState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  } catch { /* best effort */ }
}

/**
 * Fetch the remote session status by external key. Returns `{ unreachable: true }`
 * when the remote is unreachable, `{ found: false }` when the session does not
 * exist remotely, or `{ found: true, message_count, last_updated }` when it was
 * found.
 */
export async function fetchRemote(config, key) {
  const token = readToken(config.tokenFile);
  if (!token) return { unreachable: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/api/v1/manager/sessions/by-key/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { found: false };
    const data = await res.json().catch(() => ({}));
    return {
      found: true,
      message_count: typeof data.message_count === 'number' ? data.message_count : null,
      last_updated: data.last_message_at ?? data.updated_at ?? null,
    };
  } catch {
    clearTimeout(timer);
    return { unreachable: true };
  }
}
