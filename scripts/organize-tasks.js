/**
 * One-time organization pass: assign every session (and its task) to one of the
 * operator's categories, and link each coding task to a repo-tag project derived
 * from the session-manager folder name in the title.
 *
 * Idempotent: rerunning re-applies the same mapping. Run inside the app
 * container (DATABASE_URL is set):  node organize-tasks.js
 */

const crypto = require('crypto');
const postgres = require('postgres');

const sql = postgres(process.env.DATABASE_URL, { connect_timeout: 10, max: 1 });

function id(prefix) {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

// Folder name (lowercased) -> category title. Unmapped coding projects stay
// uncategorized (the operator can refine later).
const CATEGORY_MAP = {
  // Agentic System: AI agent harness, QQ bot, openclaw/pcp integration.
  openclaw: 'Agentic System',
  pcp: 'Agentic System',
  'personal-context-protocol': 'Agentic System',
  qqbot: 'Agentic System',
  casdoor: 'Agentic System',
  // Note and logs: notes/knowledge base (notenextra, codebook, blogs).
  'notenextra-origin': 'Note and logs',
  codebook: 'Note and logs',
  // Notechondria
  notechondria: 'Notechondria',
  // Cashflow
  cashflow: 'Cashflow',
  // OpenSearch
  opensearch: 'OpenSearch',
  // Dive Deep: complex reasoning / analysis / simulation / academic work.
  'marketing-roi-analysis': 'Dive Deep',
  'mta-strategy-optimizer': 'Dive Deep',
  'deepseek-harness': 'Dive Deep',
  'mta-sim-dataset': 'Dive Deep',
  evgdscasestudy: 'Dive Deep',
  cse4303finalproject: 'Dive Deep',
  'cse4303finalproject_agent_workspace': 'Dive Deep',
  honorthesis: 'Dive Deep',
  gapresearch: 'Dive Deep',
  math4202f1: 'Dive Deep',
  ese417_final_project: 'Dive Deep',
  finalproj: 'Dive Deep',
  // General Life: personal / job-hunting / short-lived.
  resume: 'General Life',
  cover_letter_factory: 'General Life',
  interview: 'General Life',
};

function isCoding(session) {
  const title = session.title || '';
  const ek = session.external_key || '';
  return title.startsWith('opencode:') || ek.includes(':opencode:');
}

/** `opencode:<device>:<folder> [<kind>] <title>` -> `<folder>` */
function extractProject(title) {
  if (!title.startsWith('opencode:')) return null;
  const parts = title.split(':');
  if (parts.length < 3) return null;
  const raw = parts[2].split(' [')[0].trim();
  return raw || null;
}

async function main() {
  const sessions = await sql`SELECT id, title, external_key, task_id, topic_id, principal FROM sessions`;
  const topics = await sql`SELECT id, title FROM topics WHERE archived = false`;
  const topicId = new Map(topics.map((t) => [t.title, t.id]));

  const projectCache = new Map(); // canonical_key -> id
  let categorized = 0;
  let projectsLinked = 0;

  for (const s of sessions) {
    let category = null;
    let project = null;
    if (isCoding(s)) {
      project = extractProject(s.title);
      if (project) category = CATEGORY_MAP[project.toLowerCase()] || null;
    } else {
      category = 'General Life';
    }

    const newTopicId = category ? (topicId.get(category) ?? null) : null;
    if ((s.topic_id ?? null) !== newTopicId) {
      await sql`UPDATE sessions SET topic_id = ${newTopicId}, updated_at = now() WHERE id = ${s.id}`;
      if (s.task_id) await sql`UPDATE tasks SET topic_id = ${newTopicId}, updated_at = now() WHERE id = ${s.task_id}`;
      categorized += 1;
    }

    if (project && s.task_id) {
      const key = `name:${project}`.slice(0, 320);
      if (!projectCache.has(key)) {
        const existing = await sql`SELECT id FROM projects WHERE canonical_key = ${key} LIMIT 1`;
        if (existing[0]) {
          projectCache.set(key, existing[0].id);
        } else {
          const pid = id('prj');
          await sql`INSERT INTO projects (id, canonical_key, display_name, git_remotes_json, sync_clock_json, archived, created_at, updated_at)
                    VALUES (${pid}, ${key}, ${project.slice(0, 200)}, '[]', '{}', false, now(), now()) ON CONFLICT (canonical_key) DO NOTHING`;
          const again = await sql`SELECT id FROM projects WHERE canonical_key = ${key} LIMIT 1`;
          projectCache.set(key, again[0] ? again[0].id : pid);
        }
      }
      const projectId = projectCache.get(key);
      await sql`INSERT INTO task_projects (task_id, project_id, is_primary, created_at)
                VALUES (${s.task_id}, ${projectId}, true, now()) ON CONFLICT (task_id, project_id) DO NOTHING`;
      projectsLinked += 1;
    }
  }

  console.log(`organize-tasks: done — ${categorized} sessions/tasks re-categorized, ${projectsLinked} project links`);
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch((e) => { console.error('organize-tasks failed:', e.message); sql.end({ timeout: 5 }).finally(() => process.exit(1)); });
