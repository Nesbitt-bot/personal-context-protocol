import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from './hooks/session-start.mjs';
const event = { session_id: '00000000-0000-4000-8000-000000000001', cwd: '/private/project', transcript_path: '/private/transcript' };
const cfg = { baseUrl: 'https://pcp.example.test', deviceId: 'device' };
test('create once; resume only probes the canonical key', async () => {
  let posts = 0;
  const request = async (url, opts) => {
    if (opts.method === 'GET') {
      assert.equal(decodeURIComponent(url.pathname), `/api/v1/manager/sessions/by-key/device:codex:${event.session_id}`);
      return Response.json(posts ? {found:true, session_id:'ses_1'} : {found:false});
    }
    assert.deepEqual(JSON.parse(opts.body), { external_key:`device:codex:${event.session_id}`, agent_name:'codex', device_id:'device', title:'Codex: project', mode:'wild' });
    posts++;
    return Response.json({success:true, session_id:'ses_1'});
  };
  for (let i=0; i<2; i++) assert.equal(await register(event, cfg, 'example', request), 'ses_1');
  assert.equal(posts, 1);
});
test('failed lookup never creates a session', async () => {
  await assert.rejects(register(event, cfg, 'example', async (_, opts) => {
    assert.equal(opts.method, 'GET'); return new Response(null, {status:403});
  }), /403/);
});
