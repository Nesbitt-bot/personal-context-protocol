/**
 * Pure planning for organize-projects.mjs: group de-duplicated session-manager
 * sessions into PCP projects that map one-to-one to the OpenCode
 * session-manager's canonical project identity, and find each project's
 * workspaces per machine.
 *
 * Identity rules mirror src/lib/project-identity.ts (checked by
 * tests/projects-planner.test.ts) and the plugin's createResolver:
 *   1. a git remote recorded by the session itself;
 *   2. else a remote learned for the same directory (any session, or git on
 *      this host), else the remote whose plugin id (sha1 of
 *      `git-remote:<remote>`) is the session's OpenCode project id, else the
 *      only remote ever seen for that directory name. Sibling sessions of an
 *      OpenCode project are NOT used as evidence: the plugin has grouped
 *      different repositories under one project id before.
 *   3. else the directory basename (`name:<basename>`);
 *   4. finally the explicit alias table (`--aliases`), which always wins.
 * Different hashes for one repository on different machines therefore merge
 * by remote, and name-only projects merge only through evidence (same
 * directory) or an explicit alias.
 */

import crypto from 'node:crypto';

export const OPENCLAW_GIT_ROOT = '/home/node/.openclaw/workspace/git';
export const OPENCLAW_DEVICE = { id: 'openclaw-gateway', label: 'OpenClaw gateway container', kind: 'openclaw-container' };

export function normalizeDirectory(directory) {
  const unified = String(directory || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return unified.replace(/^([a-z]):\//, (_m, drive) => `${drive.toUpperCase()}:/`);
}

export const isWindowsDirectory = (d) => /^[A-Za-z]:\//.test(normalizeDirectory(d));
export const isAbsoluteDirectory = (d) => /^\//.test(d) || /^[A-Za-z]:\//.test(d);

export function directoryBasename(directory) {
  const cleaned = normalizeDirectory(directory);
  const index = cleaned.lastIndexOf('/');
  return index < 0 ? cleaned : cleaned.slice(index + 1);
}

export function normalizeRemote(remote) {
  const value = String(remote || '').trim();
  if (!value) return '';
  const parts = (host, name) => {
    const pathname = name.replace(/^\/+/, '').replace(/\.git\/?$/, '').replace(/\/+$/, '');
    if (!host || !pathname || /\s/.test(pathname)) return '';
    return `${host.toLowerCase()}/${pathname}`;
  };
  if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:\d+)?\/[^\s]+$/.test(value) && !value.includes('://') && !value.includes('@')) {
    const [host, ...rest] = value.split('/');
    return parts(host.replace(/:\d+$/, ''), rest.join('/'));
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'file:') return '';
    return parts(parsed.hostname, parsed.pathname);
  } catch {
    const scp = value.match(/^([^@/:]+@)?([^/:]+):(.+)$/);
    return scp ? parts(scp[2], scp[3]) : '';
  }
}

export const remoteKey = (remote) => (normalizeRemote(remote) ? `git:${normalizeRemote(remote).toLowerCase()}` : '');
export const nameKey = (name) => (String(name || '').trim() ? `name:${String(name).trim().toLowerCase()}` : '');
/** The id the plugin (and OpenCode) give a repository with this remote. */
export const idForRemote = (remote) => crypto.createHash('sha1').update(`git-remote:${remote}`).digest('hex');

export function isEphemeralDirectory(directory) {
  const d = normalizeDirectory(directory);
  return /\/\.local\/share\/opencode\/session-manager\/projects\//.test(d) || /\/\.codex\/worktrees\//.test(d);
}

const isPlaceholder = (d) => /\/\.local\/share\/opencode\/session-manager\/projects\//.test(normalizeDirectory(d));

export function deviceKind(deviceId, hostDevice) {
  if (deviceId.startsWith('openclaw')) return 'openclaw-container';
  if (deviceId.startsWith('win-')) return 'windows';
  if (deviceId.startsWith('mac-') || deviceId.startsWith('darwin-')) return 'macos';
  return hostDevice && deviceId === hostDevice ? 'linux' : 'linux-remote';
}

/** The real working directory of a session (not a placeholder or a root). */
export function realDirectory(session) {
  for (const d of session.directories || [session.directory]) {
    const n = normalizeDirectory(d);
    if (n && n !== '/' && !isPlaceholder(n) && isAbsoluteDirectory(n)) return n;
  }
  return '';
}

/** Name for a session with no real directory: the placeholder folder name minus its hash. */
function fallbackName(session) {
  for (const d of session.directories || []) {
    if (isPlaceholder(d)) return directoryBasename(d).replace(/-[0-9a-f]{10,16}$/, '');
  }
  return session.project && session.project !== 'unknown' ? session.project : '';
}

