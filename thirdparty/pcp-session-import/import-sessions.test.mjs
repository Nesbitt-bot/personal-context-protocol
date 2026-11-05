import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  redactSecrets, sessionFromRevision, dedupe, externalKey, sessionTitle, fitContent,
  prepareMessages, batches, planUpload, MAX_CONTENT_CHARS, MAX_MESSAGES_PER_REQUEST, originDevice,
} from './lib.mjs';

const part = (id, messageID, data) => ({ id, message_id: messageID, data: JSON.stringify(data) });
const message = (id, role, t) => ({ id, time_created: String(t), data: JSON.stringify({ role, time: { created: t }, modelID: 'm1' }) });

function revision(device, { sid = 'ses_1', imported, directory = '/home/u/proj', n = 2, updated = 1 } = {}) {
  const records = [
    { table: 'project', row: { id: 'p', name: 'proj' } },
    { table: 'session', row: { id: sid, title: 'Hello', directory, parent_id: null, time_updated: updated, metadata: JSON.stringify(imported ? { imported } : {}) } },
  ];
  for (let i = 0; i < n; i += 1) {
    records.push({ table: 'message', row: message(`msg_${i}`, i % 2 ? 'assistant' : 'user', 1000 + i) });
    records.push({ table: 'part', row: part(`prt_${i}`, `msg_${i}`, { type: 'text', text: `turn ${i}` }) });
  }
  return { version: 1, device, records };
}

test('redacts common secret shapes and counts by kind, never keeping values', () => {
  const secrets = [
    'ghp_' + 'a'.repeat(36),
    'github_pat_' + 'B1'.repeat(30),
    'sk-ant-' + 'x9'.repeat(20),
    'xoxb-1234567890-abcdef',
    'pcps_' + 'f'.repeat(64),
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
    'AKIAABCDEFGHIJKLMNOP',
    'Qk3vX9pL2mN8rT4wY7zA1bC5dE6fG0hJ2kL4mN6pQ8rS',
    'MIIB+jCCAWOgAwIBAgIJAL/x9k2+abc/def8ghij+kl0mnop',
  ];
  const input = [
    ...secrets,
    'Cookie: session=abc123; other=1',
    'Authorization: Bearer abcdefgh12345678',
    'postgres://pcp:hunter2secret@db:5432/pcp',
    'https://bot:s3cr3tvalue@github.com/x.git',
    'GITHUB_TOKEN=abcd1234abcd1234abcd1234',
    'password: correcthorse',
    'DJANGO_SECRET_KEY=django-insecure-(x)!abcdefgh',
    '-----BEGIN RSA PRIVATE KEY-----\nTRUNCATEDBODY',
    '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----',
  ].join('\n');
  const { text, redactions } = redactSecrets(input);
  for (const s of [...secrets, 'abc123', 'abcdefgh12345678', 'hunter2secret', 's3cr3tvalue', 'abcd1234abcd1234abcd1234', 'correcthorse', 'AAAA', 'django-insecure', 'TRUNCATEDBODY']) {
    assert.ok(!text.includes(s), `leaked ${s.slice(0, 8)}`);
  }
  for (const kind of ['github_token', 'api_key', 'slack_token', 'pcp_token', 'jwt', 'aws_access_key', 'cookie', 'bearer_token', 'postgres_url', 'url_credentials', 'labeled_secret', 'private_key', 'high_entropy']) {
    assert.ok(redactions.includes(kind), `missing ${kind}`);
  }
});

test('leaves ordinary code and prose alone', () => {
  const input = 'const maxTokens = 4096;\nSee https://example.com/docs and run npm test.\nThe token budget was small.\nFile src/components/dashboard/SessionWorkspaceLongComponentName2.tsx and commit 2aa72617b9790f19f0ae83db917b07064bd8ee56.';
  assert.deepEqual(redactSecrets(input), { text: input, redactions: [] });
});

