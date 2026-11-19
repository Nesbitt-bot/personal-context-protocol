import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// A live-database revision was verified at PCP's append cursor. Never store
// transcript contents, local paths, or tokens in the receipt.
export async function recordReceipt(base, key, local, remote) {
  if (local.origin !== 'local-db' || !local.updated || !remote?.session_id) return;
  const dir = join(homedir(), '.local/state/pcp/import-receipts');
  const name = createHash('sha256')
    .update(`${new URL(base).origin}\n${key}`)
    .digest('hex');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, name),
    tmp = `${file}.${randomUUID()}`;
  await writeFile(
    tmp,
    JSON.stringify({ remoteId: remote.session_id, localId: local.sessionID, updated: local.updated }),
    { mode: 0o600 },
  );
  await rename(tmp, file);
}