const tally = (map, key, value) => {
  if (!key || !value) return;
  if (!map.has(key)) map.set(key, new Map());
  const counts = map.get(key);
  counts.set(value, (counts.get(value) || 0) + 1);
};
const top = (counts) => (counts ? [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] || '' : '');

/**
 * Build the plan.
 *
 * sessions: de-duplicated sessions from lib.mjs (with externalKey added).
 * options.liveRemotes: Map normalized directory -> remote (git on this host).
 * options.aliases: { "<key>": "<canonical key>" } explicit alias table.
 * options.hostDevice: this machine's device id (its POSIX paths are kind "linux").
 * options.openclawRepos: [{ name, remote }] checkouts in the OpenClaw container.
 */
export function planProjects(sessions, options = {}) {
  const aliases = Object.fromEntries(Object.entries(options.aliases || {}).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()]));
  const liveRemotes = options.liveRemotes || new Map();
  const warnings = [];

  const byDir = new Map();
  const byName = new Map();
  const knownRemotes = new Set();
  const prepared = sessions.map((s) => ({ s, dir: realDirectory(s), remote: normalizeRemote(s.remote) }));
  for (const { s, dir, remote } of prepared) {
    if (!remote) continue;
    knownRemotes.add(remote);
    tally(byDir, dir, remote);
    tally(byName, dir ? directoryBasename(dir).toLowerCase() : '', remote);
  }
  for (const [dir, remote] of liveRemotes) {
    const r = normalizeRemote(remote);
    if (!r) continue;
    knownRemotes.add(r);
    tally(byDir, normalizeDirectory(dir), r);
    tally(byName, directoryBasename(dir).toLowerCase(), r);
  }
  const remoteForId = new Map([...knownRemotes].map((r) => [idForRemote(r), r]));

  const projects = new Map();
  const assignments = [];
  for (const { s, dir, remote: own } of prepared) {
    const name = dir ? directoryBasename(dir) : fallbackName(s);
    const nameCounts = byName.get(name.toLowerCase());
    let remote = own;
    let source = own ? 'session-remote' : '';
    if (!remote && dir && byDir.has(dir)) { remote = top(byDir.get(dir)); source = 'directory-remote'; }
    if (!remote && s.projectID && remoteForId.has(s.projectID)) { remote = remoteForId.get(s.projectID); source = 'project-id-remote'; }
    if (!remote && nameCounts && nameCounts.size === 1) { remote = top(nameCounts); source = 'unique-name-remote'; }
    let key = remote ? remoteKey(remote) : nameKey(name);
    if (!remote) source = name ? 'name' : 'none';
    const derivedFrom = key;
    if (aliases[key]) { key = aliases[key]; source = `alias:${source}`; }
    if (!key) { assignments.push({ externalKey: s.externalKey, key: null, source, directory: dir }); continue; }

    if (!projects.has(key)) projects.set(key, { canonicalKey: key, names: new Map(), remotes: new Set(), aliases: new Set(), sessions: [], workspaces: new Map() });
    const project = projects.get(key);
    if (remote) project.remotes.add(remote);
    tally(project.names, 'n', remote ? directoryBasename(remote) : name);
    const nk = nameKey(name);
    if (nk && nk !== key) project.aliases.add(nk);
    if (derivedFrom !== key) project.aliases.add(derivedFrom);
    project.sessions.push(s.externalKey);
    assignments.push({ externalKey: s.externalKey, key, source, directory: dir });

    // Workspace: the machine the transcript was recorded on, at its real directory.
    if (!dir || isEphemeralDirectory(dir)) continue;
    let device = s.originDevice || s.device || '';
    const windowsPath = isWindowsDirectory(dir);
    if (windowsPath !== device.startsWith('win-')) {
      const winDevices = [...new Set(sessions.map((x) => x.originDevice).filter((d) => d && d.startsWith('win-')))];
      if (windowsPath && winDevices.length === 1) device = winDevices[0];
      else { warnings.push(`workspace skipped: ${dir} recorded on ${device} does not match that machine's platform`); continue; }
    }
    const wsKey = `${device}\u0000${dir}`;
    const ws = project.workspaces.get(wsKey) || { deviceId: device, deviceKind: deviceKind(device, options.hostDevice), directory: dir, branches: new Map(), lastSeen: 0 };
    if (s.branch && s.branch !== 'HEAD') tally(ws.branches, 'b', s.branch);
    ws.lastSeen = Math.max(ws.lastSeen, Number(s.updated) || 0);
    project.workspaces.set(wsKey, ws);
  }

  for (const repo of options.openclawRepos || []) {
    const key = aliases[remoteKey(repo.remote)] || remoteKey(repo.remote);
    const project = projects.get(key);
    if (!project) continue;
    const dir = `${OPENCLAW_GIT_ROOT}/${repo.name}`;
    project.remotes.add(normalizeRemote(repo.remote));
    project.workspaces.set(`${OPENCLAW_DEVICE.id}\u0000${dir}`, { deviceId: OPENCLAW_DEVICE.id, deviceLabel: OPENCLAW_DEVICE.label, deviceKind: OPENCLAW_DEVICE.kind, directory: dir, branches: new Map(repo.branch ? [['b', new Map([[repo.branch, 1]])]] : []), lastSeen: repo.seen || 0 });
  }

  const out = [...projects.values()].map((p) => ({
    canonical_key: p.canonicalKey,
    display_name: top(p.names.get('n')) || p.canonicalKey.replace(/^(git|name):/, ''),
    git_remotes: [...p.remotes].sort(),
    aliases: [...p.aliases].filter((a) => a !== p.canonicalKey).sort(),
    sessions: p.sessions.sort(),
    workspaces: [...p.workspaces.values()].map((w) => ({
      device_id: w.deviceId,
      ...(w.deviceLabel ? { device_label: w.deviceLabel } : {}),
      device_kind: w.deviceKind,
      directory: w.directory,
      ...(top(w.branches.get('b')) ? { default_branch: top(w.branches.get('b')) } : {}),
      ...(w.lastSeen ? { seen_at: new Date(w.lastSeen).toISOString() } : {}),
    })).sort((a, b) => `${a.device_id}${a.directory}`.localeCompare(`${b.device_id}${b.directory}`)),
  })).sort((a, b) => a.canonical_key.localeCompare(b.canonical_key));

  // An alias may only point at one project; report (never guess) collisions.
  const aliasOwner = new Map();
  for (const p of out) for (const a of p.aliases) {
    if (aliasOwner.has(a) && aliasOwner.get(a) !== p.canonical_key) warnings.push(`alias ${a} is claimed by ${aliasOwner.get(a)} and ${p.canonical_key}; add an explicit --aliases entry`);
    else aliasOwner.set(a, p.canonical_key);
  }
  for (const p of out) p.aliases = p.aliases.filter((a) => aliasOwner.get(a) === p.canonical_key && !projects.has(a));
  return { projects: out, assignments, warnings: [...new Set(warnings)] };
}

