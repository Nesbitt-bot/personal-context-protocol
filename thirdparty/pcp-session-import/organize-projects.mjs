#!/usr/bin/env node
/**
 * Organize imported coding sessions into PCP projects (PCP >= 0.2.2).
 *
 *   node organize-projects.mjs --shared DIR [--shared DIR]... [--opencode-db FILE]
 *        [--device-file FILE] [--aliases FILE] [--openclaw-git DIR]
 *        [--pcp-sessions FILE] [--base-url URL --token-file FILE] [--apply]
 *        [--all-projects] [--plan-out FILE] [--json]
 *
 * Reads the same session-manager sources as import-sessions.mjs, groups the
 * sessions into projects that map one-to-one to the plugin's canonical
 * project identity (projects-lib.mjs), and finds each project's workspace per
 * machine from the sessions' real directories (Windows paths normalized),
 * plus the OpenClaw container checkouts under --openclaw-git.
 *
 * Dry run is the default and never writes anywhere. PCP's current sessions
 * come from --pcp-sessions (a read-only export: `pcp-operator.js sessions
 * export`) or, with --base-url/--token-file, from read-only by-key lookups.
 *
 * --apply (needs --base-url, --token-file and a scoped token with
 * manage_projects) only ADDS: it ensures each project (by canonical key),
 * registers its workspaces and links each PCP session to its project with a
 * task context title, through the manager API and its conflict policy, using
 * each session's own last-update time and origin device as the write clock.
 * It never deletes and never touches message content; a rerun changes
 * nothing. Tokens are read from a file and never printed.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readSharedFolder, readOpencodeDb, dedupe, externalKey } from './lib.mjs';
import { planProjects, summarize, contextTitleFrom, normalizeDirectory, isWindowsDirectory } from './projects-lib.mjs';

function parseArgs(argv) {
  const opts = { shared: [], apply: false, json: false, allProjects: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    if (arg === '--shared') opts.shared.push(next());
    else if (arg === '--opencode-db') opts.opencodeDb = next();
    else if (arg === '--device-file') opts.deviceFile = next();
    else if (arg === '--aliases') opts.aliases = next();
    else if (arg === '--openclaw-git') opts.openclawGit = next();
    else if (arg === '--pcp-sessions') opts.pcpSessions = next();
    else if (arg === '--base-url') opts.baseUrl = next().replace(/\/+$/, '');
    else if (arg === '--token-file') opts.tokenFile = next();
    else if (arg === '--plan-out') opts.planOut = next();
    else if (arg === '--apply') opts.apply = true;
    else if (arg === '--dry-run') opts.apply = false;
    else if (arg === '--all-projects') opts.allProjects = true;
    else if (arg === '--json') opts.json = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (opts.apply && (!opts.baseUrl || !opts.tokenFile)) throw new Error('--apply needs --base-url and --token-file');
  return opts;
}

function localDevice(file) {
  for (const candidate of [file, path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'opencode', 'device.json')].filter(Boolean)) {
    try {
      const id = JSON.parse(fs.readFileSync(candidate, 'utf8')).id;
      if (typeof id === 'string' && id) return id;
    } catch {
      // next location
    }
  }
  return null;
}

/** Read-only git query; '' when the directory is not a repository. */
function git(dir, args) {
  try {
    return execFileSync('git', ['-c', 'safe.directory=*', '-C', dir, ...args], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

const progress = (msg) => process.stderr.write(`organize-projects: ${msg}\n`);

async function call(opts, token, method, route, body) {
  const res = await fetch(`${opts.baseUrl}/api/v1${route}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { error: text.slice(0, 200) }; }
  if (!res.ok) throw new Error(`PCP ${method} ${route.split('?')[0].split('/').slice(0, 4).join('/')} failed (${res.status}): ${parsed?.error ?? ''}`);
  return parsed;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const hostDevice = localDevice(opts.deviceFile);
  const candidates = [];
  const unreadable = [];
  for (const dir of opts.shared) for (const s of readSharedFolder(dir, (file) => unreadable.push(file))) candidates.push(s);
  if (opts.opencodeDb) candidates.push(...readOpencodeDb(opts.opencodeDb, hostDevice));
  const sessions = dedupe(candidates).map((s) => ({ ...s, externalKey: externalKey(s) }));
  progress(`${candidates.length} revisions, ${sessions.length} distinct sessions`);

  // Remotes of this host's own checkouts that the transcripts mention (read-only git).
  const liveRemotes = new Map();
  const hostDirs = new Set(sessions.filter((s) => (s.originDevice === hostDevice)).flatMap((s) => (s.directories || []).map(normalizeDirectory)).filter((d) => d.startsWith('/') && !isWindowsDirectory(d)));
  for (const dir of hostDirs) {
    if (!fs.existsSync(dir)) continue;
    const remote = git(dir, ['remote', 'get-url', 'origin']);
    if (remote) liveRemotes.set(dir, remote);
  }

  const openclawRepos = [];
  if (opts.openclawGit && fs.existsSync(opts.openclawGit)) {
    for (const name of fs.readdirSync(opts.openclawGit).sort()) {
      const dir = path.join(opts.openclawGit, name);
      if (!fs.existsSync(path.join(dir, '.git'))) continue;
      const remote = git(dir, ['remote', 'get-url', 'origin']);
      if (!remote) continue;
      const head = git(dir, ['rev-parse', '--abbrev-ref', 'origin/HEAD']).replace(/^origin\//, '');
      let seen = 0;
      try { seen = fs.statSync(path.join(dir, '.git', 'HEAD')).mtimeMs; } catch { /* unknown */ }
      openclawRepos.push({ name, remote, branch: head && head !== 'origin/HEAD' ? head : null, seen: Math.floor(seen) });
    }
  }

  const aliases = opts.aliases ? JSON.parse(fs.readFileSync(opts.aliases, 'utf8')) : {};
  const plan = planProjects(sessions, { hostDevice, liveRemotes, aliases, openclawRepos });

  const token = opts.tokenFile ? fs.readFileSync(opts.tokenFile, 'utf8').trim() : null;
  let pcpSessions = null;
  if (opts.pcpSessions) {
    pcpSessions = JSON.parse(fs.readFileSync(opts.pcpSessions, 'utf8')).sessions;
  } else if (opts.baseUrl && token) {
    pcpSessions = [];
    for (const [i, s] of sessions.entries()) {
      const r = await call(opts, token, 'GET', `/manager/sessions/by-key/${encodeURIComponent(s.externalKey)}`);
      if (r.found) pcpSessions.push({ id: r.session_id, external_key: s.externalKey, title: r.title, project_id: null });
      if ((i + 1) % 50 === 0) progress(`looked up ${i + 1}/${sessions.length} keys`);
    }
  }
  const summary = { host_device: hostDevice, revisions_read: candidates.length, unreadable_files: unreadable.length, sessions_found_locally: sessions.length, openclaw_checkouts: openclawRepos.length, ...summarize(plan, pcpSessions || []) };

  if (opts.planOut) {
    const inPcp = new Map((pcpSessions || []).map((s) => [s.external_key, s]));
    const out = { generated_at: new Date().toISOString(), summary, warnings: plan.warnings, projects: plan.projects.map((p) => ({ ...p, sessions: p.sessions.map((k) => ({ external_key: k, in_pcp: inPcp.has(k) })) })) };
    fs.writeFileSync(opts.planOut, `${JSON.stringify(out, null, 2)}\n`, { mode: 0o600 });
  }

  if (opts.apply) {
    const inPcp = new Map(pcpSessions.map((s) => [s.external_key, s]));
    const bySession = new Map(sessions.map((s) => [s.externalKey, s]));
    const result = { projects_created: 0, projects_existing: 0, remotes_added: 0, aliases_added: 0, alias_conflicts: [], workspaces_created: 0, workspaces_changed: 0, sessions_linked: 0, sessions_unchanged: 0, session_conflicts: 0, failures: [] };
    let done = 0;
    for (const p of plan.projects) {
      const pcpKeys = p.sessions.filter((k) => inPcp.has(k));
      if (!pcpKeys.length && !opts.allProjects) continue;
      try {
        const ensured = await call(opts, token, 'POST', '/manager/projects', { canonical_key: p.canonical_key, display_name: p.display_name, git_remotes: p.git_remotes, aliases: p.aliases });
        ensured.created ? result.projects_created++ : result.projects_existing++;
        result.remotes_added += ensured.remotes_added.length;
        result.aliases_added += ensured.aliases_added.length;
        result.alias_conflicts.push(...ensured.alias_conflicts.map((c) => ({ ...c, project: p.canonical_key })));
        const projectId = ensured.project.id;
        for (const ws of p.workspaces) {
          const r = await call(opts, token, 'POST', `/manager/projects/${encodeURIComponent(projectId)}/workspaces`, ws);
          if (r.created) result.workspaces_created++;
          else if (r.changed.length) result.workspaces_changed++;
        }
        for (const key of pcpKeys) {
          const local = bySession.get(key);
          const at = new Date(Math.max(Number(local?.updated) || 0, Date.parse('2000-01-01T00:00:00Z'))).toISOString();
          const r = await call(opts, token, 'PATCH', `/manager/sessions/by-key/${encodeURIComponent(key)}/context`, {
            project_id: projectId,
            context_title: contextTitleFrom(inPcp.get(key).title) || contextTitleFrom(local?.title),
            updated_at: at,
            device_id: local?.originDevice || 'pcp-reorg',
          });
          r.applied.includes('project_id') ? result.sessions_linked++ : result.sessions_unchanged++;
          result.session_conflicts += r.conflicts.length;
          if (++done % 25 === 0) progress(`linked ${done} sessions`);
        }
      } catch (error) {
        result.failures.push({ project: p.canonical_key, error: error instanceof Error ? error.message : String(error) });
      }
    }
    summary.apply = result;
    if (result.failures.length) process.exitCode = 1;
  }

  console.log(JSON.stringify(opts.json ? { summary, warnings: plan.warnings, projects: plan.projects } : { summary, warnings: plan.warnings }, null, 2));
}

main().catch((error) => {
  console.error(`organize-projects: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
