/**
 * Reconcile task projects with the canonical OpenCode projects.
 *
 * organize-projects.mjs linked every session to its canonical repo project
 * (git:<remote> or name:<folder>). This script re-points each leaf task's
 * project tag to its session's canonical project, then removes the leftover
 * folder-name projects that no longer have any session or task.
 */

const postgres = require('postgres');
const sql = postgres(process.env.DATABASE_URL, { connect_timeout: 10, max: 1 });

async function main() {
  // 1. Re-point every leaf task to its session's canonical project.
  const sessions = await sql`SELECT task_id, project_id FROM sessions WHERE task_id IS NOT NULL AND project_id IS NOT NULL`;
  for (const s of sessions) {
    await sql`DELETE FROM task_projects WHERE task_id = ${s.task_id}`;
    await sql`INSERT INTO task_projects (task_id, project_id, is_primary, created_at) VALUES (${s.task_id}, ${s.project_id}, true, now()) ON CONFLICT (task_id, project_id) DO NOTHING`;
  }
  console.log(`reconcile-projects: re-pointed ${sessions.length} leaf tasks`);

  // 2. Remove name:<folder> projects that are no longer referenced by any
  // session or task (the duplicates my earlier folder-name pass created).
  const deleted = await sql`
    DELETE FROM projects
    WHERE canonical_key LIKE 'name:%'
      AND id NOT IN (SELECT project_id FROM sessions WHERE project_id IS NOT NULL)
      AND id NOT IN (SELECT project_id FROM task_projects)
    RETURNING id, canonical_key
  `;
  console.log(`reconcile-projects: removed ${deleted.length} unreferenced name projects`);

  const [stats] = await sql`SELECT
    (SELECT count(*) FROM projects) AS total,
    (SELECT count(*) FROM projects WHERE canonical_key LIKE 'git:%') AS git,
    (SELECT count(*) FROM projects WHERE canonical_key LIKE 'name:%') AS name`;
  console.log(`reconcile-projects: now ${stats.total} projects (${stats.git} git, ${stats.name} name)`);
}

main().then(() => sql.end({ timeout: 5 })).catch((e) => { console.error(e.message); process.exit(1); });
