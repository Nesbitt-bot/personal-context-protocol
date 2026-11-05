import { describe, it, expect } from 'vitest';
import {
  CANONICAL_KEY_PATTERN, canonicalKeyFor, deviceKindFromId, isEphemeralDirectory, mergeRemotes, nameCanonicalKey,
  normalizeDirectory, normalizeRemote, remoteCanonicalKey,
} from '../src/lib/project-identity';
import { openclawSuggestion, startDevSnippet } from '../src/lib/dev-snippets';

describe('project identity (mirrors the OpenCode session-manager plugin)', () => {
  it('normalizes git remotes to host/owner/repo like remoteKey', () => {
    expect(normalizeRemote('https://github.com/Trance-0/circtime.git')).toBe('github.com/Trance-0/circtime');
    expect(normalizeRemote('git@github.com:Trance-0/circtime.git')).toBe('github.com/Trance-0/circtime');
    expect(normalizeRemote('ssh://git@GitHub.com/Trance-0/circtime/')).toBe('github.com/Trance-0/circtime');
    expect(normalizeRemote('https://user:secret@git.trance-0.com/Trance-0/CashFlow.git')).toBe('git.trance-0.com/Trance-0/CashFlow');
    expect(normalizeRemote('github.com/Trance-0/circtime')).toBe('github.com/Trance-0/circtime');
    expect(normalizeRemote('file:///srv/repo.git')).toBe('');
    expect(normalizeRemote('not a remote')).toBe('');
    expect(normalizeRemote('')).toBe('');
  });

  it('keys a project by remote (case-insensitive), else by lower-cased name', () => {
    expect(remoteCanonicalKey('git@github.com:Trance-0/CircTime.git')).toBe('git:github.com/trance-0/circtime');
    expect(canonicalKeyFor({ remotes: ['nonsense', 'https://github.com/Trance-0/circtime'] })).toBe('git:github.com/trance-0/circtime');
    expect(canonicalKeyFor({ name: 'CashFlow' })).toBe('name:cashflow');
    expect(canonicalKeyFor({ directory: 'D:\\Documents\\Gitea\\CashFlow\\' })).toBe('name:cashflow');
    expect(nameCanonicalKey('  ')).toBe('');
  });

  it('accepts canonical keys with inner spaces (directory names) but not padding or control characters', () => {
    expect(CANONICAL_KEY_PATTERN.test('name:default project')).toBe(true);
    expect(CANONICAL_KEY_PATTERN.test('git:github.com/o/r')).toBe(true);
    expect(CANONICAL_KEY_PATTERN.test('name: padded')).toBe(false);
    expect(CANONICAL_KEY_PATTERN.test('name:x\n')).toBe(false);
    expect(CANONICAL_KEY_PATTERN.test('other:x')).toBe(false);
  });

  it('normalizes Windows and POSIX directories so the same checkout compares equal', () => {
    expect(normalizeDirectory('d:\\Documents\\Github\\circtime\\')).toBe('D:/Documents/Github/circtime');
    expect(normalizeDirectory('D:/Documents/Github/circtime')).toBe('D:/Documents/Github/circtime');
    expect(normalizeDirectory('/home/me/repo/')).toBe('/home/me/repo');
  });

  it('merges remotes without duplicates and never drops existing ones', () => {
    expect(mergeRemotes(['github.com/a/b'], ['https://github.com/A/B.git', 'git@gitea.example:a/b.git'])).toEqual(['github.com/a/b', 'gitea.example/a/b']);
  });

  it('recognizes placeholder and throwaway directories that are not workspaces', () => {
    expect(isEphemeralDirectory('/home/u/.local/share/opencode/session-manager/projects/circtime-e992855630')).toBe(true);
    expect(isEphemeralDirectory('C:\\Users\\u\\.codex\\worktrees\\0dc3\\Notechondria')).toBe(true);
    expect(isEphemeralDirectory('D:/Documents/Github/circtime')).toBe(false);
  });

  it('derives the device kind from the plugin device id', () => {
    expect(deviceKindFromId('win-384de1b4')).toBe('windows');
    expect(deviceKindFromId('mac-0000aaaa')).toBe('macos');
    expect(deviceKindFromId('linux-1048b0a6', 'linux-1048b0a6')).toBe('linux');
    expect(deviceKindFromId('linux-deadbeef', 'linux-1048b0a6')).toBe('linux-remote');
    expect(deviceKindFromId('openclaw-gateway')).toBe('openclaw-container');
  });
});

describe('start-dev snippets', () => {
  it('clones then enters the directory on Linux, quoting unusual paths', () => {
    expect(startDevSnippet({ device_kind: 'linux', directory: '/home/me/circtime', default_branch: 'main' }, 'github.com/Trance-0/circtime')).toEqual([
      '[ -d /home/me/circtime ] || git clone --branch main https://github.com/Trance-0/circtime.git /home/me/circtime',
      'cd /home/me/circtime',
      expect.stringContaining('opencode'),
    ]);
    expect(startDevSnippet({ device_kind: 'linux-remote', directory: "/srv/my repo's" }, null)[0]).toBe(`cd '/srv/my repo'\\''s'`);
  });

  it('uses PowerShell with backslash paths on Windows', () => {
    const lines = startDevSnippet({ device_kind: 'windows', directory: 'D:/Documents/Github/circtime' }, 'github.com/Trance-0/circtime');
    expect(lines[0]).toBe('if (-not (Test-Path "D:\\Documents\\Github\\circtime")) { git clone https://github.com/Trance-0/circtime.git "D:\\Documents\\Github\\circtime" }');
    expect(lines[1]).toBe('Set-Location "D:\\Documents\\Github\\circtime"');
  });

  it('suggests the OpenClaw container checkout path for projects with a remote', () => {
    expect(openclawSuggestion('github.com/Trance-0/circtime')).toEqual({ device_kind: 'openclaw-container', directory: '/home/node/.openclaw/workspace/git/circtime' });
    expect(openclawSuggestion(null)).toBeNull();
  });
});