test('reads a shared-folder revision into text-only turns', () => {
  const rev = revision('win-1', { n: 3 });
  rev.records.push({ table: 'part', row: part('prt_t', 'msg_0', { type: 'tool', state: {} }) });
  rev.records.push({ table: 'part', row: part('prt_s', 'msg_1', { type: 'text', text: 'synthetic', synthetic: true }) });
  const s = sessionFromRevision(rev, 'shared');
  assert.equal(s.kind, 'opencode');
  assert.deepEqual(s.messages.map((m) => [m.role, m.text]), [['user', 'turn 0'], ['assistant', 'turn 1'], ['user', 'turn 2']]);
});

test('de-duplicates an imported transcript across devices, keeping the most complete copy', () => {
  const imported = { source: 'codex', sourceID: 'abc', device: 'win-1', directory: 'D:/x/proj' };
  const a = sessionFromRevision(revision('linux-1', { sid: 'ses_a', imported, n: 2 }), 'shared');
  const b = sessionFromRevision(revision('win-1', { sid: 'ses_b', imported, n: 4 }), 'shared');
  const c = sessionFromRevision(revision('linux-1', { sid: 'ses_c', n: 1 }), 'shared');
  const out = dedupe([a, b, c]);
  assert.equal(out.length, 2);
  const codex = out.find((s) => s.kind === 'codex');
  assert.equal(codex.messages.length, 4);
  assert.equal(externalKey(codex), 'win-1:codex:abc');
  assert.match(sessionTitle(codex), /^opencode:win-1:proj \[codex\] Hello$/);
});

test('native sessions take the device whose platform matches their directory', () => {
  assert.equal(originDevice({ directory: 'D:/a', importedDevice: null }, ['linux-1', 'win-2']), 'win-2');
  assert.equal(originDevice({ directory: '/home/a', importedDevice: null }, ['linux-1', 'win-2']), 'linux-1');
  assert.equal(originDevice({ directory: '/home/a', importedDevice: 'win-9' }, ['linux-1']), 'win-9');
});

test('fits content and batches within PCP limits', () => {
  const long = 'x'.repeat(MAX_CONTENT_CHARS + 500);
  const fitted = fitContent(long);
  assert.ok(fitted.length <= MAX_CONTENT_CHARS);
  assert.match(fitted, /truncated, \d+ characters omitted/);
  const msgs = Array.from({ length: 120 }, (_, i) => ({ role: 'user', content: `m${i}` }));
  const b = batches(msgs);
  assert.deepEqual(b.map((x) => x.length), [MAX_MESSAGES_PER_REQUEST, MAX_MESSAGES_PER_REQUEST, 20]);
  const big = Array.from({ length: 30 }, () => ({ role: 'user', content: 'y'.repeat(MAX_CONTENT_CHARS) }));
  assert.ok(batches(big).every((x) => x.reduce((n, m) => n + m.content.length, 0) <= 2_000_000));
});

test('prepares redacted PCP messages with provider metadata', () => {
  const s = sessionFromRevision(revision('linux-1', { n: 1 }), 'shared');
  s.messages[0].text = 'token=abcdefghijk12345';
  const { messages, counts } = prepareMessages(s);
  assert.equal(messages[0].content, 'token=<REDACTED>');
  assert.equal(messages[0].provider, 'opencode');
  assert.equal(messages[0].provider_timestamp, new Date(1000).toISOString());
  assert.deepEqual(counts, { labeled_secret: 1 });
});

test('plans append-only, idempotent uploads', () => {
  assert.deepEqual(planUpload(5, null), { action: 'create', from: 0 });
  assert.deepEqual(planUpload(5, 5), { action: 'up-to-date', from: 5 });
  assert.deepEqual(planUpload(5, 3), { action: 'append', from: 3 });
  assert.equal(planUpload(5, 7).action, 'remote-ahead');
  assert.equal(planUpload(0, null).action, 'skip-empty');
});
