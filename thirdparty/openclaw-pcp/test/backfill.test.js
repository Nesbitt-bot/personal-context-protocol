import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptTurns, replayTurns } from '../lib/backfill.js';

const row = (id, role) => ({ type: 'message', id, timestamp: '2026-01-01T00:00:00Z', message: { role, content: id } });
test('selection cannot absorb an adjacent user or another channel turn', () => {
  const rows = [row('a', 'user'), row('b', 'assistant'), row('c', 'user'), row('d', 'assistant')];
  const turns = transcriptTurns(rows, ['a']);
  assert.deepEqual(turns[0].messages.map(m => m.content), ['a', 'b']);
  assert.equal(turns[0].messages[0].timestamp, Date.parse(rows[0].timestamp));
  assert.throws(() => transcriptTurns(rows, ['missing']), /absent/);
});
test('replay uses the normal agent_end hook and stops on a queued failure', async () => {
  const calls = [];
  const plugin = { queue: { size: 0 }, stats: { synced: 0 }, flush: async () => { calls.push('flush'); plugin.stats.synced++; } };
  const entry = { sessionKey: 'agent:main:telegram:direct:123', sessionId: 'original', channel: 'telegram' };
  const turns = transcriptTurns([row('a', 'user'), row('b', 'assistant')], ['a']);
  await replayTurns(plugin, (event, ctx) => calls.push({ event, ctx }), entry, turns);
  assert.equal(calls[0].ctx.sessionId, 'original');
  assert.equal(calls[0].ctx.trigger, 'user');
  assert.equal(calls[1], 'flush');
  plugin.queue.size = 1;
  await assert.rejects(replayTurns(plugin, () => {}, entry, turns), /remain queued/);
});
