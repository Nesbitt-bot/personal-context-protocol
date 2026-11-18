/**
 * Merge sessions into per-folder parent tasks and subdivide: every folder with
 * more than one session gets a grouping parent task ("<Verb> <Target>"), and the
 * existing per-session tasks become its subtasks. Folders with a single session
 * stay as leaf tasks. Grouping parents own no session; leaves own exactly one.
 *
 * Run inside the app container:  node merge-subdivide.js
 */

const crypto = require('crypto');
const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL, { connect_timeout: 10, max: 1 });

function id(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

// Folder (lowercased) -> leading verb for the grouping parent title.
const VERBS = {
  'marketing-roi-analysis': 'Analyze',
  notechondria: 'Build',
  'mta-strategy-optimizer': 'Optimize',
  'deepseek-harness': 'Build',
  'mta-sim-dataset': 'Build',
  '.cc-switch': 'Maintain',
  'chestnut-24': 'Develop',
  motuariki: 'Maintain',
  'default project': 'Work on',
  evgdscasestudy: 'Analyze',
  wuzhe: 'Develop',
  circtime: 'Develop',
  'agents.md': 'Maintain',
  station2141: 'Develop',
  index: 'Maintain',
  kaleidoscape: 'Develop',
  legacyserver: 'Maintain',
  openclaw: 'Integrate',
  'personal-context-protocol': 'Develop',
  pcp: 'Develop',
  casdoor: 'Integrate',
  qqbot: 'Maintain',
  cashflow: 'Build',
  resume: 'Prepare',
  cover_letter_factory: 'Build',
  interview: 'Prepare',
  'notenextra-origin': 'Develop',
  codebook: 'Develop',
  cse4303finalproject: 'Complete',
  cse4303finalproject_agent_workspace: 'Complete',
  gapresearch: 'Research',
  honorthesis: 'Write',
  ese417_final_project: 'Complete',
  math4202f1: 'Complete',
  finalproj: 'Complete',
};

function humanize(folder) {
  return folder
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

function parentTitle(folder) {
  const verb = VERBS[folder.toLowerCase()] || 'Work on';
  return `${verb} ${humanize(folder)}`;
}

async function main() {
  const sessions = await sql`
    SELECT s.id, s.task_id, s.topic_id, s.title,
           split_part(split_part(s.title, ':', 3), ' [', 1) AS folder
    FROM sessions s
    WHERE s.title LIKE 'opencode:%' AND s.task_id IS NOT NULL
  `;

  // Group by (topic_id, folder); a folder key is unique within its category.
  const groups = new Map();
  for (const s of sessions) {
    const key = `${s.topic_id ?? '__null__'}::${s.folder}`;
    if (!groups.has(key)) groups.set(key, { topicId: s.topic_id, folder: s.folder, tasks: [] });
    groups.get(key).tasks.push(s.task_id);
  }

  let parents = 0;
  for (const g of groups.values()) {
    const taskIds = [...new Set(g.tasks)];
    if (taskIds.length <= 1) continue; // single-session folder stays a leaf

    const title = parentTitle(g.folder).slice(0, 200);
    const [existing] = await sql`
      SELECT id FROM tasks WHERE parent_id IS NULL AND topic_id IS NOT DISTINCT FROM ${g.topicId} AND title = ${title} LIMIT 1
    `;
    let parentId = existing ? existing.id : null;
    if (!parentId) {
      parentId = id('tsk');
      await sql`
        INSERT INTO tasks (id, parent_id, topic_id, title, description, priority, position, created_at, updated_at)
        VALUES (${parentId}, NULL, ${g.topicId}, ${title}, NULL, NULL, 0, now(), now())
      `;
      parents += 1;
    }
    for (const taskId of taskIds) {
      await sql`UPDATE tasks SET parent_id = ${parentId}, topic_id = ${g.topicId}, updated_at = now() WHERE id = ${taskId} AND parent_id IS NULL`;
    }
  }

  console.log(`merge-subdivide: created ${parents} grouping parent tasks`);
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch((e) => { console.error('merge-subdivide failed:', e.message); sql.end({ timeout: 5 }).finally(() => process.exit(1)); });
