/**
 * One-time backfill: create a sprint-board task for every session that has no
 * task yet, link the session to it, and stamp the agent_name / device_id the
 * session metadata already implies (from external_key / principal / title).
 * Idempotent: sessions that already have a task_id are skipped.
 *
 * Run with the target DATABASE_URL in the environment:
 *   DATABASE_URL=postgresql://... node scripts/backfill-tasks.js
 */

const crypto = require('crypto');
const postgres = require('postgres');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('backfill-tasks: DATABASE_URL is not configured');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { connect_timeout: 10, max: 1 });

function id(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function agentFor(session) {
  const title = session.title || '';
  const externalKey = session.external_key || '';
  const principal = session.principal || '';
  if (title.startsWith('opencode:') || externalKey.includes(':opencode:')) return 'opencode';
  if (principal.startsWith('astrbot:')) return 'astrbot';
  if (principal.startsWith('telegram:')) return 'telegram';
  if (principal.startsWith('openclaw-weixin:')) return 'openclaw-weixin';
  const match = principal.match(/^([a-z0-9-]+):/);
  return match ? match[1] : null;
}

function deviceFor(session) {
  const externalKey = session.external_key || '';
  // `win-384de1b4:opencode:ses_...`
  const fromKey = externalKey.match(/^([A-Za-z0-9][A-Za-z0-9._:-]{0,63}):opencode:/);
  if (fromKey) return fromKey[1];
  // `opencode:win-384de1b4:<context>`
  const fromTitle = (session.title || '').match(/^opencode:([^:]+):/);
  return fromTitle ? fromTitle[1] : null;
}

function cleanTitle(session, isOpencode) {
  let title = (session.title || '').trim();
  if (!title) return 'Untitled session';
  if (isOpencode) {
    title = title.replace(/^opencode:[^:]+:/, '').replace(/\s*\[[^\]]*\]\s*$/, '').trim();
  }
  return title || 'Untitled session';
}

async function main() {
  const sessions = await sql`
    SELECT id, title, topic_id, project_id, external_key, principal, created_at
    FROM sessions
    WHERE task_id IS NULL
    ORDER BY created_at ASC
  `;
  console.log(`backfill-tasks: ${sessions.length} sessions without a task`);

  const positionByTopic = new Map();
  let created = 0;
  for (const session of sessions) {
    const isOpencode = (session.title || '').startsWith('opencode:') || (session.external_key || '').includes(':opencode:');
    const topicKey = session.topic_id || '';
    const position = (positionByTopic.get(topicKey) || 0) + 1;
    positionByTopic.set(topicKey, position);

    const title = cleanTitle(session, isOpencode);
    const agentName = agentFor(session);
    const deviceId = deviceFor(session);
    const taskId = id('tsk');

    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO tasks (id, topic_id, title, external_key, priority, position, created_at, updated_at)
        VALUES (${taskId}, ${session.topic_id}, ${title.slice(0, 200)}, ${session.external_key}, 0, ${position}, now(), now())
      `;
      await tx`
        UPDATE sessions
        SET task_id = ${taskId}, agent_name = ${agentName}, device_id = ${deviceId}, updated_at = now()
        WHERE id = ${session.id}
      `;
    });

    created += 1;
    if (created % 100 === 0) console.log(`backfill-tasks: ... ${created} tasks`);
  }

  console.log(`backfill-tasks: done — created ${created} tasks and linked their sessions`);
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch((error) => {
    console.error('backfill-tasks failed:', error.message);
    sql.end({ timeout: 5 }).finally(() => process.exit(1));
  });
