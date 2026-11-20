/**
 * Rename each task to a meaningful "Verb + Target …" title derived from its
 * session's own summary (the part after the `[kind]` in the session-manager
 * title). Session titles are left untouched — the local agent owns those.
 *
 * Run inside the app container:  node rename-tasks.js
 */

const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL, { connect_timeout: 10, max: 1 });

function descriptionFor(title) {
  if (!title || !title.startsWith('opencode:')) return null;
  const m = title.match(/\]\s+(.+)$/);
  if (!m) return null;
  return m[1]
    .replace(/<[^>]*>/g, ' ') // strip <command-message> etc.
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

async function main() {
  const rows = await sql`SELECT task_id, title FROM sessions WHERE task_id IS NOT NULL`;
  let renamed = 0;
  for (const r of rows) {
    const desc = descriptionFor(r.title);
    if (!desc) continue;
    const existing = await sql`SELECT title FROM tasks WHERE id = ${r.task_id} LIMIT 1`;
    if (existing[0] && existing[0].title !== desc) {
      await sql`UPDATE tasks SET title = ${desc}, updated_at = now() WHERE id = ${r.task_id}`;
      renamed += 1;
    }
  }
  console.log(`rename-tasks: renamed ${renamed} tasks from their session summaries`);
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch((e) => { console.error('rename-tasks failed:', e.message); sql.end({ timeout: 5 }).finally(() => process.exit(1)); });
