import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WorkMonitor } from '../lib/work-monitor.js';

test('delegated progress survives restart and reports a terminal blocker once', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-monitor-'));
  const file = path.join(root, 'state.json'), log = path.join(root, 'run.acp-stream.jsonl');
  const run = '11111111-1111-4111-8111-111111111111', child = 'agent:opencode:acp:22222222-2222-4222-8222-222222222222';
  const updates = []; let now = 100000;
  const options = { file, streamRoot: root, logger: { warn() {} }, now: () => now, send: async body => updates.push(body) };
  try {
    const first = new WorkMonitor(options);
    fs.writeFileSync(log, '');
    await first.register('agent:astrbot-exec:pcp:grt_parent', { status: 'accepted', runId: run, childSessionKey: child, streamLogPath: log });
    now += 61000; await first.poll();
    assert.deepEqual(updates.map(x => x.state), ['started', 'running']);
    fs.appendFileSync(log, JSON.stringify({ runId: run, kind: 'lifecycle', phase: 'error', data: { error: 'provider billing/quota exhausted' } })+'\n');
    const restarted = new WorkMonitor(options); await restarted.poll(); await restarted.poll();
    assert.deepEqual(updates.map(x => x.sequence), [0, 1, 2]);
    assert.equal(updates.at(-1).state, 'blocked'); assert.match(updates.at(-1).text, /quota exhausted/);
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('failed terminal upload is retained and a completed task carries its final text', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-monitor-'));
  const file = path.join(root, 'state.json'), log = path.join(root, 'run.acp-stream.jsonl');
  const run = '11111111-1111-4111-8111-111111111111', child = 'agent:opencode:acp:22222222-2222-4222-8222-222222222222';
  const updates = []; let failing = false;
  try {
    fs.writeFileSync(log, '');
    const m = new WorkMonitor({ file, streamRoot: root, logger: { warn() {} }, send: async body => { if (failing) throw new Error('offline'); updates.push(body); } });
    await m.register('parent', { status: 'accepted', runId: run, childSessionKey: child, streamLogPath: log });
    fs.writeFileSync(log, [JSON.stringify({ runId: run, kind: 'assistant_delta', delta: 'Tests passed.' }), JSON.stringify({ runId: run, kind: 'lifecycle', phase: 'end' })].join('\n')+'\n');
    failing = true; await m.poll(); assert.equal(m.work[run].done, false);
    failing = false; await m.poll(); assert.equal(updates.at(-1).state, 'completed'); assert.match(updates.at(-1).text, /Tests passed/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
