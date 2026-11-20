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

import { reporter, syncState } from './hooks/presence.mjs';
test('only an acknowledged push matching the actual source and target is synced', async () => {
  const row = {file:'local', fingerprint:'3:123', pcp:{sessionID:'ses',fingerprint:'3:123'}};
  const current = async () => ({size:3,mtimeMs:123});
  assert.equal(await syncState(row,'ses',current),'synced');
  assert.equal(await syncState(row,'other',current),'unsynced');
  assert.equal(await syncState(row,'ses',async()=>({size:4,mtimeMs:123})),'unsynced');
  assert.equal(await syncState({...row, missing:true},'ses',current),'unsynced');
});
test('a reporter claims once, retries a failed start, and closes the same lease',async()=>{
  const calls=[];
  const beat=reporter(cfg,'example','device:codex:id','codex','test-run',async (_,opts)=>{
    calls.push(JSON.parse(opts.body));return new Response(null,{status:calls.length===1?503:204});
  });
  for(const state of ['synced','unsynced','synced','closed']) await beat(state);
  assert.deepEqual(calls.map(c=>c.start),[true,true,false,false]);
  assert.ok(calls.every(c=>c.run==='test-run'));
});

import { PcpPresence } from './opencode.mjs';
test('OpenCode selection reuses imported Codex identity; disposal closes its lease', async () => {
  const events=[];
  const plugin=await PcpPresence({directory:'/repo',client:{session:{get:async()=>({data:{id:'oc'}})}}},{
    settings:async()=>({config:cfg,token:'fake'}), indexEntries:async()=>[{imported:{sessionID:'oc'},kind:'codex',nativeID:'origin',device:'other-device'}],
    request:async(url,opts)=>{
      if(opts.method==='GET') { assert.match(decodeURIComponent(url.pathname),/other-device:codex:origin$/);return Response.json({found:true,session_id:'ses1'}); }
      events.push(JSON.parse(opts.body));return new Response(null,{status:204});
    },
  });
  await plugin.event({event:{type:'tui.session.select',properties:{sessionID:'oc'}}});
  await plugin.dispose();
  assert.deepEqual(events.map(e=>[e.reporter,e.state,e.start]),[['opencode','unsynced',true],['opencode','closed',false]]);
});
