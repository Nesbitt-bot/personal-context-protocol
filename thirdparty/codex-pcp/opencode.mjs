/** OpenCode server plugin. Install as described in the README. Shares only
 * identity and state with PCP, never transcript contents or the local index. */
import { basename } from 'node:path';
import { indexEntries, settings, syncState, importedRevision, reporter } from './hooks/presence.mjs';

export const PcpPresence = async ({ client, directory }, deps = {}) => {
  const getSettings = deps.settings || settings,
    getEntries = deps.indexEntries || indexEntries;
  const request = deps.request || fetch;
  const active = new Map();
  let selected;
  let disposed = false;
  let pending = Promise.resolve();
  const queue = (fn) => (pending = pending.then(fn).catch((e) => console.warn('PCP presence:', e.message)));
  async function close(id) {
    const slot = active.get(id);
    active.delete(id);
    if (slot?.report) await slot.report('closed');
  }
  async function refresh(id, entries, config, token) {
    const slot = active.get(id);
    if (!slot || disposed) return;
    const entry = entries.find((e) => e.imported?.sessionID === id);
    if (!slot.report) {
      const response = await client.session.get({ path: { id } });
      const info = response.data;
      if (!info) return;
      const imported = info.metadata?.imported;
      const kind = entry?.kind || imported?.source || 'opencode';
      if (!['codex', 'opencode'].includes(kind)) return;
      const device = entry?.device || imported?.device || config.deviceId;
      const key = `${device}:${kind}:${entry?.nativeID || imported?.sourceID || id}`;
      const api = async (path, body) => {
        const res = await request(new URL('/api/v1/manager/' + path, config.baseUrl), {
          method: body ? 'POST' : 'GET',
          redirect: 'error',
          signal: AbortSignal.timeout(4500),
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: body && JSON.stringify(body),
        });
        if (!res.ok) throw Error(`session registration returned HTTP ${res.status}`);
        return res.json();
      };
      const found = await api('sessions/by-key/' + encodeURIComponent(key));
      const remote =
        found.found === false
          ? await api('sessions', {
              external_key: key,
              agent_name: 'opencode',
              device_id: device,
              title: `OpenCode: ${basename(directory)}`,
            })
          : found;
      if (!remote.session_id) throw Error('No PCP session ID');
      slot.remoteId = remote.session_id;
      slot.key = key;
      slot.report = reporter(config, token, key, 'opencode', undefined, request);
    }
    let state = await syncState(entry, slot.remoteId);
    if (!entry) {
      const info = (await client.session.get({ path: { id } })).data;
      state = await importedRevision(config.baseUrl, slot.key, id, info?.time?.updated, slot.remoteId);
    }
    const status = await slot.report(state);
    if (status === 409) active.delete(id);
  }
  async function tick(ids) {
    if (!ids.length || disposed) return;
    const { config, token } = await getSettings();
    const entries = await getEntries();
    for (const id of ids)
      await refresh(id, entries, config, token).catch((e) => console.warn('PCP presence:', e.message));
  }
  let ticking = false;
  const timer = setInterval(() => {
    if (!ticking && active.size) {
      ticking = true;
      void queue(() => tick([...active.keys()])).finally(() => {
        ticking = false;
      });
    }
  }, 20_000);
  timer.unref?.();
  async function dispose() {
    disposed = true;
    clearInterval(timer);
    await Promise.allSettled([...active.keys()].map(close));
  }
  return {
    dispose: () => queue(dispose),
    event: ({ event }) => {
      if (
        ![
          'tui.session.select',
          'session.status',
          'session.idle',
          'session.deleted',
          'server.instance.disposed',
        ].includes(event.type)
      )
        return;
      return queue(async () => {
        const p = event.properties || {};
        if (event.type === 'server.instance.disposed') {
          await dispose();
          return;
        }
        if (disposed) return;
        if (event.type === 'session.deleted') {
          await close(p.info.id);
          return;
        }
        const id = p.sessionID;
        if (!id) return;
        if (event.type === 'tui.session.select') {
          const prev = selected;
          selected = id;
          if (prev !== id && prev && !active.get(prev)?.busy) await close(prev);
        } else if (event.type === 'session.status' || event.type === 'session.idle') {
          const busy = event.type === 'session.status' && p.status?.type !== 'idle';
          if (!busy && selected !== id) {
            await close(id);
            return;
          }
          if (active.has(id)) {
            active.get(id).busy = busy;
            return;
          }
          active.set(id, { busy });
        } else return;
        if (!active.has(id)) active.set(id, { busy: false });
        await tick([id]);
      });
    },
  };
};
