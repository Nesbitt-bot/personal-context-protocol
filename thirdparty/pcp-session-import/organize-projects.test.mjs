import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planProjects, summarize, contextTitleFrom, idForRemote, realDirectory } from './projects-lib.mjs';

const PLACEHOLDER = '/home/u/.local/share/opencode/session-manager/projects';
const s = (externalKey, fields) => ({ externalKey, originDevice: 'win-1', updated: 1_790_000_000_000, directories: [], ...fields });

test('same repository on two machines merges by remote; placeholder dirs are not workspaces', () => {
  const plan = planProjects([
    s('win-1:codex:a', { directories: ['D:\\Documents\\Github\\circtime', `${PLACEHOLDER}/circtime-e992855630`], remote: 'github.com/Trance-0/circtime', branch: 'main' }),
    s('linux-1:codex:b', { originDevice: 'linux-1', directories: ['/home/u/work/circtime'], remote: 'git@github.com:Trance-0/circtime.git' }),
  ], { hostDevice: 'linux-1' });
  assert.equal(plan.projects.length, 1);
  const [p] = plan.projects;
  assert.equal(p.canonical_key, 'git:github.com/trance-0/circtime');
  assert.deepEqual(p.git_remotes, ['github.com/Trance-0/circtime']);
  assert.deepEqual(p.workspaces.map((w) => [w.device_id, w.device_kind, w.directory, w.default_branch]), [
    ['linux-1', 'linux', '/home/u/work/circtime', undefined],
    ['win-1', 'windows', 'D:/Documents/Github/circtime', 'main'],
  ]);
});

test('a session without a remote joins the project of its directory, and its name becomes an alias', () => {
  const plan = planProjects([
    s('win-1:codex:a', { directories: ['D:/Nextcloud/marketing-roi-analysis'], remote: 'https://github.com/Trance-0/MTA-strategy-optimizer.git' }),
    s('win-1:dsh:b', { directories: ['d:\\Nextcloud\\marketing-roi-analysis\\'] }),
  ]);
  assert.equal(plan.projects.length, 1);
  assert.equal(plan.projects[0].canonical_key, 'git:github.com/trance-0/mta-strategy-optimizer');
  assert.deepEqual(plan.projects[0].aliases, ['name:marketing-roi-analysis']);
  assert.deepEqual(plan.assignments.map((a) => a.source), ['session-remote', 'directory-remote']);
});

test('the plugin id (sha1 of git-remote:<remote>) identifies a remote; sibling sessions do not', () => {
  const remote = 'github.com/Trance-0/deepseek-harness';
  const plan = planProjects([
    s('win-1:codex:a', { directories: ['D:/x/deepseek-harness'], remote }),
    s('win-1:opencode:b', { directories: [`${PLACEHOLDER}/deepseek-harness-c5ed3a19b4`], projectID: idForRemote(remote) }),
    // Same OpenCode project id as a deepseek session, but another directory: stays apart.
    s('win-1:dsh:c', { directories: ['D:/x/AGENTS.md'], projectID: 'root-commit-123' }),
    s('win-1:codex:d', { directories: ['D:/x/deepseek-harness-copy'], remote, projectID: 'root-commit-123' }),
  ]);
  const keyOf = (k) => plan.assignments.find((a) => a.externalKey === k).key;
  assert.equal(keyOf('win-1:opencode:b'), 'git:github.com/trance-0/deepseek-harness');
  assert.equal(keyOf('win-1:dsh:c'), 'name:agents.md');
});

test('a unique remote for a directory name rescues checkouts elsewhere; an ambiguous one does not', () => {
  const unique = planProjects([
    s('win-1:codex:a', { directories: ['D:/a/index'], remote: 'github.com/Trance-0/index' }),
    s('win-1:dsh:b', { directories: ['C:/old/index'] }),
  ]);
  assert.equal(unique.projects.length, 1);
  const ambiguous = planProjects([
    s('win-1:codex:a', { directories: ['D:/a/index'], remote: 'github.com/one/index' }),
    s('win-1:codex:b', { directories: ['D:/b/index'], remote: 'github.com/two/index' }),
    s('win-1:dsh:c', { directories: ['C:/old/index'] }),
  ]);
  assert.equal(ambiguous.assignments.find((a) => a.externalKey === 'win-1:dsh:c').key, 'name:index');
});

