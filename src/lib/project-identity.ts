/**
 * Cross-machine project identity, matching the OpenCode session-manager
 * plugin (`opencode/lib/project-identity.ts` in Trance-0/AGENTS.md) so a PCP
 * project maps one-to-one to the plugin's canonical project:
 *
 *   1. A git remote, normalized to `host/owner/repo` exactly like the plugin's
 *      `remoteKey` (scheme, credentials, `.git` and trailing slashes dropped,
 *      host lower-cased). Canonical key `git:<remote, lower-cased>`, so two
 *      machines that cloned the same repository share one project whatever
 *      directory they used.
 *   2. Otherwise the directory basename, lower-cased: `name:<basename>`
 *      (the plugin's `idForName`). Different names for one project are tied
 *      together by the explicit `project_aliases` table, never by guessing.
 *
 * Pure: no I/O, safe for the browser, the server and tests.
 */

export const DEVICE_KINDS = ['openclaw-container', 'linux', 'linux-remote', 'windows', 'macos'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];

export const MAX_REMOTES = 20;
/** `git:<remote>` or `name:<basename>`; a directory name may contain inner spaces. */
export const CANONICAL_KEY_PATTERN = /^(git|name):(?=\S)[^\u0000-\u001f\u007f]{1,300}(?<=\S)$/;

/** `D:\x\` and `d:/x` compare equal; trailing separators are dropped. */
export function normalizeDirectory(directory: string): string {
  const unified = String(directory || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
  return unified.replace(/^([a-z]):\//, (_m, drive: string) => `${drive.toUpperCase()}:/`);
}

export function isAbsoluteDirectory(directory: string): boolean {
  return /^\//.test(directory) || /^[A-Za-z]:\//.test(directory);
}

export function directoryBasename(directory: string): string {
  const cleaned = normalizeDirectory(directory);
  const index = cleaned.lastIndexOf('/');
  return index < 0 ? cleaned : cleaned.slice(index + 1);
}

/** Reduce a git remote URL to `host/owner/repo`; '' when it is not one. */
export function normalizeRemote(remote: string): string {
  const value = String(remote || '').trim();
  if (!value) return '';
  const parts = (host: string, name: string) => {
    const pathname = name.replace(/^\/+/, '').replace(/\.git\/?$/, '').replace(/\/+$/, '');
    if (!host || !pathname || /\s/.test(pathname)) return '';
    return `${host.toLowerCase()}/${pathname}`;
  };
  // Already normalized (`github.com/owner/repo`).
  if (/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}(:\d+)?\/[^\s]+$/.test(value) && !value.includes('://') && !value.includes('@')) {
    const [host, ...rest] = value.split('/');
    return parts(host.replace(/:\d+$/, ''), rest.join('/'));
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'file:') return '';
    return parts(parsed.hostname, parsed.pathname);
  } catch {
    // `git@host:owner/repo.git` is not a URL but is the common SSH form.
    const scp = value.match(/^([^@/:]+@)?([^/:]+):(.+)$/);
    return scp ? parts(scp[2], scp[3]) : '';
  }
}

export function remoteCanonicalKey(remote: string): string {
  const normalized = normalizeRemote(remote);
  return normalized ? `git:${normalized.toLowerCase()}` : '';
}

export function nameCanonicalKey(name: string): string {
  const cleaned = String(name || '').trim().toLowerCase();
  return cleaned ? `name:${cleaned}` : '';
}

/** Canonical key: the first usable remote wins, then the name. */
export function canonicalKeyFor(input: { remotes?: string[]; name?: string | null; directory?: string | null }): string {
  for (const remote of input.remotes || []) {
    const key = remoteCanonicalKey(remote);
    if (key) return key;
  }
  return nameCanonicalKey(input.name || (input.directory ? directoryBasename(input.directory) : ''));
}

/** Deduplicated normalized remotes, preserving first-seen order and case. */
export function mergeRemotes(...lists: Array<readonly string[] | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const remote of list || []) {
      const normalized = normalizeRemote(remote);
      if (!normalized || seen.has(normalized.toLowerCase())) continue;
      seen.add(normalized.toLowerCase());
      out.push(normalized);
    }
  }
  return out.slice(0, MAX_REMOTES);
}

/**
 * Directories that are not real workspaces: the session-manager's per-project
 * placeholder worktrees (which let OpenCode list other machines' sessions)
 * and Codex's throwaway per-task worktrees.
 */
export function isEphemeralDirectory(directory: string): boolean {
  const d = normalizeDirectory(directory);
  return /\/\.local\/share\/opencode\/session-manager\/projects\//.test(d) || /\/\.codex\/worktrees\//.test(d);
}

/** Device kind from the plugin's device id prefix (`win-`, `mac-`, `linux-`). */
export function deviceKindFromId(deviceId: string, hostDeviceId?: string | null): DeviceKind {
  if (deviceId.startsWith('openclaw')) return 'openclaw-container';
  if (deviceId.startsWith('win-')) return 'windows';
  if (deviceId.startsWith('mac-') || deviceId.startsWith('darwin-')) return 'macos';
  return hostDeviceId && deviceId === hostDeviceId ? 'linux' : 'linux-remote';
}

export function isDeviceKind(value: unknown): value is DeviceKind {
  return typeof value === 'string' && (DEVICE_KINDS as readonly string[]).includes(value);
}
