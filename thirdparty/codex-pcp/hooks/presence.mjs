import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const configDir = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode');
export async function settings() {
  const config = JSON.parse(await readFile(join(homedir(), '.config/pcp/codex.json'), 'utf8'));
  const base = new URL(config.baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password)
    throw Error('PCP requires an HTTPS origin');
  const token = (
    await readFile(config.tokenFile || join(homedir(), '.config/pcp-operator/session-import.token'), 'utf8')
  ).trim();
  if (!token) throw Error('Missing PCP scoped token');
  return { config, token };
}
export async function indexEntries() {
  try {
    return Object.values(JSON.parse(await readFile(join(configDir, 'session-index.json'), 'utf8')).entries);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}

/** The session manager acknowledges this exact source revision after its push.
 * Registration, a successful ping or an old last-message date is not a receipt. */
export async function syncState(entry, remoteId, fileStat = stat) {
  if (
    !entry ||
    entry.missing ||
    !entry.pcp ||
    entry.pcp.sessionID !== remoteId ||
    entry.fingerprint !== entry.pcp.fingerprint
  )
    return 'unsynced';
  try {
    const s = await fileStat(entry.file);
    return `${s.size}:${s.mtimeMs}` === entry.pcp.fingerprint ? 'synced' : 'unsynced';
  } catch {
    return 'unsynced';
  }
}

export function reporter(config, token, key, kind, run = randomUUID(), request = fetch) {
  const url = new URL(`/api/v1/manager/sessions/by-key/${encodeURIComponent(key)}/presence`, config.baseUrl);
  if (url.protocol !== 'https:') throw Error('PCP requires HTTPS');
  let started = false;
  return async (state) => {
    const res = await request(url, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(4500),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ reporter: kind, run, state, start: !started && state !== 'closed' }),
    });
    if (res.ok) started = true;
    return res.status;
  };
}

/** Match a successful native OpenCode import to the currently open revision. */
export async function importedRevision(base, key, localId, updated, remoteId) {
  const name = createHash('sha256')
    .update(`${new URL(base).origin}\n${key}`)
    .digest('hex');
  try {
    const receipt = JSON.parse(
      await readFile(join(homedir(), '.local/state/pcp/import-receipts', name), 'utf8'),
    );
    return receipt.remoteId === remoteId &&
      receipt.localId === localId &&
      updated &&
      updated === receipt.updated
      ? 'synced'
      : 'unsynced';
  } catch {
    return 'unsynced';
  }
}