/** Title shown as the session's task context: the source title without the importer's label. */
export function contextTitleFrom(title) {
  return String(title || '').replace(/^opencode:[^ ]+ \[[^\]]+\] /, '').replace(/\s+/g, ' ').trim().slice(0, 300) || null;
}

/** Counts for the dry-run report. */
export function summarize(plan, pcpSessions) {
  const inPcp = new Map((pcpSessions || []).filter((s) => s.external_key).map((s) => [s.external_key, s]));
  const planned = new Map(plan.assignments.map((a) => [a.externalKey, a]));
  const mapped = plan.assignments.filter((a) => a.key && inPcp.has(a.externalKey));
  const workspacesByKind = {};
  for (const p of plan.projects) for (const w of p.workspaces) workspacesByKind[w.device_kind] = (workspacesByKind[w.device_kind] || 0) + 1;
  const bySource = {};
  for (const a of mapped) bySource[a.source] = (bySource[a.source] || 0) + 1;
  const projectsWithPcpSessions = new Set(mapped.map((a) => a.key));
  return {
    projects: plan.projects.length,
    projects_with_pcp_sessions: projectsWithPcpSessions.size,
    projects_by_identity: {
      git: plan.projects.filter((p) => p.canonical_key.startsWith('git:')).length,
      name: plan.projects.filter((p) => p.canonical_key.startsWith('name:')).length,
    },
    remotes: new Set(plan.projects.flatMap((p) => p.git_remotes)).size,
    aliases: plan.projects.reduce((n, p) => n + p.aliases.length, 0),
    pcp_sessions: inPcp.size + (pcpSessions || []).filter((s) => !s.external_key).length,
    pcp_sessions_mapped: mapped.length,
    pcp_sessions_unmapped: (pcpSessions || []).filter((s) => !s.external_key || !planned.get(s.external_key)?.key).length,
    pcp_sessions_already_in_a_project: mapped.filter((a) => inPcp.get(a.externalKey).project_id).length,
    local_sessions_not_in_pcp: plan.assignments.filter((a) => !inPcp.has(a.externalKey)).length,
    mapping_evidence: bySource,
    workspaces: plan.projects.reduce((n, p) => n + p.workspaces.length, 0),
    workspaces_by_kind: workspacesByKind,
    warnings: plan.warnings.length,
  };
}
