import { basename } from 'node:path';

export async function register(payload, config, token, request = fetch) {
  const base = new URL(config.baseUrl);
  if (base.protocol !== 'https:' || base.username || base.password)
    throw Error('Configured PCP origin must use HTTPS');
  if (
    !/^[a-zA-Z0-9._-]{1,80}$/.test(config.deviceId || '') ||
    !/^[a-f0-9-]{36}$/i.test(payload.session_id || '')
  )
    throw Error('Invalid device or session ID');
  const key = `${config.deviceId}:codex:${payload.session_id}`;
  const api = async (path, body) => {
    const res = await request(new URL('/api/v1/manager/' + path, base), {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      method: body ? 'POST' : 'GET',
      body: body && JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw Error(`PCP ${body ? 'registration' : 'lookup'} returned HTTP ${res.status}`);
    return res.json();
  };
  const existing = await api('sessions/by-key/' + encodeURIComponent(key));
  if (existing.found === true && existing.session_id) return existing.session_id;
  if (existing.found !== false) throw Error('Unexpected PCP lookup response');
  // Creating the session creates its linked task on PCP. Reuse the stable
  // import key; never mint another session token on a normal resume.
  const created = await api('sessions', {
    external_key: key,
    agent_name: 'codex',
    device_id: config.deviceId,
    title: `Codex: ${basename(payload.cwd || '') || 'session'}`,
    mode: 'wild',
  });
  if (!created.success || !created.session_id) throw Error('PCP did not confirm registration');
  return created.session_id;
}
