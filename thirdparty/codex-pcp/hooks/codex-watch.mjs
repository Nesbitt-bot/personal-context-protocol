import { readFile, readlink, readdir, mkdir, writeFile, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { indexEntries, reporter, settings, syncState } from './presence.mjs';

import { register } from './registration.mjs';

const dir = join(homedir(), '.local/state/pcp/codex-presence');
function marker(id) {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw Error('Invalid session ID');
  return join(dir, id);
}
// A shared app-server PID alone outlives individual threads. Require a file
// descriptor for THIS thread, and never read any transcript or other FD contents.
async function ownerFd(pid, id) {
  const dir = `/proc/${pid}/fd`;
  for (const fd of await readdir(dir)) {
    const path = await readlink(`${dir}/${fd}`).catch(() => '');
    if (path.endsWith(`/thread-writer-locks/${id}.lock`) || path.endsWith(`-${id}.jsonl`))
      return { fd: `${dir}/${fd}`, path };
  }
}
async function findOwner(id) {
  let pid = process.ppid;
  while (process.platform === 'linux' && pid > 1) {
    const owner = await ownerFd(pid, id).catch(() => null);
    if (owner) return owner;
    const status = await readFile(`/proc/${pid}/status`, 'utf8').catch(() => '');
    pid = Number(status.match(/^PPid:\s+(\d+)/m)?.[1]);
  }
}
export async function launch(payload, remoteId, config, token) {
  const id = payload.session_id,
    file = marker(id),
    run = randomUUID();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(`${file}.${run}`, run, { mode: 0o600 });
  await rename(`${file}.${run}`, file);
  const owner = await findOwner(id);
  const key = `${config.deviceId}:codex:${id}`;
  if (!owner) {
    // Without reliable thread-liveness evidence, never leave an idle worker
    // making a dead thread green. Claim a conservative unsynced lease instead.
    if (remoteId) await reporter(config, token, key, 'codex', run)('unsynced');
    return false;
  }
  const worker = spawn(
    process.execPath,
    [fileURLToPath(import.meta.url), id, remoteId, run, owner.fd, owner.path, basename(payload.cwd || '')],
    { detached: true, stdio: 'ignore' },
  );
  worker.unref();
  return true;
}
export async function close(id, config, token) {
  const file = marker(id);
  const run = await readFile(file, 'utf8').catch(() => '');
  if (!run || run === 'closed') return;
  await writeFile(file, 'closed', { mode: 0o600 });
  await reporter(config, token, `${config.deviceId}:codex:${id}`, 'codex', run)('closed');
}
async function watch([id, remoteId, run, fd, path, cwd]) {
  const { config, token } = await settings();
  const report = reporter(config, token, `${config.deviceId}:codex:${id}`, 'codex', run);
  while (
    (await readFile(marker(id), 'utf8').catch(() => '')) === run &&
    (await readlink(fd).catch(() => '')) === path
  ) {
    if (!remoteId) {
      remoteId = await register({ session_id: id, cwd }, config, token).catch(() => '');
      if (!remoteId) {
        await sleep(20_000);
        continue;
      }
    }
    const entries = await indexEntries().catch(() => null);
    const entry = entries?.find(
      (e) => e.kind === 'codex' && e.nativeID === id && e.device === config.deviceId,
    );
    // Registration alone does not confirm a transcript is in sync.
    const state = await syncState(entry, remoteId);
    const status = await report(state).catch(() => 0);
    if ([401, 403, 404, 405, 409].includes(status)) break;
    await sleep(20_000);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await watch(process.argv.slice(2));
}
