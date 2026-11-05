/** broker/server.js against fake PCP and OpenClaw upstreams (no network). */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AddressInfo } from 'net';

const { createBroker, upstreamOk, replyText } = require('../broker/server.js');

type Call = { url: string; headers: Record<string, string>; body: string };

function harness(behaviour: { prepare?: (c: Call) => Response | Promise<Response>; openclaw?: (c: Call) => Response | Promise<Response>; secrets?: { broker: string; gateway: string } }) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: { headers: Record<string, string>; body: string }) => {
    const call = { url, headers: init.headers, body: init.body };
    calls.push(call);
    if (url.endsWith('/api/v1/service/broker/turns')) return behaviour.prepare ? behaviour.prepare(call) : json(200, PREPARED);
    if (url.endsWith('/api/v1/service/broker/turns/complete')) return json(200, { success: true, recorded: true });
    if (url.endsWith('/v1/chat/completions')) return behaviour.openclaw ? behaviour.openclaw(call) : json(200, { choices: [{ message: { content: 'hello from relay-owner' } }] });
    throw new Error('unexpected');
  };
  const server = createBroker({ pcpUrl: 'http://127.0.0.1:3000', openclawUrl: 'http://127.0.0.1:18789', pcpTimeoutMs: 1000, openclawTimeoutMs: 1000 }, {
    fetch: fetchImpl,
    secrets: () => behaviour.secrets ?? { broker: 'pcps_broker', gateway: 'gw_secret' },
  });
  return { server, calls };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const PREPARED = {
  turn_id: `grt_${'a'.repeat(48)}`,
  session_key: `pcp:grt_${'a'.repeat(48)}`,
  agent: 'relay-owner',
  model: 'openclaw/relay-owner',
  messages: [{ role: 'system', content: 'Verified sender (PCP-attested): ...' }, { role: 'user', content: 'hi' }],
};

describe('PCP broker process', () => {
  let close: () => Promise<void> = async () => undefined;
  let base = '';

  async function start(h: ReturnType<typeof harness>) {
    await new Promise<void>((resolve) => h.server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(h.server.address() as AddressInfo).port}`;
    close = () => new Promise((resolve) => h.server.close(() => resolve()));
    return h;
  }
  const turn = (headers: Record<string, string> = { authorization: 'Bearer pcps_ingress', 'x-pcp-signature': 'v1=abc' }) =>
    fetch(`${base}/v1/turn`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{"stamp":{},"message":{"text":"hi"}}' });

  beforeEach(() => { base = ''; });
  afterEach(async () => { await close(); });

  it('forwards the raw signed body to PCP, calls OpenClaw with the gateway token and pcp:<grant>, records the reply', async () => {
    const h = await start(harness({}));
    const res = await turn();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: 'hello from relay-owner', turn_id: PREPARED.turn_id, agent: 'relay-owner' });
    const [prepare, openclaw, complete] = h.calls;
    expect(prepare.headers.authorization).toBe('Bearer pcps_broker');
    expect(prepare.headers['x-pcp-ingress-authorization']).toBe('Bearer pcps_ingress');
    expect(prepare.headers['x-pcp-signature']).toBe('v1=abc');
    expect(prepare.body).toBe('{"stamp":{},"message":{"text":"hi"}}');
    expect(openclaw.headers.authorization).toBe('Bearer gw_secret');
    expect(openclaw.headers['x-openclaw-session-key']).toBe(PREPARED.session_key);
    expect(JSON.parse(openclaw.body)).toEqual({ model: 'openclaw/relay-owner', messages: PREPARED.messages, stream: false });
    expect(JSON.parse(complete.body)).toEqual({ turn_id: PREPARED.turn_id, status: 'ok', reply: 'hello from relay-owner' });
    // The gateway token never goes to PCP; the broker credential never goes to OpenClaw.
    expect(JSON.stringify([prepare, complete])).not.toContain('gw_secret');
    expect(JSON.stringify(openclaw)).not.toContain('pcps_broker');
  });

  it('fails closed when PCP is down: 503 and OpenClaw is never called', async () => {
    const h = await start(harness({ prepare: () => { throw new TypeError('fetch failed'); } }));
    expect((await turn()).status).toBe(503);
    expect(h.calls.map((c) => c.url)).toEqual(['http://127.0.0.1:3000/api/v1/service/broker/turns']);
  });

  it('PCP refusals (unsigned, replayed) are 401 and never reach OpenClaw', async () => {
    const h = await start(harness({ prepare: () => json(401, { code: 'REPLAYED_STAMP' }) }));
    const res = await turn({});
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('REPLAYED_STAMP');
    expect(h.calls).toHaveLength(1);
  });

  it('PCP 5xx means 503 (fail closed)', async () => {
    await start(harness({ prepare: () => json(500, { code: 'INTERNAL_ERROR' }) }));
    expect((await turn()).status).toBe(503);
  });

  it('an OpenClaw failure is a 502 and the turn is closed as failed', async () => {
    const h = await start(harness({ openclaw: () => json(500, { error: 'boom' }) }));
    expect((await turn()).status).toBe(502);
    expect(JSON.parse(h.calls[2].body)).toEqual({ turn_id: PREPARED.turn_id, status: 'error', error_code: 'OPENCLAW_500' });
  });

  it('without its secrets it refuses every turn', async () => {
    const h = await start(harness({ secrets: { broker: '', gateway: 'x' } }));
    expect((await turn()).status).toBe(503);
    expect(h.calls).toHaveLength(0);
    expect(await (await fetch(`${base}/healthz`)).json()).toEqual({ status: 'ok', configured: false });
  });

  it('rejects oversize bodies and unknown routes', async () => {
    await start(harness({}));
    const big = await fetch(`${base}/v1/turn`, { method: 'POST', body: 'x'.repeat(40 * 1024) }).catch(() => null);
    expect(big === null || big.status === 413).toBe(true);
    expect((await fetch(`${base}/v1/chat/completions`, { method: 'POST', body: '{}' })).status).toBe(404);
  });

  it('upstreams must be loopback http or https; replies may be content parts', () => {
    expect(upstreamOk('http://127.0.0.1:3000')).toBe(true);
    expect(upstreamOk('http://[::1]:18789')).toBe(true);
    expect(upstreamOk('https://pcp.example.test')).toBe(true);
    expect(upstreamOk('http://10.1.2.3:3000')).toBe(false);
    expect(upstreamOk('http://pcp.example.test')).toBe(false);
    expect(replyText({ choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }] })).toBe('ab');
  });
});
