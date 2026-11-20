/**
 * Apply the task-rename plans produced by the naming subagents
 * (/tmp/rename-*.json) to the database. Only the task title changes; timestamps
 * are left alone.
 */

const postgres = require('postgres');
const fs = require('fs');

const sql = postgres(process.env.DATABASE_URL, { connect_timeout: 10, max: 1 });

const FILES = ['channel', 'small', 'genlife', 'divedeep', 'uncat'];

async function main() {
  const renames = [];
  for (const f of FILES) {
    const p = `/tmp/rename-${f}.json`;
    try {
      const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
      renames.push(...arr);
    } catch (e) {
      console.error(`apply-naming: skipped ${p}: ${e.message}`);
    }
  }

  let applied = 0;
  for (const r of renames) {
    if (!r || !r.task_id || !r.title) continue;
    const title = String(r.title).trim().slice(0, 200);
    if (!title) continue;
    const [row] = await sql`SELECT id FROM tasks WHERE id = ${r.task_id} LIMIT 1`;
    if (!row) continue;
    await sql`UPDATE tasks SET title = ${title} WHERE id = ${r.task_id}`;
    applied += 1;
  }
  console.log(`apply-naming: renamed ${applied} tasks (of ${renames.length} planned)`);
}

main().then(() => sql.end({ timeout: 5 })).catch((e) => { console.error(e.message); process.exit(1); });
