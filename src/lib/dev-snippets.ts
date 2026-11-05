import type { DeviceKind } from './project-identity';

/**
 * "How to start dev here" snippets shown per workspace on the project page.
 * Pure so the page and the tests render the same text.
 */

export const OPENCLAW_GIT_ROOT = '/home/node/.openclaw/workspace/git';

export interface SnippetWorkspace {
  device_kind: DeviceKind | string;
  directory: string;
  default_branch?: string | null;
}

function cloneUrl(remote: string): string {
  return `https://${remote}.git`;
}

function repoName(remote: string | null, directory: string): string {
  const source = remote || directory;
  return source.replace(/\/+$/, '').split('/').pop() || 'project';
}

/** PowerShell quoting for Windows paths; POSIX single quotes elsewhere. */
function quote(directory: string, windows: boolean): string {
  if (windows) return `"${directory.replace(/\//g, '\\').replace(/"/g, '`"')}"`;
  return /^[A-Za-z0-9_./~-]+$/.test(directory) ? directory : `'${directory.replace(/'/g, `'\\''`)}'`;
}

export function startDevSnippet(workspace: SnippetWorkspace, remote: string | null): string[] {
  const windows = workspace.device_kind === 'windows';
  const dir = quote(workspace.directory, windows);
  const branch = workspace.default_branch ? ` --branch ${workspace.default_branch}` : '';
  const lines: string[] = [];
  if (windows) {
    if (remote) lines.push(`if (-not (Test-Path ${dir})) { git clone${branch} ${cloneUrl(remote)} ${dir} }`);
    lines.push(`Set-Location ${dir}`);
  } else {
    if (remote) lines.push(`[ -d ${dir} ] || git clone${branch} ${cloneUrl(remote)} ${dir}`);
    lines.push(`cd ${dir}`);
  }
  if (workspace.device_kind === 'openclaw-container') {
    lines.push('# inside the OpenClaw gateway container (docker exec -it <gateway> sh), or ask the agent to work here');
  } else {
    lines.push('opencode   # Session Manager lists every machine\'s sessions for this project; pick one to resume');
  }
  return lines;
}

/** Suggested OpenClaw container checkout for a project with a remote. */
export function openclawSuggestion(remote: string | null, directory?: string | null): SnippetWorkspace | null {
  if (!remote) return null;
  return { device_kind: 'openclaw-container', directory: `${OPENCLAW_GIT_ROOT}/${repoName(remote, directory || '')}` };
}
