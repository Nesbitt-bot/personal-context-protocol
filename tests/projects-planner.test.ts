import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { describe, it, expect, beforeAll } from 'vitest';
import * as app from '../src/lib/project-identity';

/**
 * The reorganization planner (thirdparty/pcp-session-import/projects-lib.mjs,
 * plain Node, outside the image) must compute exactly the identities the app
 * computes, or a rerun through the API would create a second project.
 */
type PlannerModule = {
  normalizeRemote: (v: string) => string;
  normalizeDirectory: (v: string) => string;
  remoteKey: (v: string) => string;
  nameKey: (v: string) => string;
  isEphemeralDirectory: (v: string) => boolean;
  deviceKind: (id: string, host?: string) => string;
};

// thirdparty/ is excluded from the Docker build context (.dockerignore), so in
// the CI image this check is skipped; it runs from a repository checkout.
const PLANNER = path.join(__dirname, '../thirdparty/pcp-session-import/projects-lib.mjs');

describe.skipIf(!fs.existsSync(PLANNER))('planner and app agree on project identity', () => {
  let planner: PlannerModule;
  beforeAll(async () => {
    planner = (await import(/* @vite-ignore */ pathToFileURL(PLANNER).href)) as PlannerModule;
  });

  const remotes = [
    'https://github.com/Trance-0/circtime.git', 'git@github.com:Trance-0/circtime.git', 'ssh://git@GitHub.com/Trance-0/circtime/',
    'https://user:pw@git.trance-0.com/Trance-0/CashFlow.git', 'github.com/Nesbitt-bot/personal-context-protocol', 'file:///srv/x.git', '', 'nonsense',
  ];
  const dirs = ['d:\\Documents\\Github\\circtime\\', '/home/u/x/', 'C:/Users/u/.codex/worktrees/0dc3/N', '/home/u/.local/share/opencode/session-manager/projects/a-0123456789'];

  it('normalizes remotes and keys identically', () => {
    for (const r of remotes) {
      expect(planner.normalizeRemote(r)).toBe(app.normalizeRemote(r));
      expect(planner.remoteKey(r)).toBe(app.remoteCanonicalKey(r));
    }
    expect(planner.nameKey('CashFlow')).toBe(app.nameCanonicalKey('CashFlow'));
  });

  it('normalizes directories and classifies them identically', () => {
    for (const d of dirs) {
      expect(planner.normalizeDirectory(d)).toBe(app.normalizeDirectory(d));
      expect(planner.isEphemeralDirectory(d)).toBe(app.isEphemeralDirectory(d));
    }
    for (const id of ['win-1', 'mac-1', 'linux-host', 'linux-other', 'openclaw-gateway']) {
      expect(planner.deviceKind(id, 'linux-host')).toBe(app.deviceKindFromId(id, 'linux-host'));
    }
  });
});
