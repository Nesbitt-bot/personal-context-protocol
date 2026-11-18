/**
 * Dump every session's task id, category, title, folder, and the first user +
 * assistant message content (the actual work) to /tmp/pcp-sessions.json so
 * naming subagents can read real content instead of guessing from folder names.
 */

const postgres = require('postgres');
const fs = require('fs');

const sql = postgres(process.env.DATABASE_URL, { connect_timeout: 10, max: 1 });

async function main() {
  const rows = await sql`
    SELECT s.task_id, s.id AS session_id, s.title,
           COALESCE(tp.title, '') AS category,
           split_part(split_part(s.title, ':', 3), ' [', 1) AS folder,
           (SELECT m.content FROM messages m WHERE m.session_id = s.id AND m.role = 'user' ORDER BY m.ordinal LIMIT 1) AS first_user,
           (SELECT m.content FROM messages m WHERE m.session_id = s.id AND m.role = 'assistant' ORDER BY m.ordinal LIMIT 1) AS first_assistant,
           (SELECT count(*) FROM messages m WHERE m.session_id = s.id) AS message_count
    FROM sessions s
    LEFT JOIN topics tp ON tp.id = s.topic_id
    ORDER BY s.title
  `;
  fs.writeFileSync('/tmp/pcp-sessions.json', JSON.stringify(rows, null, 2));
  console.log(`dump-sessions: wrote ${rows.length} sessions to /tmp/pcp-sessions.json`);
}

main().then(() => sql.end({ timeout: 5 })).catch((e) => { console.error(e.message); process.exit(1); });