test('the explicit alias table always wins and name-only projects never merge by guess', () => {
  const sessions = [
    s('win-1:dsh:a', { directories: ['D:/Gitea/pcp'] }),
    s('win-1:dsh:b', { directories: ['D:/Gitea/personal-context-protocol'], remote: 'github.com/Nesbitt-bot/personal-context-protocol' }),
  ];
  assert.equal(planProjects(sessions).projects.length, 2);
  const aliased = planProjects(sessions, { aliases: { 'name:pcp': 'git:github.com/nesbitt-bot/personal-context-protocol' } });
  assert.equal(aliased.projects.length, 1);
  assert.deepEqual(aliased.projects[0].aliases, ['name:pcp', 'name:personal-context-protocol']);
  assert.equal(aliased.assignments[0].source, 'alias:name');
});

test('a Windows path recorded by the Linux host is attributed to the Windows machine', () => {
  const plan = planProjects([
    s('linux-1:opencode:a', { originDevice: 'linux-1', directories: ['D:/Documents/Github/circtime'], remote: 'github.com/Trance-0/circtime' }),
    s('win-1:codex:b', { directories: ['D:/Documents/Github/circtime'], remote: 'github.com/Trance-0/circtime' }),
  ], { hostDevice: 'linux-1' });
  assert.deepEqual(plan.projects[0].workspaces.map((w) => w.device_id), ['win-1']);
});

test('OpenClaw checkouts become openclaw-container workspaces of matching projects only', () => {
  const plan = planProjects([s('win-1:codex:a', { directories: ['D:/x/resume'], remote: 'github.com/Trance-0/resume' })], {
    openclawRepos: [{ name: 'resume', remote: 'https://github.com/Trance-0/resume.git', branch: 'master', seen: 1_790_000_000_000 }, { name: 'other', remote: 'https://github.com/x/other.git' }],
  });
  assert.equal(plan.projects.length, 1);
  assert.deepEqual(plan.projects[0].workspaces.find((w) => w.device_kind === 'openclaw-container'), {
    device_id: 'openclaw-gateway', device_label: 'OpenClaw gateway container', device_kind: 'openclaw-container',
    directory: '/home/node/.openclaw/workspace/git/resume', default_branch: 'master', seen_at: new Date(1_790_000_000_000).toISOString(),
  });
});

test('codex throwaway worktrees and placeholders are ignored as workspaces; detached HEAD is not a branch', () => {
  const plan = planProjects([
    s('win-1:codex:a', { directories: ['C:/Users/u/.codex/worktrees/0dc3/Notechondria'], remote: 'github.com/Trance-0/Notechondria', branch: 'HEAD' }),
  ]);
  assert.equal(plan.projects[0].workspaces.length, 0);
  assert.equal(realDirectory({ directories: [`${PLACEHOLDER}/x-0123456789`, '/'] }), '');
});

test('summary counts mapped and unmapped PCP sessions and workspaces per kind', () => {
  const plan = planProjects([
    s('win-1:codex:a', { directories: ['D:/x/a'], remote: 'github.com/o/a' }),
    s('win-1:dsh:b', { directories: ['D:/x/b'] }),
  ]);
  const summary = summarize(plan, [
    { id: 'ses_1', external_key: 'win-1:codex:a', project_id: null },
    { id: 'ses_2', external_key: 'pcp:dm:telegram:1', project_id: null },
    { id: 'ses_3', external_key: null, project_id: null },
  ]);
  assert.equal(summary.pcp_sessions_mapped, 1);
  assert.equal(summary.pcp_sessions_unmapped, 2);
  assert.equal(summary.local_sessions_not_in_pcp, 1);
  assert.deepEqual(summary.workspaces_by_kind, { windows: 2 });
  assert.deepEqual(summary.projects_by_identity, { git: 1, name: 1 });
});

test('context titles drop the importer label', () => {
  assert.equal(contextTitleFrom('opencode:win-384de1b4:circtime [codex] add scripts to deploy'), 'add scripts to deploy');
  assert.equal(contextTitleFrom('plain title'), 'plain title');
  assert.equal(contextTitleFrom(''), null);
});
